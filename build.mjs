// Сборка для продакшена: один файл JS + CSS, без node_modules. Результат в dist/
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

mkdirSync('dist', { recursive: true })
await build({ entryPoints: ['src/main.js'], bundle: true, format: 'esm', minify: true, charset: 'utf8', target: 'es2020', external: ['@supabase/supabase-js'], outfile: 'dist/app.js' })
await build({ entryPoints: ['src/styles.css'], bundle: true, minify: true, charset: 'utf8', outfile: 'dist/app.css' })
const v = createHash('sha1').update(readFileSync('dist/app.js')).update(readFileSync('dist/app.css')).digest('hex').slice(0, 10)
const src = readFileSync('index.html', 'utf8')
const head = src.slice(0, src.indexOf('<script>'))
const html = `${head}<script type="importmap">{"imports":{"@supabase/supabase-js":"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm"}}</script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css">
<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
<link rel="stylesheet" href="/app.css?v=${v}">
</head>
<body>
<div id="app"><div class="boot"><div class="logo-mark">✓</div><div>FAKT загружается…</div></div></div>
<script type="module" src="/app.js?v=${v}"></script>
</body>
</html>
`
writeFileSync('dist/index.html', html)
copyFileSync('manifest.json', 'dist/manifest.json')
copyFileSync('sw.js', 'dist/sw.js')
console.log('dist ok', v)
