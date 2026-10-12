// Ядро FAKT: проверка доказательств, графики, флаги, рейтинг подрядчиков.
// Эти же правила продублированы в SQL-триггере (supabase/schema.sql), чтобы
// ключевые проверки (расстояние, время, повтор фото) считал сервер.

export const DAY = 86400000

export const MODULES = {
  build: { label: 'Стройки', full: 'Инфраструктурные объекты', region: 'Конаев', task: '№2', color: '#2563eb' },
  road: { label: 'Дороги', full: 'Областные дороги', region: 'область Абай', task: 'А-3', color: '#7c3aed' },
  waste: { label: 'Площадки', full: 'Контейнерные площадки', region: 'Конаев', task: '№6', color: '#0d9488' },
}

// Нормативные сроки устранения дефектов дорог (по умолчанию, акимат меняет в настройках)
export const DEFECTS = {
  pothole: { label: 'Яма / выбоина', days: 7 },
  pothole_danger: { label: 'Опасная яма (угроза ДТП)', days: 1 },
  crack: { label: 'Трещины покрытия', days: 30 },
  marking: { label: 'Стёртая разметка', days: 30 },
  sign: { label: 'Повреждён дорожный знак', days: 3 },
  shoulder: { label: 'Разрушена обочина', days: 14 },
  barrier: { label: 'Повреждено ограждение', days: 5 },
  drainage: { label: 'Засор водоотвода', days: 10 },
}

export const STAGES = {
  before: 'Фото «до»',
  after: 'Фото «после»',
  progress: 'Отчёт о ходе работ',
  inspection: 'Осмотр инспектора',
  pickup_before: 'Площадка до вывоза',
  pickup_after: 'Площадка после вывоза',
  citizen: 'Фото жителя',
}

export const ORDER_STATUS = {
  open: { label: 'В работе', tone: 'blue' },
  submitted: { label: 'На приёмке', tone: 'amber' },
  accepted: { label: 'Принято', tone: 'green' },
  rejected: { label: 'Возвращено', tone: 'red' },
}

export const VERDICT = {
  ok: { label: 'Подтверждено', tone: 'green', icon: '✓' },
  review: { label: 'Нужна проверка', tone: 'amber', icon: '?' },
  rejected: { label: 'Отклонено', tone: 'red', icon: '✕' },
}

export function haversine(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null
  const R = 6371000
  const toRad = (x) => (x * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export function fmtDist(m) {
  if (m == null) return '—'
  return m < 1000 ? `${Math.round(m)} м` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} км`
}

export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 64
  let d = 0
  for (let i = 0; i < a.length; i += 4) {
    let x = parseInt(a.slice(i, i + 4), 16) ^ parseInt(b.slice(i, i + 4), 16)
    while (x) { d += x & 1; x >>= 1 }
  }
  return d
}

// Точка, к которой привязано доказательство: точка дефекта или центр объекта
export function targetFor(object, order) {
  if (order && order.lat != null) return { lat: order.lat, lng: order.lng, radius: 40 }
  if (!object) return null
  if (object.module === 'road' && object.path?.length) return { path: object.path, radius: 60 }
  return { lat: object.lat, lng: object.lng, radius: object.radius || 80 }
}

export function distanceToTarget(pos, target) {
  if (!pos || pos.lat == null || !target) return null
  if (target.path) return Math.min(...target.path.map(([lat, lng]) => haversine(pos, { lat, lng })))
  return haversine(pos, target)
}

// Главная функция: проверяет доказательство и ставит балл доверия 0–100.
// ev: {lat,lng,accuracy,device_time,capture,phash,blur,brightness,similarity,stage,simulated}
// ctx: {target, others:[{id,phash,sha256,object_name,server_time}], serverNow, pairId}
// pairId: парное фото «до» той же работы. С ним сравнивается сцена, а не повторы:
// похожесть «до» и «после» естественна, повтором считается только тот же самый файл.
export function scoreEvidence(ev, ctx) {
  const checks = []
  const add = (code, ok, label, penalty = 0, info = false) => checks.push({ code, ok, label, penalty: ok ? 0 : penalty, info })
  const now = ctx.serverNow ?? Date.now()

  add('capture', ev.capture === 'camera',
    ev.capture === 'camera' ? 'Снято камерой внутри FAKT' : 'Загружено из файла, а не снято камерой', 40)

  if (ev.lat == null) add('gps', false, 'Нет координат GPS', 50)
  else if (ev.accuracy > 100) add('gps', false, `Низкая точность GPS: ±${Math.round(ev.accuracy)} м`, 15)
  else add('gps', true, `GPS точность ±${Math.round(ev.accuracy ?? 0)} м`)

  if (ctx.target && ev.lat != null) {
    const d = distanceToTarget(ev, ctx.target)
    const r = ctx.target.radius
    if (d <= r) add('distance', true, `Снято на месте: ${fmtDist(d)} от точки`)
    else if (d <= r * 4) add('distance', false, `Снято в ${fmtDist(d)} от точки (допуск ${r} м)`, 25)
    else add('distance', false, `Снято в ${fmtDist(d)} от объекта`, 60)
  }

  // Снято без связи: телефон хранит, сколько прошло с момента съёмки (по монотонным часам)
  const delay = ev.delay_ms > 0 ? ev.delay_ms : 0
  const skew = Math.abs(now - delay - new Date(ev.device_time).getTime())
  if (skew <= 10 * 60000) add('time', true, 'Время съёмки совпадает с сервером')
  else add('time', false, `Часы телефона расходятся с сервером на ${humanDuration(skew)}`, 25)
  if (delay > 5 * 60000) {
    if (delay <= DAY) add('offline', true, `Снято без связи, отправлено через ${humanDuration(delay)}`, 0, true)
    else add('offline', false, `Отправлено через ${humanDuration(delay)} после съёмки: время не подтверждено сервером`, 25)
  }

  let dup = null
  for (const o of ctx.others || []) {
    if (!o.phash || o.id === ev.id) continue
    if (ctx.pairId && o.id === ctx.pairId && !(ev.sha256 && o.sha256 === ev.sha256)) continue
    const h = hamming(ev.phash, o.phash)
    if (h <= 6 && (!dup || h < dup.h)) dup = { ...o, h }
  }
  if (dup && dup.id === ctx.pairId) add('duplicate', false, 'Вместо фото «после» отправлен тот же снимок, что «до»', 70)
  else if (dup) add('duplicate', false, `Это фото уже сдавали: ${dup.object_name || 'другой объект'}, ${fmtDate(dup.server_time)}`, 70)
  else add('duplicate', true, 'Фото уникально, повторов в базе нет')

  if (ev.blur != null && ev.blur < 40) add('quality', false, 'Фото размыто, детали не видны', 10)
  else if (ev.brightness != null && ev.brightness < 35) add('quality', false, 'Слишком темно', 10)
  else add('quality', true, 'Качество снимка достаточное')

  if (ev.stage === 'after' || ev.stage === 'pickup_after') {
    if (ev.similarity == null) add('scene', false, 'Нет фото «до» для сравнения', 5)
    else if (ev.similarity < 0.42) add('scene', false, `Сцена не совпадает с фото «до» (${pct(ev.similarity)})`, 30)
    else if (ev.similarity > 0.975) add('scene', false, 'Фото «после» почти копия «до»: изменений не видно', 55)
    else add('scene', true, `Та же сцена, что на фото «до» (${pct(ev.similarity)}), есть изменения`)
  }

  if (ev.simulated) add('sim', true, 'Демо-режим: позиция имитирована', 0, true)

  const penalty = checks.reduce((s, c) => s + c.penalty, 0)
  const score = Math.max(0, 100 - penalty)
  const verdict = score >= 80 ? 'ok' : score >= 50 ? 'review' : 'rejected'
  return { checks, score, verdict }
}

export function pct(x) { return `${Math.round(x * 100)}%` }

export function humanDuration(ms) {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m} мин`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} ч`
  const d = Math.round(h / 24)
  if (d < 400) return `${d} дн`
  return `${(d / 365).toFixed(1)} г`
}

export function fmtDate(d, withTime = false) {
  if (!d) return '—'
  const x = new Date(d)
  const date = x.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return withTime ? `${date} ${x.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : date
}

export function fmtMoney(v) {
  if (v == null) return '—'
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1).replace('.', ',')} млрд ₸`
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1).replace('.', ',')} млн ₸`
  return `${Math.round(v).toLocaleString('ru-RU')} ₸`
}

export function daysAgo(d, now = Date.now()) {
  if (!d) return Infinity
  return (now - new Date(d).getTime()) / DAY
}

// План по графику: S-кривая между началом и окончанием договора
export function plannedProgress(o, now = Date.now()) {
  const s = new Date(o.start_date).getTime()
  const e = new Date(o.end_date).getTime()
  if (!s || !e || e <= s) return null
  const t = Math.min(1, Math.max(0, (now - s) / (e - s)))
  const sCurve = t * t * (3 - 2 * t)
  return Math.round(sCurve * 100)
}

// Статус объекта для карты: green / amber / red + список причин
export function objectHealth(o, ctx) {
  const now = ctx.now ?? Date.now()
  const flags = []
  if (o.module === 'build') {
    const plan = plannedProgress(o, now)
    const lag = plan == null ? 0 : plan - (o.progress_confirmed ?? 0)
    if (lag >= 15) flags.push({ tone: 'red', text: `Отставание ${lag} п.п.: по графику ${plan}%, подтверждено ${o.progress_confirmed ?? 0}%` })
    else if (lag >= 5) flags.push({ tone: 'amber', text: `Отставание ${lag} п.п. от графика` })
    const gap = (o.progress_claimed ?? 0) - (o.progress_confirmed ?? 0)
    if (gap >= 10) flags.push({ tone: 'red', text: `Заявлено ${o.progress_claimed}%, подтверждено фактом ${o.progress_confirmed}%` })
    const age = daysAgo(o.last_report_at, now)
    if (age > 14) flags.push({ tone: 'red', text: age === Infinity ? 'Нет ни одного фотоотчёта' : `Нет фотоотчёта ${Math.floor(age)} дн` })
    else if (age > 7) flags.push({ tone: 'amber', text: `Фотоотчёт устарел: ${Math.floor(age)} дн` })
  }
  if (o.module === 'waste') {
    if (o.site_state === 'full') flags.push({ tone: 'red', text: 'Площадка переполнена, ждёт вывоза' })
    const age = daysAgo(o.last_report_at, now)
    const limit = 7 / Math.max(1, o.pickups_per_week || 3) + 1
    if (age > limit * 2) flags.push({ tone: 'red', text: `Вывоз не подтверждён ${Math.floor(age)} дн` })
    else if (age > limit) flags.push({ tone: 'amber', text: `Вывоз не подтверждён ${Math.floor(age)} дн` })
  }
  if (o.module === 'road') {
    const age = daysAgo(o.last_inspected_at, now)
    if (age > 30) flags.push({ tone: 'amber', text: age === Infinity ? 'Участок ещё не осматривали' : `Не осматривался ${Math.floor(age)} дн` })
  }
  for (const ord of ctx.orders?.filter((x) => x.object_id === o.id) || []) {
    if (isOverdue(ord, now)) flags.push({ tone: 'red', text: `Просрочена заявка: ${ord.title}` })
    if (ord.status === 'rejected') flags.push({ tone: 'red', text: `Работа возвращена: ${ord.reject_reason || ord.title}` })
  }
  const tone = flags.some((f) => f.tone === 'red') ? 'red' : flags.some((f) => f.tone === 'amber') ? 'amber' : 'green'
  return { tone, flags }
}

// Когда подрядчик фактически сдал работу: время фото «после», иначе время приёмки
export function doneAt(o, evidence = []) {
  const after = o.after_id ? evidence.find((e) => e.id === o.after_id) : null
  return new Date(after?.server_time || o.accepted_at).getTime()
}

export function isOverdue(ord, now = Date.now()) {
  return (ord.status === 'open' || ord.status === 'rejected') && ord.due_at && new Date(ord.due_at).getTime() < now
}

export function isFresh(o, now = Date.now()) {
  if (o.module === 'build') return daysAgo(o.last_report_at, now) <= 7
  if (o.module === 'waste') return daysAgo(o.last_report_at, now) <= 7 / Math.max(1, o.pickups_per_week || 3) + 1
  if (o.module === 'road') return daysAgo(o.last_inspected_at, now) <= 30
  return false
}

// Рейтинг подрядчика 0–100 и класс A–D
export function contractorStats(c, { orders, evidence, objects }) {
  const os = orders.filter((o) => o.contractor_id === c.id)
  const closed = os.filter((o) => o.status === 'accepted')
  const onTime = closed.filter((o) => !o.due_at || doneAt(o, evidence) <= new Date(o.due_at).getTime())
  const overdue = os.filter((o) => isOverdue(o))
  const ev = evidence.filter((e) => e.contractor_id === c.id || os.some((o) => o.id === e.order_id))
  const contractorEv = ev.filter((e) => ['after', 'progress', 'pickup_before', 'pickup_after'].includes(e.stage))
  const rejected = contractorEv.filter((e) => e.verdict === 'rejected')
  const avgScore = contractorEv.length ? contractorEv.reduce((s, e) => s + e.score, 0) / contractorEv.length : 100
  const objs = objects.filter((o) => o.contractor_id === c.id)
  const blocked = objs.filter((o) => o.module === 'build').reduce((s, o) => s + Math.max(0, (o.progress_claimed - o.progress_confirmed) / 100) * (o.amount || 0), 0)
    + os.filter((o) => o.status === 'rejected').reduce((s, o) => s + (o.amount || 0), 0)
  const onTimeRate = closed.length ? onTime.length / closed.length : 1
  const repeats = os.filter((o) => o.warranty_of).length
  const penalty = os.reduce((sum, o) => sum + orderPenalty(o, evidence), 0) + objs.reduce((sum, o) => sum + objectPenalty(o), 0)
  const rejRate = contractorEv.length ? rejected.length / contractorEv.length : 0
  // Дисциплина: сроки по заявкам, отставание строек, свежесть вывоза
  const parts = []
  if (os.length) parts.push(onTimeRate * (1 - overdue.length / os.length))
  const builds = objs.filter((o) => o.module === 'build' && o.status !== 'done')
  if (builds.length) parts.push(builds.filter((o) => { const p = plannedProgress(o); return p == null || p - (o.progress_confirmed ?? 0) < 15 }).length / builds.length)
  const sites = objs.filter((o) => o.module === 'waste')
  if (sites.length) parts.push(sites.filter((o) => isFresh(o)).length / sites.length)
  const discipline = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 1
  const honesty = Math.max(0, 1 - rejRate * 2.5 - (closed.length ? (repeats / closed.length) * 1.5 : 0))
  const index = Math.round(Math.max(0, Math.min(100, avgScore * 0.3 + honesty * 40 + discipline * 30)))
  const grade = index >= 85 ? 'A' : index >= 70 ? 'B' : index >= 55 ? 'C' : 'D'
  return { orders: os.length, closed: closed.length, onTimeRate, discipline, overdue: overdue.length, evidence: contractorEv.length, rejected: rejected.length, avgScore: Math.round(avgScore), blocked, index, grade, objects: objs.length, repeats, penalty }
}

// Покрытие дорог: доля вершин участка в 150 м от трека инспектора за 30 дней
export function roadCoverage(road, tracks, now = Date.now()) {
  const recent = tracks.filter((t) => daysAgo(t.ended_at || t.started_at, now) <= 30)
  if (!road.path?.length) return 0
  let hit = 0
  for (const [lat, lng] of road.path) {
    const p = { lat, lng }
    if (recent.some((t) => t.points.some(([a, b]) => haversine(p, { lat: a, lng: b }) <= 150))) hit++
  }
  return hit / road.path.length
}

export function pathLengthKm(path) {
  let s = 0
  for (let i = 1; i < path.length; i++) s += haversine({ lat: path[i - 1][0], lng: path[i - 1][1] }, { lat: path[i][0], lng: path[i][1] })
  return s / 1000
}

// Цепочка журнала: каждая запись содержит хэш предыдущей
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function auditPayload(e) {
  return [e.prev_hash || '', e.at, e.actor || '', e.action, e.entity, e.entity_id || '', e.summary || ''].join('|')
}

// Настройки акимата (меняются в разделе «Справочники → Настройки» и хранятся в базе)
export const CONFIG = {
  warranty_months: 12, // гарантийный срок на ремонт по договору
  warranty_radius: 50, // повторный дефект ближе этого расстояния к принятому ремонту, м
  penalty_rate: 0.001, // неустойка за день просрочки (0,1% от суммы)
  penalty_cap: 0.1, // не более 10% от суммы
  reaction_hours: 24, // норматив реакции перевозчика на переполнение
}
export const DEFAULT_DEFECT_DAYS = Object.fromEntries(Object.entries(DEFECTS).map(([k, d]) => [k, d.days]))

export function applySettings(s) {
  if (!s) return
  for (const k of Object.keys(CONFIG)) if (s[k] != null && !Number.isNaN(+s[k])) CONFIG[k] = +s[k]
  for (const [k, d] of Object.entries(s.defects || {})) if (DEFECTS[k] && +d > 0) DEFECTS[k].days = +d
}

// Санитарный норматив вывоза ТКО (санитарные правила МЗ РК): при температуре выше 0 °C
// не реже раза в сутки, при 0 °C и ниже не реже раза в 3 суток. Температура берётся
// с метеосервиса; без неё по сезону (март–ноябрь в Алматинской области теплее 0 °C).
let AIR = null
export function setAirTemp(t) { AIR = t == null || Number.isNaN(+t) ? null : +t }
export function airTemp() { return AIR }
export function wasteNorm(now = Date.now(), temp = AIR) {
  const m = new Date(now).getMonth()
  const warm = temp != null ? temp > 0 : m >= 2 && m <= 10
  const src = temp != null ? `сейчас ${temp > 0 ? '+' : ''}${Math.round(temp)} °C` : 'по сезону'
  return warm ? { days: 1, perWeek: 7, warm, label: `ежедневно: t выше 0 °C (${src})` } : { days: 3, perWeek: 3, warm, label: `не реже раза в 3 суток: t 0 °C и ниже (${src})` }
}

// Неустойка (оценка): ставка за день просрочки от суммы, с верхним пределом
export function penaltyFor(amount, daysLate) {
  if (!amount || !(daysLate > 0)) return 0
  return Math.round(Math.min(amount * CONFIG.penalty_rate * Math.ceil(daysLate), amount * CONFIG.penalty_cap))
}
// Просрочка считается до момента сдачи фото «после» (ожидание приёмки не вина подрядчика)
export function orderPenalty(o, evidence = [], now = Date.now()) {
  if (!o.due_at || o.warranty_of) return 0
  const after = o.after_id && (o.status === 'submitted' || o.status === 'accepted') ? evidence.find((e) => e.id === o.after_id) : null
  const end = after ? new Date(after.server_time).getTime() : o.status === 'accepted' ? new Date(o.accepted_at).getTime() : now
  return penaltyFor(o.amount, (end - new Date(o.due_at).getTime()) / DAY)
}
export function objectPenalty(o, now = Date.now()) {
  if (o.module !== 'build' || o.status === 'done' || !o.end_date || (o.progress_confirmed ?? 0) >= 100) return 0
  return penaltyFor(o.amount, (now - new Date(o.end_date).getTime()) / DAY)
}

// Гарантия: новый дефект рядом с ремонтом, принятым в пределах гарантийного срока
export function warrantyMatch(orders, { object_id, lat, lng }, now = Date.now()) {
  if (lat == null) return null
  let best = null
  for (const o of orders) {
    if (o.object_id !== object_id || o.status !== 'accepted' || o.lat == null || !o.accepted_at) continue
    if (now - new Date(o.accepted_at).getTime() > CONFIG.warranty_months * 30.44 * DAY) continue
    const d = haversine({ lat, lng }, o)
    if (d <= CONFIG.warranty_radius && (!best || d < best.d)) best = { order: o, d }
  }
  return best
}

// №6: время реакции на переполнение: от обращения жителя до фото вывоза
export function reactionStats(reports, now = Date.now()) {
  const list = reports.filter((r) => r.module === 'waste')
  const hours = list.map((r) => ((r.closed_at ? new Date(r.closed_at).getTime() : now) - new Date(r.created_at).getTime()) / 3600000)
  const closed = list.filter((r) => r.closed_at)
  const closedH = closed.map((r) => (new Date(r.closed_at) - new Date(r.created_at)) / 3600000).sort((a, b) => a - b)
  const inTime = hours.filter((h, i) => list[i].closed_at && h <= CONFIG.reaction_hours).length
  const lateOpen = hours.filter((h, i) => !list[i].closed_at && h > CONFIG.reaction_hours).length
  return {
    total: list.length, closed: closed.length, open: list.length - closed.length, lateOpen,
    median: closedH.length ? closedH[Math.floor(closedH.length / 2)] : null,
    // Ещё открытые, но не просроченные обращения в расчёт не входят
    inTimePct: closed.length + lateOpen ? inTime / (closed.length + lateOpen) : null,
  }
}
