# Privacy & Telemetry Notice / 隐私与遥测说明

Operator / 运营者: `bruc3van`  
Telemetry endpoint / 遥测接收端点: `https://dsh-market-pro.com/api/telemetry`  
Source code / 客户端源码审计: [`src/telemetry.ts`](src/telemetry.ts) · [`src/telemetryError.ts`](src/telemetryError.ts)  
Contact / 问题反馈与删除请求: <https://github.com/bruc3van/dsh-market-pro/issues>

---

## English

### 1. What Is Collected & Exact Payloads

DSH Market Pro includes minimal, opt-out usage telemetry solely to measure adoption and diagnose compatibility or installation failures for public plugins, built-in curated Agent Skills, and built-in curated MCP servers.

Only four event shapes can ever leave your machine:

1. **Daily heartbeat (`ping`)** — sent at most once per UTC+8 calendar day (plus at most one refinement ping if a UI attaches after a headless boot and supplies exact `desktop`/`web` + locale context):

```json
{
  "v": 1,
  "event": "ping",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "pluginVersion": "1.16.0",
  "dshVersion": "0.2.2-rc.5",
  "hostKind": "desktop",
  "os": "darwin",
  "locale": "zh"
}
```

2. **Public plugin install outcome (`plugin_install`)** — sent only when installing a plugin listed in the **official** public catalog (`DEFAULT_CATALOG_BASE` or official mirrors), normalized to its canonical `owner/repo` slug when available. Private packages, local paths, and entries from custom `catalogBase` feeds are dropped before any network request is made:

```json
{
  "v": 1,
  "event": "plugin_install",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "pluginVersion": "1.16.0",
  "dshVersion": "0.2.2-rc.5",
  "hostKind": "desktop",
  "os": "darwin",
  "locale": "zh",
  "target": "omdsh-dev/DSH-better-sidebar",
  "mode": "direct",
  "result": "failed",
  "errorCode": "compat"
}
```

3. **Curated MCP install outcome (`mcp_install`)** — sent only for the 100 built-in curated MCP servers (and never for local form-validation errors). Custom or private MCP servers are dropped without sending any request:

```json
{
  "v": 1,
  "event": "mcp_install",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "pluginVersion": "1.16.0",
  "dshVersion": "0.2.2-rc.5",
  "hostKind": "desktop",
  "os": "darwin",
  "locale": "zh",
  "target": "playwright",
  "mode": "featured",
  "result": "ok"
}
```

4. **Curated Agent Skill install outcome (`skill_install`)** — sent only for the 100 built-in curated Agent Skills (`owner/repo/skillId`), skipping local overwrite prompts (`already-exists`) and local project-directory validation errors. Custom or private skills are never sent:

```json
{
  "v": 1,
  "event": "skill_install",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "pluginVersion": "1.16.0",
  "dshVersion": "0.2.2-rc.5",
  "hostKind": "desktop",
  "os": "darwin",
  "locale": "zh",
  "target": "vercel-labs/skills/find-skills",
  "mode": "featured",
  "result": "ok"
}
```

- `errorCode` (present only when `result === "failed"`) is mapped client-side to a closed, privacy-safe enum: `"compat" | "unsupported_platform" | "not_bundle" | "already_installed" | "not_found" | "pnpm_missing" | "build_blocked" | "permission" | "disk_full" | "integrity" | "invalid_spec" | "network" | "timeout" | "refused" | "cancelled" | "write_failed" | "operation_error" | "unknown"`. Raw error messages, local paths, and stack traces are never sent.
- `id` is a random per-install UUIDv4 generated locally for daily deduplication. It is never derived from hardware IDs, MAC addresses, usernames, or accounts, and is cleared locally as soon as telemetry is turned off in Settings.

### 2. What Is Never Collected

- Conversations, prompts, or AI tool outputs
- File paths, workspace names, usernames, or hostnames
- API keys, credentials, headers, or environment variables
- Private/internal plugin names, custom `catalogBase` catalog entries, custom skills, or custom MCP servers
- Raw error stacks or local validation/overwrite prompts

### 3. Transport & Server-Side Handling

- **No IP or header collection**: Although HTTPS connections carry a source IP at the transport layer, the `/api/telemetry` Cloudflare Pages Function never reads or stores `CF-Connecting-IP`, `X-Forwarded-For`, `User-Agent`, or geolocation headers, and never logs request bodies.
- **No plaintext `id` stored (day-level granularity only)**: The incoming `id` is hashed server-side via HMAC-SHA256 (`id_hash`) before storage. Presence tables store only `first_day` / `last_day` and daily active deduplication (`YYYY-MM-DD`, UTC+8) — no sub-day timestamps are kept.
- **Decoupled install feedback**: Plugin, curated skill, and curated MCP install outcomes (`plugin_feedback_daily`) are written solely as daily aggregate counters `(day, kind, target, mode, error_code, ok_count, fail_count)` with **no `id_hash` column**, so individual per-user install histories cannot be reconstructed.
- **Non-blocking**: Requests have a 3-second timeout, swallow failures silently, and back off for the rest of the UTC+8 day if unreachable.

### 4. How to Disable Telemetry

- **In the UI**: Go to **DSH Market Pro → Settings → Anonymous Usage Telemetry** and switch it off (stops immediately and clears the local `id`).
- **Via environment variables** (honored across restarts and reflected in Settings):
  - `DO_NOT_TRACK=1` (or any non-empty value other than `0`, `false`, `off`, `no`)
  - `DSH_TELEMETRY_DISABLED=1` (any non-empty value)
  - `DSH_MARKET_TELEMETRY=0` (`0`, `false`, or `off`)
  - `CI=true` (`1` or `true`)

---

## 中文说明

### 1. 采集内容与完整报文样例

DSH Market Pro 内置极简、可关闭的遥测，仅用于统计公共安装规模，以及排查公开插件、内置精选技能与内置精选 MCP 的安装兼容性问题。

离开本机的请求只有以下 4 种固定格式：

1. **每日活跃心跳（`ping`）**：每个 UTC+8 自然日最多发送 1 次（若先无头启动、随后打开 UI 补充 `desktop`/`web` 与语言信息，则至多再细化 1 次）：

```json
{
  "v": 1,
  "event": "ping",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "pluginVersion": "1.16.0",
  "dshVersion": "0.2.2-rc.5",
  "hostKind": "desktop",
  "os": "darwin",
  "locale": "zh"
}
```

2. **公开插件安装结果（`plugin_install`）**：仅当目标属于**官方公开目录**时发送（并尽量归一化为官方目录中的 `owner/repo` 标识）；私有包名、本地路径或自定义 `catalogBase` 目录中的条目会直接丢弃，不发任何请求。

3. **精选 MCP 安装结果（`mcp_install`）**：仅针对内置 100 个精选 MCP 服务器发送（且跳过纯本地表单校验拦截）；用户自定义或私有 MCP 会直接丢弃，不发任何请求。

4. **精选技能安装结果（`skill_install`）**：仅针对内置 100 个精选 Agent Skills（`owner/repo/skillId`）发送，跳过本地目录已存在提示（`already-exists`）与本地路径校验错误；自定义或私有技能绝不上报。

```json
{
  "v": 1,
  "event": "skill_install",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "pluginVersion": "1.16.0",
  "dshVersion": "0.2.2-rc.5",
  "hostKind": "desktop",
  "os": "darwin",
  "locale": "zh",
  "target": "vercel-labs/skills/find-skills",
  "mode": "featured",
  "result": "ok"
}
```

- `errorCode` 仅在失败时出现，且固定映射为封闭、脱敏枚举：`compat | unsupported_platform | not_bundle | already_installed | not_found | pnpm_missing | build_blocked | permission | disk_full | integrity | invalid_spec | network | timeout | refused | cancelled | write_failed | operation_error | unknown`，绝不上报原始报错文本、本地路径或堆栈。
- `id` 为本地生成的随机 UUIDv4，仅用于去重，不绑定任何硬件指纹、用户名或账号；在设置中关闭统计后立即清除。

### 2. 绝不采集的内容

- 对话内容、提示词或 AI 工具输出
- 文件路径、工作区名称、用户名或主机名
- 密钥、凭据、请求头或环境变量
- 私有插件名称、自定义 `catalogBase` 目录条目、自定义技能或自定义 MCP 服务器
- 原始异常堆栈或本地表单/路径校验提示

### 3. 传输与服务端处理

- **不读取、不存储 IP 与请求头**：虽然 HTTPS 连接在传输层必然携带源 IP，但 `/api/telemetry` Cloudflare Pages Function 不读取也不存储 `CF-Connecting-IP`、`X-Forwarded-For`、`User-Agent` 或地理位置头，且不记录请求体日志。
- **不存储明文 `id`（时间粒度仅到自然日）**：服务端在入库前会先对 `id` 做 HMAC-SHA256 哈希（`id_hash`），活跃记录仅保存按 UTC+8 自然日统计的 `first_day` / `last_day` 与日活去重记录，不保存精确到时分秒的时间戳。
- **安装反馈彻底脱钩**：插件、精选技能与精选 MCP 安装结果表（`plugin_feedback_daily`）**不含 `id_hash` 字段**，仅按 `(day, kind, target, mode, error_code)` 累加每日成功与失败次数，服务端无法还原单个用户的安装画像。
- **静默退避**：所有请求 3 秒超时并静默吞掉错误；若域名不可达或被拦截，当日不再重试刷屏。

### 4. 如何关闭

- **界面一键关闭**：进入 **插件市场Pro → 设置 → 匿名使用统计** 关闭（立即停发并清除本地随机 ID）。
- **环境变量禁用**（重启生效，并在设置页显示禁用状态）：
  - `DO_NOT_TRACK=1`（或除 `0`/`false`/`off`/`no` 外的任意非空值）
  - `DSH_TELEMETRY_DISABLED=1`（任意非空值）
  - `DSH_MARKET_TELEMETRY=0`（`0`、`false` 或 `off`）
  - `CI=true`（`1` 或 `true`）
