// Одноразовая заливка демо-данных. Работает только на пустой базе.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildSeed } from './seed.js'

Deno.serve(async () => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const s = buildSeed(Date.now())
  const name = (id: string) => s.objects.find((o: any) => o.id === id)
  const audit = [
    ...s.orders.map((o: any) => ({ at: o.created_at, actor: 'Данияр Касымов', action: 'order.create', entity: 'order', entity_id: o.id, summary: `Заявка подрядчику: ${o.title}` })),
    ...s.evidence.map((e: any) => ({ at: e.server_time, actor: e.author_name || '—', action: 'evidence.add', entity: 'evidence', entity_id: e.id, summary: `${e.verdict === 'rejected' ? 'Отклонено' : e.verdict === 'review' ? 'На проверку' : 'Подтверждено'} (${e.score}/100): ${name(e.object_id)?.code} ${name(e.object_id)?.name}` })),
    ...s.orders.filter((o: any) => o.accepted_at).map((o: any) => ({ at: o.accepted_at, actor: 'Данияр Касымов', action: 'order.accept', entity: 'order', entity_id: o.id, summary: `Работа принята: ${o.title}` })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  const { data, error } = await sb.rpc('fakt_seed_load', { data: { objects: s.objects, orders: s.orders, evidence: s.evidence, tracks: s.tracks, reports: s.reports, audit } })
  return new Response(JSON.stringify({ data, error }), { headers: { 'Content-Type': 'application/json' } })
})
