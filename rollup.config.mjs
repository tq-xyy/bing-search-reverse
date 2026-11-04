import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import esbuild from 'rollup-plugin-esbuild'
import { dts } from 'rollup-plugin-dts'

// 全部路径用 import.meta.url 解析，而不是相对**当前工作目录**。
// 后者一旦从别的目录跑 `rollup -c`（或换构建入口）就会崩。
// 用 fileURLToPath 而不是 URL.pathname：后者在 Windows 前导 `/`、且会
// 把非 ASCII 字符留成百分号编码。
const at = p => fileURLToPath(new URL(p, import.meta.url))
const pkg = JSON.parse(readFileSync(at('./package.json'), 'utf8'))

/** 运行期依赖 + Node 内置模块交给使用方，不打包进产物 */
const external = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    /^node:/,
]

/**
 * 两阶段构建：
 *   1. esbuild 把多个 TS 模块拼成一个 ESM 文件
 *   2. rollup-plugin-dts 把散落的 .d.ts 合成单个声明文件
 *
 * 产物不内联第三方依赖——与过去 CDP 的处理方式一致，下游自己装。
 */
export default [
    {
        input: at('./src/index.ts'),
        output: {
            file: at('./dist/bing.js'),
            format: 'esm',
            sourcemap: false,
        },
        external,
        plugins: [
            esbuild({
                target: 'node20',
                minify: false, // 保留可读的调用栈与行号
            }),
        ],
    },
    {
        input: at('./src/index.ts'),
        output: {
            file: at('./dist/bing.d.ts'),
            format: 'esm',
        },
        external,
        plugins: [dts()],
    },
]
