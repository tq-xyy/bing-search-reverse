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
| [decisions/](decisions/)           | 关键决策的来龙去脉（ADR）                                        | 想知道"为什么不能那么改"时             |
| [HISTORY.md](HISTORY.md)           | 实验史（压缩版：推翻清单 / 无影响清单 / 可复用结论）             | 想重做一个实验前，先看这里有没有做过   |

## 四条最容易踩的坑

1. **URL 里不能带 `first` 参数** —— Bing 以它的存在判定"这是翻页请求"，
   因而跳过首屏才有的答案卡与富化模块。见 [decisions/first-param.md](decisions/first-param.md)。
2. **`rdr=1` 必须以前置的普通请求为前提** —— 两段 6/6 填充，单段 0/6 全骨架。
   见 [decisions/rdr-two-pass.md](decisions/rdr-two-pass.md)。
3. **不要用"低降级率时段"的结论否定这条路径** —— 那是无区分度基线，
   历史上因此误删过 rdr。
4. **国际版的外链几乎全是 `ck/a` 跳转**（国内版约 0~10%）。解析器**只有一个取链接出口**，
   别在字段处自己拼相对地址补全——那样国际版的视频卡、图片卡、富卡片全会漏解。
   详见 [ENTRANCES.md](ENTRANCES.md) §1.2。

## 目录

```
src/
  index.ts          对外门面：searchByBing + SearchOptions / SearchResult（入口按时区选择）
  contract.ts       对外契约：SearchResult / SearchOptions 及其引用的全部类型
  shape.ts          出口裁剪：ResultShape / stripIcons / applyResultShape
  protocol.ts       Bing 协议事实：站点基址 / IG·Salt·AnswerFetcher 正则 / 搜索与接口 URL / 入口（cn·international）
  search.ts         编排：两遍请求 + 重试 + PAA + 出口裁剪（两个入口共用）
  net/              发请求
    session.ts      会话：CookieJar / 会话内请求 / HVE 与渲染窗口合成 / single-flight
    headers.ts      基线请求头（UA + Accept 系列 + sec-ms-gec，版本取自 UA）
    errors.ts       错误模型：白名单状态码 / fetch 异常归一 / 退避
    gec.ts          sec-ms-gec 纯算法生成（逆向自 msedge.dll，0.5ms；版本由调用方给）
    paa.ts          PAA 答案正文加载（附加能力）
  utils/            与 Bing 无关的通用工具（叶子，互不依赖）
    ua.ts           UA 生成
    time.ts         日期前缀 / 相对时间
    url.ts          查询参数提取 / 相对地址绝对化
    collect.ts      通用去重收集（seen + 上限）
  parse/            解析层（纯函数，零 IO）
    index.ts        整页解析入口：容器枚举 + 卡片循环 + 全局字段
    dom.ts          DOM 取值与文本化（块级补空格 / 跳过 script·style / 可按子树跳过）
    algo.ts         主结果 li.b_algo + wpt 网格主结果
    cards.ts        相关搜索 / 资讯 / 图片
    video.ts        视频卡 + 内嵌视频
    overview.ts     AI 答案摘要（cht / gs 两套 DOM）
    questions.ts    PAA 问题与来源 URL
    rich.ts         单条结果展开（b_rcGbMod / b_richcard）
    paa-answer.ts   PAA 答案响应解析
    urls.ts         Bing 链接统一出口 resolveBingUrl（ck/a 解码 + 相对补全，幂等）与资产 URL
tests/              全部测试（scripts/ 下不再有测试）
  offline/          零网络：解析器 / GEC / UA / 样本完整性
  live/             需网络：端到端契约 / 请求形态 / 会话层 / 压测
  fixtures/         离线样本（真实响应 HTML）+ 子进程 fixture
tools/              产出物脚本：capture-samples；构建 = `rollup -c`
docs/               架构 / 协议 / 解析 / 决策 / 实验史
dist/               构建产物（`pnpm build`）
only_for_develop_fast_test.ts   手测入口
```

## 验收

```bash
pnpm test          # 全部：类型 + 离线 + 在线（含压测）≈ 15s。改完只跑这一条
pnpm test:offline  # 只有离线 ≈ 1.8s（改解析器时）
pnpm test:live     # 只有在线 ≈ 12s（改请求层时）
pnpm build         # dist/bing.js + dist/bing.d.ts
```

**没有第二套验收命令。** 历史上 `scripts/regression/` 下另有一套需要人工判断的哨兵，
已全部并入 `tests/`（见 [HISTORY.md](HISTORY.md) §7）。
