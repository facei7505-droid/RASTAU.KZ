// Офлайн-режим: вся система работает в браузере (IndexedDB).
// Нужен для показа без интернета и для автотестов.
import { buildSeed, USERS, DEMO_PASSWORD } from '../lib/seed.js'
import { verifyEvidence, applyEvidence, appendAudit, verifyChain, prepareOrder, closeReportsByOrder } from './logic.js'
import { sha256Hex, auditPayload, objectHealth } from '../lib/verify.js'

const DB = 'fakt-offline', STORE = 'kv', KEY = 'state-v5'

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function kvGet(k) {
  const db = await idb()
  return new Promise((res) => { const q = db.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined) })
}
async function kvSet(k, v) {
  const db = await idb()
  return new Promise((res) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, k); t.oncomplete = () => res(); t.onerror = () => res() })
}
const blobToDataUrl = (b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b) })
const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
// Номер обращения жителя: короткий, без похожих символов (0/O, 1/I), чтобы его можно было продиктовать
const reportId = () => 'rp' + Array.from(crypto.getRandomValues(new Uint8Array(7)), (b) => '23456789abcdefghjkmnpqrstuvwxyz'[b % 31]).join('')

export function createLocalApi() {
  let state = null
  let me = null
  const listeners = new Set()
  const emit = () => listeners.forEach((f) => f())
  const save = () => kvSet(KEY, state)

  async function seedAudit(s) {
    s.audit = []
    const events = [
      ...s.orders.map((o) => ({ at: o.created_at, actor: 'Данияр Касымов', action: 'order.create', entity: 'order', entity_id: o.id, summary: `Заявка подрядчику: ${o.title}` })),
      ...s.evidence.map((e) => ({ at: e.server_time, actor: e.author_name || '—', action: 'evidence.add', entity: 'evidence', entity_id: e.id, summary: `${e.verdict === 'rejected' ? 'Отклонено' : e.verdict === 'review' ? 'На проверку' : 'Подтверждено'} (${e.score}/100): ${s.objects.find((o) => o.id === e.object_id)?.code}` })),
      ...s.orders.filter((o) => o.accepted_at).map((o) => ({ at: o.accepted_at, actor: 'Данияр Касымов', action: 'order.accept', entity: 'order', entity_id: o.id, summary: `Работа принята: ${o.title}` })),
    ].sort((a, b) => a.at.localeCompare(b.at)).slice(-400)
    let prev = ''
    let id = 0
    for (const e of events) {
      const x = { id: ++id, prev_hash: prev, ...e }
      x.hash = await sha256Hex(auditPayload(x))
      prev = x.hash
      s.audit.push(x)
    }
  }

  return {
    mode: 'offline',
    async init() {
      state = await kvGet(KEY)
      if (!state) await this.reset(false)
      state.settings ||= {}
      const uidSaved = localStorage.getItem('fakt-offline-user')
      me = state.users.find((u) => u.id === uidSaved) || null
      return me
    },
    async reset(notify = true) {
      state = buildSeed(Date.now())
      state.photos = {}
      await seedAudit(state)
      await save()
      if (notify) emit()
    },
    async signIn(email, password) {
      const u = state.users.find((x) => x.email === email.trim().toLowerCase())
      if (!u || password !== DEMO_PASSWORD) throw new Error('Неверный email или пароль')
      me = u
      localStorage.setItem('fakt-offline-user', u.id)
      await appendAudit(state, { actor: u.full_name, action: 'auth.login', entity: 'user', entity_id: u.id, summary: 'Вход в систему' })
      await save()
      return u
    },
    async signOut() { me = null; localStorage.removeItem('fakt-offline-user') },
    me: () => me,
    subscribe(f) { listeners.add(f); return () => listeners.delete(f) },
    async load() {
      const { photos, ...rest } = state
      return structuredClone(rest)
    },
    async photo(url) {
      if (!url) return null
      if (url.startsWith('local:')) return state.photos?.[url.slice(6)] || null
      return url
    },
    async addEvidence(input, blob) {
      const ev = verifyEvidence(state, { id: uid('e'), author_id: me?.id, author_name: me?.full_name || input.author_name || 'Житель', contractor_id: me?.contractor_id || null, ...input })
      ev.photo_url = `local:${ev.id}`
      if (blob) state.photos[ev.id] = await blobToDataUrl(blob)
      state.evidence.push(ev)
      applyEvidence(state, ev)
      const obj = state.objects.find((o) => o.id === ev.object_id)
      await appendAudit(state, { actor: ev.author_name, action: 'evidence.add', entity: 'evidence', entity_id: ev.id, summary: `${ev.verdict === 'rejected' ? 'Отклонено' : ev.verdict === 'review' ? 'На проверку' : 'Подтверждено'} (${ev.score}/100): ${obj?.code || ''} ${obj?.name || ''}` })
      await save(); emit()
      return structuredClone(ev)
    },
    async createOrder(input) {
      const ord = prepareOrder(state, { id: uid('o'), status: 'open', created_at: new Date().toISOString(), created_by: me?.id, after_id: null, accepted_at: null, accepted_by: null, reject_reason: null, ...input })
      state.orders.push(ord)
      if (ord.report_id) { const r = state.reports.find((x) => x.id === ord.report_id); if (r) Object.assign(r, { order_id: ord.id, status: 'in_work' }) }
      await appendAudit(state, { actor: me?.full_name, action: 'order.create', entity: 'order', entity_id: ord.id, summary: `${ord.warranty_of ? 'Гарантийная заявка (за счёт подрядчика)' : 'Заявка подрядчику'}: ${ord.title}` })
      await save(); emit()
      return structuredClone(ord)
    },
    async linkBefore(orderId, evidenceId) {
      const o = state.orders.find((x) => x.id === orderId)
      if (!o) return
      o.before_id = evidenceId
      const ev = state.evidence.find((e) => e.id === evidenceId)
      if (ev) ev.order_id = orderId
      await save(); emit()
    },
    async decideOrder(id, accept, reason) {
      const o = state.orders.find((x) => x.id === id)
      if (accept) { o.status = 'accepted'; o.accepted_at = new Date().toISOString(); o.accepted_by = me?.id; o.reject_reason = null; closeReportsByOrder(state, o) }
      else { o.status = 'rejected'; o.reject_reason = reason || 'Работа не подтверждена' }
      await appendAudit(state, { actor: me?.full_name, action: accept ? 'order.accept' : 'order.reject', entity: 'order', entity_id: id, summary: `${accept ? 'Работа принята' : 'Работа возвращена'}: ${o.title}${reason ? ` — ${reason}` : ''}` })
      await save(); emit()
    },
    async reviewEvidence(id, approve, note) {
      const ev = state.evidence.find((x) => x.id === id)
      ev.review = approve ? 'approved' : 'declined'
      ev.review_note = note || null
      ev.reviewed_by = me?.full_name
      const o = state.objects.find((x) => x.id === ev.object_id)
      if (approve && o?.module === 'build' && ev.progress != null) o.progress_confirmed = Math.max(o.progress_confirmed || 0, ev.progress)
      // Отклонили ранее засчитанный отчёт: подтверждённый процент пересчитывается по оставшимся доказательствам
      if (!approve && o?.module === 'build') o.progress_confirmed = Math.max(0, ...state.evidence.filter((e) => e.object_id === o.id && e.progress != null && e.review !== 'declined' && (e.review === 'approved' || e.verdict === 'ok' || e.stage === 'inspection')).map((e) => e.progress))
      await appendAudit(state, { actor: me?.full_name, action: approve ? 'evidence.approve' : 'evidence.decline', entity: 'evidence', entity_id: id, summary: `${approve ? 'Отчёт подтверждён инспектором' : 'Отчёт отклонён инспектором'}: ${o?.code} ${note || ''}` })
      await save(); emit()
    },
    async updateObject(id, patch) {
      const o = state.objects.find((x) => x.id === id)
      Object.assign(o, patch)
      await appendAudit(state, { actor: me?.full_name, action: 'object.update', entity: 'object', entity_id: id, summary: `Изменён объект ${o.code}: ${Object.keys(patch).join(', ')}` })
      await save(); emit()
    },
    async addObject(input) {
      const o = { id: uid(input.module[0]), status: 'active', progress_claimed: 0, progress_confirmed: 0, last_report_at: null, ...input }
      state.objects.push(o)
      await appendAudit(state, { actor: me?.full_name, action: 'object.create', entity: 'object', entity_id: o.id, summary: `Добавлен объект ${o.code} ${o.name}` })
      await save(); emit()
      return o
    },
    async saveTrack(track) {
      const t = { id: uid('t'), inspector_id: me?.id, ...track }
      state.tracks.push(t)
      for (const road of state.objects.filter((o) => o.module === 'road')) {
        if (road.path.some(([a, b]) => t.points.some(([x, y]) => Math.abs(a - x) < 0.0015 && Math.abs(b - y) < 0.002))) road.last_inspected_at = t.ended_at
      }
      await appendAudit(state, { actor: me?.full_name, action: 'track.save', entity: 'track', entity_id: t.id, summary: `Объезд: ${t.km} км, ${t.points.length} точек GPS` })
      await save(); emit()
      return t
    },
    async addReport(input, blob) {
      const rep = { id: reportId(), created_at: new Date().toISOString(), status: 'new', author: 'Житель', ...input }
      if (blob) { state.photos[rep.id] = await blobToDataUrl(blob); rep.photo_url = `local:${rep.id}` }
      state.reports.push(rep)
      if (rep.object_id) {
        const o = state.objects.find((x) => x.id === rep.object_id)
        if (o?.module === 'waste') o.site_state = 'full'
      }
      await appendAudit(state, { actor: 'Житель', action: 'report.add', entity: 'report', entity_id: rep.id, summary: `Обращение: ${rep.text}` })
      await save(); emit()
      return rep
    },
    async updateReport(id, patch) {
      const rep = state.reports.find((x) => x.id === id)
      Object.assign(rep, patch)
      await appendAudit(state, { actor: me?.full_name, action: 'report.update', entity: 'report', entity_id: id, summary: `Обращение: статус «${patch.status}»` })
      await save(); emit()
    },
    async signAct({ entity, entity_id, summary }) {
      await appendAudit(state, { actor: me?.full_name, action: 'act.sign', entity, entity_id, summary })
      await save(); emit()
    },
    async verifyChain() { return verifyChain(state.audit) },
    async tamperDemo() {
      // Для демонстрации: подделываем запись журнала «задним числом»
      const e = state.audit[Math.floor(state.audit.length / 2)]
      e.summary = e.summary.replace('Отклонено', 'Подтверждено') + ' '
      await save(); emit()
      return { blocked: false, id: e.id }
    },
    async addUser(input) {
      const email = input.email.trim().toLowerCase()
      if (state.users.some((u) => u.email === email)) throw new Error('Пользователь с таким email уже есть')
      const u = { id: uid('u'), email, full_name: input.full_name, role: input.role, position: input.position || '', contractor_id: input.contractor_id || null }
      state.users.push(u)
      await appendAudit(state, { actor: me?.full_name, action: 'user.create', entity: 'user', entity_id: u.id, summary: `Добавлен пользователь ${u.full_name} (${u.role})` })
      await save(); emit()
      return { ...u, password: DEMO_PASSWORD }
    },
    async saveContractor(input) {
      let c = input.id && state.contractors.find((x) => x.id === input.id)
      if (c) Object.assign(c, input)
      else { c = { ...input, id: uid('c') }; state.contractors.push(c) }
      await appendAudit(state, { actor: me?.full_name, action: input.id ? 'contractor.update' : 'contractor.create', entity: 'contractor', entity_id: c.id, summary: `${input.id ? 'Изменён' : 'Добавлен'} подрядчик ${c.name}, БИН ${c.bin}` })
      await save(); emit()
      return c
    },
    async importObjects(list) {
      for (const input of list) state.objects.push({ id: uid(input.module[0]), status: 'active', progress_claimed: 0, progress_confirmed: 0, last_report_at: null, site_state: 'ok', ...input })
      await appendAudit(state, { actor: me?.full_name, action: 'object.import', entity: 'object', entity_id: null, summary: `Импорт объектов из файла: ${list.length} шт.` })
      await save(); emit()
      return list.length
    },
    async saveSettings(s) {
      state.settings = s
      await appendAudit(state, { actor: me?.full_name, action: 'settings.update', entity: 'settings', entity_id: 'main', summary: 'Изменены нормативы и настройки' })
      await save(); emit()
    },
    async publicObject(code) {
      const o = state.objects.find((x) => x.code.toLowerCase() === String(code).toLowerCase())
      if (!o) return null
      return publicCard(o, state)
    },
    async reportStatus(id) {
      const r = state.reports.find((x) => x.id.toLowerCase() === String(id).toLowerCase())
      if (!r) return null
      const o = state.objects.find((x) => x.id === r.object_id)
      const c = o && state.contractors.find((x) => x.id === o.contractor_id)
      return { id: r.id, status: r.status, created_at: r.created_at, closed_at: r.closed_at || null, resolution: r.resolution || null, text: r.text, module: r.module, object_code: o?.code || null, object_name: o?.name || null, contractor: c?.name || null }
    },
    async nearest(lat, lng, module) {
      const { haversine } = await import('../lib/verify.js')
      let best = null
      for (const o of state.objects.filter((x) => x.module === module && x.lat != null)) {
        const d = haversine({ lat, lng }, o)
        if (!best || d < best.dist) best = { id: o.id, code: o.code, name: o.name, dist: Math.round(d) }
      }
      return best
    },
    async aiAnalyze() { return { available: false, reason: 'ИИ-эксперт работает в онлайн-версии с подключённым ключом' } },
  }
}

// Публичная карточка объекта (для QR-таблички): без персональных данных
export function publicCard(o, s) {
  const c = s.contractors.find((x) => x.id === o.contractor_id)
  const evs = s.evidence.filter((e) => e.object_id === o.id && e.verdict === 'ok').sort((a, b) => b.server_time.localeCompare(a.server_time))
  return {
    id: o.id, code: o.code, name: o.name, module: o.module, address: o.address, contractor: c?.name || null, contract_no: o.contract_no, amount: o.amount,
    start_date: o.start_date, end_date: o.end_date, progress_confirmed: o.progress_confirmed ?? null, site_state: o.site_state || null,
    last_fact_at: evs[0]?.server_time || null, last_photo: evs[0]?.photo_url?.startsWith('gen:') ? evs[0].photo_url : null,
    tone: objectHealth(o, { orders: s.orders }).tone, open_reports: s.reports.filter((r) => r.object_id === o.id && r.status !== 'closed').length,
  }
}
