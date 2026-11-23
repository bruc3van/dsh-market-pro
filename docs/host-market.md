# DSH 官方发现页订阅与市场接入

用户订阅配置适用于 **DSH V0.2.1-rc.2 及以上**：左侧 **插件 → 实验性插件旁的「更多」→ 自定义插件市场**，开启后在 **发现** 中添加 JSON 索引源；也可以先访问 [DSH Market Pro 官网与全量目录](https://dsh-market-pro.com) 浏览目录，完整功能说明见 [README](../README.md)。

## 宿主适配

本插件的 DSH `peerDependencies` 与 `engines.dsh` 声明为 `>=0.2.2-rc.1 <0.3.0`；开发与测试基线固定到 DSH `0.2.2-rc.5`，Cordis / Loader / Schemastery 使用宿主的 `4.1.0` / `1.1.0` / `3.19.0`，Zod 固定到宿主的 `4.6.6`。

已核对 DSH `0.2.2-rc.1` → `0.2.2-rc.5` 的插件页、侧栏插槽、会话控制器、Loader/Settings、官方 MCP 管理器、目录浏览接口（含 DSH-go `"browse"` 能力）和安装/更新 Remote。`plugins.tab` 新增 owner 的 `update` 回调，市场与 owner 的安装、更新回调保持隔离；侧栏仍通过 `sidebar.panellist` 注册。本插件的菜单使用原生 disclosure，未依赖宿主内部浮层定位接口。

市场通过 `plugins.tab` 注册「插件市场Pro」（英文为「DSH Market Pro」）标签，共享原市场的数据源、安装队列和审查功能。注册跟随插槽和插件生命周期销毁；独立入口和右侧栏仍可用。

市场使用自己的多选安装确认框和官方 `pluginManager` Remote。官方标签 owner 的安装入口要求精确版本和版本元数据；社区目录允许裸 npm 包名、分支及多组件目标，不能直接作为官方索引的版本记录。

## 两种数据协议

- 本插件默认读取 npm feed 的紧凑 schema 4 `market-catalog-v4.json`（兼容 schema 3 `market-catalog.json`）：已审核仓库目录（已减去 `excluded_repos` / `market_exclusions` / `leaderboard_exclusions`）加官方订阅的全部插件。全部按仓库计数，展示完整目录；`install_status` 决定直接安装还是生成 AI 核对安装提示词。精选来自目录的 `featured` 块（上游 `featured.json`，与订阅索引的编辑推荐标签同源），订阅插件用于补全仓库的图标、关键词和安装目标（当 `featured` 存在时，客户端解析后丢弃冗余 `subscription` 负载以节省约 6 MiB 缓存与 RPC 体积；无 `featured` 的旧源仍回退以订阅作为精选）。默认 jsDelivr、失败或首包慢于 1.5s 自动对冲回退至国内 `registry.npmmirror.com` 与 unpkg，自定义 schema 2/3/4 地址继续兼容。见 [消费协议](market-json-spec.md)。
- 官方「发现」页和 `plugin_market` 工具读取 format-1 `index.json`。生成器、测试、发布流程、索引与生成报告由数据源仓库 [awesome-dsh-plugin-pro](https://github.com/bruc3van/awesome-dsh-plugin-pro/tree/main/scripts/host-market) 维护，本插件不生成或发布另一套索引，也不自动添加订阅。

订阅地址：`https://dsh-market-pro.com/index.json`（旧地址 `https://bruc3van.com/dsh-plugins/index.json` 与 `https://bruc3van.com/markets/dsh/index.json` 由站点兼容提供，已有订阅无需重复添加）。

## 数据源订阅规则概览

数据源侧由 [awesome-dsh-plugin-pro](https://github.com/bruc3van/awesome-dsh-plugin-pro) 每日自动构建与核验：

- 从社区目录和完整已批准且具备安装映射的目录选取候选，核实 npm/Git 来源、实际 manifest、bundle、完整性与官方 `dshRange`，缺映射或手动安装不转换。
- format-1 索引通过官方 `@deepseek-ai/dsh-plugin-market-index` 校验。显式 `engines.dsh` 优先，否则求 DSH peer 范围交集；无约束时省略，不补造范围。
- 编辑推荐保留原用途分类，额外附加「编辑推荐」标签；分类、功能和推荐标签可组合筛选。
- 站点从不可变发布记录读取并核对摘要；读取失败时使用已校验的随站快照。数据源成功发布后无需重新构建本插件。

## 已安装插件更新

市场的「已安装」卡片通过官方 Remote 的 `listBundles` 读取更新资格（并兼容 `BundleInfo.updatable` 字段回退），npm 使用 `listVersions(name, {})`，固定提交的 Git 使用 `pluginMarket.listIndexes / search` 查询现有订阅。Git 查询按已配置来源顺序读取，按精确包名匹配，并只采用宿主 `MarketListingVersion.update` 标记的同源更新；兼容性和版本豁免沿用官方判定。

用户确认目标版本后调用 `updateBundle(name, version, options)`：npm 传回列表所用 registry，Git 原样传回宿主提供的固定提交 spec；两者均携带请求 ID 并监听 `plugin-manager/update-state`。启用状态、移除、替换、恢复及重启语义由宿主实现。热更新被拒时保持插件启用状态；批量更新遇到需要重启的项时暂停等待处理，且自动将 `dsh-market-pro` 排在最后。传输失败显示结果未确认，不自动重试安装。

## 验证边界

自动化测试（`pnpm run check`）覆盖类型检查、ESM/CJS 产物构建与导入校验、真实 Loader/Settings 启动、RPC 注册、设置及插件启停跨重启持久化、AI 选型与防注入、MCP 精选与托管管理、插件单/批量更新、匿名遥测脱敏、DSH-go 远程目录浏览、以及 `scripts/verify-upstream-catalog.mjs` 对上游 schema 3/4 与订阅索引的跨仓一致性校验。
