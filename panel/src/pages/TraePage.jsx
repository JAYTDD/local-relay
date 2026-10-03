import React, { useState } from 'react';
import ChannelLayout from '../components/ChannelLayout.jsx';
import CreditsPanel from '../components/CreditsPanel.jsx';
import ModelTable from '../components/ModelTable.jsx';
import { CopyButton, Disclosure, EmptyState, LoadingBlock, Notice, Section, StatusPill, fmtCtx, fmtNum, fmtTime } from '../components/primitives.jsx';
import { AlertIcon, CalendarCheckIcon, PlaneIcon, RefreshIcon } from '../components/icons.jsx';
import { api } from '../api.js';
import { useAsyncData } from '../hooks.js';

const REGIONS = [
  { key: 'cn', label: '国内版' },
  { key: 'ai', label: '国际版' },
];

/** Trae 通道页：登录态、额度、签到、模型目录 */
export default function TraePage({ region, onRegion }) {
  const { data, loading, error, reload } = useAsyncData(api.getTrae);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // {kind, text}

  const doc = data?.regions?.[region];

  async function refresh() {
    setBusy(true);
    setNotice(null);
    try {
      const out = await api.postTraeRefresh(region);
      const errs = (out?.errors ?? []).filter(Boolean);
      setNotice(errs.length > 0
        ? { kind: 'err', text: `目录已更新，但有告警：${errs.join('；')}` }
        : { kind: 'ok', text: `目录已更新（${(out?.models ?? []).length} 个模型）` });
      await reload();
    } catch (e) {
      setNotice({ kind: 'err', text: `刷新失败：${e.message ?? e}` });
    } finally {
      setBusy(false);
    }
  }

  async function checkin() {
    setBusy(true);
    try {
      const out = await api.postTraeCheckin(region);
      setNotice(out?.claimed
        ? { kind: 'ok', text: `签到成功${typeof out.message === 'string' && out.message ? `：${out.message}` : ''}` }
        : { kind: 'info', text: `未领取：${out?.reason ?? '今日已签或活动未开启'}` });
      await reload();
    } catch (e) {
      setNotice({ kind: 'err', text: `签到失败：${e.message ?? e}` });
    } finally {
      setBusy(false);
    }
  }

  const signedIn = doc?.status === 'signed-in';

  return (
    <ChannelLayout
      icon={<PlaneIcon size={22} />}
      title="Trae"
      sub="字节跳动订阅 · 国内版支持签到与积分明细，国际版只回报订阅状态"
      regions={REGIONS}
      region={region}
      onRegion={onRegion}
      statusNode={doc && <StatusPill ok={signedIn} label={signedIn ? '已登录' : '未登录'} title={doc.reason} />}
      actions={(
        <button type="button" className="btn" disabled={busy || !doc} onClick={refresh}>
          <RefreshIcon size={14} /> 刷新目录
        </button>
      )}
    >
      {loading && !doc && <div className="section"><LoadingBlock lines={4} tall /></div>}
      {error && !doc && <Notice kind="err">{error}</Notice>}

      {doc && !signedIn && (
        <Section>
          <EmptyState
            icon={<AlertIcon size={20} />}
            title={`Trae ${region === 'cn' ? '国内版' : '国际版'}未登录`}
            sub={`在本机对应的 Trae 客户端里登录一次即可，网关会直接复用它的登录态。${doc.reason ? `（${doc.reason}）` : ''}`}
          />
          {doc.searched?.length > 0 && (
            <Disclosure summary={`凭据扫描详情（${doc.searched.length} 个位置）`}>
              <ul className="mono-list">
                {doc.searched.map((s, i) => (
                  <li key={i}>{s.path}<span className="reason"> — {s.reason}{s.message ? `：${s.message}` : ''}</span></li>
                ))}
              </ul>
            </Disclosure>
          )}
        </Section>
      )}

      {doc && signedIn && (
        <>
          {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

          <Section title="额度" actions={doc.accountName && <span className="section-hint">账号 <code className="inline">{doc.accountName}</code>{doc.tokenExpiresAtMs && <> · 令牌到期 {fmtTime(doc.tokenExpiresAtMs)}</>}</span>}>
            {region === 'cn' ? (
              <CreditsPanel
                metrics={[
                  { label: '剩余额度', value: fmtNum(doc.credits?.available), hero: true },
                  { label: '已使用', value: fmtNum(doc.credits?.consumed) },
                  { label: 'Work 通道可用', value: fmtNum(doc.credits?.workAvailable) },
                  { label: '通用通道可用', value: fmtNum(doc.credits?.generalAvailable) },
                ]}
                packs={(doc.credits?.accounts ?? []).filter((p) => p.remain > 0).map((p) => ({ name: p.displayDesc, remain: p.remain, size: p.size }))}
                error={doc.creditsError}
                unavailable={doc.usageUnavailable ? `额度信息不可用（${doc.usageUnavailable}）` : undefined}
              />
            ) : (
              <CreditsPanel
                unavailable={doc.payStatus
                  ? '国际版订阅状态正常（上游不提供积分明细）'
                  : undefined}
                error={doc.payStatusError}
              />
            )}

            {region === 'cn' && doc.checkin && (
              <div className="endpoint" style={{ marginTop: 14 }}>
                <CalendarCheckIcon size={16} style={{ color: 'var(--accent)' }} />
                <span className="meta">
                  签到：<strong style={{ color: 'var(--text)' }}>{doc.checkin.checkedIn ? '今日已签' : '今日未签'}</strong>
                  {typeof doc.checkin.credits === 'number' && doc.checkin.credits > 0 && ` · 可领 ${doc.checkin.credits} 积分`}
                  {doc.checkin.enabled === false && ' · 活动未开启'}
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="btn primary sm"
                  disabled={busy || doc.checkin.checkedIn || doc.checkin.enabled === false}
                  onClick={checkin}
                >
                  {doc.checkin.checkedIn ? '已领取' : '领取签到奖励'}
                </button>
              </div>
            )}
          </Section>

          <Section title="模型" count={`${(doc.models ?? []).length}`}>
            <ModelTable
              models={doc.models}
              columns={[
                { key: 'ctx', label: '上下文', numeric: true, render: (m) => fmtCtx(m.contextWindow) ?? '—' },
                { key: 'rate', label: '倍率', numeric: true, render: (m) => (typeof m.creditMultiplier === 'number' ? `x${m.creditMultiplier}` : '—') },
                { key: 'img', label: '图片', render: (m) => (m.input?.includes('image') ? '支持' : '—') },
              ]}
            />
          </Section>

          {(doc.rawChat || doc.accounts?.length > 1) && (
            <Disclosure summary="通道诊断">
              {doc.rawChat && <p className="small dim" style={{ margin: 0 }}>Raw Chat 通道：{doc.rawChat.state ?? '未知'}（默认关闭，不影响常规对话）</p>}
              {doc.accounts?.length > 1 && (
                <p className="small dim" style={{ margin: 0 }}>本机共登录 {doc.accounts.length} 个 Trae 账号，当前使用 {doc.accountName}。</p>
              )}
            </Disclosure>
          )}
        </>
      )}
    </ChannelLayout>
  );
}
