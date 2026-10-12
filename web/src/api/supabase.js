// Онлайн-режим: Supabase (PostgreSQL + Auth + Storage + Realtime).
// Баллы доверия считает сервер (триггер fakt_evidence_verify), клиент только передаёт измерения.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache.js'
import { isNetworkError } from '../lib/outbox.js'

const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
// Номер обращения жителя: короткий, без похожих символов (0/O, 1/I), чтобы его можно было продиктовать
const reportId = () => 'rp' + Array.from(crypto.getRandomValues(new Uint8Array(7)), (b) => '23456789abcdefghjkmnpqrstuvwxyz'[b % 31]).join('')

export async function createSupabaseApi() {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  let me = null
  const signed = new Map()
  const listeners = new Set()
  let channel = null
  let timer = null

  const must = ({ data, error }) => { if (error) throw new Error(error.message); return data }

  async function fetchAll(table, order) {
    const out = []
    for (let from = 0; ; from += 1000) {
      let q = sb.from(table).select('*').range(from, from + 999)
      if (order) q = q.order(order, { ascending: true })
      const rows = must(await q)
      out.push(...rows)
      if (rows.length < 1000) break
    }
    return out
  }

  async function loadProfile() {
    const cached = await cacheGet('me')
    let session = null
    try { session = (await sb.auth.getSession()).data.session } catch (e) { if (!isNetworkError(e)) throw e }
    // Без связи токен не обновить: работаем с сохранённым профилем, отправка фото подождёт связи
    if (!session) { me = navigator.onLine === false && cached ? cached : null; return me }
    const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
    if (error && isNetworkError(error) && cached?.id === session.user.id) { me = cached; return me }
    if (error) throw new Error(error.message)
    me = data ? { ...data, id: data.id } : null
    if (me) cacheSet('me', me)
    return me
  }

  async function loadFresh() {
    const staff = me && me.role !== 'contractor'
    const [objects, orders, evidence, contractors, users, tracks, reports, audit, settings] = await Promise.all([
      fetchAll('objects'), fetchAll('orders'), fetchAll('evidence', 'server_time'), fetchAll('contractors'), fetchAll('profiles'),
      staff ? fetchAll('tracks') : [], fetchAll('reports'),
      staff ? sb.from('audit').select('*').order('id', { ascending: false }).limit(400).then(must).then((r) => r.reverse()) : [],
      sb.from('settings').select('data').eq('id', 'main').maybeSingle().then(must).then((r) => r?.data || {}),
    ])
    return { objects, orders, evidence, contractors, users, tracks, reports, audit, settings }
  }

  function listen() {
    if (channel) return
    const ping = () => { clearTimeout(timer); timer = setTimeout(() => listeners.forEach((f) => f()), 400) }
    channel = sb.channel('fakt-live')
    for (const t of ['orders', 'evidence', 'reports', 'objects', 'contractors', 'settings']) channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, ping)
    channel.subscribe()
  }

  async function upload(path, blob) {
    const { error } = await sb.storage.from('evidence').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
    // Повторная отправка из очереди: файл уже загружен в прошлый раз
    if (error && !/exists|duplicate/i.test(error.message)) throw new Error(error.message)
    return `storage:${path}`
  }

  return {
    mode: 'online',
    async init() { await loadProfile(); if (me) listen(); return me },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Неверный email или пароль' : error.message)
      await loadProfile()
      if (!me) throw new Error('Профиль пользователя не найден. Обратитесь к администратору.')
      listen()
      return me
    },
    async signOut() { await sb.auth.signOut().catch(() => {}); await cacheDel('me'); await cacheDel('data'); me = null; if (channel) { sb.removeChannel(channel); channel = null } },
    me: () => me,
    subscribe(f) { listeners.add(f); return () => listeners.delete(f) },
    async load() {
      try {
        const d = await loadFresh()
        cacheSet('data', { at: new Date().toISOString(), user: me?.id, d })
        return d
      } catch (e) {
        const c = await cacheGet('data')
        if (isNetworkError(e) && c && c.user === me?.id) return { ...c.d, stale: c.at }
        throw e
      }
    },
    async photo(url) {
      if (!url) return null
      if (!url.startsWith('storage:')) return url
      const path = url.slice(8)
      const hit = signed.get(path)
      if (hit && hit.exp > Date.now()) return hit.url
      const { data, error } = await sb.storage.from('evidence').createSignedUrl(path, 3600)
      if (error) return null
      signed.set(path, { url: data.signedUrl, exp: Date.now() + 3500 * 1000 })
      return data.signedUrl
    },
    async addEvidence(input, blob) {
      const id = input.id || uid('e')
      const photo_url = blob ? await upload(`${input.object_id}/${id}.jpg`, blob) : input.photo_url
      const row = { ...input, id, photo_url }
      delete row.author_name
      const { error } = await sb.from('evidence').insert(row)
      // Ответ мог потеряться при обрыве связи: запись с этим id уже есть, повтор не создаёт дубль
      if (error && error.code !== '23505') throw new Error(error.message)
      return must(await sb.from('evidence').select('*').eq('id', id).single())
    },
    async createOrder(input) {
      // Гарантию и связь с обращением определяет сервер (триггер fakt_orders_log)
      const row = { id: uid('o'), status: 'open', ...input }
      const { data, error } = await sb.from('orders').insert(row).select().single()
      // Повтор из очереди после обрыва связи: заявка уже создана
      if (error?.code === '23505') return must(await sb.from('orders').select('*').eq('id', row.id).single())
      if (error) throw new Error(error.message)
      return data
    },
    async linkBefore() { /* связь делает триггер fakt_evidence_apply */ },
    async decideOrder(id, accept, reason) {
      must(await sb.from('orders').update(accept ? { status: 'accepted' } : { status: 'rejected', reject_reason: reason || 'Работа не подтверждена' }).eq('id', id))
    },
    async reviewEvidence(id, approve, note) { must(await sb.rpc('fakt_review_evidence', { p_id: id, p_approve: approve, p_note: note || null })) },
    async updateObject(id, patch) { must(await sb.from('objects').update(patch).eq('id', id)) },
    async addObject(input) {
      const row = { id: uid(input.module[0]), status: 'active', ...input }
      must(await sb.from('objects').insert(row))
      return row
    },
    async saveTrack(track) {
      const row = { id: uid('t'), ...track }
      must(await sb.from('tracks').insert(row))
      return row
    },
    async addReport(input, blob) {
      const id = reportId()
      const photo_url = blob ? await upload(`citizen/${id}.jpg`, blob) : null
      must(await sb.from('reports').insert({ id, status: 'new', author: 'Житель', ...input, photo_url }))
      return { id }
    },
    async updateReport(id, patch) { must(await sb.from('reports').update(patch).eq('id', id)) },
    async signAct({ entity, entity_id, summary }) { must(await sb.rpc('fakt_sign_act', { p_entity: entity, p_id: entity_id, p_summary: summary })) },
    async verifyChain() { return must(await sb.rpc('fakt_verify_audit')) },
    async tamperDemo() {
      const { data } = await sb.from('audit').select('id').order('id', { ascending: false }).limit(1)
      const target = data?.[0]?.id
      const { error, count } = await sb.from('audit').update({ summary: 'ПОДДЕЛКА' }, { count: 'exact' }).eq('id', target)
      return { blocked: !!error || !count, message: error?.message || 'Изменение отклонено политикой доступа: журнал доступен только для чтения' }
    },
    async nearest(lat, lng, module) { return must(await sb.rpc('fakt_nearest_object', { p_lat: lat, p_lng: lng, p_module: module })) },
    async aiAnalyze(evidenceId) {
      const { data, error } = await sb.functions.invoke('fakt-ai', { body: { id: evidenceId } })
      if (error || !data) return { available: false, reason: 'ИИ-эксперт включается в пилоте: модель размещается в контуре акимата, фото не покидают РК' }
      return data
    },
    async saveContractor(input) {
      if (input.id) { const { id, ...patch } = input; must(await sb.from('contractors').update(patch).eq('id', id)); return input }
      return must(await sb.from('contractors').insert({ ...input, id: uid('c') }).select().single())
    },
    async importObjects(list) {
      const rows = list.map((x) => ({ id: uid(x.module[0]), status: 'active', progress_claimed: 0, progress_confirmed: 0, ...x }))
      for (let i = 0; i < rows.length; i += 200) must(await sb.from('objects').insert(rows.slice(i, i + 200)))
      return rows.length
    },
    async saveSettings(data) { must(await sb.from('settings').update({ data }).eq('id', 'main')) },
    async publicObject(code) { return must(await sb.rpc('fakt_public_object', { p_code: code })) },
    async reportStatus(id) { return must(await sb.rpc('fakt_report_status', { p_id: id })) },
    async addUser(input) {
      const { data, error } = await sb.functions.invoke('fakt-admin', { body: { action: 'create_user', ...input } })
      if (error) throw new Error(error.message)
      if (data?.error) throw new Error(data.error)
      return data
    },
  }
}
