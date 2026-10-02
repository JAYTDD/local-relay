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
import { normalizeCredits } from 'dsh-workbuddy-connect';

const VARIANTS = { cn: 'wb', global: 'wbai' };

function providerFor(providers, variant) {
  const prefix = VARIANTS[variant];
  if (!prefix) return undefined;
  return providers.find((p) => p.def.prefix === prefix);
}

/** 归一化模型行：补上 credits 显示串，剥掉原始 billing */
export function toModelRow(model) {
  // normalizeCredits 是字符串归一化（'x0.79 credits' → 'x0.79'），与 DSH 面板显示一致
  const rate = normalizeCredits(model.billing?.credits);
  return {
    id: model.id,
    name: model.name ?? model.id,
    ...(model.billing?.free === true ? { free: true } : {}),
    ...(Array.isArray(model.billing?.badges) && model.billing.badges.length > 0 ? { badges: model.billing.badges } : {}),
    ...(rate === undefined ? {} : { credits: rate }),
    ...(model.billing?.rateUnknown === true ? { rateUnknown: true } : {}),
    ...(typeof model.contextWindow === 'number' && model.contextWindow > 0 ? { contextWindow: model.contextWindow } : {}),
    ...(typeof model.maxTokens === 'number' && model.maxTokens > 0 ? { maxTokens: model.maxTokens } : {}),
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
      return {
        status: signedIn ? 'signed-in' : 'signed-out',
        ...(signedIn ? {} : { reason: 'no models discovered' }),
        variant,
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
      if (kind === 'clear' || kind === 'set-maximum-context-window' || kind === 'set-model-visibility') {
        return {
          state: 'failed',
          reason: `action not wired yet: ${kind} (needs probe/visibility service, see Task 7)`,
        };
      }
      return { state: 'failed', reason: `unknown action: ${String(kind)}` };
    },
  };
}
