// Сборка для хостинга: каждый файл минифицируется отдельно, структура src/ сохраняется.
// Результат в dist/ можно выложить как статический сайт (так собран rastau-kz.vercel.app).
import { transform } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const out = join(root, 'dist')
const files = []
const walk = (d) => { for (const f of readdirSync(join(root, d))) { const p = join(d, f); statSync(join(root, p)).isDirectory() ? walk(p) : files.push(p) } }
walk('src'); walk('icons')
files.push('index.html', 'manifest.json', 'sw.js', 'favicon.svg')

rmSync(out, { recursive: true, force: true })
for (const f of files) {
  let b
  if (/\.(png|woff2|txt)$/.test(f)) b = readFileSync(join(root, f))
  else {
    let s = readFileSync(join(root, f), 'utf8')
    // esbuild превращает символ BOM в литерал, который портится при выкладке, поэтому возвращаем вызов
    if (f.endsWith('.js')) s = (await transform(s, { loader: 'js', minify: true, charset: 'utf8', format: 'esm', target: 'es2020' })).code.replaceAll('"\\uFEFF"', 'String.fromCharCode(65279)')
    if (f.endsWith('.css')) s = (await transform(s, { loader: 'css', minify: true, charset: 'utf8' })).code
    b = Buffer.from(s, 'utf8')
  }
  mkdirSync(dirname(join(out, f)), { recursive: true })
  writeFileSync(join(out, f), b)
}
console.log('dist:', files.length, 'files')
