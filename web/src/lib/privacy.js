// Защита персональных данных на фото (Закон РК «О персональных данных и их защите»):
// лица и номера машин закрываются на телефоне до отправки, оригинал без маскировки никуда не уходит.
// Автопоиск лиц работает на устройстве (MediaPipe): фото не покидает телефон до маскировки и никому не передаётся.
const LOCAL = typeof window !== 'undefined' && window.FAKT_LOCAL
const BASE = LOCAL ? '/node_modules/@mediapipe/tasks-vision' : 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1'
// Модель (230 КБ) скачивается один раз и кэшируется; снимки никуда не отправляются
const MODEL = LOCAL ? '/models/blaze_face_short_range.tflite' : 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
let detector = null

async function getDetector() {
  detector ||= (async () => {
    const url = BASE + '/vision_bundle.mjs'
    const { FilesetResolver, FaceDetector } = await import(/* webpackIgnore: true */ url)
    const files = await FilesetResolver.forVisionTasks(BASE + '/wasm')
    return FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL }, runningMode: 'IMAGE', minDetectionConfidence: 0.45 })
  })().catch((e) => { detector = null; throw e })
  return detector
}

// Ищет лица на всём кадре и по четвертям (так находятся и мелкие лица на дальнем плане)
export async function findFaces(canvas) {
  const det = await getDetector()
  const W = canvas.width, H = canvas.height
  const boxes = []
  const scan = (sx, sy, sw, sh) => {
    const c = document.createElement('canvas')
    const k = Math.min(1, 1024 / Math.max(sw, sh))
    c.width = Math.round(sw * k); c.height = Math.round(sh * k)
    c.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, c.width, c.height)
    for (const d of det.detect(c).detections) {
      const b = d.boundingBox
      boxes.push({ x: sx + b.originX / k, y: sy + b.originY / k, w: b.width / k, h: b.height / k })
    }
  }
  scan(0, 0, W, H)
  if (Math.max(W, H) > 900) {
    const tw = W * 0.6, th = H * 0.6
    for (const [x, y] of [[0, 0], [W - tw, 0], [0, H - th], [W - tw, H - th]]) scan(x, y, tw, th)
  }
  return merge(boxes)
}

function merge(boxes) {
  const out = []
  for (const b of boxes) {
    const o = out.find((a) => overlap(a, b) > 0.3)
    if (o) { const x = Math.min(o.x, b.x), y = Math.min(o.y, b.y); o.w = Math.max(o.x + o.w, b.x + b.w) - x; o.h = Math.max(o.y + o.h, b.y + b.h) - y; o.x = x; o.y = y }
    else out.push({ ...b })
  }
  return out
}
function overlap(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return (ix * iy) / Math.min(a.w * a.h, b.w * b.h)
}

// Необратимая пикселизация области (с запасом вокруг)
export function pixelate(canvas, box, pad = 0.3) {
  const ctx = canvas.getContext('2d')
  const x = Math.max(0, Math.floor(box.x - box.w * pad)), y = Math.max(0, Math.floor(box.y - box.h * pad))
  const w = Math.min(canvas.width - x, Math.ceil(box.w * (1 + 2 * pad))), h = Math.min(canvas.height - y, Math.ceil(box.h * (1 + 2 * pad)))
  if (w < 2 || h < 2) return
  const cell = Math.max(6, Math.round(Math.max(w, h) / 8))
  const small = document.createElement('canvas')
  small.width = Math.max(1, Math.round(w / cell)); small.height = Math.max(1, Math.round(h / cell))
  small.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, small.width, small.height)
  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h)
  ctx.restore()
}
