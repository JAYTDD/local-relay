/**
 * WorkBuddy 供应商：从 dsh-workbuddy-connect 提取协议层。
 * 两个变体（国内 workbuddy / 国际 workbuddy-ai）各自独立的凭据、目录与 shim。
 */
import * as wb from 'dsh-workbuddy-connect';
import { statePath } from '../state-dir.mjs';

const logger = {
  warn: (...a) => console.error('[workbuddy][warn]', ...a),
  error: (...a) => console.error('[workbuddy][error]', ...a),
};

/**
 * 从凭据算账号键（visibility / probe / catalog 都按它分桶）。纯函数，不做 IO。
 *
 * 刻意比插件的 visibilityAccountOf 更严：它只判 `uid === ""`，于是
 * `{ enterpriseId: 'e1' }` 这种 uid 缺失的凭据会算出 `"undefined:e1"` —— 一个
 * 真值字符串，让所有缺 uid 的账号悄悄共用一个桶。源注释明说这种情况就该
 * "完全没有按账号的偏好"（宁可没有，也不能把一个账号的隐藏列表套到另一个上）。
 * 所以这里把 uid 缺失/空串一律判为"没有账号"。
 */
function accountKeyFromCredential(credential) {
  if (credential === undefined || credential === null) return undefined;
  if (typeof credential.uid !== 'string' || credential.uid === '') return undefined;
  return wb.visibilityAccountOf(credential);
}

/**
 * @param {'cn'|'global'} variantId
 */
export function createWorkBuddyProvider(variantId) {
  const variant = variantId === 'global' ? wb.AI_VARIANT : wb.CN_VARIANT;
  const fallback = variantId === 'global' ? wb.FALLBACK_WORKBUDDY_AI_MODELS : wb.FALLBACK_WORKBUDDY_MODELS;

  const client = new wb.WorkBuddyUpstreamClient();
  const store = new wb.WorkBuddyCredentialStore({
    variant,
    refresh: (credential) => client.refreshToken(credential),
  });
  const catalog = new wb.WorkBuddyCatalog(fallback);
  if (variantId === 'global') catalog.setUseMaximumContextWindow(true);
  // 插件默认不可见，发现成功后才 setVisible(true)；独立网关直接暴露
  catalog.setVisible(true);

  // 目录缓存（源 createVariantRuntime 同款装配）。路径刻意落在 local-relay 自己的
  // 状态目录：DSH 插件用同名文件写 ~/.dsh，而 store 的 persist() 是全量覆盖写，
  // 两个进程同时跑会互相把对方的改动整段抹掉。
  const savedCatalogs = new wb.WorkBuddyCatalogStore({
    path: statePath(`catalog.${variantId}.json`),
  });

  // 模型启停偏好按账号持久化（源 createVariantRuntime 同款装配），路径同样隔离。
  // 与 catalog store 相反：写失败会抛异常（源实现刻意不改内存态，
  // 免得磁盘与内存不一致而谎报成功）。
  const visibility = new wb.WorkBuddyVisibilityStore({
    path: statePath(`visibility.${variantId}.json`),
  });

  /** 目录来源（面板要能说明这批模型是哪来的） */
  let catalogSource = { source: 'fallback' };

  /**
   * 账号键缓存。
   *
   * 必须是**同步**读取，因为 WorkBuddyProbeService 把它当 Map 键用、并做
   * `account() !== account` 的恒等比较（源 index.js:1071/1100/1116）。传异步函数
   * 会让两次调用返回两个不同的 Promise，恒等比较永远为真，探测就永远报
   * "account changed before detection"。
   *
   * 所以照插件的做法：异步解析一次凭据后把身份存下来，之后同步读。
   */
  let cachedAccount;

  /** 异步刷新账号键缓存，返回最新的键 */
  const refreshAccount = async () => {
    try {
      cachedAccount = accountKeyFromCredential(await store.resolve());
    } catch {
      cachedAccount = undefined;
    }
    return cachedAccount;
  };

  /** 同步读账号键（未解析过时为 undefined） */
  const account = () => cachedAccount;

  // 推理探针（源 createVariantRuntime 同款装配）。会真发上游请求并消耗额度，
  // 因此必须守住 consent 语义。
  const probeStore = new wb.WorkBuddyProbeStore({
    pluginVersion: 'local-relay/0.1.0',
    path: statePath(`probe.${variantId}.json`),
  });
  const probeService = new wb.WorkBuddyProbeService({
    store: probeStore,
    catalog,
    credentials: store,
    client,
    // 本地网关没有设置界面 → 自动探测不授权。
    // 面板的手动点击走 probe(modelId, manualConsent=true) 这条"一次性同意"通道，
    // 它不改变这里的配置。
    consent: () => false,
    account,
  });

  return {
    id: variant.id,
    label: variant.displayName,
    providerPrefix: variantId === 'global' ? 'workbuddy-ai' : 'workbuddy',
    shim: null,
    // 供面板查询（只读；响应体经面板层过滤，不含 token）
    store,
    client,
    savedCatalogs,
    visibility,
    probeStore,
    probeService,
    account,
    catalogSource: () => ({ ...catalogSource }),

    async start() {
      // 先解析一次凭据，把账号键缓存填上（探针的同步 account() 依赖它）
      await refreshAccount();

      // 再试上次保存的目录，让重启后的头几秒就有真实模型可用
      const saved = savedCatalogs.get(account());
      if (saved !== undefined && Array.isArray(saved.models) && saved.models.length > 0) {
        catalog.set(saved.models);
        catalogSource = {
          source: 'saved',
          ...(saved.fetchedAtMs === undefined ? {} : { fetchedAtMs: saved.fetchedAtMs }),
          ...(saved.appVersion === undefined ? {} : { appVersion: saved.appVersion }),
        };
      }

      const shim = wb.createWorkBuddyShim({ store, client, catalog, logger });
      await shim.ready;
      this.shim = shim;
      await this.refreshModels();
      return this;
    },

    async refreshModels() {
      const errors = [];
      try {
        const credential = await store.resolve();
        await refreshAccount();
        const models = await client.fetchModels(credential);
        if (Array.isArray(models) && models.length > 0) {
          catalog.set(models);
          catalogSource = { source: 'live', fetchedAtMs: Date.now() };
          // 落盘供下次启动使用（写失败被 store 吞掉，源行为）
          const key = account();
          if (key !== undefined) {
            savedCatalogs.set(key, {
              source: 'workbuddy:catalog',
              fetchedAtMs: Date.now(),
              models,
              ...(client.lastCatalog?.appVersion?.version === undefined
                ? {}
                : { appVersion: client.lastCatalog.appVersion.version }),
            });
          }
        }
        catalog.setVisible(true);
      } catch (e) {
        errors.push(e.message);
        catalogSource = { source: catalogSource.source, error: e.message };
        catalog.setVisible(true); // 至少暴露 fallback
      }
      return { models: catalog.current(), errors };
    },

    models() {
      return catalog.current();
    },
    async close() {
      await this.shim?.close();
    },
  };
}
