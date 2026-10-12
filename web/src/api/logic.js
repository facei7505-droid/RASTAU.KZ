// «Серверная» логика для офлайн-режима. В Supabase то же самое делают
// триггеры fakt_evidence_verify / fakt_evidence_apply (supabase/schema.sql).
import { scoreEvidence, targetFor, sha256Hex, auditPayload, warrantyMatch } from '../lib/verify.js'

export function verifyEvidence(state, input, now = Date.now()) {
  const object = state.objects.find((o) => o.id === input.object_id)
  const order = input.order_id ? state.orders.find((o) => o.id === input.order_id) : null
  const target = input.stage === 'citizen' ? null : targetFor(object, input.stage === 'before' ? null : order)
  const others = state.evidence.map((e) => ({ id: e.id, phash: e.phash, sha256: e.sha256, server_time: e.server_time, object_name: state.objects.find((o) => o.id === e.object_id)?.name }))
  let pairId = null
  if (input.stage === 'after') pairId = order?.before_id || null
  if (input.stage === 'pickup_after') pairId = [...state.evidence].reverse().find((e) => e.object_id === input.object_id && e.stage === 'pickup_before' && now - new Date(e.server_time).getTime() < 12 * 3600000)?.id || null
  const ev = { ...input, server_time: new Date(now).toISOString() }
  const { checks, score, verdict } = scoreEvidence(ev, { target: target && (input.stage === 'before' ? { ...target, radius: Math.max(target.radius, 60) } : target), others, serverNow: now, pairId })
  return { ...ev, checks, score, verdict }
}

// Новая заявка: проверка гарантии и связь с обращением жителя
export function prepareOrder(state, input, now = Date.now()) {
  const ord = { ...input }
  if (ord.kind === 'defect') {
    const w = warrantyMatch(state.orders, ord, now)
    if (w) { ord.warranty_of = w.order.id; ord.amount = 0 }
  }
  return ord
}

export function closeReportsByOrder(state, ord, now = Date.now()) {
  for (const r of state.reports || []) if (r.order_id === ord.id && r.status !== 'closed') Object.assign(r, { status: 'closed', closed_at: new Date(now).toISOString(), resolution: `Работа принята по фото: ${ord.title}` })
}

// Последствия нового доказательства для объекта и заявки
export function applyEvidence(state, ev) {
  const o = state.objects.find((x) => x.id === ev.object_id)
  const ord = ev.order_id ? state.orders.find((x) => x.id === ev.order_id) : null
  if (o) {
    if (o.module === 'build' && (ev.stage === 'progress' || ev.stage === 'inspection')) {
      o.last_report_at = ev.server_time
      if (ev.progress != null) {
        o.progress_claimed = Math.max(o.progress_claimed || 0, ev.progress)
        if (ev.verdict === 'ok' || ev.stage === 'inspection') o.progress_confirmed = Math.max(o.progress_confirmed || 0, ev.progress)
      }
    }
    if (o.module === 'waste') {
      if (ev.stage === 'pickup_after' && ev.verdict !== 'rejected') {
        o.last_report_at = ev.server_time; o.site_state = 'ok'
        // Обращения жителей по площадке закрываются фотографией вывоза, а не отпиской
        for (const r of state.reports || []) if (r.object_id === o.id && r.status !== 'closed') Object.assign(r, { status: 'closed', closed_at: ev.server_time, resolution: `Вывоз подтверждён фото (${ev.score}/100)`, evidence_id: ev.id })
      }
      if (ev.stage === 'citizen' || (ev.stage === 'inspection' && ev.comment?.includes('переполн'))) o.site_state = 'full'
    }
    if (o.module === 'road' && (ev.stage === 'before' || ev.stage === 'inspection')) o.last_inspected_at = ev.server_time
  }
  if (ord && ev.stage === 'after') {
    ord.after_id = ev.id
    // Отклонённое сервером фото не доходит до инспектора: заявка сразу возвращается подрядчику
    if (ev.verdict === 'rejected') { ord.status = 'rejected'; ord.reject_reason = `Автоматически: ${(ev.checks || []).find((c) => !c.ok && c.penalty >= 25)?.label || 'низкий балл доверия'}` }
    else { ord.status = 'submitted'; ord.reject_reason = null }
  }
}

export async function appendAudit(state, entry) {
  const prev = state.audit[state.audit.length - 1]
  const e = { id: (prev?.id || 0) + 1, at: new Date().toISOString(), prev_hash: prev?.hash || '', ...entry }
  e.hash = await sha256Hex(auditPayload(e))
  state.audit.push(e)
  return e
}

export async function verifyChain(audit) {
  let prev = ''
  for (const e of audit) {
    if ((e.prev_hash || '') !== prev) return { ok: false, brokenAt: e.id, count: audit.length }
    const h = await sha256Hex(auditPayload(e))
    if (h !== e.hash) return { ok: false, brokenAt: e.id, count: audit.length }
    prev = e.hash
  }
  return { ok: true, count: audit.length, last: prev }
}
