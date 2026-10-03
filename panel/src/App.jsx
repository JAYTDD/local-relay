import React, { useCallback, useEffect, useState } from 'react';
import { useHashRoute } from './router.jsx';
import { api } from './api.js';
import { BriefcaseIcon, GaugeIcon, PlaneIcon, TerminalIcon } from './components/icons.jsx';
import { Notice } from './components/primitives.jsx';
import OverviewPage from './pages/OverviewPage.jsx';
import TraePage from './pages/TraePage.jsx';
import WorkBuddyPage from './pages/WorkBuddyPage.jsx';
import QoderPage from './pages/QoderPage.jsx';

const NAV = [
  { key: 'overview', label: '总览', Icon: GaugeIcon },
  { key: 'trae', label: 'Trae', Icon: PlaneIcon, prefixes: ['trae', 'traeg'] },
  { key: 'workbuddy', label: 'WorkBuddy', Icon: BriefcaseIcon, prefixes: ['wb', 'wbai'] },
  { key: 'qoder', label: 'Qoder', Icon: TerminalIcon, prefixes: ['qoder', 'qoderg'] },
];

/**
 * 应用外壳：左侧导航 + hash 路由。
 * 健康度（轻量接口）在这里取一次给导航状态点用；各通道页自己拉详细文档。
 */
export default function App() {
  const { route, query, navigate, replaceQuery } = useHashRoute();
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');

  const reloadHealth = useCallback(async () => {
    try {
      setHealth(await api.getHealth());
      setError('');
    } catch (e) {
      setError(String(e.message ?? e));
    }
  }, []);

  useEffect(() => { reloadHealth(); }, [reloadHealth]);

  /** 通道页数据变化后回读健康度，导航状态点保持真实 */
  const onChannelChanged = useCallback(() => { reloadHealth(); }, [reloadHealth]);

  const statusOf = (item) => {
    if (!item.prefixes || !health) return 'ok';
    const entries = health.providers.filter((p) => item.prefixes.includes(p.prefix));
    if (entries.length === 0) return 'ok';
    if (entries.some((p) => p.error)) return 'err';
    // 通道被面板关闭（如 Trae 区域启停）：能运行但不在服务，用黄色区分
    if (entries.some((p) => p.enabled === false)) return 'warn';
    return 'ok';
  };

  const pageProps = { navigate, onChannelChanged };

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-mark"><GaugeIcon size={18} /></span>
          <div>
            <div className="brand-name">local-relay</div>
            <div className="brand-sub">本地订阅中转网关</div>
          </div>
        </div>
        {NAV.map(({ key, label, Icon, prefixes }) => {
          const count = prefixes && health
            ? health.providers.filter((p) => prefixes.includes(p.prefix)).reduce((n, p) => n + p.models, 0)
            : undefined;
          return (
            <button
              key={key}
              type="button"
              className={`nav-item ${route === key ? 'active' : ''}`}
              onClick={() => navigate(key)}
              aria-current={route === key ? 'page' : undefined}
            >
              <span className="nav-icon"><Icon size={17} /></span>
              <span className="nav-label">{label}</span>
              {count !== undefined && count > 0 && <span className="nav-count">{count}</span>}
              <span className={`nav-dot ${statusOf({ prefixes })}`} />
            </button>
          );
        })}
        <div className="sidebar-foot">
          <span className="k">网关端点</span>
          <span className="v">{window.location.host}/v1</span>
          <span className="k" style={{ marginTop: 4 }}>协议</span>
          <span className="v">OpenAI 兼容</span>
        </div>
      </nav>

      <main className="content">
        {error && <Notice kind="err">网关健康度读取失败：{error}</Notice>}
        {route === 'overview' && <OverviewPage health={health} navigate={navigate} />}
        {route === 'trae' && (
          <TraePage
            region={query.r === 'ai' ? 'ai' : 'cn'}
            onRegion={(r) => { replaceQuery({ r }); onChannelChanged(); }}
          />
        )}
        {route === 'workbuddy' && (
          <WorkBuddyPage
            variant={query.r === 'global' ? 'global' : 'cn'}
            onVariant={(r) => { replaceQuery({ r }); onChannelChanged(); }}
          />
        )}
        {route === 'qoder' && (
          <QoderPage
            variant={query.r === 'global' ? 'global' : 'cn'}
            onVariant={(r) => { replaceQuery({ r }); onChannelChanged(); }}
          />
        )}
      </main>
    </div>
  );
}
