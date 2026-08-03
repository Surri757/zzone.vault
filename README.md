# Zz.one Vault

本地/私有部署的黑曜石量化仓。界面包含观势、个股、持仓、策略和指令五个工作区。个股工作区提供沪深北和美国主要交易所的股票目录、搜索、交易所筛选、分页报价、详细行情，以及分时、五日、日 K、月 K 四档真实 OHLCV 图表。组合、策略和指令继续与真实行情隔离，使用明确标记的本地模拟数据；系统不连接券商，不具备真实下单权限。

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
- K 线行情：沪深 A 股优先使用腾讯公开 K 线，北交所和美股优先使用东方财富公开 K 线，Yahoo 仅在价格口径一致时回退；A 股日 K 和月 K 保持前复权口径。分时为当日 1 分钟 K，五日为最近 5 个交易日的 5 分钟 K，日 K 最多保留近一年 250 根，月 K 最多保留近十年 120 根（上市时间不足时按实际交易历史显示）。
- 更新策略：交易时段约每 5 秒拉取一次并增量更新最新 K 线；休市和收盘后停止轮询，显示静态历史。图表链路不使用模拟回退，行情源失败时保留上一份真实数据并显示错误状态。
- 工作区状态：当前视图、市场、交易所、搜索条件、股票、移动端面板和 K 线周期会写入 URL；刷新、分享链接和浏览器前进/后退都能恢复当前个股上下文。
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

## 本地接口

- `GET /api/markets`
- `GET /api/data-hub`
- `GET /api/live/instruments?market=CN|US&exchange=XSHG&q=600519&page=1&pageSize=20`
- `GET /api/live/quotes?ids=CN:XSHG:600519,US:XNAS:NVDA`（最多 50 只）
- `GET /api/live/bars?ids=CN:XSHG:600519&period=intraday|five-day|daily|monthly`（最多 5 只）
- `GET /api/portfolio`
- `GET /api/strategies`
- `POST /api/sim/orders`
