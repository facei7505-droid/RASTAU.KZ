// Внешние библиотеки подгружаются только когда нужны (QR, Excel), погода для норматива ТКО
const LOCAL = typeof window !== 'undefined' && window.FAKT_LOCAL
const SRC = {
  qrcode: LOCAL ? '/node_modules/qrcode-generator/qrcode.js' : 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
  xlsx: LOCAL ? '/node_modules/xlsx/dist/xlsx.full.min.js' : 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
}
const GLOBAL = { qrcode: 'qrcode', xlsx: 'XLSX' }
const loading = {}

export function loadLib(name) {
  if (window[GLOBAL[name]]) return Promise.resolve(window[GLOBAL[name]])
  loading[name] ||= new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = SRC[name]
    s.onload = () => res(window[GLOBAL[name]])
    s.onerror = () => { delete loading[name]; rej(new Error('Не удалось загрузить библиотеку ' + name + '. Проверьте интернет.')) }
    document.head.appendChild(s)
  })
  return loading[name]
}

// QR-код как SVG (вектор, печатается чётко на табличке любого размера)
export async function qrSvg(text, cell = 4) {
  const qrcode = await loadLib('qrcode')
  const q = qrcode(0, 'M')
  q.addData(text)
  q.make()
  return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true })
}

// Температура воздуха в Конаеве (Open-Meteo, без ключа). Кэш на час.
export async function fetchAirTemp(lat = 43.866, lng = 77.07) {
  const KEY = 'fakt-air-temp'
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (c && Date.now() - c.at < 3600000) return c.t
  } catch {}
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m`, { signal: AbortSignal.timeout(6000) })
    const j = await r.json()
    const t = j?.current?.temperature_2m
    if (typeof t === 'number') { try { localStorage.setItem(KEY, JSON.stringify({ t, at: Date.now() })) } catch {} return t }
  } catch {}
  return null
}

export function publicUrl(path) {
  return `${location.origin}${location.pathname.replace(/index\.html$/, '')}${path}`
}
