# 项目地图

Bing 搜索逆向：用全局 `fetch` + HTML SSR 抓取 cn.bing.com 的搜索结果，零浏览器依赖。

## 四份文档

| 文档                               | 回答什么                                                 | 什么时候读             |
| ---------------------------------- | -------------------------------------------------------- | ---------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 数据怎么流、三条分层约束、传输与会话                     | 改代码之前             |
| [PROTOCOL.md](PROTOCOL.md)         | 请求怎么发：URL / 请求头 / cookie / rdr / PAA 接口       | 怀疑请求层出问题时     |
| [PARSING.md](PARSING.md)           | 页面怎么读：容器分流、字段选择器表、时间与文本化规则     | 加卡片或解析结果不对时 |
| [ENTRANCES.md](ENTRANCES.md)       | 国内版 vs 国际版：该默认哪个、分领域判据、文学题的天花板 | 改入口逻辑，或选入口时 |

契约字段、失败语义、安装与用法在 [README.md](../README.md)，那里是唯一出处。

## 最容易踩的坑

条目由 [AGENTS.md](../AGENTS.md) 的「最容易踩的坑」统一维护（唯一出处）。
这里只给每条的展开位置：

| 坑                       | 展开                                          |
| ------------------------ | --------------------------------------------- |
| URL 不能带 `first`       | [PROTOCOL.md](PROTOCOL.md)「绝不能带 first」  |
| `rdr=1` 依赖前置普通请求 | [PROTOCOL.md](PROTOCOL.md)「rdr 第二遍请求」  |
| 别用低降级率时段否定路径 | [PROTOCOL.md](PROTOCOL.md)「不要用低降级率…」 |

## 目录

```
src/
  index.ts      对外门面（只导出 searchByBing 与 SearchResult）
  entrance.ts   入口推测（显式优先，缺省按运行时区）
  contract.ts   实现侧契约类型（对外出处是 types/bing-search-reverse.d.ts）
  shape.ts      出口裁剪（includeRichContents / includeImages / includeVideos）
  protocol.ts   Bing 协议事实（零依赖叶子）
  search.ts     编排：两遍请求 + 重试 + PAA + 出口裁剪
  net/          发请求：session / headers / errors / gec / paa
  utils/        与 Bing 无关的工具：ua / time / url / collect
  parse/        解析层（纯函数，零 IO）
types/          手写的对外契约 bing-search-reverse.d.ts（README 指向它）
tests/          offline（零网络）/ live（需网络）/ fixtures（离线样本）
tools/          产出物脚本：capture-samples；构建 = `rollup -c`
docs/           架构 / 协议 / 解析 / 入口对比（就是上面四份）
sandbox/        本地研究沙盒（LLM 工具实验，不入库）
dist/           构建产物（`pnpm build`，不入库）
```

## 验收

命令与纪律见 [AGENTS.md](../AGENTS.md) 的「验收」（唯一出处）。
