// Демо-изображения для исторических данных (gen:<вид>:<номер>:<вариант>).
// Реальные снимки делаются камерой; эти картинки только иллюстрируют демо-историю.
const cache = new Map()

function rng(seed) {
  let s = (seed * 2654435761) >>> 0
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

export function isGen(url) { return typeof url === 'string' && url.startsWith('gen:') }

export function genPhoto(url, w = 640, h = 480) {
  const key = `${url}|${w}`
  if (cache.has(key)) return cache.get(key)
  const [, kind, numS, variant] = url.split(':')
  const num = parseInt(numS, 10) || 1
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  const r = rng(num * 31 + (kind === 'road' ? 7 : kind === 'build' ? 13 : 19))
  sky(ctx, w, h, r)
  if (kind === 'road') road(ctx, w, h, r, variant === '1', num)
  else if (kind === 'build') build(ctx, w, h, r, parseInt(variant, 10) || 0)
  else waste(ctx, w, h, r, variant === 'full')
  noise(ctx, w, h, r)
  ctx.fillStyle = 'rgba(8,20,40,.7)'
  ctx.fillRect(0, h - 26, w, 26)
  ctx.fillStyle = '#FEC50C'
  ctx.fillRect(0, h - 26, 5, 26)
  ctx.fillStyle = '#fff'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillText('Rastau • демо-изображение из истории объекта', 14, h - 9)
  const data = c.toDataURL('image/jpeg', 0.82)
  cache.set(key, data)
  return data
}

function sky(ctx, w, h, r) {
  const g = ctx.createLinearGradient(0, 0, 0, h * 0.5)
  const warm = r() < 0.3
  g.addColorStop(0, warm ? '#9cc3e6' : '#6fa8dc')
  g.addColorStop(1, warm ? '#f3e2c4' : '#d6e6f2')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  // дальние холмы
  ctx.fillStyle = r() < 0.5 ? '#9aa88a' : '#a7a17f'
  ctx.beginPath(); ctx.moveTo(0, h * 0.45)
  for (let x = 0; x <= w; x += 40) ctx.lineTo(x, h * 0.42 - Math.sin(x / 90 + r() * 3) * 10 - r() * 8)
  ctx.lineTo(w, h * 0.5); ctx.lineTo(0, h * 0.5); ctx.fill()
}

function ground(ctx, w, h, color) {
  ctx.fillStyle = color
  ctx.fillRect(0, h * 0.46, w, h * 0.54)
}

function road(ctx, w, h, r, repaired, num) {
  ground(ctx, w, h, '#b5a77a')
  const hz = h * 0.47
  ctx.fillStyle = '#5b5d61'
  ctx.beginPath(); ctx.moveTo(w * 0.46, hz); ctx.lineTo(w * 0.54, hz); ctx.lineTo(w * 1.05, h); ctx.lineTo(-w * 0.05, h); ctx.fill()
  // разметка
  ctx.fillStyle = '#e9e6dc'
  for (let i = 0; i < 9; i++) {
    const t0 = i / 9, t1 = t0 + 0.05
    const y0 = hz + (h - hz) * t0 ** 1.6, y1 = hz + (h - hz) * t1 ** 1.6
    const hw0 = 1 + 6 * t0 ** 1.6, hw1 = 1 + 6 * t1 ** 1.6
    ctx.beginPath(); ctx.moveTo(w / 2 - hw0, y0); ctx.lineTo(w / 2 + hw0, y0); ctx.lineTo(w / 2 + hw1, y1); ctx.lineTo(w / 2 - hw1, y1); ctx.fill()
  }
  // столбики
  ctx.fillStyle = '#f5f5f5'
  for (let i = 1; i < 6; i++) { const t = (i / 6) ** 1.7; const y = hz + (h - hz) * t; ctx.fillRect(w * 0.5 + (w * 0.58) * t + 6, y - 22 * t - 4, 3 + 5 * t, 22 * t + 4) }
  // яма или заплатка
  const px = w * (0.32 + r() * 0.3), py = h * (0.72 + r() * 0.12), rx = 60 + r() * 50, ry = 22 + r() * 14
  if (!repaired) {
    ctx.fillStyle = '#3b3a37'
    ctx.beginPath()
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const k = 0.75 + r() * 0.35
      ctx.lineTo(px + Math.cos(a) * rx * k, py + Math.sin(a) * ry * k)
    }
    ctx.fill()
    ctx.fillStyle = 'rgba(80,110,130,.55)'
    ctx.beginPath(); ctx.ellipse(px + 5, py + 4, rx * 0.45, ry * 0.35, 0, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#2a2a28'; ctx.lineWidth = 2
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(px + rx * 0.8, py); ctx.lineTo(px + rx * (1.1 + r() * 0.6), py + (r() - 0.5) * 40); ctx.stroke() }
  } else {
    ctx.fillStyle = '#2f3134'
    ctx.beginPath(); ctx.moveTo(px - rx * 1.1, py - ry * 1.2); ctx.lineTo(px + rx * 1.15, py - ry * 1.15); ctx.lineTo(px + rx * 1.2, py + ry * 1.25); ctx.lineTo(px - rx * 1.15, py + ry * 1.2); ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 2; ctx.stroke()
  }
}

function build(ctx, w, h, r, progress) {
  ground(ctx, w, h, '#a99877')
  const floors = 9
  const done = Math.max(1, Math.round((progress / 100) * floors))
  const bx = w * (0.22 + r() * 0.12), bw = w * 0.42, fh = (h * 0.42) / floors, base = h * 0.8
  // кран
  ctx.strokeStyle = '#e8a317'; ctx.lineWidth = 6
  const cx = bx + bw + 40
  ctx.beginPath(); ctx.moveTo(cx, base); ctx.lineTo(cx, h * 0.12); ctx.lineTo(cx - w * 0.45, h * 0.12); ctx.moveTo(cx, h * 0.12); ctx.lineTo(cx + 70, h * 0.12); ctx.stroke()
  ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - w * 0.3, h * 0.12); ctx.lineTo(cx - w * 0.3, h * 0.12 + 60 + r() * 60); ctx.stroke()
  for (let f = 0; f < done; f++) {
    const y = base - (f + 1) * fh
    const finished = progress > 70 && f < done - 1
    ctx.fillStyle = finished ? '#d9d2c3' : '#9e9c97'
    ctx.fillRect(bx, y, bw, fh - 2)
    ctx.fillStyle = finished ? '#5c7891' : '#4d4d4d'
    for (let k = 0; k < 7; k++) ctx.fillRect(bx + 10 + k * (bw - 20) / 7, y + fh * 0.25, (bw - 20) / 7 - 10, fh * 0.45)
  }
  // леса и арматура сверху
  ctx.strokeStyle = '#6b4f2a'; ctx.lineWidth = 2
  for (let k = 0; k <= 8; k++) { ctx.beginPath(); ctx.moveTo(bx + k * bw / 8, base - done * fh); ctx.lineTo(bx + k * bw / 8, base - done * fh - 18); ctx.stroke() }
  // забор
  ctx.fillStyle = '#2f6db5'
  ctx.fillRect(0, base, w, h * 0.06)
  ctx.fillStyle = '#fff'; ctx.font = '600 14px system-ui'
  ctx.fillText('СТРОИТЕЛЬНАЯ ПЛОЩАДКА', 16, base + h * 0.04)
}

function waste(ctx, w, h, r, full) {
  ground(ctx, w, h, '#9f9a8c')
  ctx.fillStyle = '#c9c3b5'; ctx.fillRect(w * 0.08, h * 0.62, w * 0.84, h * 0.3)
  // навес-забор
  ctx.fillStyle = '#6f8a6a'; ctx.fillRect(w * 0.08, h * 0.38, w * 0.84, h * 0.26)
  const n = 3 + Math.floor(r() * 2)
  for (let i = 0; i < n; i++) {
    const x = w * 0.13 + i * (w * 0.74 / n)
    ctx.fillStyle = ['#2d6a3e', '#2f5f8a', '#4a4a4a'][i % 3]
    ctx.fillRect(x, h * 0.55, w * 0.74 / n - 16, h * 0.25)
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x, h * 0.55, w * 0.74 / n - 16, 8)
    if (full) {
      for (let k = 0; k < 6; k++) {
        ctx.fillStyle = ['#1d1d1d', '#e4e1d8', '#3b5998', '#8a6d3b'][Math.floor(r() * 4)]
        ctx.beginPath(); ctx.ellipse(x + r() * (w * 0.74 / n - 16), h * 0.55 - r() * 22, 14 + r() * 14, 10 + r() * 8, r(), 0, Math.PI * 2); ctx.fill()
      }
    }
  }
  if (full) for (let k = 0; k < 14; k++) {
    ctx.fillStyle = ['#1d1d1d', '#e4e1d8', '#3b5998', '#b04a3a', '#8a6d3b'][Math.floor(r() * 5)]
    ctx.beginPath(); ctx.ellipse(w * (0.1 + r() * 0.8), h * (0.8 + r() * 0.12), 12 + r() * 16, 8 + r() * 8, r(), 0, Math.PI * 2); ctx.fill()
  }
}

function noise(ctx, w, h, r) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 18
    d[i] += n; d[i + 1] += n; d[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
}
