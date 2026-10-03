import React from 'react';
import { CopyButton } from '../components/primitives.jsx';
import { BriefcaseIcon, ChevronRightIcon, GaugeIcon, GlobeIcon, PlaneIcon, TerminalIcon } from '../components/icons.jsx';

/** 三大订阅产品与它们的两个区服前缀 */
const PRODUCTS = [
  { key: 'trae', name: 'Trae', sub: '字节跳动 · 订阅额度', Icon: PlaneIcon, page: 'trae', regions: [{ key: 'cn', label: '国内版', prefix: 'trae' }, { key: 'ai', label: '国际版', prefix: 'traeg' }] },
  { key: 'workbuddy', name: 'WorkBuddy', sub: 'CodeBuddy 体系 · 订阅额度', Icon: BriefcaseIcon, page: 'workbuddy', regions: [{ key: 'cn', label: '国内版', prefix: 'wb' }, { key: 'global', label: '国际版', prefix: 'wbai' }] },
  { key: 'qoder', name: 'Qoder', sub: '阿里系 · 订阅额度', Icon: TerminalIcon, page: 'qoder', regions: [{ key: 'cn', label: '国内版', prefix: 'qoder' }, { key: 'global', label: '国际版', prefix: 'qoderg' }] },
];

// 面板由网关同源托管，端点跟随当前 origin（换 RELAY_PORT 也不会显示错）
const ENDPOINT = `${window.location.protocol}//${window.location.host}/v1`;

/** 总览：端点 + 每个产品的区服状态，点击直达对应页 */
export default function OverviewPage({ health, navigate }) {
  const total = health?.providers.reduce((n, p) => n + p.models, 0);

  return (
    <div className="content-inner">
      <header className="page-head">
        <div>
          <h1 className="page-title">
            <span className="page-icon"><GaugeIcon size={22} /></span>
            总览
          </h1>
          <p className="page-sub">
            本地订阅中转网关 · 共 {total ?? '…'} 个模型 · 三家订阅全部转成 OpenAI 兼容接口
          </p>
        </div>
      </header>

      <section className="section">
        <div className="endpoint">
          <PlugMark />
          <span className="url">{ENDPOINT}</span>
          <CopyButton className="btn sm" value={ENDPOINT} title="复制端点">复制</CopyButton>
          <span className="meta">
            OpenAI 兼容 · Chat Completions · 模型名格式 <code className="inline">前缀/模型ID</code> · 未设 RELAY_KEY 时 API Key 任意
          </span>
        </div>
      </section>

      {!health && <div className="section"><div className="skeleton" style={{ height: 120 }} /></div>}

      {health && (
        <div className="channel-grid">
          {PRODUCTS.map(({ key, name, sub, Icon, page, regions }) => (
            <div className="channel-card" key={key}>
              <div className="channel-card-head">
                <span className="cc-icon"><Icon size={18} /></span>
                <div>
                  <div className="cc-name">{name}</div>
                  <div className="cc-sub">{sub}</div>
                </div>
              </div>
              {regions.map((r) => {
                const p = health.providers.find((x) => x.prefix === r.prefix);
                const state = !p ? 'mute' : p.error ? 'err' : 'ok';
                return (
                  <button key={r.key} type="button" className="region-row" onClick={() => navigate(page, { r: r.key })}>
                    <span className={`nav-dot ${state}`} title={p?.error ?? '就绪'} />
                    <span>{r.label}</span>
                    <span className="prefix">{r.prefix}/</span>
                    <span className="grow" />
                    <span className="models">{p ? `${p.models} 模型` : '—'}</span>
                    <span className="chev"><ChevronRightIcon size={15} /></span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlugMark() {
  return <GlobeIcon size={17} style={{ color: 'var(--accent)' }} />;
}
