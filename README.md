# Zz.one Vault

本地/私有部署的个人数字门户，视觉语言为夜宣水墨。站点分三层：

| 路由 | 内容 |
| --- | --- |
| `/` | 激光雕刻封面，Enter 进入模块大厅 |
| `/modules` | 模块大厅，卡牌由 `lib/site-modules.ts` 的 `siteModules` 数组驱动；目前只有「观墨」是 `live`，其余为 `sealed` 占位 |
| `/quant` | 观墨量化仓本体，含七个工作区 |

七个工作区中，观势、个股、板块、对标使用真实行情；持仓、策略、指令与真实行情隔离，使用明确标记的本地模拟数据。系统不连接券商，不具备真实下单权限。

个股工作区提供沪深北和美国主要交易所的股票目录、搜索、交易所筛选、分页报价、详细行情，以及分时、五日、日 K、月 K 四档真实 OHLCV 图表，图表之下另有 K 线、量价、技术、盘口四档镜头切换。板块工作区做行业强弱排名与成分股下钻，对标工作区做跨市场同业涨跌、相关性与突破状态比较。

证券目录覆盖沪深北和美国主要交易所。美股目录保留普通股、优先股、ADR 和 REIT，排除 ETF、权证、债券、unit、right、基金及测试证券；实际数量以目录更新时间和接口返回为准。

## 运行

```bash
npm install
npm run dev
```

默认地址：

```text
http://localhost:3000
```

## 行情数据

- 证券目录：上交所、深交所、北交所及 Nasdaq Trader 官方目录，每日按需执行 `npm run refresh:catalog` 更新。
- 默认行情：腾讯批量公开行情，缺失时回退新浪和 Yahoo。提供最新价、涨跌、OHLC、量额、五档或一档盘口、换手率、估值、市值及 52 周区间等可用字段。
- K 线行情：主源按市场与周期分派 —— 沪深 A 股全部周期、北交所分时用腾讯公开 K 线；北交所五日/日 K/月 K 用新浪（唯一有完整历史且不被拦的源）；美股分时/五日用 Nasdaq chart，日 K/月 K 用 Nasdaq historical。主源返回空才依次回退：东方财富（美股与北交所）→ 新浪 5 分钟（北交所分时）→ 腾讯美股日 K（ETF/ETN 兜底，点少但均为真实成交）→ Yahoo。A 股日 K 和月 K 保持前复权口径；Yahoo 只返回后复权价，因此仅在价格口径本就一致时（美股、分时、五日）才被接受，避免两种复权口径混进同一根 K 线。分时为当日 1 分钟 K，五日为最近 5 个交易日的 5 分钟 K，日 K 最多保留近一年 250 根，月 K 最多保留近十年 120 根（上市时间不足时按实际交易历史显示）。
- 更新策略：交易时段观势行情流约每 3 秒拉取一次，个股目录报价约每 5 秒拉取一次；K 线由服务端返回的 `refreshAfterMs` 驱动增量更新，数据陈旧时按 3→60 秒退避重试。休市和收盘后停止轮询，显示静态历史。页面不可见时全部暂停。图表链路不使用模拟回退，行情源失败时保留上一份真实数据并显示错误状态。
- 工作区状态：当前视图、市场、交易所、搜索条件、股票、移动端面板、K 线周期和图表镜头会写入 URL；刷新、分享链接和浏览器前进/后退都能恢复当前个股上下文。
- 持牌实时 A 股：在 `.env.local` 配置 `TUSHARE_TOKEN`，优先使用 Tushare Pro `rt_k`。
- 持牌实时美股：在 `.env.local` 配置 `MASSIVE_API_KEY`，优先使用 Massive Stocks Snapshot。

公开接口没有实时 SLA 或再分发授权，系统只会将时间足够新的盘中数据标为 `PUBLIC LIVE`；闭市时显示 `LAST TICK`。只有已配置的持牌接口会显示 `LICENSED LIVE`。公开展示、商业发布或 Level 2 行情需要另行取得交易所及数据商授权。

配置模板见 `.env.example`。密钥应写入本机 `.env.local`，不要提交到版本库或粘贴到聊天中。

## 验证

```bash
npm run typecheck
npm run build
npm run refresh:catalog
```

## 部署

站点通过 OpenNext 打包为 Cloudflare Worker：

```bash
npm run preview   # 本地预览 Worker
npm run deploy    # 手动部署
```

`.github/workflows/deploy.yml` 在 **push 到 `main` 时自动执行 typecheck → opennextjs-cloudflare build → wrangler deploy**，也就是说合进 main 等于发生产。

Worker 跑在免费套餐上，单次调用最多 50 个子请求，且该上限不可配置。因此行情快照走东方财富 `ulist` 批量接口（每批 150 只、并发 8、4 个域名轮换），而不是逐页抓取；`/api/live/bars` 限 5 个 id、`/api/live/quotes` 限 200 个 id。新增任何服务端扇出前先算子请求数。

三套服务端缓存（K 线、报价、市场快照）都是 isolate 内的内存 Map，没有接 KV 或 Cache API，冷 isolate 即失效；报价链路对相同 id 集合做单飞去重，避免并发请求重复消耗子请求额度。

## 本地接口

- `GET /api/markets`
- `GET /api/data-hub`
- `GET /api/live/instruments?market=CN|US&exchange=XSHG&q=600519&page=1&pageSize=20`
- `GET /api/live/quotes?ids=CN:XSHG:600519,US:XNAS:NVDA`（最多 200 只）
- `GET /api/live/bars?ids=CN:XSHG:600519&period=intraday|five-day|daily|monthly`（最多 5 只）
- `GET /api/portfolio`
- `GET /api/strategies`
- `POST /api/sim/orders`
