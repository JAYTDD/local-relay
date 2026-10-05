/**
 * 面板 API：把 local-relay 内部的 provider 状态暴露成 JSON。
 * 只做 HTTP 编排；各通道的业务组装在 ./trae-status.mjs 等模块里。
 */
import { createTraeStatus } from './trae-status.mjs';
import { createWorkBuddyStatus } from './workbuddy-status.mjs';
import { createQoderStatus } from './qoder-status.mjs';
import { snapshotLogs } from '../request-log.mjs';

/** 安全 JSON 响应 */
function json(res, status, body) {
  const payload = JSON.stringify(body);
  if (!res.headers) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  }
  res.end(payload);
}

/** 读请求体，1MB 上限 */
async function readRequestBody(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** 读实时目录并回写 entry（与 server.mjs currentModels 同语义），失败返回 undefined */
function liveModels(entry) {
  try {
    const live = entry.provider?.models?.();
    if (live !== undefined) entry.models = live;
    return live;
  } catch {
    return undefined;
  }
}

/**
 * 通道健康度文档：不含任何凭据字段。
 * - endpoint：网关的权威端点（面板可能被 Vite dev 服务器代理打开，
 *   window.location 不可信，端点只能由网关自己宣告）。
 * - models：实时目录计数，选集/禁用后总览与 /v1/models 永远一致。
 */
export function healthDocument(providers, endpoint) {
  return {
    ok: true,
    ready: true,
    ...(endpoint === undefined ? {} : { endpoint }),
    providers: providers.map((p) => ({
      prefix: p.def.prefix,
      label: p.def.label,
      kind: p.def.kind,
      models: (liveModels(p) ?? p.models).length,
      // 通道被面板关闭（Trae 区域启停）时如实标注，前端据此显示状态点
      ...(p.provider?.enabled?.() === false ? { enabled: false } : {}),
      ...(p.error === undefined ? {} : { error: p.error }),
    })),
  };
}

/** 前缀 → 摘要模块与变体的映射在 createPanelApi 内组装（依赖三个 status 实例） */

export function createPanelApi(deps) {
  const routes = new Map();
  const traeStatus = createTraeStatus({ providers: deps.providers });
  const wbStatus = createWorkBuddyStatus({ providers: deps.providers });
  const qoderStatus = createQoderStatus({ providers: deps.providers });
  // 总览实况：前缀 → [status 模块, 变体]。summary 只做本地读（不发上游请求）。
  const SUMMARY_BY_PREFIX = {
    trae: [traeStatus, 'cn'],
    traeg: [traeStatus, 'ai'],
    wb: [wbStatus, 'cn'],
    wbai: [wbStatus, 'global'],
    qoder: [qoderStatus, 'cn'],
    qoderg: [qoderStatus, 'global'],
  };
  routes.set('GET /panel/api/logs', (req, res) => json(res, 200, snapshotLogs()));
  routes.set('GET /panel/api/health', async (req, res) => {
    const doc = healthDocument(deps.providers(), deps.endpoint?.());
    await Promise.all(doc.providers.map(async (p) => {
      const pair = SUMMARY_BY_PREFIX[p.prefix];
      if (!pair) return;
      try {
        const s = await pair[0].summary(pair[1]);
        // 只挑已知字段：摘要模块多返什么都不漏进响应体
        if (typeof s?.status === 'string') p.status = s.status;
        if (typeof s?.reason === 'string') p.reason = s.reason;
        if (s?.degraded === true) p.degraded = true;
      } catch { /* 摘要失败不影响健康度主体，状态点退回 error/enabled 判定 */ }
    }));
    json(res, 200, doc);
  });
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
  routes.set('POST /panel/api/trae/checkin', async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const region = url.searchParams.get('region') ?? 'cn';
    json(res, 200, await traeStatus.checkin(region));
  });
  routes.set('POST /panel/api/trae/control', async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const region = url.searchParams.get('region') ?? 'cn';
    const raw = await readRequestBody(req);
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return json(res, 400, { error: { message: 'invalid JSON body' } });
    }
    json(res, 200, await traeStatus.control(region, body));
  });
  routes.set('GET /panel/api/workbuddy', async (req, res) => {
    const out = {};
    for (const variant of wbStatus.variants()) {
      out[variant] = await wbStatus.document(variant);
    }
    json(res, 200, { variants: out });
  });
  routes.set('POST /panel/api/workbuddy/control', async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const variant = url.searchParams.get('variant') ?? 'cn';
    const raw = await readRequestBody(req);
    let action;
    try {
      action = JSON.parse(raw || '{}');
    } catch {
      return json(res, 400, { error: { message: 'invalid JSON body' } });
    }
    json(res, 200, await wbStatus.control(variant, action));
  });
  routes.set('POST /panel/api/workbuddy/probe', async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const variant = url.searchParams.get('variant') ?? 'cn';
    const raw = await readRequestBody(req);
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return json(res, 400, { error: { message: 'invalid JSON body' } });
    }
    json(res, 200, await wbStatus.probe(variant, body.model));
  });
  routes.set('GET /panel/api/qoder', async (req, res) => {
    const out = {};
    for (const variant of qoderStatus.variants()) {
      out[variant] = await qoderStatus.document(variant);
    }
    json(res, 200, { variants: out });
  });
  routes.set('POST /panel/api/qoder/control', async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const variant = url.searchParams.get('variant') ?? 'cn';
    const raw = await readRequestBody(req);
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return json(res, 400, { error: { message: 'invalid JSON body' } });
    }
    json(res, 200, await qoderStatus.control(variant, body));
  });
  routes.set('POST /panel/api/qoder/refresh', async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    json(res, 200, await qoderStatus.refresh(url.searchParams.get('variant') ?? 'cn'));
  });
  routes.set('POST /panel/api/qoder/probe', async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const variant = url.searchParams.get('variant') ?? 'cn';
    const raw = await readRequestBody(req);
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return json(res, 400, { error: { message: 'invalid JSON body' } });
    }
    json(res, 200, await qoderStatus.probe(variant, body.model));
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
