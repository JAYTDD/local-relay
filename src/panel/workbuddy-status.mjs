/**
 * WorkBuddy 面板数据层。
 *
 * 原插件 /plugins/dsh-workbuddy-connect/status 由 workBuddyWebStatus(deps) 组装，
 * deps 需要 store / client / models / catalog / visibility / probe / probeKey 等。
 * local-relay 的 provider 目前只保证 models() / refreshModels() 可用，
 * 因此本模块：
 *   - 读：模型一律从 provider.models() 出（能列出模型即视为可用）；
 *   - 写：把原插件的 action 语义映射到本进程可执行的操作（refresh 走 refreshModels，
 *     其余动作需要探针/可见性持久化，未装配时返回 failed 并说明原因，
 *     绝不静默成功——静默成功正是 proxy-hub 踩过的坑）。
 */
import { normalizeCredits, modelWithCurrentPromotion } from 'dsh-workbuddy-connect';

const VARIANTS = { cn: 'wb', global: 'wbai' };

function providerFor(providers, variant) {
  const prefix = VARIANTS[variant];
  if (!prefix) return undefined;
  return providers.find((p) => p.def.prefix === prefix);
}

/** 归一化模型行：补上 credits 显示串，剥掉原始 billing */
export function toModelRow(model) {
  // 促销按当前时间重算（源 modelWithCurrentPromotion）：
  // 缓存的"夜间免费"之类标签过期后自动消失、费率自动回落，不必等下一次刷新。
  // 注意该函数只接受一个参数，且无活跃促销时原样返回同一个对象。
  const live = modelWithCurrentPromotion(model);
  // normalizeCredits 是字符串归一化（'x0.79 credits' → 'x0.79'），与 DSH 面板显示一致
  const rate = normalizeCredits(live.billing?.credits);
  return {
    id: live.id,
    name: live.name ?? live.id,
    ...(live.billing?.free === true ? { free: true } : {}),
    ...(Array.isArray(live.billing?.badges) && live.billing.badges.length > 0 ? { badges: live.billing.badges } : {}),
    ...(rate === undefined ? {} : { credits: rate }),
    ...(live.billing?.rateUnknown === true ? { rateUnknown: true } : {}),
    ...(typeof live.contextWindow === 'number' && live.contextWindow > 0 ? { contextWindow: live.contextWindow } : {}),
    ...(typeof live.maxTokens === 'number' && live.maxTokens > 0 ? { maxTokens: live.maxTokens } : {}),
  };
}

export function createWorkBuddyStatus({ providers }) {
  return {
    variants() {
      return Object.keys(VARIANTS);
    },

    async document(variant) {
      const entry = providerFor(providers(), variant);
      if (!entry) {
        return { status: 'signed-out', reason: `variant not configured: ${variant}`, models: [] };
      }
      // provider 启动失败时 entry.provider 为 null
      const liveProvider = entry.provider;
      if (!liveProvider) {
        return {
          status: 'signed-out',
          variant,
          models: [],
          reason: entry.error ?? 'provider unavailable',
        };
      }
      const models = (liveProvider.models?.() ?? entry.models ?? []).map(toModelRow);
      const signedIn = models.length > 0;

      // 目录来源（源 workBuddyWebStatus 的 catalogSection）：面板要能说明这批模型
      // 是实时拉的、还是上次存下来的。未装配时不显示，不编造。
      let catalogField = {};
      if (liveProvider.catalogSource) {
        const source = liveProvider.catalogSource() ?? {};
        const account = await liveProvider.account?.();
        const saved = account === undefined ? undefined : liveProvider.savedCatalogs?.get(account);
        catalogField = {
          catalog: {
            ...source,
            ...(saved?.appVersion === undefined ? {} : { appVersion: saved.appVersion }),
          },
        };
      }

      return {
        status: signedIn ? 'signed-in' : 'signed-out',
        ...(signedIn ? {} : { reason: 'no models discovered' }),
        variant,
        ...catalogField,
        models,
      };
    },

    async control(variant, action) {
      const entry = providerFor(providers(), variant);
      if (!entry) return { state: 'failed', reason: `variant not configured: ${variant}` };
      if (!entry.provider) return { state: 'failed', reason: entry.error ?? 'provider unavailable' };
      const kind = action?.action;
      if (kind === 'refresh') {
        try {
          const out = await entry.provider.refreshModels();
          entry.models = entry.provider.models();
          return { state: 'updated', models: out.models ?? entry.models, errors: out.errors ?? [] };
        } catch (e) {
          return { state: 'failed', reason: String(e?.message ?? e) };
        }
      }
      if (kind === 'clear' || kind === 'set-maximum-context-window') {
        return {
          state: 'failed',
          reason: `action not wired yet: ${kind} (needs probe/max-context service, see docs/superpowers/plans/2026-10-02-local-relay-remaining-port.md)`,
        };
      }
      return { state: 'failed', reason: `unknown action: ${String(kind)}` };
    },
  };
}
