# 项目地图

Bing 搜索逆向：用全局 `fetch` + HTML SSR 抓取 cn.bing.com 的搜索结果，零浏览器依赖。

## 从这里开始

| 文档                               | 内容                                                             | 什么时候读                             |
| ---------------------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 模块划分、数据流、文件职责                                       | 改代码之前                             |
| [PROTOCOL.md](PROTOCOL.md)         | 请求形态：URL 参数 / 请求头 / cookie / HVE / rdr                 | 怀疑请求层出问题时                     |
| [PARSING.md](PARSING.md)           | 页面结构、CSS 选择器表、卡片形态                                 | 加卡片或解析结果不对时                 |
| [ENTRANCES.md](ENTRANCES.md)       | 国内版 vs 国际版：机制差别、检索质量、该默认哪个                 | 改入口逻辑，或决定某类查询走哪个入口时 |
| [FETCH-LIMITS.md](FETCH-LIMITS.md) | `web_fetch` 的能力边界：PDF 黑洞、切片兜底、上下文预算、成本结构 | 接下游、调成本、或怀疑抓取出问题时     |
| [decisions/](decisions/)           | 关键决策的来龙去脉（ADR）                                        | 想知道“为什么不能那么改”时             |
| [HISTORY.md](HISTORY.md)           | 实验史（压缩版：推翻清单 / 无影响清单 / 可复用结论）             | 想重做一个实验前，先看这里有没有做过   |

## 最容易踩的坑

条目与取舍由 [AGENTS.md](../AGENTS.md) 的「六条最容易踩的坑」统一维护（那里是唯一出处，
避免两处各写一版、改一处漏一处）。这里只给每条的展开位置：

| 坑                         | 展开                                                   |
| -------------------------- | ------------------------------------------------------ |
| URL 不能带 `first`         | [decisions/first-param.md](decisions/first-param.md)   |
| `rdr=1` 依赖前置普通请求   | [decisions/rdr-two-pass.md](decisions/rdr-two-pass.md) |
| 别用低降级率时段否定路径   | [HISTORY.md](HISTORY.md) §1                            |
| 国际版外链是 `ck/a` 跳转   | [ENTRANCES.md](ENTRANCES.md) §1.2                      |
| 第一遍 Set-Cookie 必须合并 | [PROTOCOL.md](PROTOCOL.md)「rdr 第二遍请求」           |
| 归因要看唯一变量           | [HISTORY.md](HISTORY.md) §1、§6                        |

## 目录

```
src/
  index.ts      对外门面
  contract.ts   对外契约（纯类型）
  shape.ts      出口裁剪
  protocol.ts   Bing 协议事实（零依赖叶子）
  search.ts     编排：两遍请求 + 重试 + PAA + 出口裁剪
  net/          发请求：session / headers / errors / gec / paa
  utils/        与 Bing 无关的工具：ua / time / url / collect
  parse/        解析层（纯函数，零 IO）：index / dom / algo / cards / video /
                overview / questions / correction / rich / paa-answer / urls
tests/          offline（零网络）/ live（需网络）/ fixtures（离线样本）
tools/          产出物脚本：capture-samples；构建 = `rollup -c`
docs/           架构 / 协议 / 解析 / 入口对比 / 抓取边界 / 决策 / 实验史
sandbox/        本地研究沙盒（LLM 工具实验，不入库）
dist/           构建产物（`pnpm build`，不入库）
```

每个文件「只做哪一件事」不在这里重复，见
[ARCHITECTURE.md](ARCHITECTURE.md) 的「模块职责」表（唯一出处）。

## 验收

```bash
pnpm test          # 全部：类型 + 离线 + 在线（含压测）≈ 15s。改完只跑这一条
pnpm test:offline  # 只有离线 ≈ 1.8s（改解析器时）
pnpm test:live     # 只有在线 ≈ 12s（改请求层时）
pnpm build         # dist/bing.js + dist/bing.d.ts
```

**没有第二套验收命令。** 历史上 `scripts/regression/` 下另有一套需要人工判断的哨兵，
已全部并入 `tests/`（见 [HISTORY.md](HISTORY.md) §7）。
