/**
 * 国际版入口的离线回归（真实响应样本，零网络）。
 *
 * 样本来源：2026-10-27 从 cn.bing.com 抓到的 \`/search?q=…&ensearch=1\` 响应，
 * 放在 tests/fixtures/samples/international/ 下。它们锁住：
 *
 *   1. 国际版页面与国内版**同一套 SSR 结构**，生产解析器直接可用；
 *   2. 国际版外链大量包 ck/a，解析器的统一出口（resolveBingUrl）必须还原它；
 *   3. 界面语言恒为 en，而 PAA 的 Feed/Language 随查询语言变化。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { parseSearchPage } from '../../src/parse/index.ts'
import type { VideoPage } from '../../src/contract.ts'

/** 2026-10-27 12:00（样本抓取当天），固定基准 */
const NOW = new Date(2026, 9, 27, 12, 0, 0).getTime()

const DIR = 'tests/fixtures/samples/international'

function load(name: string): string {
    return readFileSync(DIR + '/' + name + '.html', 'utf8')
}

const HTML = {
    /** 动量定理：10 条主结果 + 3 条视频卡；视频/富卡片外链全是 ck/a */
    momentum: load('momentum'),
    /** Redis 持久化 RDB AOF 原理：中文 PAA 4 条 + gs 摘要 */
    redis: load('redis'),
    /** kubernetes pod scheduling：英文 PAA 4 条 */
    kubernetes: load('kubernetes'),
    /** 打铁花 非遗 起源：图片卡 10 张 + 纠错卡 */
    tiehua: load('tiehua'),
}

const PARSED = {
    momentum: parseSearchPage(HTML.momentum, NOW),
    redis: parseSearchPage(HTML.redis, NOW),
    kubernetes: parseSearchPage(HTML.kubernetes, NOW),
    tiehua: parseSearchPage(HTML.tiehua, NOW),
}

function assertNoRedirect(result: unknown): void {
    const hits = JSON.stringify(result).match(/bing\.com\/ck\/a/g) ?? []
    assert.equal(hits.length, 0, '解析结果里仍有 ck/a 链接')
}

describe('1. 页面结构与国内版同构', () => {
    it('动量定理：13 条结果 = 10 主结果 + 3 视频卡', () => {
        const r = PARSED.momentum
        assert.equal(r.pages.length, 13)
        // 10 条正文页里含 1 条 [PDF]（ustc 的「第三章 动量」），判别值是 pdf
        assert.equal(r.pages.filter(p => p.type === 'page').length, 9)
        assert.equal(r.pages.filter(p => p.type === 'pdf').length, 1)
        assert.equal(r.pages.filter(p => p.type === 'video').length, 3)
        assert.equal(r.relatedSearches.length, 8)
    })

    it('Redis：中文 PAA 4 条 + gs 摘要', () => {
        const r = PARSED.redis
        assert.equal(r.pages.length, 13)
        assert.equal(r.relatedQuestions.length, 4)
        assert.equal(r.relatedQuestions[0].question, 'Redis 可以持久化吗?')
        assert.equal(
            r.relatedQuestions[0].sourceUrl,
            'https://www.cnblogs.com/xiaokang-coding/articles/18531836'
        )
        assert.equal(r.overview?.kind, 'gs')
    })

    it('kubernetes：英文 PAA 4 条', () => {
        const r = PARSED.kubernetes
        assert.equal(r.pages.length, 10)
        assert.equal(r.relatedQuestions.length, 4)
        assert.equal(
            r.relatedQuestions[0].question,
            'What is Kubernetes scheduling?'
        )
        assert.equal(
            r.relatedQuestions[0].sourceUrl,
            'https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/'
        )
    })

    it('打铁花：图片卡 10 张 + 纠错卡（英文界面文案）', () => {
        const r = PARSED.tiehua
        assert.equal(r.images?.items.length, 10)
        assert.match(r.correct?.hint ?? '', /Including results for/)
        assert.equal(r.correct?.correctedQuery, '打铁 花 非 遗产 由来')
    })
})

describe('2. ck/a 链接在解析出口被还原', () => {
    it('样本里确实原本包着 ck/a（还原不是空转）', () => {
        assert.ok(HTML.momentum.includes('bing.com/ck/a'))
        assert.ok(HTML.tiehua.includes('bing.com/ck/a'))
    })

    it('动量定理：视频卡是 bilibili 直链', () => {
        const videos = PARSED.momentum.pages.filter(
            (p): p is VideoPage => p.type === 'video'
        )
        assert.equal(
            videos[0].url,
            'https://www.bilibili.com/video/BV1LAN16iELj/'
        )
        assert.ok(videos.every(v => v.url.startsWith('https://')))
    })

    it('动量定理：首条富卡片是百科页面', () => {
        const first = PARSED.momentum.pages[0]
        assert.equal(first.type, 'page')
        if (first.type !== 'page') return
        assert.ok(
            first.richContents?.rich?.url?.startsWith(
                'https://baike.baidu.com/item/'
            )
        )
    })

    it('打铁花：图片卡头指向 cn.bing.com 图片搜索', () => {
        assert.ok(
            PARSED.tiehua.images?.url?.startsWith(
                'https://cn.bing.com/images/search?'
            )
        )
    })

    it('四份样本的解析结果都没有 ck/a 残留', () => {
        for (const r of Object.values(PARSED)) assertNoRedirect(r)
    })
})

describe('3. 语言：界面恒英文，PAA 参数随查询语言', () => {
    it('英文查询的 AnswerFetcher 用 urlpostweben / en', () => {
        assert.match(HTML.kubernetes, /"urlpostweben","en"/)
    })

    it('中文查询的 AnswerFetcher 用 urlpostwebzhchs / zh_chs', () => {
        assert.match(HTML.redis, /"urlpostwebzhchs","zh_chs"/)
    })

    it('四份样本都是英文界面（lang=en、标题 - Search）', () => {
        for (const html of Object.values(HTML)) {
            assert.match(html, /<html[^>]*lang="en"/)
            assert.match(html, /- Search<\/title>/)
        }
    })
})
