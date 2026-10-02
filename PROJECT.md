# local-relay 项目总结

> 本文档写给**零上下文的接手者**（人或 AI）。读完即可独立维护本项目，无需先了解它的来历。
> 项目路径：`D:\ProjectSave\local-relay`

> **三条最先要知道的事**
> 1. **本项目不重写任何协议**——它把 DSH 三个订阅插件里已经写好的注入式协议层装配成独立网关。遇到问题先读 `shims/node_modules/<插件>/lib/` 的源码。
> 2. **零 npm 依赖**是硬约束（根 `package.json` 只有 `scripts`，没有 `dependencies`）。
> 3. 启动：双击 **`dev.cmd`**（前后端一起）或 `npm start`（仅后端）。详见第四节。

---

## 一、这是什么

一个**跑在本机的 OpenAI 兼容网关**，把 DSH（DeepSeek Harness）三个订阅接入插件（Trae / WorkBuddy / Qoder）所对接的账号额度，转成标准 OpenAI API，供 ZCode 等任意支持自定义 OpenAI 接口的客户端使用。

**一句话**：让 ZCode 能用上 Trae / WorkBuddy / Qoder 的订阅额度。

### 支持的通道

共 **6 个前缀、90 个模型**（2026-10 实测）。「对话可用」指实测过经网关流式出字。

| 前缀 | 通道 | 模型数 | 状态 |
|---|---|---|---|
| `trae/` | Trae 国内版 | 15 | ✅ 对话可用 |
| `traeg/` | Trae 国际版 | 7 | ⚠️ 未登录国际版客户端，只有兜底花名册 |
| `wb/` | WorkBuddy 国内版 | 17 | ✅ 对话可用 |
| `wbai/` | WorkBuddy 国际版 | 20 | ⚠️ 模型可列，额度受限 |
| `qoder/` | Qoder 国内版 | 14 | ✅ 对话可用 |
| `qoderg/` | Qoder 国际版 | 17 | ⚠️ 模型/额度可用，对话被账号 p3 排队挡住 |

> `traeg/` 与 `qoderg/` 的不可用**都是账号侧条件，不是代码问题**。详见第十节。

---

## 二、为什么这样做（关键设计决策）

### 背景

最初尝试过第三方项目 `proxy-hub`，但问题严重：模型清单写死（比上游旧）、Trae 请求形态用错通道、tools 格式错误、错误被静默吞成"空成功"。**已废弃删除**。

### 转折点

调研发现：DSH 那三个订阅插件（`dsh-connect-trae` / `dsh-workbuddy-connect` / `dsh-qoder-connect`）**内部各自已经带了一个 OpenAI 兼容的 loopback 网关**：

- `createTraeShim` / `createWorkBuddyShim` / `createQoderShim`
- 暴露 `/healthz`、`/v1/models`、`/v1/chat/completions`
- 带随机 bearer + loopback Host/Origin 校验
- DSH 的 pi-ai provider 只是它的**一个客户端**

### 于是采取的方案（A 方案）

**不是重写协议，而是把 shim 从 DSH 胶水里剥出来独立运行。**

- 插件的协议层是**纯函数 / 注入式类**（`credential()`、`identity()`、`fetchImpl` 全部外部注入），本就为可独立测试设计
- 代价：需要为 5 个 DSH 内部包造**空桩**（核心协议不调用它们的逻辑）
- 收益：白拿作者调试过的正解——正确的请求形态、模型路由自动化、SSE 解码、工具调用桥接

### 为什么这样比手写协议好（实证）

插件的 `TRAE_DIRECTORY_FUNCTIONS` 会自动并集 `solo_work_remote` / `solo_work_lite` 解析每个模型真正可调用的 `config_name` 与 function。手工逆向时曾反复试错（`inline_chat` → 报 3003；`solo_work_lite` → 报 4001；最终才找到 `solo_coder`），而插件是**自动化且更完整**的。

---

## 三、架构

```
ZCode / 任意 OpenAI 客户端
        │  POST /v1/chat/completions   (模型名: 前缀/模型ID)
        ▼
┌─────────────────────────────────────────────┐
│  src/server.mjs          统一入口 :8790     │
│   - 前缀路由 → 对应 provider                │
│   - 流规范化 (normalizeChunk/relayStream)   │
│   - 托管 /panel 面板 + /panel/api/*         │
└──────────────┬──────────────────────────────┘
               │ 转发到各 provider 的内部 shim
     ┌─────────┼─────────┬──────────┐
     ▼         ▼         ▼          ▼
  Trae CN  Trae 国际  WB 国内   WB 国际
  (shim)   (shim)    (shim)    (shim)
     │         │         │          │
     ▼         ▼         ▼          ▼
  solo.trae  coresg   copilot.   workbuddy.ai
   .cn      -normal   tencent     /codebuddy.ai
            .trae.ai  .com
```

### 目录结构

```
local-relay/
├── dev.cmd                     # ★ 双击启动前后端（唯一启动脚本）
├── src/
│   ├── server.mjs              # 统一入口：前缀路由 + 流规范化 + 静态托管 + /v1/models
│   ├── state-dir.mjs           # 持久化状态目录（与 DSH 插件隔离，见第八节）
│   ├── providers/
│   │   ├── trae.mjs            # Trae 栈装配（cn / ai）+ 死模型过滤
│   │   ├── workbuddy.mjs       # WorkBuddy 栈装配（cn / global）+ 目录/可见性/探针
│   │   └── qoder.mjs           # Qoder 栈装配（cn / global）+ 未导出 transport 的加载
│   └── panel/
│       ├── api.mjs             # /panel/api/* 路由编排
│       ├── trae-status.mjs     # Trae 面板数据（登录态 + 额度 + 签到 + 诊断）
│       ├── workbuddy-status.mjs# WorkBuddy 面板数据（额度 + 目录 + 可见性 + 探针）
│       ├── qoder-status.mjs    # Qoder 面板数据（额度 + 签到 + 探针 + 凭据尾号）
│       └── static.mjs          # 托管 Vite 产物（含 SPA fallback）
├── scripts/
│   └── dev.mjs                 # npm run dev：一条命令起前后端（零依赖）
├── panel/                      # React + Vite 前端
│   ├── src/
│   │   ├── App.jsx
│   │   ├── api.js
│   │   └── components/
│   │       ├── ChannelHealth.jsx   # 网关总览
│   │       ├── TraeCard.jsx
│   │       ├── WorkBuddyCard.jsx
│   │       ├── QoderCard.jsx
│   │       └── ModelTable.jsx      # 三个卡片共用
│   └── vite.config.js          # base: '/panel/'，代理端口跟随 RELAY_PORT
├── shims/node_modules/         # ★ 从 DSH 插件提取的协议层 + 依赖桩（入库，可 diff 审查）
│   ├── dsh-connect-trae/       # v2.5.0
│   ├── dsh-workbuddy-connect/  # v0.7.0
│   ├── dsh-qoder-connect/      # v0.2.2
│   ├── @deepseek-ai/           # 6 个桩包（含 schemastery）
│   └── @earendil-works/
├── test/                       # node:test 测试（71 项）
├── docs/superpowers/plans/     # 实施计划（历史文档，含已完成的移植计划）
├── README.md                   # 用户向使用说明
└── PROJECT.md                  # 本文件（交接文档）
```

> `node_modules/` 是 `shims/node_modules/` 的副本（`.gitignore` 忽略），靠 **`npm run sync:deps`** 重建。
> 改了桩之后**两份都要更新**（`cp shims/node_modules/... node_modules/...`），否则运行时读的还是旧的——Qoder 的桩修复就踩过这个。

### 依赖桩（为什么需要）

三个插件 `import` 了 DSH 运行时内部包，在 DSH 进程外解析不到：

| 包 | 桩内容 | 为何可行 |
|---|---|---|
| `@earendil-works/pi-ai` | `createProvider` / `openAICompletionsApi` | 只在最外层 provider 注册用 |
| `@deepseek-ai/dsh-llm` | `LlmError`、`resolveRetryPolicy` 等 | 只在适配层引用 |
| `@deepseek-ai/dsh-llm-pi-ai` | `PiAiAdapter` 空类 | 同上 |
| `@deepseek-ai/dsh-home-paths` | `resolveDshHome()` → `~/.dsh` | 路径解析 |
| `@deepseek-ai/dsh-atomic-write` | `writeFileAtomic` / `withFileLock` | 原子写 |
| `@deepseek-ai/dsh-attachment` | `resolveImageAttachmentAccess` 等 | 仅图片路径 |

核心协议代码不调用这些逻辑，桩成空实现即可跑通。

---

## 四、如何启动

### 一条命令起前后端（改面板时用这个）

```bash
cd D:\ProjectSave\local-relay
npm run dev
```

两条一起拉起，前端带热更新：

| 进程 | 地址 | 说明 |
|---|---|---|
| 后端网关 | http://127.0.0.1:8790/v1 | `src/server.mjs` |
| 前端面板（dev） | http://127.0.0.1:5173/panel | Vite dev server，改 `panel/src/` 即时生效 |

`/panel/api/*` 由 Vite 代理到网关（见 `panel/vite.config.js`），所以两个地址都能打开面板并拿到真实数据；**dev 态不需要事先 build**。`Ctrl+C` 一次结束两个进程，且谁先挂会带停另一个（不留孤儿占端口）。

端口可用 `RELAY_PORT` / `PANEL_PORT` 覆盖，两边保持一致（代理端口跟着 `RELAY_PORT` 走）：

```bash
RELAY_PORT=8800 PANEL_PORT=5200 npm run dev
```

实现见 `scripts/dev.mjs`：零依赖，只用 node 内置模块，没有引入 concurrently / npm-run-all。

> 前端 dev server 显式绑定 `127.0.0.1`。不加 `--host` 时 Vite 只监听 `localhost`，本机把它解析成 `::1`，于是 `127.0.0.1:5173` 连不上（浏览器能用，脚本/工具会踩）。也别用裸 `--host`——那会绑 `0.0.0.0`，把带凭据的面板暴露到局域网。

### 日常启动（最常用，只跑后端）

```bash
cd D:\ProjectSave\local-relay
node src/server.mjs
```

`panel/dist` 已构建好，日常启动**不需要**重新构建前端，面板由网关自己托管在 http://127.0.0.1:8790/panel。

### 改了前端（`panel/`）之后

只想重建产物、不起 dev server：

```bash
npm run build:panel      # 只构建面板
npm run start:full       # 构建 + 启动，一步到位
```

### 停止

前台 `Ctrl+C`。若在后台：

```bash
netstat -ano | grep '127.0.0.1:8790.*LISTENING'   # 找 PID
MSYS2_ARG_CONV_EXCL='*' taskkill /PID <PID> /F
```

### 可选环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `RELAY_PORT` | `8790` | 监听端口 |
| `RELAY_KEY` | 空 | 设了则客户端需带 `Authorization: Bearer <key>` |
| `PANEL_PORT` | `5173` | 仅 `npm run dev`：前端 dev server 端口 |

### 访问地址

| 用途 | 地址 |
|---|---|
| 控制面板 | http://127.0.0.1:8790/panel |
| OpenAI 端点 | http://127.0.0.1:8790/v1 |
| 健康度 JSON | http://127.0.0.1:8790/healthz |
| 模型列表 | http://127.0.0.1:8790/v1/models |
| 面板 API | http://127.0.0.1:8790/panel/api/{health,trae,workbuddy,qoder} |

---

## 五、如何接入 ZCode

在 ZCode 新建供应商：

| 字段 | 填什么 |
|---|---|
| Base URL | `http://127.0.0.1:8790/v1` |
| API 格式 | `Chat Completions (/chat/completions)` |
| API Key | 任意（未设 `RELAY_KEY` 时） |
| 模型 | 手动添加，格式 `前缀/模型ID` |

**注意**：ZCode 的 API 格式下拉**必须选 Chat Completions**，不要选 Responses（本项目只实现 chat completions 协议）。

### 模型名怎么写（三条规则）

```
前缀/模型ID
```

1. **前缀定通道**：`trae/` `traeg/` `wb/` `wbai/` `qoder/` `qoderg/`——写错或漏写前缀都会被拒。
2. **斜杠后面必须是上游的模型 ID，不是显示名**。`GET /v1/models` 现在**同时返回** `id` 和 `name`：
   - `id`（**填这个**）：`qoder/qmodel_latest`
   - `name`（**只是给人看的**）：`Qwen3.7-Max`
   - 客户端模型选择器通常显示 `name`，但配置里必须落 `id`。把 `Qwen3.7-Max` 填进去，上游不认。
3. **ID 大小写敏感**，且跨通道同名模型 ID 可能不同（Trae 用 `DeepSeek-V4-Pro-Official`，WorkBuddy 用 `deepseek-v4-pro`）。

常见例子：

```
✅ qoder/qmodel_latest        → Qwen3.7-Max
✅ wb/deepseek-v4.1-flash     → DeepSeek-V4.1-Flash
✅ trae/glm-5.3               → GLM-5.3
❌ qoder/Qwen3.7-Max          ← 显示名当 ID，上游拒
❌ qmodel_latest              ← 没前缀，无法路由
❌ QODER/QMODEL_LATEST        ← 前缀和 ID 都大小写错了
```

> 想知道某个显示名对应的 ID，直接查：`curl -s http://127.0.0.1:8790/v1/models`

### 可用模型（2026-10 实测）

**`trae/`（15 个）**
```
trae/glm-5.3              trae/glm-5.2
trae/kimi-k3              trae/kimi-k2.7-code       trae/kimi-k2.6
trae/minimax-m3           trae/qwen3.8-max          trae/qwen-3.7-plus
trae/deepseek-v4.1-flash  trae/DeepSeek-V4-Pro-Official
trae/DeepSeek-V4-Flash-Official
trae/step-5-preview
trae/Doubao-Seed-Evolving trae/Doubao-Seed-2.1-Pro  trae/Doubao-Seed-2.1-Turbo
```

**`wb/`（16 个）**
```
wb/glm-5.3            wb/glm-5.3-flash      wb/glm-5.2         wb/glm-5.1
wb/glm-5v-turbo       wb/deepseek-v4.1-flash wb/deepseek-v4-pro
wb/kimi-k3-1          wb/kimi-k2.8-preview  wb/kimi-k2.7       wb/kimi-k2.6
wb/minimax-m3         wb/minimax-m2.7
wb/hy4-preview        wb/hy3                wb/hy3-x
```

**`wbai/`（25 个，需账号额度）** 含 `gpt-6-astra`、`gpt-5.6-*`、`grok-4.7`、`gemini-3.8-flash`、`kimi-k3` 等。

**`qoder/`（14 个）** —— 上游 ID 是内部代号，**必须按 ID 填**，括号里是它在选择器里显示的名字：

| ID（填这个） | 显示名 |
|---|---|
| `qmodel_latest` | Qwen3.7-Max |
| `qmodel_38max` | Qwen3.8-Max |
| `qmodel` | Qwen3.7-Plus |
| `qfmodel` | Qwen3.8-Flash |
| `q37fmodel` | Qwen3.7-Flash |
| `auto` | Auto（自动选） |
| `dmodel` / `dfmodel` | DeepSeek 系 |
| `gmodel` / `gfmodel` / `gm51model` | GLM 系 |
| `kmodel` / `kmodel_latest` | Kimi 系 |
| `mmodel` | MiniMax |

**`qoderg/`（17 个）** 另含 `ultimate`、`performance`、`efficient`、`smodel`、`cmodel`。

> 以 `GET /v1/models` 的实际返回为准，上面仅作参考。该接口**同时返回 `id`（填这个）和 `name`（给人看的）**。

---

## 六、已知的坑（重要，改动前必读）

### 坑 1：流规范化 —— ZCode 显示满屏"思考·持续了几秒"

**症状**：接 ZCode 后，对方回复区刷屏大量"思考·持续了几秒"，几乎无法使用。但接 DSH 一切正常。

**根因**：WorkBuddy 上游**每一帧 SSE 都重复带 `"role":"assistant"`**，而 ZCode 的解析逻辑是「出现 `role` 就开一个新段落」。DSH 的 pi-ai 适配器会容错合并，所以同一后端在 DSH 正常、在 ZCode 异常。上游还附带非标准字段：`reasoning_content:""`、`function_call:null`、`refusal`、`extra_fields`、`logprobs`。

**修复**：`src/server.mjs` 的 `normalizeChunk()` + `relayStream()`
- `role` **只保留首帧**
- 丢弃空的 `reasoning_content`
- 剥离 `function_call` / `refusal` / `extra_fields` / `logprobs` 等非标准键
- 丢弃无任何增量的空帧

**验证方法**：`curl` 流式请求后统计 `"role"` 出现次数，**应为 1**。

```bash
curl -s -N -m 60 -X POST http://127.0.0.1:8790/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"wb/deepseek-v4.1-flash","stream":true,"messages":[{"role":"user","content":"说 ok"}]}' \
  | grep -c '"role"'
```

> ⚠️ 这个修复很容易被无意破坏。改 `server.mjs` 的流式分支后务必重跑上面这条验证。

### 坑 2：shim 只输出流式，忽略 `stream:false`

三个插件的 shim **永远返回 SSE**，不看请求里的 `stream` 字段。因此非流式请求必须在网关自己做 SSE→JSON 聚合（`collectStream()`）。

**ZCode 走流式**，所以日常不触发这段；但非流式客户端（如某些测试脚本）会用到。

### 坑 3：模型名前缀决定路由，且大小写敏感

- 前缀必须精确：`trae/` `traeg/` `wb/` `wbai/`
- 前缀后的模型 ID **大小写敏感**：`trae/DeepSeek-V4-Pro-Official` 不能写成 `trae/deepseek-v4-pro-official`
- 不同通道的同一模型 ID 可能不同（Trae 用 `DeepSeek-V4-Pro-Official`，WorkBuddy 用 `deepseek-v4-pro`）

### 坑 4：面板不能"凭依赖不全就声称未登录"

早期 `trae-status.mjs` 一律返回 `signed-out`，导致**已登录的 Trae CN 在面板上被误报为"未登录"**。

现已接上真实凭据 store：`store.status()` / `store.accounts()`。**面板必须反映真实状态**——说假话比报错更糟。改动时保持这一点。

### 坑 5：provider 启动失败时 `entry.provider` 为 `null`

Trae 国际版未登录时启动会失败，`state.providers` 里该项的 `provider` 是 `null`。面板数据层必须空值保护，否则 500。

### 坑 6：写操作绝不静默成功

未装配的能力（探针清空、最大上下文开关、账号切换）统一返回：

```json
{ "state": "failed", "reason": "action not wired yet: ..." }
```

**这是刻意设计**——proxy-hub 的致命问题之一就是把失败静默成"空成功"。新增写操作时不要破坏这个约定。

### 坑 7：探针服务的 `account` 回调必须是同步的

`WorkBuddyProbeService` 把 `account()` 的返回值当 **Map 键**用，并做 `account() !== account` 的**恒等比较**（源 `index.js:1071/1100/1116`）。传一个 `async` 函数会让两次调用返回两个不同的 Promise，恒等比较永远为真，于是**每次探测都报 `account changed before detection`**、永远写不进记录。

正确做法（照插件）：异步解析一次凭据后把账号键**缓存**下来，`account` 是同步 getter。local-relay 在 `start()` / `refreshModels()` 里调 `refreshAccount()` 刷新缓存。

### 坑 8：`modelWithCurrentPromotion` 只接受一个参数

别传第二个 `now`——签名是 `(model) => model`，内部自己取当前时间。无活跃促销时它**原样返回同一个对象**（不是副本），所以可以直接用。

### 坑 9：依赖桩不是"空实现"就够——Qoder 踩了两个

`shims/node_modules/@deepseek-ai/dsh-llm` 是手写桩，早期注释写着"插件仅在注册/适配层引用这些符号，协议路径不调用其逻辑"。**这对 Trae / WorkBuddy 成立，对 Qoder 不成立**，结果连踩两脚：

1. **`ProviderRequestId` 必须是可调用函数**。原桩写成 `{ create: ... }` 对象，而 Qoder 的 transport 直接当函数调（`ProviderRequestId(headers.get('x-request-id'))`）→ 抛 `ProviderRequestId is not a function`。
2. **`createUserMessage` / `createAssistantMessage` / `createToolResultMessage` 必须补 `role`**。原桩是 `return m ?? {role:...}`，只在参数为 `undefined` 时才补；而调用点传的是 `{content, source}`（**不带 role**），于是每条消息都缺 `role` → 上游回 400 `invalid_parameter_error: is not one of ['system','assistant','user','tool','function']`。

两个都已修（函数式 + 强制补 role），且都保留对象式 `.create` 兼容。**修完这两处，Qoder 国内版对话就跑通了**（实测经网关流式返回 `PONG`）。

**教训**：桩的"最小"边界要按**实际调用点**确定，不能按注释猜。新增通道时先 `grep` 一下该通道 import 了桩里的哪些符号、怎么用的。

### 坑 11：`trae/` 的流式响应没有 `role` 帧，这是正常的

Trae 上游的 SSE delta **从不带 `role`**，所以经 `/v1/chat/completions` 出来的流里 `"role"` 计数是 **0**。`wb/` 和 `qoder/` 各带 1 次。

这不是缺陷：`normalizeChunk()` 的写法是 `if (delta.role && !seen.role)`——**上游给才转发**，不会凭空造一个 role 出来。实测在 Trae shim 的原样输出里同样是 0 次，所以是上游行为。

> 后果：`PROJECT.md` 第七节回归清单里那条"`"role"` 计数应为 1"**只对 `wb/` 成立**。用 `trae/` 测会得到 0，别误判成回归。要一个稳定的流规范化哨兵，就用 `wb/`。

另外 Trae 的模型（如 `glm-5.3`）会先吐一大段 `reasoning_content`，`content` 帧在很后面才出现。用 `curl` 短超时观察会以为"没有正文"，实际是还没轮到——验证时给足超时（180s）或改用非流式。

### 坑 10：transport 的错误包装会掩盖真实原因

Qoder 的 `chatStream` 用 `failureResult(error)` 归类失败，但它只认 `LlmError` / `UpstreamRequestError`。**普通 `TypeError` 会落进兜底分支再去读 `.status`**，于是真实原因被替换成：

```
{"error":{"message":"qoder upstream server (http 502): TypeError: Cannot read properties of undefined (reading 'status')"}}
```

坑 9 的两个 bug 都是被这层包装盖住的。要看真相必须绕开它：直接驱动 `transport.stream()`，或给 transport 传自己的 `logger`／包一层 `fetch`。

另一个记号：`shim.baseUrl` 和 `shim.token` 对 Qoder 是**函数**（`shim.baseUrl()`），Trae/WorkBuddy 是字符串。

---

## 七、测试

```bash
cd D:\ProjectSave\local-relay
node --test test/*.test.js
```

当前 **71 项全绿**。其中 `test/panel-e2e.test.js` 需要网关在跑，否则自动 skip。

测试覆盖：

| 文件 | 覆盖 |
|---|---|
| `panel-api.test.js` | 面板 API 骨架、健康度、Qoder 占位 |
| `panel-trae-status.test.js` | Trae 真实登录态、账号、无凭据泄漏、失效 provider |
| `panel-trae-usage.test.js` | Trae 额度映射（嵌套 summary + packs）、签到、诊断、无泄漏 |
| `panel-trae-checkin.test.js` | 签到**先读后写守卫**、业务拒绝 vs 网络失败、AI 区域拒绝、路由 |
| `trae-catalog.test.js` | `sanitizeCatalog`/`deriveCatalog` 行为、**`dropDeadModels` 死模型剔除** |
| `panel-workbuddy-status.test.js` | 模型倍率归一化、写操作拒绝、失效 provider |
| `panel-workbuddy-catalog.test.js` | 目录落盘与重读、**状态路径隔离**、账号键、促销重算 |
| `state-dir.test.js` | 状态目录不与 DSH 插件共用、`RELAY_STATE_DIR` 覆盖、幂等建目录 |
| `panel-static.test.js` | 静态托管、SPA fallback、**路径穿越防护**、缺 dist 提示 |
| `panel-e2e.test.js` | 端到端验收（通道数、无泄漏、HTML 可服务） |

> ⚠️ `panel-e2e.test.js` 里有一条断言"health 返回 4 个通道"，加 Qoder 后**需要改成 6**。改通道数时记得同步这个数字，以及 README 里的模型总数。

### 回归验证清单（改完必做）

```bash
# 1. 全量测试
node --test test/*.test.js

# 2. 模型总数（2026-10 实测 59：trae 15 + traeg 7 + wb 17 + wbai 20）
curl -s http://127.0.0.1:8790/v1/models | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.length))"

# 3. 流规范化未被破坏（应输出 1）
curl -s -N -m 60 -X POST http://127.0.0.1:8790/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"wb/deepseek-v4.1-flash","stream":true,"messages":[{"role":"user","content":"说 ok"}]}' \
  | grep -c '"role"'

# 4. 面板可访问
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8790/panel
```

---

## 八、控制面板

访问 http://127.0.0.1:8790/panel

| 区块 | 内容 |
|---|---|
| 网关总览 | 6 通道模型数与就绪状态 |
| Trae | 国内/国际切换、**真实登录态 + 账号 + 令牌到期**、**额度（含权益包明细）**、**签到状态与领取**、模型表（含倍率、上下文窗口）、未登录时列出**扫描过的凭据位置与失败原因** |
| WorkBuddy | 国内/国际切换、**额度（剩余总额 + 分包明细）**、**目录来源（实时/缓存/兜底）**、**推理探针（候选与逐模型探测）**、**模型可见性开关**、模型表（倍率、免费标记、夜间免费等标签）、刷新模型 |
| Qoder | 未接入占位 + 前置说明 |

### 面板架构

- 后端：`/panel/api/*` 路由，复用插件 host 端导出的类与函数（`normalizeCredits`、`modelWithCurrentPromotion` 等）
- 前端：React + Vite，产物由同一 server 托管在 `/panel`（不另起端口，免 CORS）
- **面板 API 响应体绝不含凭据**（只允许 `accountName`、`tokenExpiresAtMs` 这类非敏感字段）

### 面板写操作

| 操作 | 路由 | 语义 |
|---|---|---|
| Trae 签到领取 | `POST /panel/api/trae/checkin?region=cn` | **先读后写**：已签/未开启一律不打上游。业务拒绝以 `code` 非零返回（`claimed:false`），网络失败才是 `failed` |
| WorkBuddy 模型启停 | `POST /panel/api/workbuddy/control` `{action:'set-model-visibility', model, visible}` | 按账号维度；重新显示最后一个隐藏模型会整条删除该账号记录 |
| WorkBuddy 推理探针 | `POST /panel/api/workbuddy/probe` `{model}` | 会**真发上游请求并消耗额度**。自动探测不授权（`consent: () => false`），面板点击走 `manualConsent=true` 的一次性同意 |

### 状态文件隔离（改动前必读）

local-relay 自己的持久化状态放在 **`~/.dsh/local-relay/`**（`RELAY_STATE_DIR` 可覆盖），**不用** `workbuddyCatalogPath()` 等默认值：

```
~/.dsh/local-relay/catalog.<variant>.json      # 上次成功拉取的模型目录
~/.dsh/local-relay/visibility.<variant>.json   # 按账号的模型隐藏名单
~/.dsh/local-relay/probe.<variant>.json        # 推理探针观测记录
```

**为什么必须隔离**：DSH 插件用同名文件写 `~/.dsh`（`.workbuddy-catalog.json` 等），而几个 store 的 `persist()` 是**全量覆盖写**——读整个文件 → 改一处 → 写回。两个进程同时跑会互相把对方的改动整段抹掉；格式版本演进时还会互相判为旧格式而读成空，把对方数据清空落盘。改动时**不要**把这些 store 改回默认路径。

**例外**：Trae 的凭据副本（`~/.dsh/.trae-auth.<region>.json`）与 DSH 插件共享是**期望行为**——两边都该复用同一份登录态，本地网关的意义就在这里。

### 为什么面板是重写的，不是从插件移植的

原插件的面板是 **DSH cordis 客户端插件**：入口 `window.__ModuleLoader__.load(...)`，挂载到 DSH 私有槽位（`settings.plugin.item` 等），依赖注入 `slots` / `locale` / DSH `layout` 服务。**脱离 DSH 宿主无处渲染**，故只能复用数据层、重写 UI。

---

## 九、Git 状态

本地新建仓库（**无远端**），所有工作提交在 `master`。

历史分两段。**第一段：初始导入 + 面板骨架**（`98523bd` … `b2d2e32`）：

```
b2d2e32 docs: add PROJECT.md handover guide for new sessions
d4196b8 fix(panel): report real Trae sign-in state instead of always signed-out
58f0b9d test(panel): add end-to-end acceptance tests for the panel
6889d00 feat(panel): add Qoder placeholder card and document the panel
612fd09 feat(panel): add WorkBuddy card with credits, models and probe controls
871b23a feat(panel): add Trae card with credits, checkin and models
801e845 feat(panel): add API client and channel health overview
09b4179 feat(panel): scaffold Vite+React app and static hosting at /panel
306e7b4 feat(panel): add Qoder placeholder endpoint
2413989 feat(panel): add WorkBuddy status document and refresh control
b36c2f4 feat(panel): add Trae status document assembly
f17378d feat(panel): add panel API skeleton with health endpoint
98523bd chore: initial import of local-relay gateway and panel plan
```

**第二段：补齐未移植能力 + 接入 Qoder + 一键启动**（`1a58554` 之后，共 16 个提交）。按时间顺序，每个都对应上面某节：

| 提交 | 内容 |
|---|---|
| `1a58554` | `npm run dev` 一键启动 + 移植计划文档 |
| `c8e19e0` | Trae 额度/签到（`TraeUsageClient`） |
| `b000b62` | Trae 签到领取（**先读后写**守卫） |
| `9f6462e` | Trae 死模型过滤（`dropDeadModels`）+ 登录诊断 |
| `5e5d6f7` | WorkBuddy 状态隔离 + 目录持久化 + 促销重算 |
| `57fbcab` | WorkBuddy 额度 |
| `360f06f` | WorkBuddy 模型启停（visibility） |
| `99ca24d` | WorkBuddy 推理探针 |
| `703d47e` | 面板补齐 + 文档同步 |
| `97efa3c` | 计划文档标记完成 |
| `2d0b2cf` | **接入 Qoder 通道**（+ 修两个依赖桩缺陷） |
| `4869133` | Qoder 国内版对话打通（验证 + 文档更正） |
| `d1c6646` | `/v1/models` 返回显示名（六通道） |
| `eb54289` / `5dfbc5c` | `dev.cmd` 一键启动；删掉 start.cmd/start.sh |

> 想快速回顾这一轮改了什么：`git log --oneline b2d2e32..HEAD`，或 `git diff b2d2e32..HEAD --stat`。

`.gitignore` 忽略：`/node_modules/`、`/panel/node_modules/`、`/panel/dist/`、`*.log`。

> `shims/node_modules/` **是提交的**——它是项目核心资产（提取的协议层），需要能 diff 审查。

---

## 十、已知限制与未做的事

| 项 | 说明 |
|---|---|
| **Qoder 国际版对话** | 账号处于 p3 排队（`throttled`, `isQueued:true`, `serviceAvailable:false`）。模型/额度/签到都正常，属账号侧条件，**非代码问题** |
| **Trae 国际版** | 未登录国际版客户端，当前只服务兜底花名册；对话会返回 `Internal shim error`（因为拿到的是 fallback 表里的模型名，上游不认）。需在该客户端登录，非代码工作 |
| **WorkBuddy 国际版额度** | 本机缺 `WORKBUDDY_AI_ELECTRON_BIN`，`fetchCredits` 直接报错。面板如实显示该错误，不编造 |
| **WorkBuddy 国际版模型可见性** | 其凭据无 uid，按源设计**不提供按账号偏好**（避免多个账号共用一个桶）。面板因此不显示开关，这是刻意的降级 |
| **探针清空 / 最大上下文开关** | 仍返回明确失败原因。`clear` 需要先定交互语义（清谁的、全清还是单模型） |
| **Trae 账号切换** | 面板只读展示选中账号。切换属真写操作，需先想清多账号并存语义 |
| **Trae raw chat 通道** | 默认 `enabled:false`，且 `resolveTraeRawRuntime` 依赖外部 `sqlite3`（Windows 通常没有）。刻意不移植 |
| **认证** | 面板不设登录（本机 loopback 自用） |
| **UPSTREAM 变化** | 各上游协议随时可能变；插件升级后需同步 `shims/` |

---

## 十一、如何更新插件副本

DSH 插件升级后，重新复制并同步：

```bash
cd D:\ProjectSave\local-relay
SRC=~/.dsh/profiles/desktop/node_modules

# 复制最新 lib
for p in dsh-connect-trae dsh-workbuddy-connect dsh-qoder-connect; do
  rm -rf shims/node_modules/$p/lib
  cp -r "$SRC/$p/lib" shims/node_modules/$p/
  cp "$SRC/$p/package.json" shims/node_modules/$p/
done

# 同步到运行时依赖目录
rm -rf node_modules && cp -r shims/node_modules node_modules

# 回归验证
node --test test/*.test.js
node src/server.mjs
```

**注意**：插件升级可能改变内部 API 签名（本项目的 provider 装配代码直接调用了它们）。升级后务必跑全量测试 + 手动验证一次对话。

---

## 十二、安全与合规

- 只连接**你自己的账号**，不提供账号/额度
- 凭据直读本机桌面客户端登录态，**不经任何第三方服务器**
- 面板 API 响应体不含 token；`trae-status.mjs` 有测试专门守护这一点
- 复用本机登录态可能违反各上游 ToS，有风控风险，**仅供本地学习研究，勿商用或绕过计费**

---

## 十三、给接手者的快速上手路径

0. **先记住这个项目的本质**：这里不重写任何协议，只是把 DSH 三个插件里**已经写好的**注入式协议层装配起来。所以**遇到问题先去读插件的源码**——`shims/node_modules/<插件>/lib/index.js` 的 `apply()` / `createVariantRuntime()` 是权威的装配顺序，`variants-*.js` 是具体实现。**不要自己发明协议**。
1. 读本文档第二、三节（理解设计）和第六节（11 个坑，都是真金白银换来的）
2. 读 `docs/superpowers/plans/2026-10-02-local-relay-remaining-port.md`（已完成的移植计划，含哪些刻意不做及理由）
3. `node --test test/*.test.js` 确认基线绿（当前 71 项）
4. **双击 `dev.cmd`**（或 `npm run dev`）启动前后端，浏览器看 `/panel`；只跑后端用 `npm start`
5. 需要改前端 → 改 `panel/src/`（dev 态热更新；发布要跑 `npm run build:panel`）
6. 需要改后端 → 改 `src/`，跑全量测试 + 第七节的回归清单
7. 遇到"同一后端不同客户端表现不同"的问题 → **先抓原始 SSE 逐帧看字段，不要猜**（坑 1 就是这么找到的）
8. 加新通道时：`grep` 目标插件 import 了哪些依赖桩符号、**怎么用**，再决定桩要不要补（坑 9 的教训）

### 本仓库的硬约束

- **零 npm 依赖**：根 `package.json` 不许加 `dependencies`（只用 Node 内置模块）
- **状态文件必须隔离**：`src/state-dir.mjs` → `~/.dsh/local-relay/`，**不要**改回 `workbuddyCatalogPath()` 之类的默认路径（会与 DSH 插件互相覆盖，见第八节）
- **面板 API 响应体绝不含凭据**
- **写操作绝不静默成功**
