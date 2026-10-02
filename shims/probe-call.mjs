// 可行性验证 2：真实装配 Trae 栈并跑通一次调用
import * as t from 'dsh-connect-trae';

const REGION = 'cn';
const logger = { warn: (...a) => console.error('[warn]', ...a), error: (...a) => console.error('[err]', ...a) };

const catalog = new t.TraeCatalog(REGION);
const wire = { byId: new Map(), byName: new Map() };

const identity = async () => {
  const preferred = (await store.current().catch(() => undefined))?.edition;
  const hint = preferred;
  const cands = t.traeStorageCandidates().filter(
    (item) => item.source === 'desktop' && (hint !== undefined ? item.edition === hint : true),
  );
  return t.resolveTraeIdentity(cands, hint ?? 'cn');
};

const refreshDeviceSafe = async () => {
  try { const v = await identity(); return { deviceId: v.deviceId, machineId: v.machineId }; }
  catch { return undefined; }
};

const store = new t.TraeCredentialStore({
  region: REGION,
  edition: 'auto',
  refresh: async (credential) => t.refreshTraeCredential(credential, undefined, await refreshDeviceSafe()),
});

const solo = new t.TraeSoloUpstreamClient({
  credential: () => store.resolve(),
  identity,
  log: (m, d) => logger.warn(m, d),
});
const remoteCatalog = new t.TraeSoloRemoteCatalogClient({ credential: () => store.resolve() });
const wireResolver = (displayId) => wire.byId.get(displayId) ?? wire.byName.get(String(displayId).trim().toLowerCase());
const upstream = new t.TraeSoloBridge(solo, catalog, wireResolver);
const delegating = new t.TraeDelegatingUpstreamClient(upstream);

const shim = t.createTraeShim({ catalog, client: delegating, logger });
await shim.ready;

console.log('✅ shim 已启动:', shim.baseUrl());

// 发现模型
const merged = t.mergeTraeModelSources(await remoteCatalog.fetchModels(), await solo.fetchModels());
for (const m of merged) {
  if (m.wireConfigName !== undefined) {
    const target = { configName: m.wireConfigName, ...(m.wireFunction === undefined ? {} : { function: m.wireFunction }) };
    wire.byId.set(m.id, target);
    wire.byName.set(m.name.trim().toLowerCase(), target);
  }
}
console.log('发现模型:', merged.length, '个；其中带 wire 映射:', wire.byId.size);
console.log('样例:', merged.slice(0, 8).map((m) => `${m.id}[${m.wireFunction ?? '-'}]`).join(', '));

// 跑一次真实调用（直连 shim，标准 OpenAI 协议）
const first = merged[0];
console.log('\n用模型:', first?.id);
const res = await fetch(`${shim.baseUrl()}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${shim.token()}` },
  body: JSON.stringify({ model: first.id, messages: [{ role: 'user', content: '说 ok' }], stream: false }),
});
console.log('HTTP', res.status);
const text = await res.text();
console.log(text.slice(0, 500));
await shim.close();
