# local-relay

把 **DSH 三个订阅接入插件**（`dsh-connect-trae` / `dsh-workbuddy-connect` / `dsh-qoder-connect`）的**协议层提取出来**，做成一个不依赖 DSH、可独立运行的本地 **OpenAI 兼容网关**，供 ZCode 等任意支持自定义 OpenAI 接口的客户端使用。

## 为什么是这个方案

这三个插件内部**本身就各自带一个 OpenAI 兼容的 loopback 网关**（`createTraeShim` / `createWorkBuddyShim` / `createQoderShim`，暴露 `/healthz`、`/v1/models`、`/v1/chat/completions`），DSH 的 pi-ai provider 只是它的一个客户端。

它们的协议层是**纯函数 / 注入式类**（`credential()`、`identity()`、`fetchImpl` 全部外部注入），因此可以脱离 DSH 单独装配。相比自己逆向上游协议，这里能直接拿到作者调试过的正解：

- **凭据发现 / 解密 / 刷新**：`TraeCredentialStore`、`decryptTraeStorageValue`、`refreshTraeCredential`
- **正确的请求形态**：`prepareSoloBody`（`config_name` + 私有 tools 格式）
- **SSE 解码与工具调用桥接**：`decodeTraeEvent`、`TraeSoloBridge`
- **模型路由自动化**：`TRAE_DIRECTORY_FUNCTIONS` 自动并集 `solo_work_remote` / `solo_work_lite`，解析每个模型真正可调用的 `config_name` 与 function

## 运行方式

```bash
cd D:\ProjectSave\local-relay
node src/server.mjs
```

默认监听 `http://127.0.0.1:8790/v1`。可用环境变量覆盖：

| 变量 | 默认 | 说明 |
|---|---|---|
| `RELAY_PORT` | `8790` | 监听端口 |
| `RELAY_KEY` | 空 | 设了则客户端需带 `Authorization: Bearer <key>` |

## 控制面板

启动网关后打开 <http://127.0.0.1:8790/panel>。

首次使用或改动 `panel/` 后需要构建一次前端：

```bash
npm run build:panel
```

一条命令构建并启动：

```bash
npm run start:full
```

面板内容：

| 区块 | 说明 |
|---|---|
| 网关总览 | 四个通道的模型数与就绪状态 |
| Trae | 国内版 / 国际版切换、额度、签到、模型列表与上下文窗口 |
| WorkBuddy | 国内版 / 国际版切换、额度、模型倍率与免费标记、刷新模型 |
| Qoder | 占位（待 `qoderclicn` 登录后接入） |

面板 API 挂在 `/panel/api/*`，只读接口不含任何凭据字段。

### 验收记录

- `node --test test/*.test.js` 全部通过（22 项）
- `GET /panel/api/health` 返回 4 个通道
- 面板 API 响应体不含 accessToken / refreshToken / Bearer 等凭据字段
- `/panel` 返回 HTML，`/v1/models` 仍返回 56 个模型
- 流式响应中 `"role"` 仅出现 1 次（流规范化未被面板改动破坏）

## 接入 ZCode

在 ZCode 新建供应商：

| 字段 | 填什么 |
|---|---|
| Base URL | `http://127.0.0.1:8790/v1` |
| API 格式 | `Chat Completions (/chat/completions)` |
| API Key | 任意（未设 `RELAY_KEY` 时） |
| 模型 | 见 `http://127.0.0.1:8790/v1/models`，前缀区分通道 |

## 模型命名

统一用 `{通道}/{模型}` 前缀，避免不同上游同名冲突：

| 前缀 | 通道 | 实测状态 |
|---|---|---|
| `trae/` | Trae 国内版 | ✅ 对话 + 工具调用 |
| `traeg/` | Trae 国际版 | 需登录国际版客户端 |
| `wb/` | WorkBuddy 国内版 | ✅ 对话 + 工具调用 |
| `wbai/` | WorkBuddy 国际版 | 模型可列，账号额度耗尽时 429 |

### 实测可用模型（2026-10）

**`trae/`**：`glm-5.3`、`glm-5.2`、`kimi-k3`、`kimi-k2.7-code`、`kimi-k2.6`、`minimax-m3`、`qwen3.8-max`、`qwen-3.7-plus`、`deepseek-v4.1-flash`、`DeepSeek-V4-Pro-Official`、`DeepSeek-V4-Flash-Official`、`step-5-preview`、`Doubao-Seed-Evolving`、`Doubao-Seed-2.1-Pro`、`Doubao-Seed-2.1-Turbo`

**`wb/`**：`glm-5.3`、`glm-5.3-flash`、`glm-5.2`、`glm-5.1`、`glm-5v-turbo`、`deepseek-v4.1-flash`、`deepseek-v4-pro`、`kimi-k3-1`、`kimi-k2.8-preview`、`kimi-k2.7`、`kimi-k2.6`、`minimax-m3`、`minimax-m2.7`、`hy4-preview`、`hy3`、`hy3-x`

**`wbai/`**（需额度）：`gpt-6-astra`、`gpt-6-sol`、`gpt-6-luna`、`gpt-5.6-*`、`gpt-5.5`、`gpt-5.4`、`grok-4.7`、`gemini-3.8-flash`、`gemini-3.5-flash`、`glm-5.3`、`kimi-k3` 等 25 个

## 目录结构

```
local-relay/
├── package.json
├── src/
│   ├── server.mjs              # 统一入口：单端口 + 前缀路由 + SSE 聚合
│   └── providers/
│       ├── trae.mjs            # Trae 栈装配（两个区域）
│       └── workbuddy.mjs       # WorkBuddy 栈装配（国内 / 国际）
├── shims/                      # 从 DSH 插件提取的协议层（含 DSH 依赖桩）
│   ├── node_modules/
│   │   ├── @deepseek-ai/       # 5 个桩包
│   │   ├── @earendil-works/
│   │   ├── dsh-connect-trae/
│   │   ├── dsh-workbuddy-connect/
│   │   └── dsh-qoder-connect/
│   └── probe-*.mjs             # 可行性验证脚本
└── node_modules/               # 复制自 shims/node_modules
```

## 为什么需要桩包

三个插件 `import` 了 DSH 运行时内部包，在 DSH 进程外解析不到：

| 包 | 桩内容 | 为什么可行 |
|---|---|---|
| `@earendil-works/pi-ai` | `createProvider` / `openAICompletionsApi` | 只在最外层 provider 注册用 |
| `@deepseek-ai/dsh-llm` | `LlmError`、`resolveRetryPolicy` 等 | 只在适配层引用 |
| `@deepseek-ai/dsh-llm-pi-ai` | `PiAiAdapter` 空类 | 同上 |
| `@deepseek-ai/dsh-home-paths` | `resolveDshHome()` → `~/.dsh` | 路径解析 |
| `@deepseek-ai/dsh-atomic-write` | `writeFileAtomic` / `withFileLock` | 原子写 |
| `@deepseek-ai/dsh-attachment` | `resolveImageAttachmentAccess` 等 | 仅图片路径 |

核心协议代码不调用这些逻辑，所以桩成空实现即可跑通。

## 已知限制

- **Trae 国际版 / Qoder**：需对应客户端登录后才可用；未登录时该通道模型数为 0。
- **WorkBuddy 国际版**：模型列表可拉取，但实际请求受账号额度约束（额度耗尽返回 429 `Credits exhausted`）。
- 上游协议随时可能变化，插件版本更新后需同步 `shims/node_modules` 下的插件副本。
- 复用本机登录态可能违反各上游 ToS，有风控风险，仅供本地学习研究。

## 更新插件副本

插件升级后，重新从 DSH profile 复制：

```bash
cp -r ~/.dsh/profiles/desktop/node_modules/dsh-connect-trae/lib shims/node_modules/dsh-connect-trae/
# 其余两个同理，然后同步到 node_modules/
```
