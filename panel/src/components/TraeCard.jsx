import React, { useState } from 'react';
import ModelTable from './ModelTable.jsx';

const REGION_LABEL = { cn: '国内版', ai: '国际版' };

/** 数字裁剪到 4 位小数，避免长尾 */
function num(v) {
  if (typeof v !== 'number') return '—';
  return String(Math.round(v * 1e4) / 1e4);
}

/** 到期时间戳 → 本地可读；缺失显示 — */
function expiry(ms) {
  if (typeof ms !== 'number' || ms <= 0) return '—';
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}

function CreditsBlock({ doc }) {
  if (doc.credits) {
    const packs = doc.credits.accounts ?? [];
    const live = packs.filter((p) => p.remain > 0);
    return (
      <>
        <div className="kv-grid">
          <div><span className="k">总额度</span><span className="v">{num(doc.credits.total)}</span></div>
          <div><span className="k">已用</span><span className="v">{num(doc.credits.consumed)}</span></div>
          <div><span className="k">剩余</span><span className="v">{num(doc.credits.available)}</span></div>
          <div><span className="k">Work 可用</span><span className="v">{num(doc.credits.workAvailable)}</span></div>
          <div><span className="k">通用可用</span><span className="v">{num(doc.credits.generalAvailable)}</span></div>
        </div>
        {live.length > 0 && (
          <details className="details">
            <summary className="muted small">查看权益包明细（有余额 {live.length} / 共 {packs.length}）</summary>
            <ul className="small muted">
              {live.map((p, i) => (
                <li key={i}>{p.displayDesc || '（未命名）'} — 剩余 {num(p.remain)} / {num(p.size)}</li>
              ))}
            </ul>
          </details>
        )}
      </>
    );
  }
  if (doc.creditsError) return <p className="muted small">额度读取失败：{doc.creditsError}</p>;
  if (doc.payStatus) return <p className="muted small">订阅状态已获取（国际版不提供积分明细）</p>;
  if (doc.payStatusError) return <p className="muted small">订阅状态读取失败：{doc.payStatusError}</p>;
  if (doc.usageUnavailable) return <p className="muted small">额度信息不可用（{doc.usageUnavailable}）</p>;
  // 未登录时额度字段本来就为空，措辞不要误报为"客户端没装配"
  return <p className="muted small">登录后显示额度</p>;
}

function CheckinBlock({ doc, region, onCheckin }) {
  if (region !== 'cn') return null;
  if (doc.checkinError) return <p className="muted small">签到状态读取失败：{doc.checkinError}</p>;
  if (!doc.checkin) return <p className="muted small">签到信息不可用</p>;
  const c = doc.checkin;
  return (
    <div className="row-between">
      <span>
        签到：{c.checkedIn ? '今日已签' : '今日未签'}
        {typeof c.credits === 'number' && <> · 奖励 {c.credits}</>}
        {c.enabled === false && <> · 活动未开启</>}
      </span>
      <button className="btn" disabled={!c.enabled || c.checkedIn} onClick={() => onCheckin(region)}>
        {c.checkedIn ? '已领取' : '领取'}
      </button>
    </div>
  );
}

export default function TraeCard({ data, onRefresh, onCheckin }) {
  const [region, setRegion] = useState('cn');
  const [busy, setBusy] = useState(false);
  const doc = data?.regions?.[region];

  async function refresh() {
    setBusy(true);
    try { await onRefresh(region); } finally { setBusy(false); }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Trae</h2>
        <div className="tabs">
          {['cn', 'ai'].map((r) => (
            <button
              key={r}
              className={`tab ${r === region ? 'active' : ''}`}
              onClick={() => setRegion(r)}
            >
              {REGION_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {!doc && <p className="muted">正在读取 Trae {REGION_LABEL[region]} 状态…</p>}

      {doc && (
        <>
          <div className="status-line">
            {doc.status === 'signed-in'
              ? <span className="badge ok">已登录</span>
              : <span className="badge warn">未登录</span>}
            {doc.accountName && <span className="muted"> · {doc.accountName}</span>}
            {doc.tokenExpiresAtMs && <span className="muted"> · 令牌到期 {expiry(doc.tokenExpiresAtMs)}</span>}
            <button className="btn ghost" disabled={busy} onClick={refresh}>刷新</button>
          </div>

          {doc.status !== 'signed-in' && doc.searched?.length > 0 && (
            <details className="details">
              <summary className="muted small">查看已扫描的凭据位置（{doc.searched.length}）</summary>
              <ul className="small muted">
                {doc.searched.map((s, i) => (
                  <li key={i}><code>{s.path}</code> — {s.reason}{s.message ? `：${s.message}` : ''}</li>
                ))}
              </ul>
            </details>
          )}

          <h3 className="sub">额度</h3>
          <CreditsBlock doc={doc} />

          <CheckinBlock doc={doc} region={region} onCheckin={onCheckin} />

          <h3 className="sub">模型（{(doc.models ?? []).length}）</h3>
          <ModelTable
            models={doc.models}
            emptyText="未发现模型"
            columns={[
              { key: 'ctx', label: '上下文', render: (m) => (m.contextWindow ? `${Math.round(m.contextWindow / 1000)}K` : '—') },
              { key: 'img', label: '图片', render: (m) => (m.input?.includes('image') ? '支持' : '—') },
              { key: 'rate', label: '倍率', render: (m) => (typeof m.creditMultiplier === 'number' ? `x${m.creditMultiplier}` : '—') },
            ]}
          />

          {doc.rawChat && (
            <p className="muted small">Raw Chat 通道：{doc.rawChat.state ?? '未知'}</p>
          )}
        </>
      )}
    </section>
  );
}
