/**
 * Trae 供应商：从 dsh-connect-trae 提取协议层，装配成一个独立的
 * OpenAI 兼容 loopback shim。
 *
 * 依赖注入式构造（credential/identity/fetchImpl）是插件原本就提供的，
 * 这里只负责把它们按插件 apply() 里的顺序串起来。
 */
import * as trae from 'dsh-connect-trae';

const logger = {
  warn: (...a) => console.error('[trae][warn]', ...a),
  error: (...a) => console.error('[trae][error]', ...a),
};

export const TRAE_REGIONS = ['cn', 'ai'];

/**
 * 为一个区域装配 Trae 栈。
 * @param {string} region 'cn' | 'ai'
 */
export function createTraeProvider(region) {
  const catalog = new trae.TraeCatalog(region);
  const wire = { byId: new Map(), byName: new Map() };

  // identity 需要 store 已就绪，先声明后引用
  let store;

  const identity = async () => {
    let preferred;
    try { preferred = (await store.current())?.edition; } catch { /* 未登录时忽略 */ }
    const hint = preferred;
    const candidates = trae.traeStorageCandidates().filter(
      (item) => item.source === 'desktop' && (hint !== undefined ? item.edition === hint : true),
    );
    return trae.resolveTraeIdentity(candidates, hint ?? (region === 'ai' ? 'solo-sg' : 'cn'));
  };

  const refreshDeviceSafe = async () => {
    try {
      const v = await identity();
      return { deviceId: v.deviceId, machineId: v.machineId };
    } catch {
      return undefined;
    }
  };

  store = new trae.TraeCredentialStore({
    region,
    edition: 'auto',
    refresh: async (credential) => trae.refreshTraeCredential(credential, undefined, await refreshDeviceSafe()),
  });

  const solo = new trae.TraeSoloUpstreamClient({
    credential: () => store.resolve(),
    identity,
    log: (message, detail) => logger.warn(message, detail),
  });

  const remoteCatalog = new trae.TraeSoloRemoteCatalogClient({ credential: () => store.resolve() });
  const wireResolver = (displayId) =>
    wire.byId.get(displayId) ?? wire.byName.get(String(displayId).trim().toLowerCase());

  const upstream = new trae.TraeSoloBridge(solo, catalog, wireResolver);
  const delegating = new trae.TraeDelegatingUpstreamClient(upstream);

  return {
    id: region === 'ai' ? 'trae-global' : 'trae',
    label: region === 'ai' ? 'Trae (国际版)' : 'Trae (国内版)',
    providerPrefix: region === 'ai' ? 'traeg' : 'trae',
    shim: null, // start() 时填充
    async start() {
      const shim = trae.createTraeShim({ catalog, client: delegating, logger });
      await shim.ready;
      this.shim = shim;
      await this.refreshModels();
      return this;
    },
    async refreshModels() {
      const lastErr = [];
      let remote = [];
      let local = [];
      try { remote = await remoteCatalog.fetchModels(); } catch (e) { lastErr.push(`remote: ${e.message}`); }
      try { local = await solo.fetchModels(); } catch (e) { lastErr.push(`wire: ${e.message}`); }
      const merged = trae.mergeTraeModelSources(remote, local);
      for (const model of merged) {
        if (model.wireConfigName !== undefined) {
          const target = {
            configName: model.wireConfigName,
            ...(model.wireFunction === undefined ? {} : { function: model.wireFunction }),
          };
          wire.byId.set(model.id, target);
          wire.byName.set(model.name.trim().toLowerCase(), target);
        }
      }
      catalog.set(merged);
      return { models: merged, errors: lastErr };
    },
    models() {
      return catalog.current();
    },
    async close() {
      await this.shim?.close();
    },
  };
}
