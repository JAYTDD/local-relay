import React, { useState } from 'react';
import ModelTable from './ModelTable.jsx';

const VARIANT_LABEL = { cn: '国内版', global: '国际版' };

function fmt(ts) {
  if (typeof ts !== 'number' || ts <= 0) return '—';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

/** 数字裁剪到 4 位小数，避免长尾 */
function num(v) {
  if (typeof v !== 'number') return '—';
  return String(Math.round(v * 1e4) / 1e4);
}

/** 额度：总数 + 分包明细（形状 {total, accounts:[{packageName,remain,size}]}） */
function CreditsBlock({ doc }) {
  if (doc.creditsError) return <p className="muted small">额度读取失败：{doc.creditsError}</p>;
  if (!doc.credits) return <p className="muted small">额度信息不可用</p>;
  const packs = doc.credits.accounts ?? [];
  // 0 余额的包不占地方，但计数里保留（面板要说实话）
  const live = packs.filter((p) => p.remain > 0);
  return (
    <>
      <div className="kv-grid">
        <div><span className="k">剩余总额</span><span className="v">{num(doc.credits.total)}</span></div>
        <div><span className="k">有效包</span><span className="v">{live.length} / {packs.length}</span></div>
      </div>
      {live.length > 0 && (
        <details className="details">
          <summary className="muted small">查看分包明细（{live.length}）</summary>
          <ul className="small muted">
            {live.map((p, i) => (
              <li key={i}>{p.packageName} — 剩余 {num(p.remain)} / {num(p.size)}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/** 目录来源：面板要能说明这批模型是实时拉的还是缓存 */
function CatalogNote({ doc }) {
  if (!doc.catalog) return null;
  const label = { live: '实时拉取', saved: '上次保存', fallback: '内置兜底' }[doc.catalog.source] ?? doc.catalog.source;
  return (
    <p className="muted small">
      目录来源：{label}
      {doc.catalog.fetchedAt ? ` · ${fmt(doc.catalog.fetchedAt)}` : ''}
      {doc.catalog.error ? ` · ${doc.catalog.error}` : ''}
    </p>
  );
}

/** 探针：候选、已有结果、逐模型触发 */
function ProbeBlock({ doc, variant, busy, onProbe }) {
  const probe = doc.probe;
  if (!probe) return null;
  const results = probe.results ?? [];
  const candidates = probe.candidates ?? [];
  const done = new Set(results.map((r) => r.id));
  return (
    <>
      <h3 className="sub">推理探针（{results.length} 项结果）</h3>
      <p className="muted small">
        候选 {candidates.length} 个 · {probe.running ? '正在探测…' : '空闲'}
        {candidates.length > 0 && ' · 探测会真的发上游请求并消耗额度，逐个点击触发'}
      </p>
      {candidates.length > 0 && (
        <div className="chip-row">
          {candidates.map((id) => (
            <button
              key={id}
              className="btn ghost small"
              disabled={busy !== '' || probe.running}
              onClick={() => onProbe(id)}
              title={done.has(id) ? '已有结果，可重测' : '尚未探测'}
            >
              {id}{done.has(id) ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}
      {results.length > 0 && (
        <details className="details" open>
          <summary className="muted small">探测结果</summary>
          <ul className="small muted">
            {results.map((r) => (
              <li key={r.id}>
                <code>{r.id}</code> — {r.validation}
                {r.efforts?.length ? `（${r.efforts.join('、')}）` : ''}
                {r.probedAt ? ` · ${fmt(r.probedAt)}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

export default function WorkBuddyCard({ data, onControl, onProbe }) {
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

  async function probe(id) {
    setBusy(`探测 ${id}`);
    setNotice('');
    try {
      const out = await onProbe(variant, id);
      if (out?.state === 'ok') setNotice(`探测 ${id} 完成：${out.validation}（${(out.efforts ?? []).join('、') || '无'}）`);
      else if (out?.state === 'unavailable') setNotice(`探测 ${id} 不可用：${out.reason}`);
      else setNotice(`探测 ${id} 失败：${out?.reason ?? out?.state ?? '未知原因'}`);
    } catch (e) {
      setNotice(`探测 ${id} 失败：${e.message ?? e}`);
    } finally {
      setBusy('');
    }
  }

  function toggleVisible(modelId, visible) {
    run({ action: 'set-model-visibility', model: modelId, visible }, `${visible ? '显示' : '隐藏'} ${modelId}`);
  }

  const disabled = new Set(doc?.visibility?.disabled ?? []);

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
              {busy === '刷新模型' ? '刷新中…' : '刷新模型'}
            </button>
          </div>

          {doc.reason && <p className="muted small">原因：{doc.reason}{doc.reasonCode ? `（${doc.reasonCode}）` : ''}</p>}
          {notice && <div className="banner note">{notice}</div>}
          <CatalogNote doc={doc} />

          <h3 className="sub">额度</h3>
          <CreditsBlock doc={doc} />

          <ProbeBlock doc={doc} variant={variant} busy={busy} onProbe={probe} />

          <h3 className="sub">
            模型（{(doc.models ?? []).length}）
            {disabled.size > 0 && <span className="muted small"> · 已隐藏 {disabled.size}</span>}
          </h3>
          <ModelTable
            models={doc.models}
            emptyText="未发现模型"
            columns={[
              { key: 'rate', label: '倍率', render: (m) => (typeof m.credits === 'string' || typeof m.credits === 'number' ? `x${m.credits}`.replace(/^xx/, 'x') : '—') },
              { key: 'free', label: '免费', render: (m) => (m.free ? '是' : '—') },
              { key: 'ctx', label: '上下文', render: (m) => (m.contextWindow ? `${Math.round(m.contextWindow / 1000)}K` : '—') },
              { key: 'badge', label: '标签', render: (m) => (m.badges?.length ? m.badges.join('、') : '—') },
              {
                key: 'visible',
                label: '可见',
                render: (m) => (
                  <button
                    className="btn ghost small"
                    disabled={busy !== ''}
                    onClick={() => toggleVisible(m.id, disabled.has(m.id))}
                  >
                    {disabled.has(m.id) ? '已隐藏' : '可见'}
                  </button>
                ),
              },
            ]}
          />
        </>
      )}
    </section>
  );
}
