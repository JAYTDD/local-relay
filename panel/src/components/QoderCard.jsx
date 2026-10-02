import React from 'react';

export default function QoderCard({ data }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Qoder</h2>
        {data && <span className="badge warn">未接入</span>}
      </div>
      <p className="muted small">
        {data?.reason ?? '正在读取…'}
      </p>
      <p className="muted small">
        接入前置：安装 <code>qoderclicn</code> 并执行 <code>qoderclicn login</code>，
        然后补写 <code>src/providers/qoder.mjs</code>（其 transport 未从插件包导出，需自行装配）。
      </p>
    </section>
  );
}
