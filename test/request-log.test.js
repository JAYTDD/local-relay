import test from 'node:test';
import assert from 'node:assert/strict';

// 环形容量在模块加载时读 env，必须先设 env 再动态 import
process.env.RELAY_LOG_CAP = '3';
const { logRequest, snapshotLogs, resetLogs } = await import('../src/request-log.mjs');

test('快照 newest-first，且不持有可变引用', () => {
  resetLogs();
  logRequest({ model: 'a', status: 'ok' });
  logRequest({ model: 'b', status: 'ok' });
  const snap = snapshotLogs();
  assert.deepEqual(snap.entries.map((e) => e.model), ['b', 'a']);
  snap.entries[0].model = 'mutated';
  assert.equal(snapshotLogs().entries[0].model, 'b', '快照必须是拷贝');
});

test('超过容量丢弃最旧的，并如实报告丢弃数', () => {
  resetLogs();
  for (let i = 0; i < 7; i++) logRequest({ model: `m${i}` });
  const snap = snapshotLogs();
  assert.equal(snap.entries.length, 3);
  assert.deepEqual(snap.entries.map((e) => e.model), ['m6', 'm5', 'm4']);
  assert.equal(snap.dropped, 4);
});
