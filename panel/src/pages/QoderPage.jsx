import React, { useState } from 'react';
import ChannelLayout from '../components/ChannelLayout.jsx';
import CreditsPanel from '../components/CreditsPanel.jsx';
import ModelTable from '../components/ModelTable.jsx';
import ProbeSection from '../components/ProbeSection.jsx';
import { Disclosure, EmptyState, LoadingBlock, Notice, Section, StatusPill, fmtCtx, fmtNum, fmtRate, fmtTime } from '../components/primitives.jsx';
import { AlertIcon, CalendarCheckIcon, RefreshIcon, TerminalIcon } from '../components/icons.jsx';
import { api } from '../api.js';
import { useAsyncData } from '../hooks.js';

const REGIONS = [
  { key: 'cn', label: '国内版' },
  { key: 'global', label: '国际版' },
];

const CATALOG_LABEL = { live: '实时拉取', saved: '上次保存的目录', fallback: '内置兜底名册' };
const CHECKIN_LABEL = {
  claimed: '今日已领',
  already_claimed: '今日已领',
  'already-claimed': '今日已领',
  available: '今日可领',
};

/** 上下文列：默认窗口，若有更大的可扩展窗口则以 200K / 1M 形式并列 */
function qoderCtx(m) {
  const def = fmtCtx(m.contextWindow);
  const max = fmtCtx(m.maxContextWindow);
  if (!def) return '—';
  return max && max !== def ? `${def} / ${max}` : def;
}

/** Qoder 通道页：额度、签到状态、推理探测、模型目录 */
export default function QoderPage({ variant, onVariant }) {
  const { data, loading, error, reload } = useAsyncData(api.getQoder);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);

  const doc = data?.variants?.[variant];
  const configured = doc?.status === 'signed-in';

  async function refresh() {
    setBusy('刷新目录');
    setNotice(null);
    try {
      const out = await api.postQoderRefresh(variant);
      setNotice(out?.state === 'updated'
        ? { kind: 'ok', text: `目录已更新（${(out?.models ?? []).length} 个模型）` }
        : { kind: 'err', text: `刷新失败：${out?.reason ?? out?.state}` });
      await reload();
    } catch (e) {
      setNotice({ kind: 'err', text: `刷新失败：${e.message ?? e}` });
    } finally {
      setBusy('');
    }
  }

  async function probe(modelId) {
    setBusy(`探测 ${modelId}`);
    setNotice(null);
    try {
      const out = await api.postQoderProbe(variant, modelId);
      setNotice(out?.state === 'ok'
        ? { kind: 'ok', text: `探测 ${modelId} 完成：${out.validation}${out.efforts?.length ? `（${out.efforts.join('、')}）` : ''}` }
        : { kind: 'err', text: `探测 ${modelId} 未完成：${out?.reason ?? out?.state ?? '未知原因'}` });
      await reload();
    } catch (e) {
      setNotice({ kind: 'err', text: `探测 ${modelId} 失败：${e.message ?? e}` });
    } finally {
      setBusy('');
    }
  }

  return (
    <ChannelLayout
      icon={<TerminalIcon size={22} />}
      title="Qoder"
      sub="上游模型 ID 是内部代号（qfmodel 等），调用时以 ID 为准"
      regions={REGIONS}
      region={variant}
      onRegion={onVariant}
      statusNode={doc && <StatusPill ok={configured} label={configured ? '已配置' : '未配置'} title={doc.reason} />}
      actions={(
        <button type="button" className="btn" disabled={busy !== '' || !configured} onClick={refresh}>
          <RefreshIcon size={14} /> 刷新目录
        </button>
      )}
    >
      {loading && !doc && <div className="section"><LoadingBlock lines={4} tall /></div>}
      {error && !doc && <Notice kind="err">{error}</Notice>}

      {doc && !configured && (
        <Section>
          <EmptyState
            icon={<AlertIcon size={20} />}
            title={`Qoder ${variant === 'cn' ? '国内版' : '国际版'}未配置`}
            sub={doc.reason ?? '未找到本机 Qoder 客户端的登录凭据'}
          />
        </Section>
      )}

      {doc && configured && (
        <>
          {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

          <Section title="额度">
            <CreditsPanel
              metrics={[
                { label: '可用额度', value: fmtNum(doc.credits?.total), hero: true },
                { label: '总额度', value: fmtNum(doc.credits?.totalSize) },
                ...(doc.credits?.unlimited === true ? [{ label: '计费模式', value: '不限量' }] : []),
              ]}
              packs={(doc.credits?.accounts ?? []).filter((p) => p.remain > 0).map((p) => ({ name: p.packageName, remain: p.remain, size: p.size }))}
              error={doc.creditsError}
            />
            {/* 不限量账号的周期重置是 9999-12-31，那是哨兵值不是真实日期，不展示 */}
            {doc.credits?.cycleResetTime && !String(doc.credits.cycleResetTime).startsWith('9999') && (
              <p className="small dim" style={{ margin: '10px 0 0' }}>
                周期重置：{String(doc.credits.cycleResetTime).slice(0, 10)}
              </p>
            )}
            {doc.checkIn && (
              <div className="endpoint" style={{ marginTop: 14 }}>
                <CalendarCheckIcon size={16} style={{ color: 'var(--accent)' }} />
                <span className="meta">
                  签到：<strong style={{ color: 'var(--text)' }}>{CHECKIN_LABEL[doc.checkIn.status] ?? doc.checkIn.status}</strong>
                  {typeof doc.checkIn.amount === 'number' && doc.checkIn.amount > 0 && ` · 奖励 ${doc.checkIn.amount}`}
                  {doc.checkIn.date && ` · ${doc.checkIn.date}`}
                </span>
                <span style={{ flex: 1 }} />
                <span className="small dim">签到领取由客户端完成，面板只读</span>
              </div>
            )}
          </Section>

          <ProbeSection probe={doc.probe} busy={busy} onProbe={probe} />

          <Section title="模型" count={`${(doc.models ?? []).length}`}>
            <ModelTable
              models={doc.models}
              columns={[
                { key: 'ctx', label: '上下文', numeric: true, render: qoderCtx },
                { key: 'reason', label: '推理', render: (m) => (m.isReasoning ? <span className="tag reasoning">{m.reasoningEfforts?.length ? m.reasoningEfforts.join('、') : '支持'}</span> : '—') },
                { key: 'img', label: '图片', render: (m) => (m.supportsImages ? '支持' : '—') },
                { key: 'rate', label: '倍率', numeric: true, render: (m) => fmtRate(m.credits) ?? '—' },
              ]}
            />
          </Section>

          {(doc.pat || doc.catalog) && (
            <Disclosure summary="凭据与目录详情">
              {doc.pat && (
                <p className="small dim" style={{ margin: 0 }}>
                  凭据来源：{doc.pat.source ?? '未知'}
                  {doc.pat.patTail ? ` · 令牌尾号 ${doc.pat.patTail}` : ''}
                  {fmtTime(doc.pat.savedAtMs) ? ` · 保存于 ${fmtTime(doc.pat.savedAtMs)}` : ''}
                </p>
              )}
              {doc.catalog && (
                <p className="small dim" style={{ margin: 0 }}>
                  模型目录：{CATALOG_LABEL[doc.catalog.source] ?? doc.catalog.source}
                  {fmtTime(doc.catalog.fetchedAtMs) ? ` · ${fmtTime(doc.catalog.fetchedAtMs)}` : ''}
                  {doc.catalog.error ? ` · ${doc.catalog.error}` : ''}
                </p>
              )}
              {doc.filePath && <p className="small dim" style={{ margin: 0 }}>凭据文件：<code className="inline">{doc.filePath}</code></p>}
            </Disclosure>
          )}
        </>
      )}
    </ChannelLayout>
  );
}
