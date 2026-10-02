import React, { useState } from 'react';
import ModelTable from './ModelTable.jsx';

const VARIANT_LABEL = { cn: '国内版', global: '国际版' };

function fmt(ts) {
  if (typeof ts !== 'number' || ts <= 0) return '—';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

export default function WorkBuddyCard({ data, onControl }) {
  const [variant, setVariant] = useState('cn');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const doc = data?.variants?.[variant];

  async function run(action, label) {
    setBusy(label);
    setNotice('');
    try {
      const out = await onControl(variant, action);
      if (out?.state === 'updated') setNotice(`${label} 成功`);
      else setNotice(`${label} 失败：${out?.reason ?? out?.state ?? '未知原因'}`);
    } catch (e) {
      setNotice(`${label} 失败：${e.message ?? e}`);
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>WorkBuddy</h2>
        <div className="tabs">
          {['cn', 'global'].map((v) => (
            <button key={v} className={`tab ${v === variant ? 'active' : ''}`} onClick={() => setVariant(v)}>
              {VARIANT_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      {!doc && <p className="muted">正在读取 WorkBuddy {VARIANT_LABEL[variant]} 状态…</p>}

      {doc && (
        <>
          <div className="status-line">
            {doc.status === 'signed-in'
              ? <span className="badge ok">已登录</span>
              : <span className="badge warn">未登录</span>}
            {doc.nickname && <span className="muted"> · {doc.nickname}</span>}
            {doc.expiresAt && <span className="muted"> · 到期 {fmt(doc.expiresAt)}</span>}
            <button className="btn ghost" disabled={busy !== ''} onClick={() => run({ action: 'refresh' }, '刷新模型')}>
              刷新模型
            </button>
          </div>

          {doc.reason && <p className="muted small">原因：{doc.reason}{doc.reasonCode ? `（${doc.reasonCode}）` : ''}</p>}
          {notice && <div className="banner note">{notice}</div>}

          <h3 className="sub">额度</h3>
          {doc.credits
            ? <pre className="json small">{JSON.stringify(doc.credits, null, 2)}</pre>
            : <p className="muted small">{doc.creditsError ? `读取失败：${doc.creditsError}` : '未登录或无额度数据'}</p>}

          <h3 className="sub">模型（{(doc.models ?? []).length}）</h3>
          <ModelTable
            models={doc.models}
            emptyText="未发现模型"
            columns={[
              { key: 'rate', label: '倍率', render: (m) => (typeof m.credits === 'string' || typeof m.credits === 'number' ? `x${m.credits}`.replace(/^xx/, 'x') : '—') },
              { key: 'free', label: '免费', render: (m) => (m.free ? '是' : '—') },
              { key: 'ctx', label: '上下文', render: (m) => (m.contextWindow ? `${Math.round(m.contextWindow / 1000)}K` : '—') },
              { key: 'badge', label: '标签', render: (m) => (m.badges?.length ? m.badges.join('、') : '—') },
            ]}
          />

          {doc.probe && (
            <>
              <h3 className="sub">探针（{doc.probe.results?.length ?? 0} 项结果）</h3>
              <div className="row-between">
                <span className="muted small">候选模型 {doc.probe.candidates?.length ?? 0} 个</span>
                <div className="btn-row">
                  <button className="btn" disabled={busy !== ''} onClick={() => run({ action: 'refresh' }, '运行探针')}>运行探针</button>
                  <button className="btn ghost" disabled={busy !== ''} onClick={() => run({ action: 'clear' }, '清空探针')}>清空</button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
