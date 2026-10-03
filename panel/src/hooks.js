import { useCallback, useEffect, useState } from 'react';

/**
 * 页面级数据加载：挂载即取，暴露 reload。
 * 数据层约定：接口永不 500（异常都折进文档字段），这里的 error 只覆盖网络级失败。
 */
export function useAsyncData(fn) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      setState({ data, loading: false, error: null });
      return data;
    } catch (e) {
      setState({ data: null, loading: false, error: String(e?.message ?? e) });
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}
