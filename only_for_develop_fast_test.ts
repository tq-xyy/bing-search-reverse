import { searchByBing } from './src'

// 不用 `import.meta.main` 守卫：它要 Node 24+，在 20/22 上会让脚本静默什么都不做。
// 这个文件不会被 import，直接执行即可。
const q = process.argv[2] ?? '全面从严治党关键在从严治吏'

console.log(await searchByBing(q))
