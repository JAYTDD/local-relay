/**
 * local-relay：把 DSH 三个订阅接入插件的协议层，聚合成一个本地
 * OpenAI 兼容网关。
 *
 * 每个 provider 自带的 loopback shim 只监听随机端口、带独立随机 bearer，
 * 这里做一层统一入口：单一端口 + 单一 key + 模型名前缀路由。
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTraeProvider } from './providers/trae.mjs';
import { createWorkBuddyProvider } from './providers/workbuddy.mjs';
import { createQoderProvider } from './providers/qoder.mjs';
import { createPanelApi } from './panel/api.mjs';
import { createStaticHandler } from './panel/static.mjs';

const PORT = Number(process.env.RELAY_PORT ?? 8790);
const ACCESS_KEY = process.env.RELAY_KEY ?? '';

/** 各 provider 暴露的模型名前缀（避免不同上游模型同名冲突）。 */
const PROVIDERS = [
  { kind: 'trae', prefix: 'trae', label: 'Trae 国内版', build: () => createTraeProvider('cn') },
  { kind: 'trae', prefix: 'traeg', label: 'Trae 国际版', build: () => createTraeProvider('ai') },
  { kind: 'workbuddy', prefix: 'wb', label: 'WorkBuddy 国内版', build: () => createWorkBuddyProvider('cn') },
  { kind: 'workbuddy', prefix: 'wbai', label: 'WorkBuddy 国际版', build: () => createWorkBuddyProvider('global') },
  // Qoder 的 build 是 async：transport 要从包内未导出的路径动态加载
  { kind: 'qoder', prefix: 'qoder', label: 'Qoder 国内版', build: () => createQoderProvider('cn') },
  { kind: 'qoder', prefix: 'qoderg', label: 'Qoder 国际版', build: () => createQoderProvider('global') },
];

const state = { providers: [], ready: false, errors: [] };

const panelApi = createPanelApi({ providers: () => state.providers });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const panelStatic = createStaticHandler({ distDir: path.join(__dirname, '..', 'panel', 'dist') });

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function authorized(req) {
  if (!ACCESS_KEY) return true;
  const h = req.headers.authorization ?? '';
  return h === `Bearer ${ACCESS_KEY}` || h === `x-api-key ${ACCESS_KEY}`;
}

async function readBody(req, limit = 64 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** 按前缀把外部模型名拆成 { provider, upstreamModel }。 */
function resolveModel(modelId) {
  for (const p of state.providers) {
    const prefix = `${p.def.prefix}/`;
    if (modelId.startsWith(prefix)) {
      return { provider: p, upstreamModel: modelId.slice(prefix.length) };
    }
  }
  // 未带前缀时按顺序找第一个声明该模型的 provider
  for (const p of state.providers) {
    if (p.models.some((m) => m.id === modelId)) return { provider: p, upstreamModel: modelId };
  }
  return null;
}

function listModels() {
  const data = [];
  for (const p of state.providers) {
    for (const m of p.models) {
      data.push({
        id: `${p.def.prefix}/${m.id}`,
        object: 'model',
        created: 0,
        owned_by: p.def.label,
        ...(m.contextWindow === undefined ? {} : { context_window: m.contextWindow }),
        ...(m.maxTokens === undefined ? {} : { max_tokens: m.maxTokens }),
        ...(m.reasoningSupported === undefined ? {} : { reasoning: m.reasoningSupported }),
      });
    }
  }
  return data;
}

/**
 * 把上游 SSE 流聚合成一个非流式 chat.completion。
 * 三个插件的 shim 只输出流式（忽略 stream:false），所以非流式请求必须在这里聚合。
 */
async function collectStream(response, fallbackModel) {
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let finish = 'stop';
  let id = `chatcmpl-${Math.random().toString(36).slice(2, 10)}`;
  let model = fallbackModel;
  let created = Math.floor(Date.now() / 1000);
  let usage;
  let upstreamError;
  const toolCalls = new Map();

  const consume = (payload) => {
    if (payload === '[DONE]') return;
    let obj;
    try { obj = JSON.parse(payload); } catch { return; }
    if (obj.error) { upstreamError = obj.error.message ?? JSON.stringify(obj.error); return; }
    if (obj.id) id = obj.id;
    if (obj.model) model = obj.model;
    if (obj.created) created = obj.created;
    if (obj.usage) usage = obj.usage;
    const choice = obj.choices?.[0];
    const delta = choice?.delta;
    if (delta?.content) content += delta.content;
    if (delta?.reasoning_content) reasoning += delta.reasoning_content;
    for (const tc of delta?.tool_calls ?? []) {
      const key = tc.index ?? 0;
      const cur = toolCalls.get(key) ?? { id: tc.id ?? `call_${key}`, type: 'function', function: { name: '', arguments: '' } };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.function.name = tc.function.name;
      if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
      toolCalls.set(key, cur);
    }
    if (choice?.finish_reason) finish = choice.finish_reason;
  };

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith('data:')) consume(t.slice(5).trim());
    }
  }
  if (buffer.trim().startsWith('data:')) consume(buffer.trim().slice(5).trim());

  if (upstreamError && !content && toolCalls.size === 0) throw new Error(upstreamError);

  const message = { role: 'assistant', content };
  if (reasoning) message.reasoning_content = reasoning;
  if (toolCalls.size > 0) {
    message.tool_calls = [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }
  const finalFinish = toolCalls.size > 0 ? 'tool_calls' : (finish || 'stop');
  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [{ index: 0, message, finish_reason: finalFinish }],
    usage: usage ?? { prompt_tokens: 0, completion_tokens: Math.ceil((content.length + reasoning.length) / 4), total_tokens: 0 },
  };
}

/**
 * 规范化一个 OpenAI 流式 chunk，使其严格符合标准形态。
 *
 * 上游（WorkBuddy / Trae）会带非标准字段，并**在每一帧都重复 `role`**：
 *   - ZCode 之类客户端按「出现 role 就开新段落」解析，于是每帧都开一个新
 *     思考块，界面上表现为满屏「思考·持续了几秒」。
 *   - DSH 的适配器对此容错，所以直连 DSH 看不出问题。
 *
 * 处理：role 只保留首帧；丢弃空 reasoning_content 与非标准键；
 * 无任何有效增量的空帧直接丢弃。
 */
export function normalizeChunk(chunk, seen) {
  if (!chunk || typeof chunk !== 'object') return null;
  const out = {
    id: chunk.id,
    object: chunk.object ?? 'chat.completion.chunk',
    created: chunk.created,
    model: chunk.model,
  };
  if (chunk.usage) out.usage = chunk.usage;
  out.choices = (chunk.choices ?? []).map((choice) => {
    const delta = choice?.delta ?? {};
    const clean = {};
    // role 只在首帧出现一次
    if (delta.role && !seen.role) { clean.role = delta.role; seen.role = true; }
    if (delta.content) clean.content = delta.content;
    if (delta.reasoning_content) clean.reasoning_content = delta.reasoning_content;
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) clean.tool_calls = delta.tool_calls;
    const cleanChoice = { index: choice?.index ?? 0, delta: clean, finish_reason: choice?.finish_reason ?? null };
    return cleanChoice;
  });
  // 既无增量也无结束标记的空帧丢弃（客户端不需要）
  const hasDelta = out.choices.some((c) => Object.keys(c.delta).length > 0);
  const hasFinish = out.choices.some((c) => c.finish_reason);
  if (!hasDelta && !hasFinish) return null;
  return out;
}

/** 逐行解析上游 SSE，规范化后转发。 */
async function relayStream(body, res) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  const seen = { role: false };
  const write = (obj) => res.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') { res.write(encoder.encode('data: [DONE]\n\n')); continue; }
      let obj;
      try { obj = JSON.parse(payload); } catch { continue; }
      if (obj.error) { write({ error: obj.error }); continue; }
      const norm = normalizeChunk(obj, seen);
      if (norm) write(norm);
    }
  }
  if (buffer.trim().startsWith('data:')) {
    const payload = buffer.trim().slice(5).trim();
    if (payload && payload !== '[DONE]') {
      try {
        const norm = normalizeChunk(JSON.parse(payload), seen);
        if (norm) write(norm);
      } catch { /* 忽略尾部残片 */ }
    }
  }
}

async function handleChat(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req)).toString('utf8'));
  } catch (e) {
    return json(res, 400, { error: { message: `Invalid JSON body: ${e.message}` } });
  }
  const modelId = body.model;
  const hit = resolveModel(modelId);
  if (!hit) {
    return json(res, 404, {
      error: { message: `Unknown model: ${modelId}. See GET /v1/models for the list.` },
    });
  }
  const { provider, upstreamModel } = hit;
  const wantStream = body.stream === true;
  const upstreamBody = { ...body, model: upstreamModel, stream: true };

  let r;
  try {
    r = await fetch(`${provider.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.shim.token()}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch (e) {
    return json(res, 502, { error: { message: `Upstream failed: ${e.message}` } });
  }

  if (!r.ok) {
    const text = await r.text().catch(() => '');
    return json(res, r.status, { error: { message: `Upstream failed: ${text.slice(0, 400)}` } });
  }

  if (wantStream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    if (!r.body) return res.end();
    await relayStream(r.body, res);
    return res.end();
  }

  try {
    const result = await collectStream(r, upstreamModel);
    return json(res, 200, result);
  } catch (e) {
    return json(res, 502, { error: { message: `Upstream failed: ${e.message}` } });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname;
    if (pathname.startsWith('/panel/api/')) {
      const handled = await panelApi.handle(req, res, pathname);
      if (handled) return;
      return json(res, 404, { error: { message: `no such panel route: ${pathname}` } });
    }
    if (pathname === '/panel' || pathname.startsWith('/panel/')) {
      const served = await panelStatic.handle(req, res, pathname);
      if (served) return;
    }
    if (req.method === 'GET' && (pathname === '/healthz' || pathname === '/health')) {
      return json(res, 200, { ok: true, ready: state.ready, providers: state.providers.map((p) => ({ id: p.def.prefix, label: p.def.label, models: p.models.length, error: p.error })) });
    }
    if (!authorized(req)) return json(res, 401, { error: { message: 'Unauthorized' } });
    if (req.method === 'GET' && (pathname === '/v1/models' || pathname === '/v1/models/')) {
      return json(res, 200, { object: 'list', data: listModels() });
    }
    if (req.method === 'POST' && (pathname === '/v1/chat/completions' || pathname === '/v1/chat/completions/')) {
      return handleChat(req, res);
    }
    return json(res, 404, { error: { message: `no such route: ${req.method} ${pathname}` } });
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: { message: String(e) } });
    else res.end();
  }
});

async function boot() {
  for (const def of PROVIDERS) {
    const entry = { def, provider: null, shim: null, models: [], error: undefined };
    try {
      // await 对同步工厂无害，Qoder 的工厂是 async（动态加载未导出的 transport）
      const provider = await def.build();
      await provider.start();
      entry.provider = provider;
      entry.shim = provider.shim;
      entry.models = provider.models();
      console.log(`✅ ${def.label.padEnd(18)} 模型 ${String(entry.models.length).padStart(3)} 个`);
    } catch (e) {
      entry.error = e.message;
      console.warn(`⚠️  ${def.label.padEnd(18)} 不可用: ${e.message.slice(0, 140)}`);
    }
    state.providers.push(entry);
  }
  state.ready = true;
  server.listen(PORT, '127.0.0.1', () => {
    const total = state.providers.reduce((n, p) => n + p.models.length, 0);
    console.log(`\nlocal-relay listening on http://127.0.0.1:${PORT}/v1  (共 ${total} 个模型)`);
    console.log(`API Key: ${ACCESS_KEY || '(未设置，任意值均可)'}`);
  });
}

async function shutdown() {
  for (const p of state.providers) {
    try { await p.provider?.close(); } catch { /* 忽略 */ }
  }
  server.close();
}

process.on('SIGINT', async () => { await shutdown(); process.exit(0); });
process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });

boot().catch((e) => { console.error('启动失败:', e); process.exit(1); });
