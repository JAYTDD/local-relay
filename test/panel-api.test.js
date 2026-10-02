import test from 'node:test';
import assert from 'node:assert/strict';
import { createPanelApi } from '../src/panel/api.mjs';

/** 造一个假的 providers 快照 */
function fakeProviders() {
  return [
    { def: { prefix: 'trae', label: 'Trae 国内版', kind: 'trae' }, models: [{ id: 'glm-5.3' }], error: undefined },
    { def: { prefix: 'wb', label: 'WorkBuddy 国内版', kind: 'workbuddy' }, models: [{ id: 'hy3' }], error: undefined },
  ];
}

/** 最小 req/res 桩，收集响应 */
function makeRes() {
  const res = {
    statusCode: undefined,
    headers: undefined,
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(chunk) { if (chunk !== undefined) this.body += chunk; },
  };
  return res;
}

test('GET /panel/api/health returns provider summary without tokens', async () => {
  const api = createPanelApi({ providers: fakeProviders });
  const res = makeRes();
  const handled = await api.handle({ method: 'GET', url: '/panel/api/health', headers: {} }, res, '/panel/api/health');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.providers.length, 2);
  assert.equal(body.providers[0].prefix, 'trae');
  assert.equal(body.providers[0].models, 1);
  assert.equal(res.body.includes('token'), false);
});

test('unknown panel path is not handled', async () => {
  const api = createPanelApi({ providers: fakeProviders });
  const res = makeRes();
  const handled = await api.handle({ method: 'GET', url: '/panel/api/nope', headers: {} }, res, '/panel/api/nope');
  assert.equal(handled, false);
});
