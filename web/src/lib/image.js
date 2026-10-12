// Обработка снимка в браузере: уменьшение, фото-штамп, SHA-256,
// перцептивный хэш (dHash), резкость, яркость, сравнение сцен «до/после».

const MAX = 1280

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function drawScaled(source, w, h, max = MAX) {
  const k = Math.min(1, max / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.round(w * k)
  c.height = Math.round(h * k)
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height)
  return c
}

export function frameFromVideo(video) {
  return drawScaled(video, video.videoWidth, video.videoHeight)
}

export async function canvasFromFile(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    return drawScaled(img, img.naturalWidth, img.naturalHeight)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Фото-штамп внизу кадра: время, координаты, объект, код проверки
export function stamp(canvas, lines) {
  const ctx = canvas.getContext('2d')
  const fs = Math.max(14, Math.round(canvas.width / 48))
  const pad = Math.round(fs * 0.6)
  const h = lines.length * (fs + 4) + pad * 2
  ctx.fillStyle = 'rgba(8, 20, 40, 0.72)'
  ctx.fillRect(0, canvas.height - h, canvas.width, h)
  ctx.fillStyle = '#FEC50C'
  ctx.fillRect(0, canvas.height - h, Math.round(fs * 0.35), h)
  ctx.font = `600 ${fs}px system-ui, sans-serif`
  ctx.fillStyle = '#fff'
  lines.forEach((t, i) => ctx.fillText(t, pad + fs * 0.4, canvas.height - h + pad + fs * (i + 0.85) + i * 4))
  return canvas
}

export function toBlob(canvas, q = 0.82) {
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', q))
}

export async function sha256Blob(blob) {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function gray(canvas, w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(canvas, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  const g = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  return { g, rgba: d }
}

// dHash 64 бита → 16 hex-символов. Устойчив к сжатию и небольшому кадрированию.
// Штамп внизу не участвует: берём верхние 85% кадра.
export function dhash(canvas) {
  const crop = cropTop(canvas, 0.85)
  const { g } = gray(crop, 9, 8)
  let bits = ''
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += g[y * 9 + x] > g[y * 9 + x + 1] ? '1' : '0'
  let hex = ''
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

function cropTop(canvas, part) {
  const c = document.createElement('canvas')
  c.width = canvas.width
  c.height = Math.round(canvas.height * part)
  c.getContext('2d').drawImage(canvas, 0, 0)
  return c
}

// Резкость: дисперсия лапласиана на 256 px
export function sharpness(canvas) {
  const w = 256
  const h = Math.max(8, Math.round((canvas.height / canvas.width) * 256))
  const { g } = gray(cropTop(canvas, 0.85), w, h)
  let sum = 0, sum2 = 0, n = 0
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    const l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i]
    sum += l; sum2 += l * l; n++
  }
  const mean = sum / n
  return Math.round(sum2 / n - mean * mean)
}

export function brightness(canvas) {
  const { g } = gray(canvas, 32, 32)
  return Math.round(g.reduce((s, v) => s + v, 0) / g.length)
}

function histogram(canvas) {
  const { rgba } = gray(cropTop(canvas, 0.85), 64, 48)
  const bins = new Float32Array(4 * 4 * 4)
  for (let i = 0; i < rgba.length; i += 4) bins[(rgba[i] >> 6) * 16 + (rgba[i + 1] >> 6) * 4 + (rgba[i + 2] >> 6)]++
  const n = rgba.length / 4
  return bins.map((b) => b / n)
}

// Сходство сцен 0..1: пересечение цветовых гистограмм + структура (dHash)
export function sceneSimilarity(a, b) {
  const ha = histogram(a), hb = histogram(b)
  let inter = 0
  for (let i = 0; i < ha.length; i++) inter += Math.min(ha[i], hb[i])
  const h = hammingHex(dhash(a), dhash(b))
  const struct = Math.max(0, (1 - h / 64 - 0.5) * 2)
  return Math.round((inter * 0.55 + struct * 0.45) * 1000) / 1000
}

function hammingHex(a, b) {
  let d = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) { d += x & 1; x >>= 1 }
  }
  return d
}

export async function analyze(canvas) {
  return { phash: dhash(canvas), blur: sharpness(canvas), brightness: brightness(canvas) }
}
