/**
 * 离线解析器单测（node --test，不依赖网络）。
 *
 * 用 tests/fixtures/samples/cards/*.html 里固化的真实响应做回归 —— 这是唯一能在
 * 断网 / Bing 改版 / 骨架期都稳定运行的验证方式。
 *
 * 契约（2026-10-27 起）：pages 是 WebPage | PdfPage | VideoPage | NewsPage 的联合数组；
 * overview / relatedQuestions / relatedSearches 在顶层；images 也在顶层。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { parseSearchPage } from '../../src/parse/index.ts'
import { stripIcons, applyResultShape } from '../../src/shape.ts'
import type {
    WebPage,
    PdfPage,
    VideoPage,
    NewsPage,
    SearchResult,
} from '../../src/contract.ts'
import { parsePaaAnswer } from '../../src/parse/paa-answer.ts'
import { parse, hasClass } from '../../src/parse/dom.ts'
import { decodeBingRedirectUrl, resolveBingUrl } from '../../src/parse/urls.ts'
import { extractDatePrefix, parseDateTime } from '../../src/utils/time.ts'
import { readQueryParam } from '../../src/utils/url.ts'

const CARD_DIR = 'tests/fixtures/samples/cards'
/** 固定基准时刻，让相对时间的断言与运行当天无关 */
const NOW = new Date(2026, 9, 17, 12, 0, 0).getTime()

function load(slug: string): string {
    const p = CARD_DIR + '/' + slug + '.html'
    return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

const SLUGS = ['dsh', 'luotianyi', 'dsv41', 'xinzhisheng', 'distinguish']
const PAGES = new Map<string, ReturnType<typeof parseSearchPage>>()
for (const s of SLUGS) {
    const html = load(s)
    if (html) PAGES.set(s, parseSearchPage(html, NOW))
}

/** 按类型取条目（主结果断言不掺视频/资讯条目）。 */
function pagesOf<T extends SearchResult['pages'][number]>(
    slug: string,
    type: T['type']
): T[] {
    return (PAGES.get(slug)?.pages ?? []).filter(
        (p): p is T => p.type === type
    )
}

const web = (slug: string) => pagesOf<WebPage>(slug, 'page')
const videos = (slug: string) => pagesOf<VideoPage>(slug, 'video')
const news = (slug: string) => pagesOf<NewsPage>(slug, 'news')

/** 断言筛选结果为空（失败时打印是哪几条）。 */
function assertNone<T>(
    list: readonly T[],
    bad: (item: T) => boolean,
    show: (item: T) => unknown = item => item
): void {
    assert.deepEqual(list.filter(bad).map(show), [])
}

// ══════════════════════════════════════════════════════════════
describe('1. 日期前缀', () => {
    it('绝对日期 → 只到日（不再补 00:00），正文剥离干净', () => {
        assert.deepEqual(
            extractDatePrefix('2026年8月17日 · DSH WorkBuddy Connect', NOW),
            {
                date: '2026-08-17',
                datePrecision: 'day',
                rest: 'DSH WorkBuddy Connect',
            }
        )
    })

    it('连字符日期 → 只到日', () => {
        const dash = extractDatePrefix('2026-10-09 · some result', NOW)
        assert.equal(dash.date, '2026-10-09')
        assert.equal(dash.datePrecision, 'day')
    })

    it('相对时间 → day 精度且正文剥离干净', () => {
        assert.deepEqual(extractDatePrefix('6 天之前 · 阿里云百炼提供', NOW), {
            date: '2026-10-11',
            datePrecision: 'day',
            rest: '阿里云百炼提供',
        })
    })

    it('正文年份不误判且原样返回', () => {
        assert.deepEqual(
            extractDatePrefix('2010年由贵州赤水、福建泰宁', NOW),
            {
                rest: '2010年由贵州赤水、福建泰宁',
            }
        )
    })

    it('日期后缺分隔符不误判', () => {
        const noSep = extractDatePrefix('2026年8月17日 DSH', NOW)
        assert.equal(noSep.date, undefined)
    })

    // 表驱动：覆盖「前」/「之前」两种后缀、day/hour 两种精度、有无「前」字
    const PREFIXED: [prefix: string, date: string | undefined][] = [
        ['1 天前', '2026-10-16'],
        ['10 小时之前', '2026-10-17 02'],
        ['10 小时', undefined], // 缺「前」字的时长不算日期
    ]
    for (const [prefix, date] of PREFIXED) {
        it('"' + prefix + '" → ' + (date ?? '不识别'), () => {
            assert.equal(extractDatePrefix(prefix + ' · x', NOW).date, date)
        })
    }
})

describe('2. 相对时间换算（固定 nowMs）', () => {
    it('6 天 = 6×86400s，精度 day', () => {
        assert.deepEqual(parseDateTime('6 天之前', NOW), {
            value: '2026-10-11',
            precision: 'day',
        })
    })

    it('2 周之前 → day 精度', () => {
        assert.deepEqual(parseDateTime('2 周之前', NOW), {
            value: '2026-10-03',
            precision: 'day',
        })
    })

    it('4 个月 = 120 天 → day 精度', () => {
        assert.deepEqual(parseDateTime('4 个月之前', NOW), {
            value: '2026-06-19',
            precision: 'day',
        })
    })

    it('无法识别返回 undefined', () => {
        assert.equal(parseDateTime('昨天', NOW), undefined)
    })

    it('"8 小时" 时长 → hour 精度', () => {
        assert.deepEqual(
            parseDateTime('8 小时', NOW, { allowBareDuration: true }),
            {
                value: '2026-10-17 04',
                precision: 'hour',
            }
        )
    })

    it('时长形态默认不换算', () => {
        assert.equal(parseDateTime('8 小时', NOW), undefined)
    })

    // 「4 天」类裸时长只该在资讯卡路径（allowBareDuration）被换算
    it('"4 天" 裸时长（开启后）→ day 精度', () => {
        assert.deepEqual(
            parseDateTime('4 天', NOW, { allowBareDuration: true }),
            { value: '2026-10-13', precision: 'day' }
        )
    })
})

// ────────────────────────────────────────────────────────────────────────────
// 2b. 日期前缀：原始 HTML 实体形态（历史脚本可能直接喂未解码片段）
// ────────────────────────────────────────────────────────────────────────────
describe('2b. 日期前缀：原始 HTML 实体形态', () => {
    const SEP = '&ensp;&#0183;&ensp;'

    it('&ensp; / &#0183; 实体分隔符也能识别（八进制引用）', () => {
        assert.deepEqual(
            extractDatePrefix('6 天之前' + SEP + '正文内容', NOW),
            {
                date: '2026-10-11',
                datePrecision: 'day',
                rest: '正文内容',
            }
        )
    })

    it('连字符日期 + 实体分隔符', () => {
        assert.equal(
            extractDatePrefix('2026-09-20' + SEP + 'Laya 文档', NOW).date,
            '2026-09-20'
        )
    })

    it('非行首的相对时间不算日期', () => {
        assert.equal(
            extractDatePrefix('本文写于 3 天之前的那次发布', NOW).date,
            undefined
        )
    })
})

describe('3. URL 工具', () => {
    const CK_URL =
        'https://www.bing.com/ck/a?!&&p=x&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9wYXRo&ntb=1'

    it('ck/a 重定向解码', () => {
        assert.equal(decodeBingRedirectUrl(CK_URL), 'https://example.com/path')
    })

    it('非 ck/a 原样返回', () => {
        assert.equal(
            decodeBingRedirectUrl('https://example.com/x'),
            'https://example.com/x'
        )
    })

    it('站内相对链接补全', () => {
        assert.equal(
            resolveBingUrl('/images/search?q=x'),
            'https://cn.bing.com/images/search?q=x'
        )
    })

    it('协议相对补全', () => {
        assert.equal(
            resolveBingUrl('//cdn.example.com/a.png'),
            'https://cdn.example.com/a.png'
        )
    })

    it('仅解一层编码', () => {
        assert.equal(
            readQueryParam(
                'x?mediaurl=https%3A%2F%2Fa.com%2F%3Fq%3D1',
                'mediaurl'
            ),
            'https://a.com/?q=1'
        )
    })

    it('参数不存在返回 undefined', () => {
        assert.equal(readQueryParam('x?a=1', 'b'), undefined)
    })
})

describe('4. 主结果（type=page）', () => {
    const dated = web('luotianyi').filter(p => p.date)
    /** 富化结果（class 是多值 b_algo b_rc_gb_template）若被丢弃，这里就会是 undefined */
    const baike = web('luotianyi').find(p => /百度百科/.test(p.title))

    it('洛天依 10 条普通结果', () => {
        assert.equal(web('luotianyi').length, 10)
    })

    // class 是多值（b_algo b_rc_gb_template），不能用精确等值匹配
    it('富化结果未被丢弃（百度百科词条在列）', () => {
        assert.ok(baike, '未找到百度百科词条')
    })

    // 标题里的 <strong> 高亮不能被插入空格
    it('标题未被 <strong> 劈开', () => {
        assert.equal(baike?.title, '洛天依（中国内地女虚拟歌手）_百度百科')
    })

    it('标题无「空格 + 标点」痕迹', () => {
        assertNone(
            web('luotianyi'),
            p => /\s[（）、，《》]/.test(p.title),
            p => p.title.slice(0, 20)
        )
    })

    it('条目必有 title/url 且 url 是绝对地址', () => {
        assertNone(
            web('luotianyi'),
            p => !p.title || !/^https?:\/\//.test(p.url)
        )
    })

    it('site 取自 tptt（仅展示标签）', () => {
        assert.equal(baike?.site, '百度百科')
    })

    // 来源以 url 为准：site 只是展示名，能从 url 推出真实 host
    it('url 里含真实 host（无需额外字段）', () => {
        assert.match(baike?.url ?? '', /^https?:\/\/[^/]*baike\.baidu\.com\//)
    })

    it('date 一律带 datePrecision', () => {
        assert.deepEqual(
            dated.filter(p => !p.datePrecision).map(p => p.date),
            []
        )
    })

    it('day 精度不带时刻（不再补 00:00）', () => {
        const bad = dated.filter(
            p => p.datePrecision === 'day' && p.date!.length !== 10
        )
        assert.deepEqual(
            bad.map(p => p.date),
            []
        )
    })

    // snippet 不应残留**前缀形态**的日期（行首日期 + " · "）。
    it('snippet 无「行首日期 + ·」残留', () => {
        const bad = web('luotianyi').filter(p =>
            /^\d{4}年\d{1,2}月\d{1,2}日\s*·/.test(p.snippet ?? '')
        )
        assert.deepEqual(
            bad.map(p => p.snippet?.slice(0, 30)),
            []
        )
    })

    // date 必须与 datePrecision 自洽：day→10 位、hour→13 位、minute→16 位
    it('date 形状与精度自洽', () => {
        const bad = dated.filter(p => {
            const d = p.date!
            if (p.datePrecision === 'day')
                return !/^\d{4}-\d{2}-\d{2}$/.test(d)
            if (p.datePrecision === 'hour')
                return !/^\d{4}-\d{2}-\d{2} \d{2}$/.test(d)
            return !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(d)
        })
        assert.deepEqual(
            bad.map(p => p.date + '/' + p.datePrecision),
            []
        )
    })

    it('snippet 变体 b_lineclamp3 也被识别', () => {
        assert.ok(web('dsv41').filter(p => p.snippet).length >= 9)
    })

    it('每条普通结果都有站点图标（.cico.siteicon .rms_iac[data-src]）', () => {
        for (const slug of SLUGS) {
            for (const p of web(slug)) {
                assert.match(
                    p.favicon ?? '',
                    /^https?:\/\//,
                    slug + ' 的 ' + p.title.slice(0, 20) + ' 缺 favicon'
                )
            }
        }
    })

    it('洛天依的展开内容（b_rcGbMod）被解析', () => {
        const p = web('luotianyi').find(x => x.rich)
        assert.ok(p, '没有条目带 rich')
        assert.ok((p!.rich?.sections.length ?? 0) > 0)
        assert.ok(p!.rich!.sections.every(s => s.title || s.text))
        assert.match(p!.rich!.url ?? '', /^https?:\/\//)
    })

    it('普通条目没有 rich 时不伪造', () => {
        assert.equal(web('dsh').filter(p => p.rich).length, 0)
    })
})

describe('5. 相关搜索', () => {
    const dsh = PAGES.get('dsh')

    it('dsh 8 个词', () => {
        assert.equal(dsh?.relatedSearches.length, 8)
    })

    // 取的是可见容器 #brsv3（8 条），不是隐藏的 #inline_rs（6 条）
    it('取可见容器而非隐藏容器', () => {
        assert.ok((dsh?.relatedSearches.length ?? 0) > 6)
    })

    it('词内无「空格 + 标点」碎裂', () => {
        const bad = (dsh?.relatedSearches ?? []).filter(w =>
            /\s[.：:，,。]/.test(w)
        )
        assert.deepEqual(bad, [])
    })

    it('v4.1 未被拆成 "v4 . 1"', () => {
        const bad = (PAGES.get('dsv41')?.relatedSearches ?? []).filter(w =>
            /v4\s+\.\s+1/.test(w)
        )
        assert.deepEqual(bad, [])
    })

    it('无重复词', () => {
        const words = dsh?.relatedSearches ?? []
        assert.equal(new Set(words).size, words.length)
    })

    it('鑫质生产力无该模块时为空数组', () => {
        assert.equal(PAGES.get('xinzhisheng')?.relatedSearches.length, 0)
    })
})

describe('6. 视频（type=video 与 page.video）', () => {
    const v = videos('luotianyi')[0]

    it('洛天依视频卡展开 3 条', () => {
        assert.equal(videos('luotianyi').length, 3)
    })

    it('视频条目带卡头（标题/更多链接）', () => {
        assert.match(v?.card.title ?? '', /洛天依/)
        assert.ok(v?.card.moreUrl)
    })

    it('视频有 title/url', () => {
        assert.ok(v?.title)
        assert.match(v?.url ?? '', /^https?:\/\//)
    })

    it('视频有缩略图', () => {
        assert.match(v?.thumbnail ?? '', /^https?:\/\//)
    })

    it('视频有 duration', () => {
        assert.match(v?.duration ?? '', /^\d+:\d{2}(:\d{2})?$/)
    })

    it('视频有 site', () => {
        assert.equal(v?.site, 'bilibili')
    })

    it('视频有 uploader', () => {
        assert.ok(v?.uploader)
    })

    it('视频发布时间带精度', () => {
        assert.ok(v?.published)
        assert.ok(v?.publishedPrecision)
        if (v!.publishedPrecision === 'day')
            assert.match(v!.published!, /^\d{4}-\d{2}-\d{2}$/)
        else if (v!.publishedPrecision === 'hour')
            assert.match(v!.published!, /^\d{4}-\d{2}-\d{2} \d{2}$/)
        else assert.match(v!.published!, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    })

    // 内嵌形态：dsh 与 dsv41 没有视频卡，但主结果里内嵌了视频
    const inline = web('dsh').find(p => p.video)?.video

    it('dsh 没有视频卡', () => {
        assert.equal(videos('dsh').length, 0)
    })

    it('dsh 有内嵌视频', () => {
        assert.ok(inline)
        assert.equal(inline!.source, 'inline')
    })

    it('内嵌视频标题由所属 page 承载', () => {
        const p = web('dsh').find(x => x.video)
        assert.ok(p?.title && p.title.length > 5)
    })

    it('内嵌视频作者来自 b_factrow', () => {
        assert.ok(inline?.uploader)
    })

    it('内嵌视频播放量来自 b_factrow', () => {
        assert.ok((inline?.views ?? '').startsWith('查看次数'))
    })
})

describe('7. 资讯（type=news）', () => {
    // nscard_link 变体：早期实现整张卡漏掉
    it('dsv41 资讯 3 条（nscard_link 变体）', () => {
        assert.equal(news('dsv41').length, 3)
    })

    it('dsv41 资讯标题来自 nscard_caption', () => {
        const title = news('dsv41')[0]?.title ?? ''
        assert.ok(title.length > 5)
    })

    // 时间在 footer 末尾（"凤凰网科技 · 10 小时"），不能整串直接解析
    it('dsv41 资讯时间也换算（footer "来源 · N 小时" 形态 → hour 精度）', () => {
        const items = news('dsv41')
        assert.ok(items.length > 0)
        for (const n of items) {
            assert.match(n.time ?? '', /^\d{4}-\d{2}-\d{2} \d{2}$/)
            assert.equal(n.timePrecision, 'hour')
        }
    })

    const n0 = news('distinguish')[0]

    // nscjk_card_link 变体
    it('distinguish 资讯 5 条（nscjk 变体）', () => {
        assert.equal(news('distinguish').length, 5)
    })

    it('资讯有 source', () => {
        assert.ok(n0?.source)
    })

    it('资讯时间已换算且带 hour 精度', () => {
        assert.equal(n0?.time, '2026-10-17 04')
        assert.equal(n0?.timePrecision, 'hour')
    })

    it('资讯 url 是绝对地址', () => {
        assert.match(n0?.url ?? '', /^https?:\/\//)
    })

    it('资讯 snippet 非空', () => {
        assert.ok(n0?.snippet)
    })

    it('资讯 source logo（pubimg data-src-hq）被补全', () => {
        const withLogo = news('dsv41').find(n => n.logo)
        assert.ok(withLogo, '没有一条资讯带 logo')
        assert.match(withLogo!.logo!, /^https:\/\/www\.bing\.com\//)
    })
})

describe('8. 图片卡（顶层 images）', () => {
    const ly = PAGES.get('luotianyi')
    const i0 = ly?.images?.items[0]

    it('洛天依图片卡 10 张', () => {
        assert.equal(ly?.images?.items.length, 10)
    })

    it('卡头标题', () => {
        assert.match(ly?.images?.title ?? '', /图片/)
    })

    it('卡头有 url', () => {
        assert.match(ly?.images?.url ?? '', /^https?:\/\//)
    })

    it('有 moreUrl', () => {
        assert.match(ly?.images?.moreUrl ?? '', /^https?:\/\//)
    })

    it('缩略图是绝对 URL', () => {
        assert.match(i0?.thumbnailUrl ?? '', /^https?:\/\//)
    })

    it('不是 svg 图标', () => {
        assert.doesNotMatch(i0?.thumbnailUrl ?? '', /\.svg/)
    })

    it('有 title', () => {
        assert.ok(i0?.title)
    })

    it('detailUrl 是绝对地址', () => {
        assert.match(i0?.detailUrl ?? '', /^https?:\/\//)
    })

    it('有 mediaUrl（原图）', () => {
        assert.ok(i0?.mediaUrl)
    })

    it('有 originalWidth/Height', () => {
        assert.ok(i0?.originalWidth)
        assert.ok(i0?.originalHeight)
    })

    it('有 id（thid）', () => {
        assert.ok(i0?.id)
    })

    it('无重复缩略图', () => {
        const items = ly?.images?.items ?? []
        assert.equal(
            new Set(items.map(i => i.thumbnailUrl)).size,
            items.length
        )
    })

    // 其它样本不该凭空多出图片卡
    it('dsh 无图片卡', () => {
        assert.equal(PAGES.get('dsh')?.images, undefined)
    })
})

describe('9. 答案摘要（两套 DOM + kind）', () => {
    const dsh = PAGES.get('dsh')

    // cht 型
    it('dsh 有 cht 型摘要', () => {
        assert.ok(dsh?.overview)
        assert.equal(dsh?.overview?.kind, 'cht')
    })

    it('cht 摘要有多段正文', () => {
        assert.ok((dsh?.overview?.paragraphs.length ?? 0) >= 2)
    })

    it('cht 摘要有多条来源', () => {
        assert.ok((dsh?.overview?.sources.length ?? 0) >= 2)
    })

    it('来源 url 是绝对地址', () => {
        const bad = (dsh?.overview?.sources ?? []).filter(
            s => !/^https?:\/\//.test(s.url)
        )
        assert.deepEqual(bad, [])
    })

    it('来源 name 非空', () => {
        const bad = (dsh?.overview?.sources ?? []).filter(s => !s.name)
        assert.deepEqual(bad, [])
    })

    // gs 型：只支持 cht 时整张卡被判为"没有 overview"
    const dist = PAGES.get('distinguish')

    it('distinguish 有 gs 型摘要', () => {
        assert.ok(dist?.overview)
        assert.equal(dist?.overview?.kind, 'gs')
    })

    it('gs 摘要正文非空', () => {
        assert.ok((dist?.overview?.paragraphs.length ?? 0) > 0)
    })

    it('gs 摘要来源被去 # 片段', () => {
        assert.doesNotMatch(dist?.overview?.sources[0]?.url ?? '', /#/)
    })

    // 无答案卡的样本必须缺省（而非空壳对象）
    it('xinzhisheng 无摘要', () => {
        assert.equal(PAGES.get('xinzhisheng')?.overview, undefined)
    })

    it('overview 来源图标字段合法（有则 http）', () => {
        for (const slug of SLUGS) {
            for (const s of PAGES.get(slug)?.overview?.sources ?? []) {
                if (s.favicon) assert.match(s.favicon, /^https?:\/\//)
            }
        }
    })
})

const RICH_PATH = 'tests/fixtures/samples/samples/cht-rich.html'
const richHtml = existsSync(RICH_PATH) ? readFileSync(RICH_PATH, 'utf8') : ''

// 富样本：Bing 的答案卡把要点放在 ul>li、命令放在 pre>code。
describe(
    '9b. cht 摘要：列表 / 代码块 / 嵌套',
    { skip: !richHtml && '缺少 tests/fixtures/samples/samples/cht-rich.html' },
    () => {
        const rich = parseSearchPage(richHtml, NOW)
        const ps = rich.overview?.paragraphs ?? []

        it('引导句与列表合并（不残留孤立冒号段）', () => {
            const bad = ps.filter(p => /[：:]$/.test(p))
            assert.deepEqual(bad, [])
        })

        it('引导句后列表还原为 Markdown 项', () => {
            assert.ok(
                ps.some(
                    p =>
                        p.startsWith('✅ 适合：') &&
                        p.includes('\n- 单元测试补全')
                )
            )
        })

        it('有序列表还原为 1.', () => {
            assert.ok(ps.some(p => /(^|\n)1\. /.test(p)))
        })

        it('代码块还原为围栏（含命令）', () => {
            assert.ok(
                ps.some(
                    p => p.includes('```') && p.includes('/plugin install')
                )
            )
        })

        it('小节标题还原为 ##', () => {
            assert.ok(ps.some(p => p.startsWith('## 一、')))
        })

        it('首个 h2 不重复（已作为 title）', () => {
            assert.ok(
                !ps.some(p => p.includes('Ralph 循环（Ralph Loop）是一种'))
            )
        })

        it('代码块不含「复制」工具栏', () => {
            assert.ok(!ps.some(p => p.includes('复制')))
        })

        it('段落剥离不再清空来源站名', () => {
            const sources = rich.overview?.sources ?? []
            assert.ok(sources.length > 0)
            assert.deepEqual(
                sources.filter(s => !s.name),
                []
            )
        })

        // 嵌套 li>ul：父项文本曾被展平后与子项重复
        it('嵌套列表不重复父项文本', () => {
            const dup = (PAGES.get('dsh')?.overview?.paragraphs ?? []).filter(
                p => (p.match(/用量统计/g) ?? []).length > 1
            )
            assert.deepEqual(dup, [])
        })
    }
)

describe('10. 健壮性（不抛错）', () => {
    const cases = [
        '',
        '<html></html>',
        '<li class="b_algo">没闭合',
        '不是 HTML 的纯文本',
        '<div class="b_pag"></div>',
    ]

    it('空串/残缺 HTML 不抛错且字段合法', () => {
        for (const c of cases) {
            const r = parseSearchPage(c, NOW)
            assert.ok(
                Array.isArray(r.pages),
                'pages 不是数组: ' + c.slice(0, 20)
            )
            assert.ok(
                Array.isArray(r.relatedQuestions),
                'relatedQuestions 不是数组: ' + c.slice(0, 20)
            )
            assert.ok(
                Array.isArray(r.relatedSearches),
                'relatedSearches 不是数组: ' + c.slice(0, 20)
            )
        }
    })

    it('空页面 pages 为空数组', () => {
        assert.deepEqual(parseSearchPage('', NOW).pages, [])
    })

    // 可选模块的值是 undefined；relatedQuestions/relatedSearches 是空数组。
    it('空页面可选模块缺省', () => {
        const empty = parseSearchPage('', NOW)
        assert.equal(empty.overview, undefined)
        assert.equal(empty.images, undefined)
        assert.deepEqual(empty.relatedQuestions, [])
        assert.deepEqual(empty.relatedSearches, [])
    })
})

describe('11. 解析结果自洽性', () => {
    for (const [slug, page] of PAGES) {
        it('普通结果不超过 10 条 ' + slug, () => {
            assert.ok(web(slug).length <= 10)
        })

        it('普通结果无重复 url ' + slug, () => {
            const urls = web(slug).map(p => p.url)
            assert.equal(new Set(urls).size, urls.length)
        })

        it('pages 的 type 都是合法判别值 ' + slug, () => {
            const bad = page.pages.filter(
                p => !['page', 'pdf', 'video', 'news'].includes(p.type)
            )
            assert.deepEqual(bad, [])
        })
    }
})

// ────────────────────────────────────────────────────────────────────────────
// 12. 结果流容器枚举
// ────────────────────────────────────────────────────────────────────────────

/**
 * 容器枚举的断言都走 `parseSearchPage` 的**产出**，不再直接检查中间容器列表。
 *
 * 旧版检查的是 `collectLayout(doc).unknown`——一个生产代码从不读取、
 * 只为测试而存在的字段，而且它的判据（`h2 a` / `.b_caption` 等过宽特征）
 * 让哨兵恒绿。删掉 layout.ts 后，同一批保护改由「样本必须解析出结果」承担：
 * 容器枚举一旦失效（顶层选择器写错、Bing 改版），`pages` 会直接变空。
 */

const LAYOUT_FILES = [
    'cards/dsh.html',
    'cards/luotianyi.html',
    'cards/dsv41.html',
    'cards/xinzhisheng.html',
    'cards/distinguish.html',
    'cards2/周杰伦.html',
    'cards2/猫.html',
    'cards2/新质生产力和传统生产力的区别.html',
    'cards3/VCP.html',
    'cards3/决策树算法.html',
    'cards3/决策模型.html',
    'cards3/父母欠薪345万捧女儿出道.html',
    'cards3/苏轼.html',
    'cards3/北京天气.html',
    'cards3/什么是向量数据库.html',
    'cards3/Redis 持久化 RDB AOF 原理.html',
    'cards3/美元 人民币 汇率.html',
    'samples/cht-rich.html',
    'samples/browser-2nd-response.html',
    'samples/cdp-normal.html',
].map(f => 'tests/fixtures/samples/' + f)

describe('12. 结果流容器枚举', () => {
    for (const file of LAYOUT_FILES) {
        const html = existsSync(file) ? readFileSync(file, 'utf8') : ''
        it(
            '样本解析出结果流：' + file.split('/').pop(),
            { skip: !html && '缺少样本 ' + file },
            () => {
                const r = parseSearchPage(html, NOW)
                assert.ok(
                    r.pages.length > 0,
                    '容器枚举失效：顶层选择器可能已改版'
                )
            }
        )
    }

    it('无 #b_results 时回退到旧式 li.b_algo', () => {
        const html =
            '<html><body><ol><li class="b_algo"><h2><a href="https://x.example/a">t</a></h2></li></ol></body></html>'
        const r = parseSearchPage(html, NOW)
        assert.deepEqual(
            r.pages.map(p => p.type),
            ['page']
        )
    })

    it('视频卡容器不进入主结果', () => {
        // 视频卡容器里有 2 个 .btitle 的 h2 a，按内容特征会把它当主结果；
        // 这里锁住「按 class 分流」这个语义：视频卡必须产出 video 而非 page
        const r = parseSearchPage(load('luotianyi'), NOW)
        const videoContainers = r.pages.filter(p => p.type === 'video')
        assert.ok(videoContainers.length > 0, '视频卡没有产出 VideoPage')
        const duplicated = r.pages.filter(
            p => p.type === 'page' && /播放|视频/.test(p.title) && !p.snippet
        )
        assert.deepEqual(duplicated, [], '视频卡被当成了主结果')
    })

    it('dsv41 的资讯来自 b_topw（.b_results_eml）', () => {
        // 只枚举 #b_results 会漏掉 ol#b_topw.b_results_eml 里的资讯卡
        const r = parseSearchPage(load('dsv41'), NOW)
        assert.ok(
            r.pages.some(p => p.type === 'news'),
            '没有从 .b_results_eml 枚举到资讯'
        )
    })

    it('深链接/扩展链接兼容解析（构造用例）', () => {
        const html =
            '<html><body><ol id="b_results"><li class="b_algo b_vtl_deeplinks qbrs"><h2><a href="https://x.example/a">t</a></h2><div class="b_vlist2col b_deep"><a href="https://x.example/b">扩展一</a><a href="https://x.example/c">扩展二</a></div></li></ol></body></html>'
        const r = parseSearchPage(html, NOW)
        const p = r.pages.find(x => x.type === 'page') as WebPage
        assert.deepEqual(
            p.links?.map(l => l.title),
            ['扩展一', '扩展二']
        )
    })
})

// ────────────────────────────────────────────────────────────────────────────
// 13. 新组件样本（tests/fixtures/samples/cards3，2026-10-18 抓取）
// ────────────────────────────────────────────────────────────────────────────

const CARDS3 = 'tests/fixtures/samples/cards3'
const NEW_SLUGS = [
    'VCP',
    '决策树算法',
    '决策模型',
    '父母欠薪345万捧女儿出道',
    '苏轼',
    '北京天气',
    '什么是向量数据库',
    'Redis 持久化 RDB AOF 原理',
]
const NEW_PAGES = new Map<string, ReturnType<typeof parseSearchPage>>()
for (const s of NEW_SLUGS) {
    const p = CARDS3 + '/' + s + '.html'
    if (existsSync(p))
        NEW_PAGES.set(s, parseSearchPage(readFileSync(p, 'utf8'), NOW))
}
const NO_NEW =
    NEW_PAGES.size === 0 && '缺少 tests/fixtures/samples/cards3 样本'

function newWeb(slug: string): WebPage[] {
    return (NEW_PAGES.get(slug)?.pages ?? []).filter(
        (p): p is WebPage => p.type === 'page'
    )
}

describe('13. 新组件（cards3 样本）', { skip: NO_NEW }, () => {
    it('普通结果都有站点图标', () => {
        for (const [slug, r] of NEW_PAGES) {
            for (const p of r.pages) {
                if (p.type !== 'page') continue
                assert.match(
                    p.favicon ?? '',
                    /^https?:\/\//,
                    slug + ' 缺 favicon'
                )
            }
        }
    })

    it('PAA 问题与来源 URL', () => {
        for (const slug of [
            'VCP',
            '决策树算法',
            '什么是向量数据库',
            'Redis 持久化 RDB AOF 原理',
        ]) {
            const qs = NEW_PAGES.get(slug)?.relatedQuestions ?? []
            assert.ok(qs.length > 0, slug + ' 没有 relatedQuestions')
            for (const q of qs) {
                assert.ok(q.question)
                if (q.sourceUrl) assert.match(q.sourceUrl, /^https?:\/\//)
            }
        }
    })

    it('PAA 答案响应解析（.paa-txt / .paa-cit-card）', () => {
        const p = 'tests/fixtures/samples/paa/决策树算法.html'
        assert.ok(existsSync(p), '缺少 PAA 答案样本')
        const a = parsePaaAnswer(readFileSync(p, 'utf8'))
        assert.ok(a.answer && a.answer.length > 20)
        assert.ok((a.citations?.length ?? 0) > 0)
        assert.match(a.citations![0]!.url, /^https?:\/\//)
    })

    it('b_rcGbMod / b_richcard 富化被解析', () => {
        for (const slug of [
            '决策树算法',
            '苏轼',
            '决策模型',
            '什么是向量数据库',
        ]) {
            const pages = newWeb(slug)
            const rich = pages.find(p => p.rich)
            assert.ok(rich, slug + ' 没有 rich')
            assert.ok((rich!.rich?.sections.length ?? 0) > 0)
            assert.ok(rich!.rich!.sections.some(s => s.title || s.text))
        }
    })

    it('苏轼的图片侧边栏（b_imgcap_img）', () => {
        const pages = newWeb('苏轼').filter(p => p.sideImage)
        assert.equal(pages.length, 2)
        for (const p of pages) {
            assert.match(p.sideImage!.thumbnailUrl, /^https?:\/\//)
            assert.match(p.sideImage!.detailUrl ?? '', /^https?:\/\//)
            assert.ok((p.sideImage!.width ?? 0) > 0)
            assert.ok((p.sideImage!.height ?? 0) > 0)
        }
    })

    it('苏轼的图片卡仍在顶层（不进入 pages）', () => {
        const r = NEW_PAGES.get('苏轼')
        assert.ok((r?.images?.items.length ?? 0) > 0)
        assert.equal(
            r!.pages.filter(p => (p as { type: string }).type === 'images')
                .length,
            0
        )
    })

    it('深链接/扩展链接（VCP 的 b_vtl_deeplinks）', () => {
        const page = newWeb('VCP').find(p => p.links?.length)
        assert.ok(page, 'VCP 没有 links')
        assert.ok((page!.links!.length ?? 0) >= 3)
        for (const l of page!.links!) {
            assert.ok(l.title)
            assert.match(l.url, /^https?:\/\//)
        }
    })

    it('gs 摘要不再把正文强调词当标题', () => {
        const o = NEW_PAGES.get('父母欠薪345万捧女儿出道')?.overview
        assert.ok(o)
        assert.equal(o!.kind, 'gs')
        assert.notEqual(o!.title, '盛艾敬')
        assert.ok(o!.title.length > 10)
    })

    it('资讯在 pages 中逐条展开（决策模型/父母欠薪）', () => {
        for (const slug of ['决策模型', '父母欠薪345万捧女儿出道']) {
            const list =
                NEW_PAGES.get(slug)?.pages.filter(p => p.type === 'news') ?? []
            assert.equal(list.length, 5, slug + ' 资讯条数')
        }
    })
})

// ══════════════════════════════════════════════════════════════
describe('图标出口裁剪（stripIcons）', () => {
    it('剥掉 favicon / logo / 来源图标 / PAA 引用图标，核心字段不动', () => {
        const result: SearchResult = {
            pages: [
                {
                    type: 'page',
                    title: '标题',
                    url: 'https://example.com/a',
                    snippet: '摘要',
                    favicon: 'https://ts2.tc.mm.bing.net/th?id=fav',
                } satisfies WebPage,
                {
                    type: 'news',
                    title: '资讯',
                    url: 'https://example.com/n',
                    logo: 'https://www.bing.com/th?id=logo',
                    card: { title: '卡头' },
                } satisfies NewsPage,
            ],
            overview: {
                kind: 'cht',
                title: '摘要',
                paragraphs: ['正文'],
                sources: [
                    {
                        name: '来源',
                        url: 'https://example.com/s',
                        favicon: 'https://ts2.tc.mm.bing.net/th?id=src',
                    },
                ],
            },
            relatedQuestions: [
                {
                    question: '问题',
                    citations: [
                        {
                            url: 'https://example.com/c',
                            favicon: 'https://ts2.tc.mm.bing.net/th?id=cit',
                        },
                    ],
                },
            ],
            relatedSearches: ['相关搜索'],
        }

        stripIcons(result)

        assert.equal(
            result.pages[0].type === 'page' && result.pages[0].favicon,
            undefined,
            'favicon 应被剥离'
        )
        assert.equal(
            result.pages[1].type === 'news' && result.pages[1].logo,
            undefined,
            'logo 应被剥离'
        )
        assert.equal(result.overview!.sources[0].favicon, undefined)
        assert.ok(
            result.relatedQuestions[0].citations![0].favicon === undefined,
            'PAA 引用图标应被剥离'
        )
        assert.equal((result.pages[0] as WebPage).url, 'https://example.com/a')
        assert.equal((result.pages[0] as WebPage).title, '标题')
        assert.equal((result.pages[0] as WebPage).snippet, '摘要')
        assert.equal(result.relatedQuestions[0].question, '问题')
        assert.equal(result.relatedSearches[0], '相关搜索')
    })

    it('真实样本：解析层保留图标，剥离后消失且条数不变', () => {
        const html = load('dsh')
        assert.ok(html, '缺 dsh 样本')
        const result = parseSearchPage(html, NOW)
        assert.ok(
            result.pages.some(p => p.type === 'page' && p.favicon != null),
            '解析层应保留 favicon（裁剪只发生在出口）'
        )
        const count = result.pages.length
        stripIcons(result)
        assert.equal(
            result.pages.filter(p => p.type === 'page' && p.favicon != null)
                .length,
            0
        )
        assert.equal(result.pages.length, count)
        assert.ok(result.pages.every(p => p.title && p.url))
    })
})

// ══════════════════════════════════════════════════════════════
describe('出口裁剪（applyResultShape）', () => {
    it('默认：剥图标、去图片卡、去视频卡', () => {
        const html = load('luotianyi')
        assert.ok(html, '缺 luotianyi 样本')
        const full = parseSearchPage(html, NOW)
        assert.ok(full.images, '样本应带图片卡')
        const videoCount = full.pages.filter(p => p.type === 'video').length
        assert.equal(videoCount, 3, '样本应有 3 条视频卡')
        const total = full.pages.length

        // applyResultShape 是原地修改，必须在调用前记录条数
        const shaped = applyResultShape(full)
        assert.equal(shaped.images, undefined, '图片卡应被移除')
        assert.equal(
            shaped.pages.filter(p => p.type === 'video').length,
            0,
            '视频卡应被移除'
        )
        assert.equal(
            shaped.pages.filter(p => p.type === 'page' && p.favicon != null)
                .length,
            0,
            '图标应被剥离'
        )
        assert.equal(shaped.pages.length, total - videoCount)
        assert.ok(shaped.pages.every(p => p.title && p.url))
    })

    it('显式开启后三项都恢复', () => {
        const html = load('luotianyi')
        assert.ok(html)
        const r = applyResultShape(parseSearchPage(html, NOW), {
            includeIcons: true,
            includeImages: true,
            includeVideos: true,
        })
        assert.ok(r.images, '图片卡应恢复')
        assert.equal(r.pages.filter(p => p.type === 'video').length, 3)
        assert.ok(
            r.pages.some(p => p.type === 'page' && p.favicon != null),
            '图标应恢复'
        )
    })
})

// ────────────────────────────────────────────────────────────────────────────
// 13. 词条卡 / 汇率卡 / 特殊查询（cards4，2026-10-24 抓取）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 这一组样本的共同点：首屏顶部有一张**我们不解析的卡片**。
 *
 * 词条卡（compromise）与汇率卡（美元对人民币汇率）都是 `li.b_ans.b_top`，
 * 内部是 `common-module-*` / `fin_*` 那套 DOM，没有 `h2 a` 也没有 `.tptt`。
 * 因此它们天然不会被 `extractWebDigest` 当主结果收走——要锁住的正是这条性质：
 * **新卡片类型出现时，主结果集不能多一条也不能少一条。**
 */
describe('13. 词条卡与特殊查询（cards4）', () => {
    const DIR4 = 'tests/fixtures/samples/cards4'
    /** 与 cards4/README.md 的抓取时刻一致 */
    const NOW4 = new Date(2026, 9, 24, 18, 41).getTime()

    const load4 = (name: string): string => {
        const p = DIR4 + '/' + name + '.html'
        return existsSync(p) ? readFileSync(p, 'utf8') : ''
    }
    const parse4 = (
        name: string
    ): ReturnType<typeof parseSearchPage> | null => {
        const html = load4(name)
        return html ? parseSearchPage(html, NOW4) : null
    }

    describe('词条卡（compromise）', () => {
        const r = parse4('compromise')

        it('主结果仍是 10 条，词条卡没有挤占', t => {
            if (!r) return t.skip('缺少样本')
            assert.equal(r.pages.length, 10)
            assert.ok(r.pages.every(p => p.type === 'page'))
        })

        it('词条卡不被当成主结果（卡内没有 h2 a / .tptt）', t => {
            if (!r) return t.skip('缺少样本')
            for (const p of r.pages) {
                assert.ok(p.url.startsWith('http'), '每条都必须有真实 URL')
                assert.ok(p.title.trim(), '每条都必须有标题')
                // 词条卡没有 h2 a，它的释义文本（"n. 妥协；折衷"）与词性行
                // 因此不会成为任何结果的标题
                assert.ok(
                    !/^[a-z]+\.\s/.test(p.title),
                    '词性行不得成为结果标题: ' + p.title
                )
            }
        })

        it('主结果里可以出现 bing 词典页（那是真实 b_algo，不是词条卡）', t => {
            if (!r) return t.skip('缺少样本')
            // 区分点：bing.com/dict 作为**主结果**由 h2 a 承载，有标题有 URL；
            // 词条卡则是 b_ans 容器、无 h2 a。两者不能混为一谈。
            for (const p of r.pages.filter(x =>
                x.url.includes('bing.com/dict')
            ))
                assert.ok(p.title.length > 0)
        })

        it('词典类查询仍返回相关搜索', t => {
            if (!r) return t.skip('缺少样本')
            assert.ok(r.relatedSearches.length > 0)
        })

        it('正常查询没有 correct 字段（纠错块只在打错字时出现）', t => {
            if (!r) return t.skip('缺少样本')
            assert.equal(r.correct, undefined)
        })
    })

    describe('汇率卡（美元对人民币汇率）', () => {
        const r = parse4('美元对人民币汇率')

        it('主结果 10 条，汇率卡没有挤占', t => {
            if (!r) return t.skip('缺少样本')
            assert.equal(r.pages.length, 10)
        })

        it('AI Overview 仍产出（汇率卡与 overview 是两个容器）', t => {
            if (!r) return t.skip('缺少样本')
            assert.ok(r.overview, '应解析出 overview')
            assert.equal(r.overview.kind, 'cht')
            assert.ok(r.overview.paragraphs.length > 0)
        })

        it('overview 里的汇率数字是文本，不是结构化字段', t => {
            if (!r) return t.skip('缺少样本')
            // 断言的是「我们没有伪造汇率字段」：overview 是纯文本段落
            const all = r.overview!.paragraphs.join('\n')
            assert.match(all, /\d+\.\d{3,}/, '应含小数形式的汇率')
        })

        it('PAA 问题与来源都能解析（答案正文由搜索层加载）', t => {
            if (!r) return t.skip('缺少样本')
            assert.equal(r.relatedQuestions.length, 3)
            for (const q of r.relatedQuestions) {
                assert.ok(q.question.length > 0)
                assert.ok(
                    q.sourceUrl?.startsWith('http'),
                    '每条 PAA 都带来源 URL'
                )
                // 离线解析层不加载答案：answer 必须缺省
                assert.equal(q.answer, undefined)
            }
        })

        it('小时精度的时间戳不补分钟位', t => {
            if (!r) return t.skip('缺少样本')
            const hourly = r.pages.filter(
                (p): p is WebPage =>
                    p.type === 'page' && p.datePrecision === 'hour'
            )
            assert.ok(hourly.length > 0, '该查询有「N 小时前」条目')
            for (const p of hourly) {
                assert.equal(p.date!.length, 13, 'hour 精度必须是 13 位')
                assert.ok(!/\d{2}:\d{2}$/.test(p.date!), '不得伪造分钟')
            }
        })
    })

    describe('模糊歌词（我给你唱一曲 如游丝的气息）', () => {
        const r = parse4('青衣 歌词')

        it('视频卡与主结果共存，类型顺序正确', t => {
            if (!r) return t.skip('缺少样本')
            const types = r.pages.map(p => p.type)
            assert.equal(types.filter(x => x === 'video').length, 3)
            // 视频卡在文档里排在主结果之前
            assert.equal(
                types.indexOf('page') > types.lastIndexOf('video'),
                true
            )
        })

        it('视频卡的时间字段成对出现且按 day 截断', t => {
            if (!r) return t.skip('缺少样本')
            for (const p of r.pages) {
                if (p.type !== 'video') continue
                assert.ok(p.duration, '视频必须有 duration')
                if (p.published) {
                    assert.equal(p.publishedPrecision, 'day')
                    assert.equal(p.published.length, 10)
                }
            }
        })

        it('内嵌视频不单独成条（作为 WebPage.video）', t => {
            if (!r) return t.skip('缺少样本')
            const inline = r.pages.filter(
                p => p.type === 'page' && p.video != null
            )
            assert.ok(inline.length > 0, '该查询有内嵌视频富摘要')
            for (const p of inline) {
                if (p.type !== 'page' || !p.video) continue
                assert.equal(p.video.source, 'inline')
            }
        })

        it('歌词查询没有相关搜索（长 query 正常为 0）', t => {
            if (!r) return t.skip('缺少样本')
            assert.equal(r.relatedSearches.length, 0)
        })
    })

    describe('错别字纠错卡（Pyton socket）', () => {
        const r = parse4('Pyton socket')

        it('wpt 卡里的主结果被收录，且不重复', t => {
            if (!r) return t.skip('缺少样本')
            // wpt 卡（li.b_ans）里带 .b_tpcn 来源行的块是主结果；
            // 卡内 AI 摘要/视频/相关搜索块不是结果，不得计入
            assert.equal(r.pages.length, 10)
            const bossfrank = r.pages.filter(p => p.url.includes('Bossfrank'))
            assert.equal(bossfrank.length, 1, '纠错卡里的主结果应恰好一条')
            assert.equal(bossfrank[0]!.type, 'page')
            // wpt 结果排在主结果之前（它在文档里位于 #b_results 之前）
            assert.equal(r.pages[0]!.url.includes('Bossfrank'), true)
        })

        it('correct.hint 是两段原文拼接（单段读起来像正常结果页）', t => {
            if (!r) return t.skip('缺少样本')
            const c = r.correct
            assert.ok(c, '应存在 correct 字段')
            // 样本是旧文案版本；新版是「以下是…改为搜索…?」。
            // 断言的是**结构**：两段都进来、按文档顺序、不加分隔符。
            assert.equal(
                c.hint,
                '包含 Python socket 的结果。是否只需要 Pyton socket 的结果?'
            )
            // 后段才是"搜索错了"的信号：缺了它，前段读起来像正常结果标题
            assert.match(c.hint, /是否只需要|改为搜索/)
        })

        it('correct.correctedQuery 是 Bing 建议改搜的词', t => {
            if (!r) return t.skip('缺少样本')
            const c = r.correct
            if (!c) return t.skip('缺少 correct 字段')
            assert.equal(c.correctedQuery, 'Python socket')
            // 字段集合锁死：多一个字段就是契约变更
            assert.deepEqual(Object.keys(c).sort(), ['correctedQuery', 'hint'])
        })

        it('错别字查询仍有相关搜索（Bing 已纠错）', t => {
            if (!r) return t.skip('缺少样本')
            assert.equal(r.relatedSearches.length, 8)
        })

        it('新版文案（以下是…/改为搜索…?）同样解析', () => {
            // 文案是灰度可变的：2026-10-24 当天同一查询先后见过两套。
            // 解析器只认结构（两个 .b_promtxt），不认字面——这条用例锁住它。
            const html =
                '<html><body><ol id="b_results"><li class="b_ans">' +
                '<div class="b_promtxt sp_requery">以下是 ' +
                '<a href="/search?q=Python+socket&amp;FORM=AWRE">Python socket</a>' +
                ' 的结果。</div>' +
                '<div class="b_promtxt sp_recourse">改为搜索 ' +
                '<a href="/search?q=Pyton+socket">Pyton socket</a>?</div>' +
                '</li></ol></body></html>'
            const res = parseSearchPage(html, NOW4)
            assert.ok(res.correct, '新版文案也应解析出 correct')
            assert.equal(
                res.correct.hint,
                '以下是 Python socket 的结果。改为搜索 Pyton socket?'
            )
            assert.equal(res.correct.correctedQuery, 'Python socket')
        })

        it('缺后段时不补字（结构残缺就只给前段）', () => {
            const html =
                '<html><body><ol id="b_results"><li class="b_ans">' +
                '<div class="b_promtxt sp_requery">以下是 ' +
                '<a href="/search?q=Python+socket">Python socket</a> 的结果。</div>' +
                '</li></ol></body></html>'
            const res = parseSearchPage(html, NOW4)
            assert.equal(res.correct?.hint, '以下是 Python socket 的结果。')
        })

        it('没有纠正词链接时不算纠错', () => {
            const html =
                '<html><body><ol id="b_results"><li class="b_ans">' +
                '<div class="b_promtxt sp_requery">以下是 的结果。</div>' +
                '</li></ol></body></html>'
            const res = parseSearchPage(html, NOW4)
            assert.equal(res.correct, undefined)
        })
    })
})

// ────────────────────────────────────────────────────────────────────────────
// 17. 文档型主结果（type:'pdf'，2026-10-27）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 判别依据只有一条：Bing 在标题上方下发的 `.sb_doct_txt` 标记。
 *
 * 为什么不看 URL 后缀：我们是 Bing 的封装，Bing 打什么标就信什么标。
 * 现有样本里标记与 `.pdf` 后缀 3/3 重合（ck/a 包裹的那条离线解开的也是 .pdf），
 * 两条信号互相印证、无法互相证伪——这组用例锁的是「标记决定 type」这个语义。
 */
describe('17. 文档型主结果（type:pdf）', () => {
    const pdfOf = (r: ReturnType<typeof parseSearchPage>) =>
        r.pages.filter((p): p is PdfPage => p.type === 'pdf')

    it('xinzhisheng：两条报纸版面 PDF 被单独定型', () => {
        const r = PAGES.get('xinzhisheng')
        assert.ok(r)
        const pdfs = pdfOf(r)
        assert.equal(pdfs.length, 2)
        assert.ok(
            pdfs.every(p => p.url.endsWith('.pdf')),
            '这两条本来就是 PDF'
        )
        for (const p of pdfs) {
            assert.ok(p.title.trim(), '标题不得混入 [PDF] 标记')
            assert.equal(p.title.includes('[PDF]'), false)
            assert.ok(p.date && p.datePrecision, 'date 与精度必须成对')
        }
    })

    it('决策树算法：清华大学出版社的 PDF 讲义', () => {
        const r = NEW_PAGES.get('决策树算法')
        assert.ok(r)
        const pdfs = pdfOf(r)
        assert.equal(pdfs.length, 1)
        assert.equal(
            pdfs[0]!.url,
            'https://www.tup.tsinghua.edu.cn/upload/books/yz/090631-01.pdf'
        )
        assert.equal(pdfs[0]!.site, '清华大学出版社')
    })

    it('没有标记的页面一律还是 page（不按 URL 猜）', () => {
        const p = 'tests/fixtures/samples/cards4/compromise.html'
        if (!existsSync(p)) return
        const r = parseSearchPage(readFileSync(p, 'utf8'), NOW)
        assert.equal(pdfOf(r).length, 0)
        assert.ok(r.pages.every(x => x.type === 'page'))
    })

    it('HTML 页面里聊 PDF 不算文档型', () => {
        // 真实样本没有这种形态，用构造页锁住语义：没有 .sb_doct_txt 就是 page
        const html =
            '<html><body><ol id="b_results"><li class="b_algo">' +
            '<h2><a href="https://example.com/how-to-export-pdf">如何导出 PDF</a></h2>' +
            '<div class="b_caption"><p class="b_lineclamp2">PDF 导出教程</p></div>' +
            '</li></ol></body></html>'
        const r = parseSearchPage(html, NOW)
        assert.deepEqual(
            r.pages.map(p => p.type),
            ['page']
        )
    })

    it('标记在但 URL 不是 .pdf，仍然判成 pdf（标记说了算）', () => {
        const html =
            '<html><body><ol id="b_results"><li class="b_algo">' +
            '<div class="b_title"><span class="sb_doct_txt">[PDF]</span>' +
            '<h2><a href="https://example.com/serve?id=42">文档下载</a></h2></div>' +
            '<div class="b_caption"><p class="b_lineclamp2">摘要正文</p></div>' +
            '</li></ol></body></html>'
        const r = parseSearchPage(html, NOW)
        assert.deepEqual(
            r.pages.map(p => p.type),
            ['pdf']
        )
    })

    it('标记 class 是多值的，b_float 变体同样识别', () => {
        // 国际版就是 `sb_doct_txt b_float`；按类名匹配，不按 class 串等值
        const html =
            '<html><body><ol id="b_results"><li class="b_algo">' +
            '<div class="b_title"><span class="sb_doct_txt b_float">[PDF]</span>' +
            '<h2><a href="https://example.com/x.pdf">文档</a></h2></div>' +
            '</li></ol></body></html>'
        const r = parseSearchPage(html, NOW)
        assert.deepEqual(
            r.pages.map(p => p.type),
            ['pdf']
        )
    })

    it('没见过的标记（[DOC]）不建类型，退回 page（不猜）', () => {
        const html =
            '<html><body><ol id="b_results"><li class="b_algo">' +
            '<div class="b_title"><span class="sb_doct_txt">[DOC]</span>' +
            '<h2><a href="https://example.com/x.doc">文档</a></h2></div>' +
            '</li></ol></body></html>'
        const r = parseSearchPage(html, NOW)
        assert.deepEqual(
            r.pages.map(p => p.type),
            ['page']
        )
    })

    it('出口裁剪对 pdf 同样生效（favicon 默认剥离）', () => {
        const r = PAGES.get('xinzhisheng')
        assert.ok(r)
        const full = structuredClone(r)
        assert.ok(
            pdfOf(full).every(p => p.favicon),
            '解析层应保留 pdf 的 favicon'
        )
        const shaped = applyResultShape(full)
        assert.deepEqual(
            shaped.pages
                .filter(p => 'favicon' in p && p.favicon != null)
                .map(p => p.type),
            [],
            'pdf 的 favicon 漏剥 = shape 里按 type 分派漏了分支'
        )
        // pdf 不参与任何裁剪：条数不变
        assert.equal(pdfOf(shaped).length, pdfOf(r).length)
    })
})
