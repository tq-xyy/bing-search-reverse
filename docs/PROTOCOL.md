# 请求形态

浏览器发什么，我们发什么。下面是**必须照做**的部分，以及**不要改**的理由。

## URL

```
https://cn.bing.com/search
  ?q=<encodeURIComponent(query)>
  &form=QBLH
  &sp=-1&lq=0
  &pq=<同 q>
  &sc=<字符数>-<词数>
  &qs=n&sk=&cvid=<32 位大写十六进制>
```

### ⚠️ 绝不能带 `first`

`first` 是分页参数（从第几条开始），但 Bing 以它的**存在**判定"这是翻页/后续请求"，
因而跳过首屏才有的答案卡与富化模块：

| URL              | 响应      | b_ans | AI Overview |
| ---------------- | --------- | ----- | ----------- |
| 无 first         | 407KB     | 77    | ✅          |
| first=1          | 107KB     | 0     | ❌          |
| first=0 / 2 / 空 | 105~107KB | 0     | ❌          |

三个词（经济应用数学基础 / Kubernetes Pod 调度 原理 / 民族团结法）全部复现。

⚠️ 注意：**结果条目本身仍然正确**（首条都对），丢掉的只有 AI Overview、
相关搜索、富化模块与响应体积。所以"结果看起来是对的"不能作为没踩坑的证据。

## 国际版入口（2026-10-27 逆向）

CN Bing 的搜索页右上角有「国内版 / 国际版」两个 div（#est_cn / #est_en）。
用 CDP 真实鼠标事件观察，点「国际版」发出的导航是：

    GET https://cn.bing.com/search?q=<q>&FORM=BESBTB&rdr=1&rdrig=<IG>&ensearch=1

结论：

- **唯一的内容开关是 ensearch=1**。去掉它返回中文界面（<html lang="zh">、
  标题 "… - 搜索"）；带上它返回英文界面（lang="en"、标题 "… - Search"），
  服务端还会把 SRCHHPGUSR 改写成 SRCHLANG=en&…&IG=<国际版 IG>。
- **页面结构完全同构**：li.b_algo / li.b_ans / #df_listaa / .b_paa_ansContainer
  与国内版逐一对应，解析器不需要分支。
- **rdr 不是必需**：直接 /search?q=…&ensearch=1 首遍即为填充页
  （8 个查询 320–532KB）。模块仍保留「首遍骨架 → rdr 兜底」的既有序列，
  第二遍自动带着 ensearch=1。
- **PAA 的 Feed/Language 随查询语言变化**：中文查询 urlpostwebzhchs / zh_chs，
  英文查询 urlpostweben / en。加载层本来就从页面 AnswerFetcher 提取，无需改。
- **外链形态不同**：国际版单页 40–66 处外链包着 /ck/a 跳转（国内版约 0~10%）。
  解析器**只有一个取链接出口**，统一做「ck/a 还原 + 相对补全」，
  包括解出的站内相对路径（/images/search?…）——这是国际版必须做的修复。
  细节与违规写法见 [ENTRANCES.md](ENTRANCES.md) §1.2。

会话握手**不区分入口**：继续用 getSession()（cn.bing.com/ 首页），
因为浏览器里点「国际版」也是从国内首页进去的。

入口选择：`searchByBing` 的 `bingEnterance` 参数（`cn` / `international`）。
不传时按运行时时区推测：中国大陆与港澳台时区 → `cn`，其余 → `international`。
这个推测只是缺省值，数据上并不成立——见 [ENTRANCES.md](ENTRANCES.md) §四。

## 请求头

最小集即可，完整 Edge 头与这套逐条等效：

```
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7
Accept-Encoding: gzip, deflate, br
Accept-Language: zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6
User-Agent: <Edge 形态，Chrome/Edg 同主版本，版本池 131/135/138/145/152/155/160>
```

补充：`cookie` 用会话的，`referer` 首遍是 `https://cn.bing.com/`、第二遍是首遍的 URL。

### `sec-ms-gec`：必需的准入令牌（可纯算法生成）

头形如 `sec-ms-gec: <16 位 hex>-<64 位 hex>`，**必须成对**带
`sec-ms-gec-version: 2-<Edge 版本>`。

| 形态                                | 第一遍响应         |
| ----------------------------------- | ------------------ |
| 官方新鲜 gec + `2-155.0.4283.45`    | **347–460KB 填充** |
| 不带 version / `1-` 前缀 / 无 gec   | 103KB 骨架         |
| gec + `2-999.0.0.0`（版本号不校验） | 413KB 填充         |
| 30 分钟前的 gec                     | 103KB 骨架         |

#### ✅ 已实现纯算法生成（2026-10-18 逆向完成）

算法（`forgeGec()`，纯函数、0.5ms、无浏览器无网络）：

```
payload = "Copyright (C) Microsoft Corporation. All rights reserved."
        + str(ticks) + "NO_SUBSCRIPTION"
ticks   = (unix + 11644473600) 按 300 取整 × 10^7
part2   = SHA256(payload)                                       → 64 hex
part1   = hex( hashA(u32(payload), u32(sha)) XOR hashB(同输入) ) → 16 hex
gec     = part1 + "-" + part2
```

- `hashA`/`hashB` 是 Edge 自带的 32 位混合哈希（`imul` + `rol 16` 链），常量已固定
- `u32(x)` = 字节串按 4 字节小端打包，**补齐到 8 字节边界**（元素数必须为偶数）
- 与浏览器同窗口的值**逐字节一致**，生成耗时 ~0.5ms
- 端到端实测：3 个查询首遍全部 355–456KB 填充，无需 rdr

因此**不需要任何浏览器**：生产路径只有一次 SHA-256 和两组位运算。

#### ⚠️ 无 gec 时不能指望 rdr 兜底

2026-10-18 深夜复测：无 gec 的三组查询第一遍 105–108KB 骨架，**rdr 第二遍也只回到
106–109KB**（早前记录的「12/12 补救」已不成立）。所以 gec 现在是**必需项**，
不是「省一次往返的优化项」。

#### ⚠️ 只对 Edge UA 生效

| UA                      | 带 gec | 第一遍                       |
| ----------------------- | ------ | ---------------------------- |
| Edge/131、145、155、160 | ✅     | **438–460KB 填充**           |
| Chrome/155              | ✅     | 105KB 骨架（**令牌被忽略**） |
| Chrome/155              | ❌     | 104KB 骨架                   |
| Edge/155                | ❌     | 105KB 骨架                   |

两点推论：

1. Bing 不能不给 Chrome 活路，所以「骨架页 + 客户端补渲染」是 Chrome 的通用回退路线；
   GEC 是 Edge 用户的捷径。
2. **我们也不能对 Chrome UA 发这个头**：现实中不存在这种组合，发出去反而是异常特征。
   这条不变量现在由**类型**保证而不是运行时判断：`gecHeaders(edgeVersion)` 只收
   版本号、没有 UA 参数；而 `resolveUaProfile()` 的唯一产物就是 Edge UA。

UA 主版本**不校验**（131~160 都能首遍填充），所以 `ua.ts` 的随机版本池没有风险。

#### 取值：纯算法，唯一来源；版本随 UA

```ts
const { ua, edgeVersion } = resolveUaProfile() // utils/ua.ts，单例
gecHeaders(edgeVersion) // → { sec-ms-gec, sec-ms-gec-version: '2-' + edgeVersion }
```

不再有采集器、缓存文件或环境变量覆盖。同一 300s 窗口内结果恒定（进程内缓存，
缓存键含版本）。`sec-ms-gec-version` **跟随 UA 里的 `Edg/` 版本**，不再钉死
`2-155.0.4283.45`——真实 Edge 的网络栈携带的是自己正在运行的版本，
固定 155 会与 UA（如 `Edg/152`）拼出现实中不存在的组合。

> 2026-10-24 实测：主版本池 131/135/138/145/152/155/160 逐版本配自身版本号，
> 全部首遍填充（383–393KB，含 `b_ans`）。Bing 本身不校验版本一致性
> （`2-999.0.0.0` 也填充），此处「跟随」纯粹为了形态自洽，代价为零。

跳过第二遍：首遍 ≥ 200KB 即视为填充页（骨架 100–110KB / 填充 350–480KB）。
带 `sec-ms-gec` 时首遍几乎总是填充页（实测 8/8 查询 343–477KB），因此第二遍
默认不执行，只作为首遍退化成骨架页时的兜底。

> 2026-10-24：`BING_NO_RDR` / `BING_FORCE_RDR` / `BING_UA` 三个环境变量已删除。
> 前两个关的都是「默认已经不走的路径」；`BING_UA` 更危险——它会换掉 UA 进而
> 让 `sec-ms-gec-version` 与 UA 版本脱节，把「版本错配」误归因成「Chrome UA 降级」。
> 库现在没有任何环境变量开关，行为完全由 `searchByBing(query, options)` 决定。

### UA 不是反爬变量

实测 Edge 与 Chrome UA 完全等效。真正决定"填充页 vs 骨架页"的是 **cookie 完整度**。

历史上曾把"Edge UA 导致降级"当作结论——那是错的：那次对照里 Edge 组恰好用了
精简 cookie，把 cookie 的问题误记到了 UA 头上。

## cookie

会话 cookie 由三部分组成：首页 `Set-Cookie` + 页面 JS 会设置的 cookie + 自造 HVE。

### HVE 是关键字段

页面 JS 在用户首次交互时把 `SRCHHPGUSR=HV=<时间戳秒>&HVE=<Salt>` 写进 cookie。
我们直接构造，跳过交互。`Salt` 的值就在首页 HTML 里（`Salt:"..."`）。

逐字段删除实验的结论：从浏览器完整 cookie（22 项）逐项删，
**只有删 `SRCHHPGUSR` 会从 438KB 崩到 101KB**；再对 `SRCHHPGUSR` 内部 18 字段逐个删，
**只有 `HVE` 是致命项**。

### 渲染窗口字段也必须补全

只有 `SRCHLANG`+`HV`+`HVE` 时仍是 104KB / b_ans=0。补上下面这些才是 392KB / b_ans=76：

```
PREFCOL=0  BRW=HTP  BRH=S  CW=756  CH=488  DPR=1  UTC=480
```

取值来自真实 Edge 抓包（756×488 视口 / DPR 1.0 / 东八区）。
服务端用它判断"这是一个真实渲染中的浏览器页面"。

### ⚠️ 必须合并进已有的 SRCHHPGUSR，不能追加同名项

首页 `Set-Cookie` 已含 `SRCHHPGUSR=SRCHLANG=zh-Hans`。若再追加一个
`SRCHHPGUSR=HV=..&HVE=..`，会产生**重复同名 cookie**，该形态实测会让单请求也降级
（HVE 事实上未被采纳）。

## rdr 第二遍请求

```
GET <第一遍的 URL>&rdr=1&rdrig=<IG>
```

这是拿到填充页（~400KB）而非骨架页（~100KB）的**决定性条件**。

### ⚠️ 必须以前置的普通请求为前提

| 形态                  | 填充页   |
| --------------------- | -------- |
| 三连单请求（无 rdr）  | 0/9      |
| 单请求 → rdr → rdr    | 9/9      |
| 单请求 → rdr → 单请求 | 骨/填/骨 |
| 两段（首遍 + rdr）    | 6/6      |
| 只发一次带 rdr=1      | 0/6      |

rdr 不是独立开关，它依赖"本会话刚发生过一次普通搜索"。**不能合并成一次请求。**

### ⚠️ 两遍之间必须合并第一遍的 Set-Cookie

第一遍普通请求的响应会**重新下发 6 条 cookie**，其中 `SRCHHPGUSR` 是服务端生成的
HV/HVE 形态。第二遍 `rdr=1` 只有带上这份新 cookie 才会返回填充页。

实测（2026-10-18，`Kubernetes Pod 调度 原理`）：

| 第二遍带的 cookie     | 体积        | brsv3 | b_ans |
| --------------------- | ----------- | ----- | ----- |
| 首页 cookie（旧）     | 107,889     | ✗     | 0     |
| 合并第一遍 Set-Cookie | **358,876** | ✓     | 65    |

浏览器会自动做这件事（cookie jar）；本库的 `Session` 用 `tough-cookie` 的 `CookieJar`
做同样的事（早期手写 http2 层曾**把 Set-Cookie 全丢了**），
所以在服务端开始下发新 `SRCHHPGUSR` 之后，富化模块整体消失（overview/related/videos/images 全空），
主结果却仍正常 —— 这会被误判成"CSR 改版"或"风控"。

### `rdrig` 的取值无关紧要

实测真值 / 首页值 / 伪造 / 跨会话 / 完全不带，均能拿到填充页。
用首页 `IG` 只是因为最方便、形态最自然，且不依赖首遍响应。
（现在优先用首遍响应里的 `IG`，退回首页值。）

### ⚠️ 不要用"低降级率时段"的结论否定它

历史上曾因在低骨架率时段测到"关闭 rdr 也 72/72 正常"而误判其冗余并删除，
随后在骨架高发期立刻回归。**无区分度基线上的对照没有任何证明力。**

## 骨架页 vs 填充页

|                     | 骨架页             | 填充页 |
| ------------------- | ------------------ | ------ |
| 体积                | ~100KB             | ~400KB |
| 主结果              | 有，且标题同样精准 | 有     |
| AI Overview         | 无                 | 有     |
| 相关搜索 / 富化卡片 | 无                 | 有     |

⚠️ **体积与 `b_algo` 计数都不能作为降级判据**——骨架页的结果条目本身是对的，
差异只在富化模块。本库不做降级检测（`status`/`fallbackQuery` 已在 2026-10-18 退役）。

## PAA 答案接口（2026-10-18 实测）

“其他用户还问了以下问题”的问题与来源 URL 在服务端 HTML 里；答案正文是
用户点击后由前端异步请求的。实现分两半：**请求**（POST 到 `/getanswerforclickedquestion`）与
**响应解析**（HTML 片段，不是 JSON）。接口 URL 的 IG 与 SFX 参数由搜索页 HTML 推出。

### 请求

```
POST https://cn.bing.com/getanswerforclickedquestion
  ?IG=<32hex>&IID=RelatedQnA-QnAAlsoAsk&SFX=<n>

content-type: application/x-www-form-urlencoded
body = JSON.stringify({
  Question: "<问题文本>",
  Feed: "urlpostwebzhchs",
  Language: "zh_chs",
  Url: "<.b_paa_ansContainer 的 data-url>"
})
```

- `IG` 来自搜索页 HTML（`IG:"<32hex>"`），与 rdr 的 `rdrig` 同源。
- `Feed`/`Language` 从页面内联脚本
  `new GetAnswerForClickedQuestion.AnswerFetcher("/getanswerforclickedquestion?...", "urlpostwebzhchs", "zh_chs", ...)`
  提取；缺省值就是这两个。
- `SFX` 是前端自增计数，从 1 开始；实测每条独立请求都可用。
- 必须带搜索页的 cookie 与 `referer`（cookie 由 `Session.request` 自动管理）。

### 响应

HTML 片段（不是 JSON）：

| 选择器              | 内容                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `.paa-txt`          | 答案正文（前端 clamp 到 5 行，但 DOM 文本完整）                                                        |
| `.paa-txt-continue` | “继续阅读”（不取）                                                                                     |
| `.paa-cit-card`     | 引用卡片；`.paa-cit-txt` 标题、`.paa-cit-attr-text` 站点、`.paa-cit-url` URL、`.paa-cit-logo img` 图标 |

答案正文**不要直抓 `data-url` 来源页**：百科对直抓返回 403，应走这个接口。
接口失败/超时按附加能力降级：只丢 `answer`，问题与来源 URL 保留。
