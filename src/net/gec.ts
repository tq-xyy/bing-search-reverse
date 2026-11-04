import { createHash } from 'node:crypto'

/** 轮换窗口（秒）。 */
const GEC_WINDOW_SEC = 300

export const GEC_WINDOW_MS = GEC_WINDOW_SEC * 1000

const GEC_VERSION_PREFIX = '2-'
const PREFIX = 'Copyright (C) Microsoft Corporation. All rights reserved.'
const SALT = 'NO_SUBSCRIPTION'
const EPOCH = 11644473600

// 下面两路哈希的寄存器名来自 msedge.dll 的反汇编，故意保留以便逐行对照
const rol = (x: number, n: number): number =>
    ((x << n) | (x >>> (32 - n))) >>> 0

function hashA(c1: number[], c2: number[]): [number, number] {
    const r9 = c1.length
    const edx = (c2[0] | 1) >>> 0
    const r10d = (c2[1] | 1) >>> 0
    let ebx = 0,
        rsi = r9,
        r11 = 0,
        edi = 0
    for (;;) {
        if (edi < r9) {
            ebx = c1[edi] >>> 0
            edi++
        }
        let ebp = Math.imul(ebx, edx) >>> 0
        ebx = rol(ebx, 16)
        ebx = Math.imul(ebx, 0xef0569fb) >>> 0
        ebx = (ebx + ebp) >>> 0
        ebx = rol(ebx, 16)
        ebp = Math.imul(ebx, 0x76f50f34) >>> 0
        ebx = rol(ebp, 16)
        ebx = Math.imul(ebx, 0xc3efea97) >>> 0
        ebx = (ebx + ebp) >>> 0
        if (edi >= r9) break
        ebp = c1[edi] >>> 0
        edi++
        r11 = (r11 + ebx) >>> 0
        ebx = Math.imul(ebp, r10d) >>> 0
        ebp = rol(ebp, 16)
        ebp = Math.imul(ebp, 0xc31713db) >>> 0
        ebp = (ebp + ebx) >>> 0
        ebp = rol(ebp, 16)
        ebp = Math.imul(ebp, 0x1881ce3c) >>> 0
        ebx = rol(ebp, 16)
        ebx = Math.imul(ebx, 0x35bd1ec9) >>> 0
        ebx = (ebx + ebp) >>> 0
        r11 = (r11 + ebx) >>> 0
        rsi -= 2
        if (rsi <= 1) break
    }
    return [ebx >>> 0, r11 >>> 0]
}

function hashB(c1: number[], c2: number[]): [number, number] {
    const r9 = c1.length
    const edx = (c2[0] | 1) >>> 0
    const r10d = (c2[1] | 1) >>> 0
    let r11 = 0,
        rdi = r9,
        esi = 0,
        ebx = 0
    for (;;) {
        if (r11 < r9) {
            ebx = (ebx + c1[r11]) >>> 0
            r11++
        }
        ebx = rol(Math.imul(ebx, edx) >>> 0, 16)
        ebx = rol(Math.imul(ebx, 0xcf98b111) >>> 0, 16)
        ebx = rol(Math.imul(ebx, 0x87085b9f) >>> 0, 16)
        ebx = rol(Math.imul(ebx, 0x12ceb96d) >>> 0, 16)
        ebx = Math.imul(ebx, 0x257e1d83) >>> 0
        if (r11 >= r9) break
        let ebp = (c1[r11] + ebx) >>> 0
        r11++
        ebp = rol(Math.imul(ebp, r10d) >>> 0, 16)
        ebp = rol(Math.imul(ebp, 0xa27416f5) >>> 0, 16)
        ebp = rol(Math.imul(ebp, 0xd38396ff) >>> 0, 16)
        esi = (esi + ebx) >>> 0
        ebx = rol(Math.imul(ebp, 0x7c932b89) >>> 0, 16)
        ebx = Math.imul(ebx, 0xbfa49f69) >>> 0
        esi = (esi + ebx) >>> 0
        rdi -= 2
        if (rdi <= 1) break
    }
    return [ebx >>> 0, esi >>> 0]
}

/** 字节串 → uint32 小端数组，补齐到 8 字节边界。 */
function toWords(b: Buffer): number[] {
    const pad = (8 - (b.length % 8)) % 8
    const buf = pad ? Buffer.concat([b, Buffer.alloc(pad)]) : b
    const out: number[] = []
    for (let i = 0; i < buf.length; i += 4) out.push(buf.readUInt32LE(i))
    return out
}

/** 生成 sec-ms-gec；同一 300s 窗口内结果恒定。 */
export function forgeGec(nowMs = Date.now()): string {
    const unix = Math.floor(nowMs / 1000)
    const t = unix + EPOCH
    const ticks = (t - (t % GEC_WINDOW_SEC)) * 10_000_000
    const payload = Buffer.from(PREFIX + String(ticks) + SALT, 'utf8')
    const sha = createHash('sha256').update(payload).digest()
    const a = hashA(toWords(payload), toWords(sha))
    const b = hashB(toWords(payload), toWords(sha))
    const raw = Buffer.alloc(8)
    raw.writeUInt32LE((a[0] ^ b[0]) >>> 0, 0)
    raw.writeUInt32LE((a[1] ^ b[1]) >>> 0, 4)
    return (
        raw.toString('hex').toUpperCase() +
        '-' +
        sha.toString('hex').toUpperCase()
    )
}

let cache: { window: number; version: string; gec: string } | null = null

/** 当前窗口的 GEC 请求头；版本号由调用方给的 Edge 版本决定。 */
export function gecHeaders(
    edgeVersion: string,
    now = Date.now()
): Record<string, string> {
    const window = Math.floor(now / GEC_WINDOW_MS)
    const version = GEC_VERSION_PREFIX + edgeVersion
    if (!cache || cache.window !== window || cache.version !== version) {
        cache = { window, version, gec: forgeGec(now) }
    }
    return { 'sec-ms-gec': cache.gec, 'sec-ms-gec-version': version }
}
