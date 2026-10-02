import React, { useState } from 'react';
import ModelTable from './ModelTable.jsx';

const VARIANT_LABEL = { cn: '国内版', global: '国际版' };

function fmt(ts) {
  if (typeof ts !== 'number' || ts <= 0) return '—';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

function num(v) {
  if (typeof v !== 'number') return '—';
  return String(Math.round(v * 1e4) / 1e4);
}

/** 凭据来源：只显示 patTail 与来源，绝不显示完整 PAT */
function PatLine({ doc }) {
  if (!doc.pat) return null;
  return (
    <p className="muted small">
      凭据来源：{doc.pat.source ?? '未知'}
      {doc.pat.patTail ? ` · 令牌尾号 ${doc.pat.patTail}` : ''}
      {doc.pat.savedAtMs ? ` · 保存于 ${fmt(doc.pat.savedAtMs)}` : ''}
    </p>
  );
}

function CreditsBlock({ doc }) {
  if (doc.creditsError) return <p className="muted small">额度读取失败：{doc.creditsError}</p>;
  if (!doc.credits) return <p className="muted small">额度信息不可用</p>;
  const c = doc.credits;
  const packs = c.accounts ?? [];
  const live = packs.filter((p) => p.remain > 0);
  return (
    <>
      <div className="kv-grid">
        <div><span className="k">可用总额</span><span className="v">{num(c.total)}</span></div>
        <div><span className="k">总额度</span><span className="v">{num(c.totalSize)}</span></div>
        {c.unlimited === true && <div><span className="k">计费模式</span><span className="v">不限量</span></div>}
        {c.cycleResetTime && <div><span className="k">周期重置</span><span className="v">{String(c.cycleResetTime).slice(0, 10)}</span></div>}
      </div>
      {live.length > 0 && (
        <details className="details">
          <summary className="muted small">查看额度包明细（有余额 {live.length} / 共 {packs.length}）</summary>
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

function CheckInBlock({ doc }) {
  if (doc.checkInError) return <p className="muted small">签到状态读取失败：{doc.checkInError}</p>;
  if (!doc.checkIn) return null;
  const c = doc.checkIn;
  const label = { claimed: '今日已领', already_claimed: '今日已领', available: '今日可领' }[c.status] ?? c.status;
  return (
    <p className="muted small">
      签到：{label}
      {typeof c.amount === 'number' && c.amount > 0 ? ` · 奖励 ${c.amount}` : ''}
      {c.date ? ` · ${c.date}` : ''}
      {c.message ? ` · ${c.message}` : ''}
    </p>
  );
}

function CatalogNote({ doc }) {
  if (!doc.catalog) return null;
  const label = { live: '实时拉取', saved: '上次保存', fallback: '内置兜底' }[doc.catalog.source] ?? doc.catalog.source;
  return (
    <p className="muted small">
      目录来源：{label}
      {doc.catalog.fetchedAtMs ? ` · ${fmt(doc.catalog.fetchedAtMs)}` : ''}
      {doc.catalog.error ? ` · ${doc.catalog.error}` : ''}
    </p>
  );
}

function ProbeBlock({ doc, busy, onProbe }) {
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
        {candidates.length > 0 && ' · 探测会真的发上游请求并消耗额度'}
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
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

export default function QoderCard({ data, onRefresh, onProbe }) {
  const [variant, setVariant] = useState('cn');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const doc = data?.variants?.[variant];

  async function refresh() {
    setBusy('刷新模型');
    setNotice('');
    try {
      const out = await onRefresh(variant);
      setNotice(out?.state === 'updated' ? `刷新成功（${(out.models ?? []).length} 个模型）` : `刷新失败：${out?.reason ?? out?.state}`);
    } catch (e) {
      setNotice(`刷新失败：${e.message ?? e}`);
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

  return (
    <section className="card">
      <div className="card-head">
        <h2>Qoder</h2>
        <div className="tabs">
          {['cn', 'global'].map((v) => (
            <button key={v} className={`tab ${v === variant ? 'active' : ''}`} onClick={() => setVariant(v)}>
              {VARIANT_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      {!doc && <p className="muted">正在读取 Qoder {VARIANT_LABEL[variant]} 状态…</p>}

      {doc && (
        <>
          <div className="status-line">
            {doc.status === 'signed-in'
              ? <span className="badge ok">已配置</span>
              : <span className="badge warn">未配置</span>}
            {doc.region && <span className="muted"> · 区域 {doc.region}</span>}
            <button className="btn ghost" disabled={busy !== ''} onClick={refresh}>
              {busy === '刷新模型' ? '刷新中…' : '刷新模型'}
            </button>
          </div>

          {doc.reason && <p className="muted small">原因：{doc.reason}</p>}
          {notice && <div className="banner note">{notice}</div>}
          <PatLine doc={doc} />
          <CatalogNote doc={doc} />

          <h3 className="sub">额度</h3>
          <CreditsBlock doc={doc} />

          <CheckInBlock doc={doc} />

          <ProbeBlock doc={doc} busy={busy} onProbe={probe} />

          <h3 className="sub">模型（{(doc.models ?? []).length}）</h3>
          <ModelTable
            models={doc.models}
            emptyText="未发现模型"
            columns={[
              { key: 'ctx', label: '上下文', render: (m) => (m.contextWindow ? `${Math.round(m.contextWindow / 1000)}K` : '—') },
              { key: 'reason', label: '推理', render: (m) => (m.isReasoning ? (m.reasoningEfforts?.join('、') ?? '支持') : '—') },
              { key: 'img', label: '图片', render: (m) => (m.supportsImages ? '支持' : '—') },
              { key: 'rate', label: '倍率', render: (m) => (typeof m.credits === 'number' || typeof m.credits === 'string' ? `x${m.credits}`.replace(/^xx/, 'x') : '—') },
            ]}
          />
        </>
      )}
    </section>
  );
}
