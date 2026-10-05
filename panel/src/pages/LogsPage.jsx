import React, { useEffect } from 'react';
import { EmptyState, LoadingBlock, Notice, Section, fmtTime } from '../components/primitives.jsx';
import { RefreshIcon, ScrollTextIcon } from '../components/icons.jsx';
import { api } from '../api.js';
import { useAsyncData } from '../hooks.js';

const STATUS_LABEL = {
  ok: '成功',
  error: '失败',
  aborted: '已取消',
  'unknown-model': '模型不存在',
};

/** 请求日志：环形缓冲的元数据（不含正文），排障用。挂载期间每 5s 轮询。 */
export default function LogsPage() {
  const { data, loading, error, reload } = useAsyncData(api.getLogs);

  useEffect(() => {
    const t = setInterval(() => { reload(); }, 5_000);
    return () => clearInterval(t);
  }, [reload]);

  const entries = data?.entries ?? [];

  return (
    <div className="content-inner">
      <header className="page-head">
        <div>
          <h1 className="page-title">
            <span className="page-icon"><ScrollTextIcon size={22} /></span>
            日志
          </h1>
          <p className="page-sub">
            请求元数据 · 内存环形缓冲（容量 {data?.cap ?? '…'}，重启即清） · 不记录请求与响应正文
            {data?.dropped > 0 && ` · 已滚出 ${data.dropped} 条`}
          </p>
        </div>
        <button type="button" className="btn" onClick={() => reload()}>
          <RefreshIcon size={14} /> 刷新
        </button>
      </header>

      {error && !data && <Notice kind="err">{error}</Notice>}
      {loading && !data && <div className="section"><LoadingBlock lines={6} tall /></div>}

      {data && entries.length === 0 && (
        <Section>
          <EmptyState
            icon={<ScrollTextIcon size={20} />}
            title="还没有请求记录"
            sub="网关收到 /v1/chat/completions 调用后会在这里留痕（成功、失败、取消、模型名错误都算）"
          />
        </Section>
      )}

      {data && entries.length > 0 && (
        <Section>
          <table className="table">
            <thead>
              <tr><th>时间</th><th>通道</th><th>模型</th><th>流式</th><th>结果</th><th>耗时</th></tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.at}-${i}`} style={e.status !== 'ok' ? { color: 'var(--err, #f87171)' } : undefined}>
                  <td>{fmtTime(e.at)}</td>
                  <td>{e.channel ? <code className="inline">{e.channel}/</code> : <span className="dim">—</span>}</td>
                  <td><code className="inline">{e.model}</code></td>
                  <td>{e.stream ? '是' : '否'}</td>
                  <td title={e.error ?? e.status}>
                    {STATUS_LABEL[e.status] ?? e.status}
                    {e.status === 'error' && e.error ? ` · ${e.error.slice(0, 80)}` : ''}
                  </td>
                  <td>{e.durationMs != null ? `${e.durationMs}ms` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}
