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
 * 当前账号键（visibility / probe / catalog 都按它分桶）。
 *
 * 刻意比插件的 visibilityAccountOf 更严：它只判 `uid === ""`，于是
 * `{ enterpriseId: 'e1' }` 这种 uid 缺失的凭据会算出 `"undefined:e1"` —— 一个
 * 真值字符串，让所有缺 uid 的账号悄悄共用一个桶。源注释明说这种情况就该
 * "完全没有按账号的偏好"（宁可没有，也不能把一个账号的隐藏列表套到另一个上）。
 * 所以这里把 uid 缺失/空串一律判为"没有账号"。
 *
 * @returns {Promise<string|undefined>}
 */
async function accountKeyOf(store) {
  try {
    const credential = await store.resolve();
    if (credential === undefined || credential === null) return undefined;
    if (typeof credential.uid !== 'string' || credential.uid === '') return undefined;
    return wb.visibilityAccountOf(credential);
  } catch {
    return undefined;
  }
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

  /** 目录来源（面板要能说明这批模型是哪来的） */
  let catalogSource = { source: 'fallback' };

  const account = () => accountKeyOf(store);

  return {
    id: variant.id,
    label: variant.displayName,
    providerPrefix: variantId === 'global' ? 'workbuddy-ai' : 'workbuddy',
    shim: null,
    // 供面板查询（只读；响应体经面板层过滤，不含 token）
    store,
    client,
    savedCatalogs,
    account,
    catalogSource: () => ({ ...catalogSource }),

    async start() {
      // 先试上次保存的目录，让重启后的头几秒就有真实模型可用
      const saved = savedCatalogs.get(await account());
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
        const models = await client.fetchModels(credential);
        if (Array.isArray(models) && models.length > 0) {
          catalog.set(models);
          catalogSource = { source: 'live', fetchedAtMs: Date.now() };
          // 落盘供下次启动使用（写失败被 store 吞掉，源行为）
          const key = await account();
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
