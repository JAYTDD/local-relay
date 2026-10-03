import React, { useState } from 'react';
import ChannelLayout from '../components/ChannelLayout.jsx';
import CreditsPanel from '../components/CreditsPanel.jsx';
import ModelTable from '../components/ModelTable.jsx';
import ProbeSection from '../components/ProbeSection.jsx';
import { Disclosure, EmptyState, LoadingBlock, Notice, Section, StatusPill, fmtCtx, fmtNum, fmtRate, fmtTime } from '../components/primitives.jsx';
import { AlertIcon, BriefcaseIcon, RefreshIcon } from '../components/icons.jsx';
import { api } from '../api.js';
import { useAsyncData } from '../hooks.js';

const REGIONS = [
  { key: 'cn', label: '国内版' },
  { key: 'global', label: '国际版' },
];

const CATALOG_LABEL = { live: '实时拉取', saved: '上次保存的目录', fallback: '内置兜底名册' };

/** WorkBuddy 通道页：额度、模型启停、推理探测 */
export default function WorkBuddyPage({ variant, onVariant }) {
  const { data, loading, error, reload } = useAsyncData(api.getWorkBuddy);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);

  const doc = data?.variants?.[variant];
  const signedIn = doc?.status === 'signed-in';
  const disabled = new Set(doc?.visibility?.disabled ?? []);

  async function control(action, label, okText) {
    setBusy(label);
    setNotice(null);
    try {
      const out = await api.postWorkBuddyControl(variant, action);
      setNotice(out?.state === 'updated'
        ? { kind: 'ok', text: okText ?? `${label}成功` }
        : { kind: 'err', text: `${label}失败：${out?.reason ?? out?.state ?? '未知原因'}` });
      await reload();
    } catch (e) {
      setNotice({ kind: 'err', text: `${label}失败：${e.message ?? e}` });
    } finally {
      setBusy('');
    }
  }

  async function probe(modelId) {
    setBusy(`探测 ${modelId}`);
    setNotice(null);
    try {
      const out = await api.postWorkBuddyProbe(variant, modelId);
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
      icon={<BriefcaseIcon size={22} />}
      title="WorkBuddy"
      sub="CodeBuddy 体系订阅 · 模型启停按账号持久化，仅国际版共享目录"
      regions={REGIONS}
      region={variant}
      onRegion={onVariant}
      statusNode={doc && <StatusPill ok={signedIn} label={signedIn ? '已登录' : '未登录'} title={doc.reason} />}
      actions={(
        <button
          type="button"
          className="btn"
          disabled={busy !== '' || !doc}
          onClick={() => control({ action: 'refresh' }, '刷新目录', `目录已更新（${(doc?.models ?? []).length} 个模型）`)}
        >
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
            title={`WorkBuddy ${variant === 'cn' ? '国内版' : '国际版'}不可用`}
            sub={doc.reason ?? '未发现可用凭据或模型目录为空'}
          />
        </Section>
      )}

      {doc && signedIn && (
        <>
          {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

          <Section
            title="额度"
            hint={doc.catalog && (
              <span className="section-hint">
                模型目录：{CATALOG_LABEL[doc.catalog.source] ?? doc.catalog.source}
                {doc.catalog.appVersion ? ` · app ${doc.catalog.appVersion}` : ''}
                {fmtTime(doc.catalog.fetchedAtMs) ? ` · ${fmtTime(doc.catalog.fetchedAtMs)}` : ''}
              </span>
            )}
          >
            <CreditsPanel
              metrics={[
                { label: '剩余总额', value: fmtNum(doc.credits?.total), hero: true },
                {
                  label: '有效额度包',
                  value: doc.credits
                    ? `${(doc.credits.accounts ?? []).filter((p) => p.remain > 0).length} / ${(doc.credits.accounts ?? []).length}`
                    : null,
                },
              ]}
              packs={(doc.credits?.accounts ?? []).filter((p) => p.remain > 0).map((p) => ({ name: p.packageName, remain: p.remain, size: p.size }))}
              error={doc.creditsError}
            />
          </Section>

          <ProbeSection probe={doc.probe} busy={busy} onProbe={probe} />

          <Section
            title="模型"
            count={`${(doc.models ?? []).length}${disabled.size > 0 ? ` · 已隐藏 ${disabled.size}` : ''}`}
          >
            <ModelTable
              models={doc.models}
              columns={[
                { key: 'rate', label: '倍率', numeric: true, render: (m) => fmtRate(m.credits) ?? (m.rateUnknown ? '未知' : '—') },
                { key: 'free', label: '计费', render: (m) => (m.free ? <span className="tag free">免费</span> : '—') },
                { key: 'ctx', label: '上下文', numeric: true, render: (m) => fmtCtx(m.contextWindow) ?? '—' },
                { key: 'badges', label: '标签', render: (m) => (m.badges?.length ? <span className="tag">{m.badges.join('、')}</span> : '—') },
                {
                  key: 'visible',
                  label: '展示',
                  render: (m) => (
                    <button
                      type="button"
                      className={`btn sm ${disabled.has(m.id) ? '' : 'ghost'}`}
                      disabled={busy !== ''}
                      onClick={() => control(
                        { action: 'set-model-visibility', model: m.id, visible: disabled.has(m.id) },
                        `${disabled.has(m.id) ? '显示' : '隐藏'} ${m.id}`,
                      )}
                    >
                      {disabled.has(m.id) ? '已隐藏' : '可见'}
                    </button>
                  ),
                },
              ]}
            />
            {variant === 'global' && (
              <p className="small dim" style={{ margin: '10px 0 0' }}>
                国际版凭据不含账号 uid，按源设计不提供按账号的模型启停。
              </p>
            )}
          </Section>
        </>
      )}
    </ChannelLayout>
  );
}
