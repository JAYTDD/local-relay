import { useCallback, useEffect, useState } from 'react';

/**
 * 极简 hash 路由：#/路由名?key=value。
 *
 * 不引 react-router——本项目前端依赖刻意只有 react/react-dom（面板由网关
 * 同源托管，hash 路由不依赖服务端 fallback，最稳）。够用即可。
 */
export const ROUTES = ['overview', 'trae', 'workbuddy', 'qoder', 'logs'];

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const route = ROUTES.includes(pathPart) ? pathPart : 'overview';
  const query = {};
  for (const [k, v] of new URLSearchParams(queryPart ?? '')) query[k] = v;
  return { route, query };
}

export function useHashRoute() {
  const [state, setState] = useState(parseHash);

  useEffect(() => {
    const onChange = () => setState(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((route, query = {}) => {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== ''),
    ).toString();
    window.location.hash = `/${route}${qs ? `?${qs}` : ''}`;
  }, []);

  /** 当前页内参数变化（如切区服）时原地替换，不产生历史记录 */
  const replaceQuery = useCallback((query = {}) => {
    const { route } = parseHash();
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== ''),
    ).toString();
    const next = `#/${route}${qs ? `?${qs}` : ''}`;
    if (next !== window.location.hash) {
      window.history.replaceState(null, '', next);
      setState(parseHash());
    }
  }, []);

  return { ...state, navigate, replaceQuery };
}
