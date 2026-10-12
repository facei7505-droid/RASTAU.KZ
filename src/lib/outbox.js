// Очередь фото без связи. На трассе и на окраинах сеть пропадает: снимок сохраняется на телефоне
// вместе с координатами и временем съёмки и уходит на сервер, когда появится связь.
// Сервер получает delay_ms (сколько прошло от съёмки до отправки) и сам решает, можно ли доверять времени.
const DB = 'fakt-outbox', ST = 'items'
const SESSION = Math.random().toString(36).slice(2)
let dbp = null
const listeners = new Set()
let flushing = null

function db() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: 'id' })
    r.onsuccess = () => res(r.result)
    r.onerror = () => { dbp = null; rej(r.error) }
  }))
}
async function run(mode, fn) {
  const d = await db()
  return new Promise((res, rej) => {
    const t = d.transaction(ST, mode)
    const req = fn(t.objectStore(ST))
    t.oncomplete = () => res(req?.result)
    t.onerror = () => rej(t.error)
    t.onabort = () => rej(t.error || new Error('Хранилище телефона недоступно'))
  })
}

export const list = () => run('readonly', (s) => s.getAll()).then((x) => (x || []).sort((a, b) => a.queued_at - b.queued_at))
export const onOutbox = (fn) => { listeners.add(fn); list().then(fn).catch(() => {}); return () => listeners.delete(fn) }
const notify = () => list().then((items) => listeners.forEach((f) => f(items))).catch(() => {})

export function isNetworkError(e) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out|offline/i.test(String(e?.message || e))
}

// Сколько прошло от съёмки: в той же сессии по монотонным часам (их не перевести), иначе по часам телефона
function delayOf(item) {
  if (item.session === SESSION && item.capture_perf != null) return Math.max(0, Math.round(performance.now() - item.capture_perf))
  return Math.max(0, Date.now() - new Date(item.meta.device_time).getTime())
}

export async function enqueue(meta, blob, capture_perf, kind = 'evidence') {
  const item = { id: meta.id, kind, meta, blob, capture_perf: capture_perf ?? null, session: SESSION, queued_at: Date.now(), tries: 0, last_error: null }
  await run('readwrite', (s) => s.put(item))
  notify()
  return item
}

export const remove = (id) => run('readwrite', (s) => s.delete(id)).then(notify)

// Отправка по порядку съёмки (фото «до» уходит раньше фото «после»). Сетевой сбой останавливает отправку до следующей попытки.
export function flush(send) {
  return (flushing ||= (async () => {
    let sent = 0, failed = 0
    for (const it of await list()) {
      try {
        if (it.kind === 'order') await send.order(it.meta)
        else await send.evidence({ ...it.meta, delay_ms: delayOf(it) }, it.blob)
        await run('readwrite', (s) => s.delete(it.id))
        sent++
      } catch (e) {
        if (isNetworkError(e)) break
        failed++
        await run('readwrite', (s) => s.put({ ...it, tries: it.tries + 1, last_error: String(e.message || e) }))
      }
    }
    await notify()
    return { sent, failed }
  })().finally(() => { flushing = null }))
}

// Оборачивает api: фото и заявки по дефектам работают и без связи
export function withOutbox(api) {
  const send = api.addEvidence.bind(api)
  const sendOrder = api.createOrder.bind(api)
  api.createOrder = async (input) => {
    const meta = { ...input, id: input.id || `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}` }
    const queue = async () => { await enqueue(meta, null, null, 'order'); return { ...meta, status: 'open', queued: true } }
    // В офлайн-демо данные и так в браузере: ставить заявку в очередь незачем
    if (api.mode !== 'online') return sendOrder(meta)
    if (navigator.onLine === false) return queue()
    try { return await sendOrder(meta) } catch (e) { if (isNetworkError(e)) return queue(); throw e }
  }
  const strip = ({ capture_perf, ...m }) => m
  api.addEvidence = async (input, blob) => {
    const meta = strip({ ...input, id: input.id || `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}` })
    const perf = input.capture_perf
    const queue = async () => {
      await enqueue(meta, blob, perf)
      return { ...meta, queued: true, verdict: 'queued', score: null, checks: [], photo_url: blob ? URL.createObjectURL(blob) : meta.photo_url }
    }
    if (blob && navigator.onLine === false) return queue()
    try {
      return await send({ ...meta, ...(perf != null ? { delay_ms: Math.max(0, Math.round(performance.now() - perf)) } : {}) }, blob)
    } catch (e) {
      if (blob && isNetworkError(e)) return queue()
      throw e
    }
  }
  api.flushOutbox = () => flush({ evidence: send, order: sendOrder })
  const tryFlush = () => { if (navigator.onLine !== false) api.flushOutbox().catch(() => {}) }
  window.addEventListener('online', tryFlush)
  setInterval(() => list().then((x) => x.length && tryFlush()).catch(() => {}), 30000)
  setTimeout(tryFlush, 3000)
  return api
}
