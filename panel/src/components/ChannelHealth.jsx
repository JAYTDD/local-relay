import React from 'react';

/** 四个通道的健康度总览 */
export default function ChannelHealth({ health }) {
  if (!health) return <section className="card"><p className="muted">正在读取网关状态…</p></section>;
  const total = health.providers.reduce((n, p) => n + p.models, 0);
  return (
    <section className="card">
      <div className="card-head">
        <h2>网关总览</h2>
        <span className="muted">共 {total} 个模型</span>
      </div>
      <table className="table">
        <thead>
          <tr><th>通道</th><th>前缀</th><th>模型数</th><th>状态</th></tr>
        </thead>
        <tbody>
          {health.providers.map((p) => (
            <tr key={p.prefix}>
              <td>{p.label}</td>
              <td><code>{p.prefix}/</code></td>
              <td>{p.models}</td>
              <td>
                {p.error
                  ? <span className="badge err" title={p.error}>不可用</span>
                  : <span className="badge ok">就绪</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        网关端点 <code>http://127.0.0.1:8790/v1</code>，客户端 API Key 任意（未设 RELAY_KEY 时）。
        模型名格式为 <code>前缀/模型ID</code>。
      </p>
    </section>
  );
}
