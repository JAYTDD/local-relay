import * as wb from 'dsh-workbuddy-connect';
const client = new wb.WorkBuddyUpstreamClient();
const store = new wb.WorkBuddyCredentialStore({ variant: wb.CN_VARIANT, refresh: (c)=>client.refreshToken(c) });
const catalog = new wb.WorkBuddyCatalog(wb.FALLBACK_WORKBUDDY_MODELS);
console.log('setVisible(true) ->', catalog.setVisible(true), '| isVisible:', catalog.isVisible(), '| 模型数:', catalog.current().length);
try { const cred = await store.resolve(); console.log('凭据解析 OK, account:', cred?.accountName || cred?.userId || JSON.stringify(cred).slice(0,120)); }
catch(e){ console.log('凭据解析失败:', e.message.slice(0,200)); }
const shim = wb.createWorkBuddyShim({ store, client, catalog, logger:{warn(){},error(){}} });
await shim.ready;
console.log('shim ready. 此刻 catalog 模型数:', catalog.current().length);
const r = await fetch(`${shim.baseUrl()}/v1/models`, { headers: { Authorization: `Bearer ${shim.token()}` } });
const j = await r.json();
console.log('带 bearer 请求 /v1/models -> HTTP', r.status, '模型数:', (j.data||[]).length);
await shim.close();
