import React from 'react';

/**
 * 模型列表。Trae 与 WorkBuddy 共用。
 * columns 决定额外列（如倍率、上下文窗口）。
 */
export default function ModelTable({ models, emptyText = '暂无模型', columns = [] }) {
  if (!models || models.length === 0) return <p className="muted small">{emptyText}</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>模型 ID</th>
          <th>名称</th>
          {columns.map((c) => <th key={c.key}>{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {models.map((m) => (
          <tr key={m.id}>
            <td><code>{m.id}</code></td>
            <td>{m.name ?? m.id}</td>
            {columns.map((c) => <td key={c.key}>{c.render(m)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
