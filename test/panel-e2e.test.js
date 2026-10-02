import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.RELAY_BASE ?? 'http://127.0.0.1:8790';

/** 探测网关是否在跑；不在则跳过整个文件 */
async function gatewayUp() {
  try {
    const r = await fetch(`${BASE}/panel/api/health`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

const up = await gatewayUp();
const opts = up ? {} : { skip: '网关未运行（先 node src/server.mjs）' };

test('health lists six channels', opts, async () => {
  const r = await fetch(`${BASE}/panel/api/health`);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.providers.length, 6);
  const prefixes = j.providers.map((p) => p.prefix).sort();
  assert.deepEqual(prefixes, ['qoder', 'qoderg', 'trae', 'traeg', 'wb', 'wbai']);
});

test('trae document has both regions and no credential leak', opts, async () => {
  const r = await fetch(`${BASE}/panel/api/trae`);
  const j = await r.json();
  assert.deepEqual(Object.keys(j.regions).sort(), ['ai', 'cn']);
  const text = JSON.stringify(j);
  for (const needle of ['accessToken', 'refreshToken', 'Bearer ', 'password']) {
    assert.equal(text.includes(needle), false, `response leaked ${needle}`);
  }
});

test('workbuddy document lists models with credits rate', opts, async () => {
  const r = await fetch(`${BASE}/panel/api/workbuddy`);
  const j = await r.json();
  const cn = j.variants.cn;
  assert.ok(Array.isArray(cn.models));
  assert.ok(cn.models.length > 0, 'expected at least one WorkBuddy model');
  const withRate = cn.models.filter((m) => typeof m.credits === 'string' || typeof m.credits === 'number');
  assert.ok(withRate.length > 0, 'expected at least one model with a credits rate');
});

test('workbuddy control returns explicit state, never silent success', opts, async () => {
  const r = await fetch(`${BASE}/panel/api/workbuddy/control?variant=cn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'clear' }),
  });
  const j = await r.json();
  assert.ok(['updated', 'failed', 'stale-account', 'cleared'].includes(j.state));
  if (j.state === 'failed') assert.ok(typeof j.reason === 'string' && j.reason.length > 0);
});

test('qoder reports both variants with real data', opts, async () => {
  const r = await fetch(`${BASE}/panel/api/qoder`);
  const j = await r.json();
  assert.ok(j.variants, 'expected a variants document');
  const cn = j.variants.cn;
  assert.equal(cn.status, 'signed-in');
  assert.ok(cn.models.length > 0, 'Qoder CN should list models');
  // 凭据来源只允许 patTail 这类展示信息，不得出现完整 PAT
  assert.equal(JSON.stringify(cn).includes('"pat":"'), false);
});

test('panel HTML is served', opts, async () => {
  const r = await fetch(`${BASE}/panel`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /panel/i);
});
