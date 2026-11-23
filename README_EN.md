# DSH Market Pro

<img src="./assets/logo.svg" alt="DSH Market Pro logo" width="96" height="96" />

**An agent-native plugin, skills & MCP marketplace for DSH: built-in AI discovery skills & tools, 100 curated skills, and 100 curated MCP servers — plus management and security review in one place.**

[中文](./README.md) | English

An AI-native third-party plugin marketplace for DeepSeek Harness (DSH), powered by the verified community catalog [awesome-dsh-plugin-pro](https://github.com/bruc3van/awesome-dsh-plugin-pro), 100 built-in curated Agent Skills, and 100 curated MCP servers. In addition to visual browsing, one-click installation, version updates, zero-CLI skill direct install & removal, curated MCP discovery, managed MCP configuration & connection-test diagnostics, and post-install AI security review, it equips your **DSH Agent to search catalogs, compare options, inspect installed capabilities, and safely install plugins, skills & MCP servers right inside chat** — no manual sifting required.

![Marketplace main view](./assets/screenshots/marketplace.png)

## Key Features

- **Agent-Native AI Discovery, Batch Updates & Safe Setup (Unified `/market-pro` Skill + Plugins, Skills & MCP Tools)**:
  - Enabled by default as soon as `dsh-market-pro` is installed: automatically registers the unified bundled **`market-pro`** skill along with three underlying tools — **`dsh_market_pro`** (plugins & batch updates), **`dsh_skills_pro`** (100 curated Agent Skills & approval-gated direct install), and **`dsh_mcp_pro`** (curated & custom MCP setup) — and cleans them up automatically when disabled or uninstalled.
  - **Discover plugins, skills, batch-update, and configure MCPs in conversation**: describe what you need in natural language, invoke **`/market-pro`** directly (including cross-type plugin vs skill vs MCP recommendations), or click **Ask AI to pick plugins**, **Ask AI to pick skills**, or **Ask AI to pick MCP** in the toolbar.
  - **High-precision search & environment awareness**: supports CJK 2-gram fallback, bilingual multi-synonym queries, installed/configured filtering, and batch detail lookups across locally cached editor's picks, 29,000+ community repositories, 100 curated skills, and 100 built-in curated MCP servers — while checking installed plugins, skills, and live MCP servers to avoid duplicates.
  - **Defense-in-depth anti-injection, native approval & zero plaintext secrets**: discovery and update checks are strictly read-only, scrubbing invisible Unicode payloads, neutralizing angle brackets, and wrapping output inside `<untrusted_market_data>` / `<untrusted_mcp_data>` / `<untrusted_skill_data>` envelopes. Plugin installs go through official `plugin_manager` approval; batch plugin updates (`update_plugins`) pin exact user-confirmed package/version pairs and fail closed through DSH's native approval prompt listing every item; curated skill direct installs (`install_featured`) and MCP mutations (`install_featured` / `install_custom` / `set_enabled`) likewise fail closed through native approval while rejecting plaintext secrets and auto-binding `${credential:REF}` templates.
  - **Instant toggle, zero-token friendly**: turn **AI Discovery Assistant (Plugins, Skills & MCP)** off anytime in **DSH Market Pro → Settings** to withdraw the bundled skill and all tools immediately with zero standing token overhead, or toggle online catalog access per profile. Direct **Refresh**, **Open-source repository**, and **Contact author** buttons sit in the top-right header for quick access and feedback.
- **Curated & Full Catalog**: Filters out unrelated projects and topic riders. Opens on editor's picks while offering the full verified catalog with category filters, keyword/package search, **Active & popular / Most stars / Recently updated** sorting in **All**, and guided cross-scope switching when a narrower view has no matches.
- **One-Click Install**: Install and enable plugins directly from their cards; for repositories without direct install metadata, generate a prompt draft so your AI agent can verify and install them for you.
- **Manage, Filter & Batch-Update Installed Plugins**: View all installed plugins in one place, filter by **All installed / Updates available**, toggle enable/disable states live without restarting, uninstall, pick from scrollable version lists per plugin, or run **Update all** (confirm checklist → sequential updates with skip-on-failure & retry failed → summary, automatically ordering `dsh-market-pro` last). When `dsh-market-pro` itself has an update, a quick update button also appears next to Refresh in the header.
- **Post-Install AI Review**: Prepare a review draft in your conversation input box (sent only when you confirm) to have your AI agent inspect installed plugin files for network calls, credential access, scripts, and other potential risks.
- **Curated Skills Direct Install & Grouped Management**:
  - **100 curated Agent Skills (from skills.sh All Time)**: organized under the same 7 functional categories as Plugins (with category + source dropdown filters) and displaying real organization/author brand logos;
  - **Zero-CLI, non-interactive direct install with China mirror fallback**: download verified subpaths directly from GitHub inside the modal (automatically falling back to official jsDelivr mirrors when GitHub is unreachable) — no local `npx` CLI or interactive terminal confirmation needed; defaults to **DSH global `~/.dsh/skills`**, with options for **shared `~/.agents/skills`** or a **project-level `.dsh/skills`** chosen via the directory picker; enforces root `SKILL.md` and path-boundary verification plus script warnings, while keeping **Verify with AI** and approval-gated `dsh_skills_pro` install;
  - **Grouped Installed View & Modal Delete Confirmation**: both **Skills → Installed** and the in-conversation **Skills** tab group skills by source (**User / Project / Bundled**) with count badges and dividers, offering **Open folder** and safe removal of local user/project skills via a **confirmation modal** (Host-side verification of `.dsh/skills` / `.agents/skills` & `SKILL.md`, symlink-escape protection, and protection for bundled skills like `market-pro`).
- **Curated MCP Catalog, Management & Probe Diagnostics**: Built on DSH's official MCP manager (DSH ≥ 0.2.2-rc.2) with **Featured** and **Configured** sub-tabs, plus **Open settings file**, **Ask AI to pick MCP**, and **Add MCP** aligned cleanly on the tab toolbar row:
  - **100 built-in curated MCP servers** organized under the same functional categories as Plugins (Developer Tools, Knowledge & Research, Web & Browser, Design & Visual, Integrations & Sharing, Utilities, Agents & Workflows — including Context7, DeepWiki, arXiv, Zotero, AWS Docs, Playwright, Chrome DevTools, Scrapling, Browser Use, GitHub, GitLab, Supabase, Stripe, Sentry, Azure, Firebase, CloudBase, DBHub, Serena, Codebase Memory, Kubernetes, MongoDB, ClickHouse, Neo4j, DuckDB, Exa, AIHOT, Amap, Baidu Maps, 12306, Home Assistant, AKTools, Feishu/Lark, DingTalk, Yuque, Notion, Excel, Airtable, AntV Chart, draw.io, GitDiagram, tldraw, MiniMax, Figma, Qdrant, Basic Memory, and more), with category + runtime/no-key dropdown filters, search, live connection status badges, direct key-page shortcut links, secret visibility toggles, command copy, and native `StateDot` / `TextShimmer` live startup tracking with one-click retry;
  - **Live status, Tools dialog & Test-Connection dialog**: filter configured servers by status, monitor live connections, browse or search exposed tools in a dedicated **Tools dialog**, and click **Test connection** to open a dedicated diagnostic modal reporting live handshake status, latency, server version, discovered tools, and failure details (with one-click retest or edit);
  - **Full lifecycle & credential safety**: add, edit, enable/disable, and restart servers, including **auto-reconnect** and **close-timeout** settings; inspect credential sources (credential store / environment), move plaintext secrets to credentials, and update or **clear** stored values;
  - **One-click static MCP adoption**: static `dsh-mcp-client` rows written straight into the profile show risk notices, toggle controls, and one-click **Manage** adoption (moving plaintext secrets to credentials on the Host and disabling the static row safely).

## How It Compares

Compared with other common discovery and management approaches, DSH Market Pro unifies a **verified catalog**, **curated MCP directory**, **all-in-one management UI**, and **toggleable agent-native discovery** in a single plugin:

| Dimension | DSH Market Pro (This Plugin) | Official DSH Discover (`dsh-plugin-market`) | Typical UI-Only / Broad Community Markets | Standalone Discovery Skill / MCP Server |
|---|---|---|---|---|
| **Catalog Quality & Curation** | **Verified real plugins + curated skills + curated MCPs**: daily checks filter out topic riders, empty repos, and non-plugins; combines **editor's picks + 29,000+ full catalog + 100 curated skills + 100 curated MCPs** with local cache & mirror failover (including jsDelivr fallback for skills) | Reads user-configured format-1 index URLs only; does not ship a built-in community directory | Many aggregate broadly by GitHub topic, often mixing non-plugins or uninstallable repos that require manual filtering | Relies on external registry APIs or CLIs with limited DSH manifest & install-target coverage |
| **In-Chat AI Discovery & Setup** | **Enabled by default in Standard & Creator modes**: unified bundled `/market-pro` skill and `dsh_market_pro` + `dsh_skills_pro` + `dsh_mcp_pro` tools for cross-type discovery, approval-gated batch plugin updates, and safe MCP install/toggle | Exposes `plugin_market` tool, but **enabled only in Creator preset by default** with no companion discovery skill or MCP installer | Mostly click-to-browse UIs without autonomous in-chat catalog search | Supports chat discovery, but usually requires an extra MCP subprocess or CLI and provides no management UI |
| **Environment Awareness** | Jointly inspects active profile **installed plugins + managed/static MCPs & live tool groups**, skips duplicates, and recommends complementary capabilities | Annotates listing install status without MCP/skills cross-checking | Typically limited to per-card installed badges rather than conversation-level planning | Generally lacks direct visibility into the active DSH profile's installed plugins and managed MCPs |
| **Management Scope** | **Plugins + Skills + Curated & Managed MCPs + Settings** in one place (live toggle, updates-available filter & one-click batch updates, one-click curated MCP add, adoption, credentials, tools dialog) | Focused on plugin discovery and installation; no Skills tab or MCP manager UI | Focused on browsing, ratings, or discussions; managing MCP/skills usually requires separate plugins | Single-purpose (skills-only or MCP-only), without host plugin lifecycle management |
| **Security & Anti-Injection** | **Defense-in-depth** (invisible Unicode scrubbing + angle-bracket neutralization + untrusted-data envelopes) + official `plugin_manager` / native approval + **zero plaintext secrets** + **post-install AI review** | Notes untrusted text in tool description; installs via official `plugin_manager` approval | Varies by project; mostly UI notices or install-time checks | Primarily relies on prompt-level confirmation reminders, rarely enforcing protocol isolation or zero-plaintext-secret checks |
| **Token Overhead Control** | Compact single-language output & batch lookups; **one-click toggle in Settings** immediately withdraws all skills & tools for **zero standing token cost** | Schema cost applies in presets where the tool is enabled | Passive UI with zero standing conversation overhead | Separate MCP process continuously injects tool schemas into sessions |

> This comparison reflects public implementations and typical designs. Each approach has its own focus (for example, UI-focused markets work well if you prioritize community comments or screenshot galleries). DSH Market Pro is built for users who want a **verified plugin dataset, built-in curated MCP catalog, unified plugin/skill/MCP management**, and an **out-of-the-box yet instantly toggleable agent-native discovery loop**.

## Installation

1. Open the **Plugins** page from the left navigation bar in DSH.
2. Enter **`dsh-market-pro`** in the official plugin installation interface to install and enable it.
3. Once installed, open **DSH Market Pro** anytime from the left navigation bar, the Plugins page tab, or the right sidebar inside a conversation — or simply ask DSH in chat / run **`/market-pro`** to let your agent pick plugins, skills, and MCP servers for you.

## Chat-Native AI Discovery & Setup Examples

The screenshots use a local demo model for the conversations. DSH runs the tools and generates the approval cards shown.

### 1. Discover Plugins & Cross-Type Setups (`/market-pro`)

With the AI assistant enabled by default, just ask in any DSH conversation:

```text
Check which plugins I already have installed, then recommend active DSH plugins for diagramming and Word/PDF document export.
```

Or invoke the unified bundled skill explicitly:

```text
/market-pro Recommend a practical plugin, skill, and MCP setup for frontend engineering and API debugging
```

Your agent uses `dsh_market_pro` to:

1. **Inspect your environment** (`environment`) to see installed plugins and MCP servers and avoid duplicates.
2. **Search curated & full catalogs** (`featured` / `search` / `detail`) to verify install targets, activity, and prerequisites.
3. **Compare and install safely** — presenting 2–4 tailored options and invoking the official `plugin_manager` only after your confirmation, followed by an optional read-only security review.

![Chat-native AI plugin discovery](./assets/screenshots/marketplace-ai-chat.png)

### 2. Check & Batch-Update Installed Plugins (`/market-pro`)

Ask in any conversation:

```text
/market-pro Check my installed plugins for updates and batch-update them to the latest compatible versions after I confirm.
```

Your agent uses `dsh_market_pro` to run a safe end-to-end update loop:

1. **Read-only update check** (`check_updates`): checks both npm registries and configured Git subscription indexes, listing each updatable plugin's current and latest compatible stable versions.
2. **Pinned scope + native approval** (`update_plugins`): after you confirm, submits only the exact confirmed `{ packageName, version }` pairs through DSH's native approval prompt listing every plugin, orders `dsh-market-pro` last automatically, skips failures with rollback diagnostics, and reports applied, restart-required, and failed outcomes clearly.

### 3. Discover & Safely Install MCP Servers (`/market-pro`)

Run `/market-pro` in chat or click **Ask AI to pick MCP** in the MCP tab toolbar:

```text
/market-pro Inspect my currently configured MCP servers first, then recommend curated MCPs for up-to-date docs and diagramming, and install them safely after my confirmation.
```

Your agent uses `dsh_mcp_pro` to complete a safe end-to-end flow:

1. **Read-only audit & search** (`list_configured` / `search_featured` / `detail`): skips capabilities already covered by configured MCPs and compares transport (`HTTP` / `npx` / `uvx`) and credential prerequisites.
2. **Native approval-gated writes** (`install_featured` / `install_custom` / `set_enabled`): after you confirm in chat, every mutation triggers DSH's native approval prompt displaying the exact command/URL, working directory, env vars, and headers — failing closed if declined.
3. **Zero plaintext secrets**: servers requiring API keys automatically bind `${credential:REF}` templates without ever asking you to paste secrets into chat; after saving, your agent directs you to **DSH Market Pro → MCP → Configured** to click **Set** and store credentials securely.

![Chat-native AI MCP discovery and approval-gated installation](./assets/screenshots/marketplace-ai-mcp-chat.png)

### 4. Discover & Directly Install Agent Skills (`/market-pro`)

Run `/market-pro` in chat or click **Ask AI to pick skills** in the Skills tab toolbar:

```text
/market-pro Inspect my currently available skills first, then recommend curated skills for frontend UI design or code review, and install them to ~/.dsh/skills after my confirmation.
```

Your agent uses `dsh_skills_pro` to complete a safe end-to-end flow:

1. **Audit & search** (`list_installed` / `search_featured` / `detail`): skips skills you already have and reviews each curated skill's repository, verified subpath, and fit.
2. **Native approval-gated direct install** (`install_featured`): after you confirm, triggers DSH's native approval prompt and downloads the verified skill directly (with automatic jsDelivr mirror fallback) into `~/.dsh/skills`, `~/.agents/skills`, or `<project>/.dsh/skills` — without running interactive `npx skills` commands.

> To turn this capability off or back on anytime, open **DSH Market Pro → Settings** and toggle **AI Discovery Assistant (Plugins, Skills & MCP)**.

## Interface Preview

### Marketplace Settings (AI Assistant & Catalog Switches)

Toggle **AI Discovery Assistant (Plugins, Skills & MCP)** and **Community Plugin Catalog** from the **Settings** tab with immediate effect and per-profile persistence, or jump straight into chat to try AI discovery.

![Marketplace settings view](./assets/screenshots/marketplace-settings.png)

### Full Catalog & Sorting

Switch to **All** to explore the full verified catalog with category filters and **Active & popular**, **Most stars**, or **Recently updated** sorting.

![Full catalog and sorting](./assets/screenshots/marketplace-all.png)

### Curated MCP Catalog, Management, Probe & Tools Dialogs

Access **Open settings file**, **Ask AI to pick MCP**, and **Add MCP** directly from the **MCP** tab toolbar. Browse the 100 built-in curated MCP servers under **MCP → Featured** (aligned with Plugin functional categories, with category & runtime/no-key dropdown filters, search, live connection status badges, direct key-page shortcuts, and native `StateDot` / `TextShimmer` startup tracking), then switch to **Configured** to manage both managed and static MCP servers: filter by status, inspect and clear credentials, convert static rows to managed servers, run **Test connection** in a dedicated diagnostic modal, and search exposed tools in the **Tools dialog**.

![Curated MCP catalog](./assets/screenshots/marketplace-mcp-featured.png)

![MCP configured servers management view](./assets/screenshots/marketplace-mcp.png)

![MCP connection test diagnostic modal](./assets/screenshots/marketplace-mcp-probe.png)

![MCP tools dialog](./assets/screenshots/marketplace-mcp-tools.png)

### Right Sidebar Shortcut

In addition to the main navigation bar, you can open **DSH Market Pro** directly from the right sidebar inside any session.

![Right sidebar entry](./assets/screenshots/marketplace-sidebar.png)

### Installed Plugins, Filtering & Batch Updates

Manage your installed plugins under the **Installed** tab: filter by **All installed / Updates available**, toggle enable/disable states live, uninstall, pick from scrollable version lists per plugin, or click **Update all** to confirm and sequentially upgrade plugins (skipping failures with one-click retry). When `dsh-market-pro` itself has an update, a quick update button also appears in the top-right header.

![Installed panel](./assets/screenshots/marketplace-installed.png)

![Batch update confirmation](./assets/screenshots/marketplace-batch-update.png)

### Post-Install AI Review

Click **AI review** after installation or on any installed plugin card to prepare a read-only security review prompt in your conversation input box.

![AI review draft](./assets/screenshots/marketplace-sec-check.png)

### Skills Page, Direct Install & Grouped Management

Browse the 100 curated All Time skills from skills.sh under **Skills → Featured** (displaying real brand logos, category and source dropdown filters, verified repo subpaths, and zero-CLI one-click direct installation with automatic jsDelivr mirror fallback into **DSH global `~/.dsh/skills`**, **shared `~/.agents/skills`**, or a **project-level `.dsh/skills`** directory — plus Ask AI review with approval-gated chat install). Switch to **Installed** or open the **Skills** tab below the conversation title to view skills grouped by source (**User / Project / Bundled**), open folders, or safely delete local user/project skills via a confirmation modal.

![Global Skills Featured page](./assets/screenshots/marketplace-skills.png)

![Curated Skill direct install modal](./assets/screenshots/marketplace-skills-install.png)

![Installed Skills grouped management](./assets/screenshots/marketplace-skills-installed.png)

![Conversation Skills tab](./assets/screenshots/conversation-skills.png)

## Usage Notes

- **Security reminder**: Catalog inclusion verifies that a project is a DSH plugin, not that it is safe. Always review a plugin's source and requested permissions before installing.
- **About AI review**: AI review is an optional post-install check on local plugin files to help you assess risk; it cannot prevent or undo code that has already executed during installation.
- **Anonymous telemetry**: Enabled by default, sending an anonymous daily heartbeat (random install ID, plugin & DSH version, host type, OS, locale) and public plugin / curated MCP install outcomes to [dsh-market-pro.com](https://dsh-market-pro.com) to measure adoption and improve install reliability. It never collects chats, file paths, secrets, or private plugin names. Turn it off anytime under **Settings → Anonymous Usage Telemetry** or via `DO_NOT_TRACK=1` / `DSH_MARKET_TELEMETRY=0` / `DSH_TELEMETRY_DISABLED=1`.

## Related Projects

- **[DSH Market Pro Web Directory](https://dsh-market-pro.com/en/)**: Browse all 29,000+ verified DSH plugins, 100 curated MCP servers, and the Discover subscription feed online.

- **[DSH Desktop Pro](https://github.com/bruc3van/dsh-desktop-pro)**: Standalone DeepSeek Harness desktop client.
- **[awesome-dsh-plugin-pro](https://github.com/bruc3van/awesome-dsh-plugin-pro)**: Verified DSH community plugin catalog and data source for this market.
- **[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)**: Official DeepSeek Harness repository.

## License

[MIT](./LICENSE)
