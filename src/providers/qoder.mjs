/**
 * Qoder 供应商：从 dsh-qoder-connect 提取协议层，装配成独立的
 * OpenAI 兼容 loopback shim。
 *
 * ⚠️ 两个与另外两个插件不同的地方，改之前先看这里：
 *
 * 1. **transport 与 getMachineId 没从包根导出**。包的 `exports` 只暴露
 *    `.` / `./client` 等，`import 'dsh-qoder-connect/lib/variants-CFI6-cGn.js'`
 *    会报 ERR_PACKAGE_PATH_NOT_EXPORTED。这里按**绝对路径**导入同一个文件
 *    （本地 vendor 的副本，路径自己算），所以能拿到 `createQoderTransport`。
 *    这是本项目能接 Qoder 的关键——PROJECT.md 早期版本说"未导出所以接不了"，
 *    那个结论是错的。
 *
 * 2. **attachments 是必填依赖，哪怕只发纯文本**。transport 的
 *    `enforceImageLimits()` 会无条件读 `attachments.imageLimits`，缺了就在
 *    chat 路径上抛 TypeError。而且这个 TypeError 会被 `failureResult()` 的
 *    LlmError 分支掩盖成 "reading 'status'" 的 502，排查时极具误导性。
 *    本地网关不做图片输入，所以给一个只提供 imageLimits 的桩，
 *    图片相关方法直接明确报错而不是假装成功。
 *
 * 3. **shim.baseUrl 与 shim.token 是函数**，要 `shim.baseUrl()` 调用；
 *    Trae/WorkBuddy 的 shim 是字符串。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as qoder from 'dsh-qoder-connect';
import { statePath } from '../state-dir.mjs';

const logger = {
  warn: (...a) => console.error('[qoder][warn]', ...a),
  error: (...a) => console.error('[qoder][error]', ...a),
};

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 从包内 lib 目录按绝对路径取未导出的内部符号。
 * 包名可能出现在本项目的 node_modules，也可能只在 shims/ 下，两个都试。
 */
async function loadInternals() {
  const candidates = [
    path.resolve(HERE, '..', '..', 'node_modules', 'dsh-qoder-connect', 'lib', 'variants-CFI6-cGn.js'),
    path.resolve(HERE, '..', '..', 'shims', 'node_modules', 'dsh-qoder-connect', 'lib', 'variants-CFI6-cGn.js'),
  ];
  let lastErr;
  for (const file of candidates) {
    try {
      const mod = await import(pathToFileURL(file).href);
      if (typeof mod.b !== 'function' || typeof mod.x !== 'function') {
        throw new Error(`内部导出不符合预期（b=${typeof mod.b}, x=${typeof mod.x}）`);
      }
      return { createQoderTransport: mod.b, getMachineId: mod.x, file };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `无法加载 dsh-qoder-connect 的 transport 实现（未从包根导出，需按路径导入）：${lastErr?.message ?? lastErr}`,
  );
}

/** 图片输入的明确拒绝：本地网关不装配图片链路 */
function unsupportedAttachments() {
  const reject = () => {
    throw new Error('local-relay: Qoder image input is not supported by this gateway');
  };
  return {
    // transport 在 chat 路径上无条件读这个字段（即使消息里没有图片）
    imageLimits: {
      maxImagesPerMessage: 0,
      maxMessageImageBytes: 0,
      maxImageBytes: 0,
      maxImagePixels: 0,
    },
    readImageRequest: async () => reject(),
    saveImage: async () => reject(),
  };
}

/**
 * @param {'cn'|'global'} variantId
 */
export async function createQoderProvider(variantId) {
  const variant = variantId === 'global' ? qoder.GLOBAL_VARIANT : qoder.CHINA_VARIANT;
  const fallback = qoder.FALLBACK_QODER_MODELS;
  const { createQoderTransport, getMachineId } = await loadInternals();

  const store = new qoder.QoderCredentialStore({ variant, logger });
  const attachments = unsupportedAttachments();

  const transport = createQoderTransport({
    region: variant.region,
    resolvePat: () => store.patPromise(),
    resolveMachineId: () => getMachineId([qoder.qoderPluginDataDir() + path.sep + 'machine_id']),
    logger,
    attachments,
  });

  const client = new qoder.QoderUpstreamClient({
    region: variant.region,
    providerId: variant.id,
    getPat: () => store.patPromise(),
    transport,
    attachments,
  });

  const catalog = new qoder.QoderCatalog(fallback);
  // 插件默认不可见，发现成功后才 setVisible(true)；独立网关直接暴露
  catalog.setVisible(true);

  // 状态文件与 DSH 插件隔离（同 WorkBuddy 的理由：persist() 是全量覆盖写）
  const savedCatalogs = new qoder.QoderCatalogStore({
    path: statePath(`qoder-catalog.${variantId}.json`),
  });
  const probeStore = new qoder.QoderProbeStore({
    pluginVersion: 'local-relay/0.1.0',
    path: statePath(`qoder-probe.${variantId}.json`),
  });

  /** 目录来源（面板要能说明这批模型是哪来的） */
  let catalogSource = { source: 'fallback' };

  /**
   * 账号键（按 PAT 的 sha256 前 16 位，源 qoderCredentialIdentity 的设计：
   * PAT 是 bearer 密钥，键用单向哈希，面板显示它不泄漏任何可用信息）。
   * 必须是**同步**读取——探针服务把它当 Map 键做恒等比较。
   */
  let cachedAccount;

  const refreshAccount = async () => {
    try {
      const pat = await store.patPromise();
      cachedAccount = pat === undefined || pat === '' ? undefined : qoder.qoderCredentialIdentity({ pat });
    } catch {
      cachedAccount = undefined;
    }
    return cachedAccount;
  };

  const account = () => cachedAccount;

  const probeService = new qoder.QoderProbeService({
    store: probeStore,
    catalog,
    credentials: store,
    client,
    // 本地网关没有设置界面 → 自动探测不授权；面板点击走一次性同意
    consent: () => false,
    account,
  });

  return {
    id: variant.id,
    label: variant.displayName,
    providerPrefix: variantId === 'global' ? 'qoderg' : 'qoder',
    shim: null,
    store,
    client,
    transport,
    savedCatalogs,
    probeStore,
    probeService,
    account,
    catalogSource: () => ({ ...catalogSource }),

    async start() {
      await refreshAccount();

      // 先用上次保存的目录，让重启后头几秒也有真实模型
      const saved = savedCatalogs.get(account());
      if (saved !== undefined && Array.isArray(saved.models) && saved.models.length > 0) {
        catalog.set(saved.models);
        catalogSource = {
          source: 'saved',
          ...(saved.fetchedAtMs === undefined ? {} : { fetchedAtMs: saved.fetchedAtMs }),
        };
      }

      const shim = qoder.createQoderShim({
        store,
        client,
        catalog,
        logger,
        providerId: variant.id,
      });
      await shim.ready;
      this.shim = shim;
      await this.refreshModels();
      return this;
    },

    async refreshModels() {
      const errors = [];
      try {
        await refreshAccount();
        const models = await client.fetchModels();
        if (Array.isArray(models) && models.length > 0) {
          catalog.set(models);
          catalogSource = { source: 'live', fetchedAtMs: Date.now() };
          const key = account();
          if (key !== undefined) {
            // 写失败被 store 吞掉（源行为）
            savedCatalogs.set(key, { source: 'qoder:discovery', fetchedAtMs: Date.now(), models });
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

export const QODER_VARIANTS = ['cn', 'global'];
