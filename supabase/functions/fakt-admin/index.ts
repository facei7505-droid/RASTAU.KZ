// Создание учётных записей сотрудников акимата и подрядчиков. Вызывать может только руководитель (роль admin).
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function password() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const b = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(b, (x) => abc[x % abc.length]).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user } } = await caller.auth.getUser()
    if (!user) return json({ error: 'Нужен вход в систему' }, 401)
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (me?.role !== 'admin') return json({ error: 'Создавать пользователей может только руководитель' }, 403)

    const body = await req.json()
    if (body.action !== 'create_user') return json({ error: 'Неизвестное действие' }, 400)
    const email = String(body.email || '').trim().toLowerCase()
    const fullName = String(body.full_name || '').trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Некорректный email' }, 400)
    if (fullName.length < 3) return json({ error: 'Укажите ФИО' }, 400)
    if (!['admin', 'inspector', 'contractor'].includes(body.role)) return json({ error: 'Неизвестная роль' }, 400)
    if (body.role === 'contractor' && !body.contractor_id) return json({ error: 'Для подрядчика выберите организацию' }, 400)

    const pass = password()
    const { data: created, error } = await admin.auth.admin.createUser({ email, password: pass, email_confirm: true, user_metadata: { full_name: fullName } })
    if (error) return json({ error: /already/i.test(error.message) ? 'Пользователь с таким email уже есть' : error.message }, 400)
    const { error: pErr } = await admin.rpc('fakt_create_profile', {
      p_admin: user.id, p_id: created.user.id, p_email: email, p_full_name: fullName, p_role: body.role, p_position: String(body.position || ''), p_contractor: body.role === 'contractor' ? String(body.contractor_id) : '',
    })
    if (pErr) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: pErr.message }, 400) }
    return json({ id: created.user.id, email, password: pass })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
