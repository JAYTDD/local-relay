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
 * 丢掉"Remote 广告了、但 get_detail_param 没有匹配项"的死 config_name
 * （源 apply() 的 dropDeadModels；例如 Doubao-Seed-Code —— 调了会报 3003/4001）。
 *
 * 判定拿显示键（小写 id 与 name）两边都试：上游对同一模型的 id 与 name 拼写可能不同。
 * `resolved` 为 false（首次 discovery 尚未成功）时不过滤——那时没有证据说谁死了，
 * 贸然过滤会把整个花名册清空。
 *
 * @param {Array} rows 候选模型行
 * @param {{resolved: boolean, callableKeys: Set<string>}} wire 本区域的 wire 状态
 */
export function dropDeadModels(rows, wire) {
  if (!wire.resolved) return rows;
  return rows.filter(
    (m) =>
      wire.callableKeys.has(String(m.id).trim().toLowerCase()) ||
      wire.callableKeys.has(String(m.name ?? '').trim().toLowerCase()),
  );
}

/**
 * 为一个区域装配 Trae 栈。
 * @param {string} region 'cn' | 'ai'
 */
export function createTraeProvider(region) {
  const catalog = new trae.TraeCatalog(region);

  // 本区域的 wire 状态。CN 与国际版名册重叠（有些 id 拼写不同），
  // 共享一张 map 会让一个区域的答案过滤掉另一个区域的目录。
  // callableKeys：经确认可调用的显示键（小写 id 与 name）——两者都缺席的模型是死 config_name。
  const wire = {
    callableKeys: new Set(),
    resolved: false,
    byId: new Map(),
    byName: new Map(),
  };

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

  // 额度/签到客户端（源 apply() 同款装配）。注入式：credential + deviceId 都由外部提供。
  // CN 与 AI 的取数契约不同：CN 走 snapshot/checkinStatus，AI 走 payStatus。
  const usage = new trae.TraeUsageClient({
    credential: () => store.resolve(),
    deviceId: async () => (await identity()).deviceId,
  });

  return {
    id: region === 'ai' ? 'trae-global' : 'trae',
    label: region === 'ai' ? 'Trae (国际版)' : 'Trae (国内版)',
    providerPrefix: region === 'ai' ? 'traeg' : 'trae',
    // 供面板查询真实登录态与账号（只读；不暴露 token）
    store,
    // 供面板查询额度/签到（只读部分；写操作只有 checkin）
    usage,
    region,
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

      // 记录本区域确认可调用的显示键（源 apply() 的 discoverModels）
      wire.callableKeys.clear();
      for (const model of merged) {
        wire.callableKeys.add(String(model.id).trim().toLowerCase());
        wire.callableKeys.add(String(model.name).trim().toLowerCase());
      }
      wire.resolved = merged.length > 0;

      wire.byId.clear();
      wire.byName.clear();
      for (const model of merged) {
        if (model.wireConfigName !== undefined) {
          const target = {
            configName: model.wireConfigName,
            ...(model.wireFunction === undefined ? {} : { function: model.wireFunction }),
          };
          wire.byId.set(model.id, target);
          wire.byName.set(String(model.name).trim().toLowerCase(), target);
        }
      }

      // 过滤管道（源 apply() 的 derive）：清洗 → 去死模型 → 派生。
      // 空选集语义 = "未配置过" = 全都要；本地网关无按模型选集，故传空集。
      const cleaned = dropDeadModels(trae.sanitizeCatalog(merged), wire);
      const derived = trae.deriveCatalog(cleaned, new Set(), {});
      const final = derived.length > 0 ? derived : trae.fallbackModelsFor(region);

      // 关键：过滤后的结果才是写进 catalog 的。若把未过滤的存进去，
      // 下次读 catalog 会复活死模型（源实现也是写过滤后的）。
      catalog.set(final);
      return { models: final, errors: lastErr };
    },
    models() {
      return catalog.current();
    },
    async close() {
      await this.shim?.close();
    },
  };
}
