import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStaticHandler } from '../src/panel/static.mjs';

function makeRes() {
  return {
    statusCode: undefined,
    headers: undefined,
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(chunk) { if (chunk !== undefined) this.body += chunk; },
  };
}

/** 建一个临时 dist 目录 */
function tempDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-dist-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>PANEL-INDEX</html>');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  return dir;
}

test('serves index.html for /panel', async () => {
  const h = createStaticHandler({ distDir: tempDist() });
  const res = makeRes();
  assert.equal(await h.handle({ method: 'GET' }, res, '/panel'), true);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /PANEL-INDEX/);
  assert.match(res.headers['Content-Type'], /text\/html/);
});

test('serves hashed asset with js content type', async () => {
  const h = createStaticHandler({ distDir: tempDist() });
  const res = makeRes();
  assert.equal(await h.handle({ method: 'GET' }, res, '/panel/assets/app.js'), true);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /javascript/);
  assert.match(res.body, /console\.log/);
});

test('SPA fallback for unknown non-asset path', async () => {
  const h = createStaticHandler({ distDir: tempDist() });
  const res = makeRes();
  assert.equal(await h.handle({ method: 'GET' }, res, '/panel/settings'), true);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /PANEL-INDEX/);
});

test('rejects path traversal', async () => {
  const h = createStaticHandler({ distDir: tempDist() });
  const res = makeRes();
  assert.equal(await h.handle({ method: 'GET' }, res, '/panel/../../etc/passwd'), true);
  assert.equal(res.statusCode, 404);
});

test('missing dist returns 503 with build hint', async () => {
  const h = createStaticHandler({ distDir: path.join(os.tmpdir(), 'definitely-missing-dist-xyz') });
  const res = makeRes();
  assert.equal(await h.handle({ method: 'GET' }, res, '/panel'), true);
  assert.equal(res.statusCode, 503);
  assert.match(res.body, /build:panel/);
});
