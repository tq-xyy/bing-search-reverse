export interface UaProfile {
    ua: string
    /** UA 里的 Edg/ 版本，供 sec-ms-gec-version 使用。 */
    edgeVersion: string
}

const CHROME_MAJOR_POOL = [131, 135, 138, 145, 152, 155, 160] as const

function randomRealVersion(major: number): string {
    const build = 6000 + Math.floor(Math.random() * 2200)
    const patch = 1 + Math.floor(Math.random() * 220)
    return major + '.0.' + build + '.' + patch
}

let cached: UaProfile | null = null

/** 本进程使用的 UA（单例）。Chrome 与 Edg 用同一主版本——真实 Edge 就是这样。 */
export function resolveUaProfile(): UaProfile {
    if (cached !== null) return cached
    const major =
        CHROME_MAJOR_POOL[Math.floor(Math.random() * CHROME_MAJOR_POOL.length)]
    const edgeVersion = randomRealVersion(major)
    cached = {
        ua:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/' +
            randomRealVersion(major) +
            ' Safari/537.36 Edg/' +
            edgeVersion,
        edgeVersion,
    }
    return cached
}
