/**
 * 面板 API：把 local-relay 内部的 provider 状态暴露成 JSON。
 * 只做 HTTP 编排；各通道的业务组装在 ./trae-status.mjs 等模块里。
 */

/** 安全 JSON 响应 */
function json(res, status, body) {
  const payload = JSON.stringify(body);
  if (!res.headers) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  }
  res.end(payload);
}

/** 通道健康度文档：不含任何凭据字段 */
export function healthDocument(providers) {
  return {
    ok: true,
    ready: true,
    providers: providers.map((p) => ({
      prefix: p.def.prefix,
      label: p.def.label,
      kind: p.def.kind,
      models: p.models.length,
      ...(p.error === undefined ? {} : { error: p.error }),
    })),
  };
}

export function createPanelApi(deps) {
  const routes = new Map();
  routes.set('GET /panel/api/health', (req, res) => json(res, 200, healthDocument(deps.providers())));

  return {
    /** 返回 true 表示已处理该请求 */
    async handle(req, res, pathname) {
      const key = `${req.method} ${pathname}`;
      const route = routes.get(key);
      if (!route) return false;
      try {
        await route(req, res);
      } catch (e) {
        json(res, 500, { error: { message: String(e?.message ?? e) } });
      }
      return true;
    },
  };
}
