import type { BingEntrance } from './protocol.ts'
import type { SearchOptions } from './contract.ts'

/** 中国大陆与港澳台走国内版，其余走国际版。 */
const CN_TIMEZONES = new Set([
    'Asia/Shanghai',
    'Asia/Chongqing',
    'Asia/Harbin',
    'Asia/Urumqi',
    'Asia/Kashgar',
    'PRC',
    'Asia/Hong_Kong',
    'Asia/Macau',
    'Asia/Taipei',
])

/**
 * 决定实际生效的入口：显式传入的永远优先，否则按运行时时区推测。
 *
 * `timeZone` 参数只为单测而存在——生产调用永远走默认值（运行时真实时区）。
 * 放在这里而不是 `index.ts`，是为了让离线测试能直接打这条路径；门面依旧
 * 只导出 `searchByBing` 与 `SearchResult`，这是内部实现。
 */
export function resolveEntrance(
    explicit?: SearchOptions['bingEntrance'],
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
): BingEntrance {
    if (explicit === 'cn' || explicit === 'international') return explicit
    return CN_TIMEZONES.has(timeZone) ? 'cn' : 'international'
}
