/**
 * GEC 注入层单测（`tsx --test`，**不依赖网络、不启动浏览器**）。
 *
 * forge 是唯一来源，所以这里检验的是「窗口行为 + 版本头来源」。
 *
 * 关于「只有 Edge 才发 GEC」：这条不变量已经**不在运行时表达了**——
 * `gecHeaders` 只接收 `edgeVersion`，没有 UA 参数，也就不存在
 * 「Chrome UA 该不该注入」这个分支可以测。它由 `resolveUaProfile()`
 * 的唯一产物（Edge UA）保证，见 ua.test.ts。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { GEC_WINDOW_MS, gecHeaders, forgeGec } from '../../src/net/gec.ts'

/** 任意一个 300s 窗口内的固定时刻，避免测试跨窗口抖动 */
const BASE = 1_792_310_100_000

/** 一个合法的 `Edg/` 版本（与 UA 里的段同形） */
const EDGE_VERSION = '152.0.7328.133'

describe('gecHeaders（forge 唯一来源）', () => {
    it('产出两个头，值格式为 <16hex>-<64hex>', () => {
        const h = gecHeaders(EDGE_VERSION, BASE)
        assert.match(h['sec-ms-gec'], /^[0-9A-F]{16}-[0-9A-F]{64}$/)
        assert.equal(h['sec-ms-gec-version'], '2-' + EDGE_VERSION)
    })

    it('版本头以 2- 开头（1- 前缀会被 Bing 拒绝）', () => {
        assert.ok(
            gecHeaders(EDGE_VERSION, BASE)['sec-ms-gec-version'].startsWith(
                '2-'
            )
        )
    })

    it('版本头跟随传入的版本，而不是某个固定值', () => {
        for (const v of ['131.0.1.2', '155.0.4283.45', '160.0.9999.1'])
            assert.equal(
                gecHeaders(v, BASE)['sec-ms-gec-version'],
                '2-' + v,
                'gec-version 必须与调用方的 UA 版本一致'
            )
    })

    it('同一 300s 窗口内恒定', () => {
        const a = gecHeaders(EDGE_VERSION, BASE)
        const b = gecHeaders(EDGE_VERSION, BASE + 100_000)
        assert.equal(a['sec-ms-gec'], b['sec-ms-gec'])
    })

    it('跨窗口后变化', () => {
        const a = gecHeaders(EDGE_VERSION, BASE)
        const b = gecHeaders(EDGE_VERSION, BASE + GEC_WINDOW_MS)
        assert.notEqual(a['sec-ms-gec'], b['sec-ms-gec'])
    })

    it('同窗口内换版本 → 重新生成（缓存键含版本）', () => {
        const a = gecHeaders('131.0.1.2', BASE)
        const b = gecHeaders('160.0.9.9', BASE)
        assert.equal(b['sec-ms-gec-version'], '2-160.0.9.9')
        assert.notEqual(a['sec-ms-gec-version'], b['sec-ms-gec-version'])
    })

    it('与 forgeGec 直接计算结果一致', () => {
        assert.equal(
            gecHeaders(EDGE_VERSION, BASE)['sec-ms-gec'],
            forgeGec(BASE)
        )
    })

    it('返回的是副本，外部修改不会污染缓存', () => {
        const a = gecHeaders(EDGE_VERSION, BASE)
        a['sec-ms-gec'] = 'X'
        assert.notEqual(gecHeaders(EDGE_VERSION, BASE)['sec-ms-gec'], 'X')
    })
})

describe('forgeGec 稳定性', () => {
    it('同一窗口内任意时刻结果相同', () => {
        const w = Math.floor(BASE / GEC_WINDOW_MS) * GEC_WINDOW_MS
        assert.equal(forgeGec(w), forgeGec(w + GEC_WINDOW_MS - 1))
    })

    it('相邻窗口结果不同', () => {
        const w = Math.floor(BASE / GEC_WINDOW_MS) * GEC_WINDOW_MS
        assert.notEqual(forgeGec(w), forgeGec(w + GEC_WINDOW_MS))
    })
})
