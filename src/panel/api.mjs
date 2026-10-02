/**
 * 面板 API：把 local-relay 内部的 provider 状态暴露成 JSON。
 * 只做 HTTP 编排；各通道的业务组装在 ./trae-status.mjs 等模块里。
 */
import { createTraeStatus } from './trae-status.mjs';

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
  const traeStatus = createTraeStatus({ providers: deps.providers });
  routes.set('GET /panel/api/health', (req, res) => json(res, 200, healthDocument(deps.providers())));
  routes.set('GET /panel/api/trae', async (req, res) => {
    const out = {};
    for (const region of traeStatus.regions()) {
      out[region] = await traeStatus.document(region);
    }
    json(res, 200, { regions: out });
  });
  routes.set('POST /panel/api/trae/refresh', async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const region = url.searchParams.get('region') ?? 'cn';
    const out = await traeStatus.refresh(region);
    json(res, 200, out);
  });

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
