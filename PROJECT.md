# local-relay 项目总结

> 本文档写给**零上下文的接手者**（人或 AI）。读完即可独立维护本项目，无需先了解它的来历。
> 项目路径：`D:\ProjectSave\local-relay`

---

## 一、这是什么

一个**跑在本机的 OpenAI 兼容网关**，把 DSH（DeepSeek Harness）三个订阅接入插件所对接的账号额度，转成标准 OpenAI API，供 ZCode 等任意支持自定义 OpenAI 接口的客户端使用。

**一句话**：让 ZCode 能用上 Trae / WorkBuddy 的订阅额度。

### 支持的通道

| 前缀 | 通道 | 状态 |
|---|---|---|
| `trae/` | Trae 国内版 | ✅ 实测可用（对话 + 工具调用） |
| `traeg/` | Trae 国际版 | 需登录国际版客户端 |
| `wb/` | WorkBuddy 国内版 | ✅ 实测可用（对话 + 工具调用） |
| `wbai/` | WorkBuddy 国际版 | 模型可列，受账号额度约束 |
| `qoder/` | Qoder | ❌ 未接入（见"已知限制"） |

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
├── src/
│   ├── server.mjs              # 统一入口：前缀路由 + 流规范化 + 静态托管
│   ├── providers/
│   │   ├── trae.mjs            # Trae 栈装配（cn / ai 两区域）
│   │   └── workbuddy.mjs       # WorkBuddy 栈装配（cn / global 两变体）
│   └── panel/
│       ├── api.mjs             # /panel/api/* 路由编排
│       ├── trae-status.mjs     # Trae 面板数据（真实登录态 + 账号）
│       ├── workbuddy-status.mjs# WorkBuddy 面板数据
│       ├── qoder-status.mjs    # Qoder 占位
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
│   │       └── ModelTable.jsx      # 两个卡片共用
│   └── vite.config.js          # base: '/panel/'
├── shims/node_modules/         # ★ 从 DSH 插件提取的协议层 + 5 个依赖桩
│   ├── dsh-connect-trae/       # v2.5.0
│   ├── dsh-workbuddy-connect/  # v0.7.0
│   ├── dsh-qoder-connect/      # v0.2.2
│   ├── @deepseek-ai/           # 5 个桩包
│   └── @earendil-works/
├── test/                       # node:test 测试（26 项）
├── docs/superpowers/plans/     # 面板实施计划（历史文档）
├── README.md                   # 用户向使用说明
└── PROJECT.md                  # 本文件（交接文档）
```

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

或双击 `start.cmd`。

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

> 以 `GET /v1/models` 的实际返回为准，上面仅作参考。

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

未装配的能力（探针清空、模型启停、签到领取）统一返回：

```json
{ "state": "failed", "reason": "action not wired yet: clear (needs probe/visibility service)" }
```

**这是刻意设计**——proxy-hub 的致命问题之一就是把失败静默成"空成功"。新增写操作时不要破坏这个约定。

---

## 七、测试

```bash
cd D:\ProjectSave\local-relay
node --test test/*.test.js
```

当前 **26 项全绿**。其中 `test/panel-e2e.test.js` 需要网关在跑，否则自动 skip。

测试覆盖：

| 文件 | 覆盖 |
|---|---|
| `panel-api.test.js` | 面板 API 骨架、健康度、Qoder 占位 |
| `panel-trae-status.test.js` | Trae 真实登录态、账号、无凭据泄漏、失效 provider |
| `panel-workbuddy-status.test.js` | 模型倍率归一化、写操作拒绝、失效 provider |
| `panel-static.test.js` | 静态托管、SPA fallback、**路径穿越防护**、缺 dist 提示 |
| `panel-e2e.test.js` | 端到端验收（4 通道、无泄漏、HTML 可服务） |

### 回归验证清单（改完必做）

```bash
# 1. 全量测试
node --test test/*.test.js

# 2. 模型总数（应 56）
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
| 网关总览 | 4 通道模型数与就绪状态 |
| Trae | 国内/国际切换、**真实登录态 + 账号 + 令牌到期**、模型表（含倍率、上下文窗口） |
| WorkBuddy | 国内/国际切换、模型表（倍率、免费标记、夜间免费等标签）、刷新模型 |
| Qoder | 未接入占位 + 前置说明 |

### 面板架构

- 后端：`/panel/api/*` 路由，复用插件 host 端导出的函数（`normalizeCredits` 等）
- 前端：React + Vite，产物由同一 server 托管在 `/panel`（不另起端口，免 CORS）
- **面板 API 响应体绝不含凭据**（只允许 `accountName`、`tokenExpiresAtMs` 这类非敏感字段）

### 为什么面板是重写的，不是从插件移植的

原插件的面板是 **DSH cordis 客户端插件**：入口 `window.__ModuleLoader__.load(...)`，挂载到 DSH 私有槽位（`settings.plugin.item` 等），依赖注入 `slots` / `locale` / DSH `layout` 服务。**脱离 DSH 宿主无处渲染**，故只能复用数据层、重写 UI。

---

## 九、Git 状态

本地新建仓库（无远端），所有工作提交在 `master`：

```
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

`.gitignore` 忽略：`/node_modules/`、`/panel/node_modules/`、`/panel/dist/`、`*.log`。

> `shims/node_modules/` **是提交的**——它是项目核心资产（提取的协议层），需要能 diff 审查。

---

## 十、已知限制与未做的事

| 项 | 说明 |
|---|---|
| **Qoder 通道** | `createQoderTransport` / `getMachineId` **未从包导出**，且本机未装 `qoderclicn`。需登录后自行装配 transport |
| **Trae 国际版** | 需用户在 Trae 国际版客户端登录，非代码工作 |
| **额度明细** | 需要 `TraeUsageClient` / WorkBuddy credits 客户端装配。当前面板显示"额度信息不可用（用量客户端尚未装配）" |
| **签到领取** | 只读展示状态，按钮未触发写操作 |
| **模型启停 / 探针清空** | 写操作返回明确失败原因，未实现持久化 |
| **认证** | 面板不设登录（本机 loopback 自用） |
| **UPSTREAM 变化** | 各上游协议随时可能变；插件升级后需同步 `shims/` |

### Qoder 接入的下一步（若要做）

1. 安装 `qoderclicn` 并 `qoderclicn login`
2. 参考 `~/.dsh/profiles/desktop/node_modules/dsh-qoder-connect/lib/index.js` 里 `createVariantRuntime` 的装配顺序
3. 自行实现 transport（该函数未导出，可能需要从 `variants-CFI6-cGn.js` 里挖，或直接调用上游）
4. 新增 `src/providers/qoder.mjs`，在 `server.mjs` 的 `PROVIDERS` 里注册
5. 把 `src/panel/qoder-status.mjs` 从占位改为真实数据

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

1. 读本文档第二、三节（理解设计）和第六节（坑）
2. `node --test test/*.test.js` 确认基线绿
3. `node src/server.mjs` 启动，浏览器打开 `/panel` 看效果
4. 需要改前端 → 改 `panel/src/`，跑 `npm run build:panel`
5. 需要改后端 → 改 `src/`，跑全量测试 + 第七节的回归清单
6. 遇到"同一后端不同客户端表现不同"的问题 → **先抓原始 SSE 逐帧看字段，不要猜**（坑 1 就是这么找到的）
