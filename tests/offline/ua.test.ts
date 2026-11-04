/**
 * UA 生成层的离线单测（原 scripts/regression/ua-random-check.ts）
 *
 * 验证的是「生产 UA 的形态、单例性，以及它与其他头的同源关系」：
 *   1. 同进程多次 resolveUaProfile() 恒定 —— fetch 头里各字段必须同源；
 *   2. 形态合法：Chrome 段与 Edg 段各为 4 段完整版本；
 *   3. 不携带零补丁伪造特征，也不撞已知黑名单串；
 *   4. **`edgeVersion` 就是 UA 串里的那个 `Edg/` 版本** ——
 *      `sec-ms-gec-version` 直接用它，两边不一致就拼出现实中不存在的组合。
 *
 * 随机性（跨进程会变）需要多次运行本文件比较输出：
 *   for i in 1 2 3; do pnpm test:offline; done
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resolveUaProfile } from '../../src/utils/ua.ts'
import { gecHeaders } from '../../src/net/gec.ts'

const UA_RE =
    /Chrome\/(\d+\.\d+\.\d+\.\d+) Safari\/537\.36 Edg\/(\d+\.\d+\.\d+\.\d+)$/

describe('UA 生成', () => {
    const profile = resolveUaProfile()
    const ua = profile.ua

    it('同进程多次调用恒定（fetch 与浏览器同源）', () => {
        assert.equal(resolveUaProfile().ua, ua)
        assert.equal(resolveUaProfile(), profile)
        assert.equal(resolveUaProfile().ua, ua)
        assert.equal(resolveUaProfile().edgeVersion, profile.edgeVersion)
    })

    it('形态合法：Chrome 4 段 + Edg 4 段', () => {
        assert.match(ua, UA_RE)
    })

    describe('版本补丁位', () => {
        const m = UA_RE.exec(ua)
        const chrome = m?.[1] ?? ''
        const edge = m?.[2] ?? ''

        it('Chrome 段非零补丁（不退化成 X.0.0.0）', () => {
            assert.notEqual(chrome.split('.')[3], '0', chrome)
        })

        it('Edg 段非零补丁', () => {
            assert.notEqual(edge.split('.')[3], '0', edge)
        })

        it('不撞已知黑名单串', () => {
            assert.ok(
                !(chrome === '152.0.0.0' && edge === '152.0.0.0'),
                chrome + ' / ' + edge
            )
        })
    })

    describe('与 sec-ms-gec-version 同源', () => {
        it('edgeVersion 就是 UA 串里的 Edg 版本', () => {
            const m = UA_RE.exec(ua)
            assert.equal(
                profile.edgeVersion,
                m?.[2],
                'edgeVersion 与 UA 中的 Edg 段不一致'
            )
        })

        it('生产头里的 gec-version 与 UA 版本一致（不是固定值）', () => {
            const headers = gecHeaders(profile.edgeVersion)
            assert.equal(
                headers['sec-ms-gec-version'],
                '2-' + profile.edgeVersion
            )
        })

        it('Chrome 与 Edg 主版本相同（真实 Edge 的形态）', () => {
            const m = UA_RE.exec(ua)
            assert.equal(
                m?.[1]?.split('.')[0],
                m?.[2]?.split('.')[0],
                'Chrome 主版本必须与 Edg 主版本一致'
            )
        })
    })
})
