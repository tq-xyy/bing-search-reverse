/**
 * 离线样本的完整性哨兵（合并自 layout-check / attribute-check 的硬断言）
 *
 * 原两个脚本是「只观测不裁决」的仪表盘：打印一堆分布统计、永远 exit 0。
 * 没有人会去看那些输出，所以本文件只保留**两条真正会在代码坏掉时变红的断言**：
 *
 *   1. 样本目录存在且每个样本都能解析出结果流容器（items 非空）
 *      —— 防的是「目录改名 / 路径写错 / 解析器顶层选择器失效导致静默通过」；
 *   2. 有 date 的条目必须有 datePrecision
 *      —— 这是解析缺陷（date 与精度是成对产出的），不是服务端行为。
 *
 * 被丢弃的是统计输出：pages 条数分布、date 覆盖率、site 空值率、unknown 容器明细。
 * 它们随服务端漂移、没有 baseline，断言只会变成假警报。需要诊断时看失败信息。
 *
 * 原 scripts/regression/{layout,attribute}-check.ts 已删除。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, it } from 'node:test'

import { parseSearchPage } from '../../src/parse/index.ts'

/** 离线样本目录（每个目录下是服务端原始 HTML） */
const SAMPLE_DIRS = [
    'tests/fixtures/samples/cards',
    'tests/fixtures/samples/cards2',
    'tests/fixtures/samples/cards3',
    'tests/fixtures/samples/samples',
    'tests/fixtures/samples/international',
]

/** 读一个目录下所有 .html；目录不存在返回空数组 */
function htmlFiles(dir: string): string[] {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
        .filter(f => f.endsWith('.html'))
        .map(f => dir + '/' + f)
}

describe('离线样本完整性', () => {
    const all = SAMPLE_DIRS.flatMap(htmlFiles)

    it('样本目录存在且非空', () => {
        assert.ok(
            all.length > 0,
            '一个样本都没找到：检查 ' +
                SAMPLE_DIRS.join(' / ') +
                ' 是否被误删或改名'
        )
    })

    it('每个样本都能解析出结果流', () => {
        const empty = all
            .map(p => ({
                p,
                n: parseSearchPage(readFileSync(p, 'utf8')).pages.length,
            }))
            .filter(x => x.n === 0)
            .map(x => x.p + ' (pages=0)')
        assert.deepEqual(
            empty,
            [],
            '顶层选择器可能已失效（#b_results > li / .b_results_eml > li）'
        )
    })
})

describe('日期精度一致性', () => {
    const all = SAMPLE_DIRS.flatMap(htmlFiles)

    it('有 date 的条目必有 datePrecision', () => {
        const nowMs = new Date(2026, 9, 17, 12, 0, 0).getTime()
        const bad: string[] = []
        for (const p of all) {
            for (const page of parseSearchPage(readFileSync(p, 'utf8'), nowMs)
                .pages) {
                if ('date' in page && page.date && !page.datePrecision) {
                    bad.push(p + ': ' + page.date)
                }
                if ('time' in page && page.time && !page.timePrecision) {
                    bad.push(p + ': ' + page.time)
                }
            }
        }
        assert.deepEqual(bad, [], 'date 与精度必须成对产出')
    })
})
