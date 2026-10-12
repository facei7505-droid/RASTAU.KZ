// Разовая привязка демо-данных к реальной географии: дороги области Абай по настоящим трассам (OSRM),
// объекты Конаева на реальные здания (OpenStreetMap). Все связанные точки (заявки, фото, обращения, треки)
// сдвигаются вместе с объектом, поэтому расстояния и результаты проверок не меняются.
import { createClient } from 'npm:@supabase/supabase-js@2'

const KEY = Deno.env.get('GEO_KEY') ?? ''
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
type P = [number, number]

const R = 6371000, rad = (x: number) => (x * Math.PI) / 180
function hav(a: P, b: P) {
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1])
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}
function cum(path: P[]) { const c = [0]; for (let i = 1; i < path.length; i++) c.push(c[i - 1] + hav(path[i - 1], path[i]) / 1000); return c }
function at(path: P[], c: number[], km: number): P {
  if (km <= 0) return path[0]
  for (let i = 1; i < path.length; i++) if (c[i] >= km) {
    const t = (km - c[i - 1]) / ((c[i] - c[i - 1]) || 1)
    return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t]
  }
  return path[path.length - 1]
}
// Проекция точки на ломаную: км вдоль пути и точка основания
function project(p: P, path: P[], c: number[]) {
  const k = Math.cos(rad(p[0]))
  let best = { d: Infinity, km: 0, foot: path[0] as P }
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i]
    const ax = a[1] * k, ay = a[0], bx = b[1] * k, by = b[0], px = p[1] * k, py = p[0]
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy
    const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0
    const foot: P = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    const d = hav(p, foot)
    if (d < best.d) best = { d, km: c[i - 1] + (c[i] - c[i - 1]) * t, foot }
  }
  return best
}
const r5 = (x: number) => Math.round(x * 1e5) / 1e5

// Центры районов Конаева (по жилым массивам OpenStreetMap)
const ANCHOR: Record<string, P> = {
  'мкр. 1': [43.8587, 77.0600], 'мкр. 2': [43.8592, 77.0545], 'мкр. 3': [43.8515, 77.0585], 'мкр. 4': [43.8522, 77.0535],
  'Центр': [43.8660, 77.0625], 'Набережная': [43.8710, 77.0790], 'мкр. Жана Конаев': [43.8945, 77.0665],
  'мкр. Шенгельды': [43.8800, 77.0890], 'мкр. Кербулак': [43.8420, 77.0590], 'Промзона': [43.8320, 77.0490], 'Новый город': [43.8360, 77.0690],
}

async function overpassBuildings(): Promise<P[]> {
  const q = '[out:json][timeout:40];way["building"](43.826,77.040,43.902,77.102);out center 4000;'
  for (const host of ['https://maps.mail.ru/osm/tools/overpass', 'https://overpass-api.de', 'https://overpass.private.coffee', 'https://overpass.kumi.systems']) {
    try {
      const r = await fetch(host + '/api/interpreter?data=' + encodeURIComponent(q), { signal: AbortSignal.timeout(45000) })
      if (!r.ok) continue
      const j = await r.json()
      const pts = (j.elements || []).filter((e: any) => e.center).map((e: any) => [e.center.lat, e.center.lon] as P)
      if (pts.length > 300) return pts
    } catch (_) { /* следующий сервер */ }
  }
  throw new Error('Overpass недоступен')
}

async function osrm(a: P, b: P): Promise<P[]> {
  const u = `https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`
  for (let i = 0; i < 3; i++) {
    const r = await fetch(u, { signal: AbortSignal.timeout(20000) }).catch(() => null)
    if (!r) continue
    if (r.ok) { const j = await r.json(); if (j.routes?.[0]) return j.routes[0].geometry.coordinates.map(([lng, lat]: number[]) => [lat, lng] as P) }
    await new Promise((s) => setTimeout(s, 1500))
  }
  throw new Error('OSRM недоступен')
}

Deno.serve(async (req) => {
  if (req.headers.get('x-geo-key') !== KEY) return json({ error: 'forbidden' }, 403)
  const q = new URL(req.url).searchParams
  const apply = q.get('apply') === '1', part = q.get('part') || 'roads'
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  try {
    const all = async (t: string, cols: string) => { const { data, error } = await sb.from(t).select(cols).limit(5000); if (error) throw error; return data as any[] }
    const objects = await all('objects', 'id, module, code, district, lat, lng, path, length_km')
    const orders = await all('orders', 'id, object_id, lat, lng')
    const evidence = await all('evidence', 'id, object_id, order_id, lat, lng')
    const reports = await all('reports', 'id, object_id, lat, lng')
    const tracks = await all('tracks', 'id, points, km')
    const roads = objects.filter((o) => o.module === 'road')
    if (part === 'roads' && roads.some((r) => (r.path?.length || 0) > 100)) return json({ skipped: 'already applied' })

    const upd: { t: string; id: string; v: Record<string, unknown> }[] = []
    const orderDelta = new Map<string, P>()
    const stat: Record<string, unknown> = {}

    // ---------- Дороги ----------
    const roadGeo = new Map<string, { old: P[]; oc: number[]; neu: P[]; nc: number[] }>()
    const routes: P[][] = []
    if (part === 'roads') for (const r of roads) routes.push(await osrm(r.path[0], r.path[r.path.length - 1]))
    for (const [ri, road] of (part === 'roads' ? roads : []).entries()) {
      const old = road.path as P[], oc = cum(old)
      const full = routes[ri], fc = cum(full)
      const len = Math.min(Number(road.length_km), fc[fc.length - 1])
      const neu: P[] = []
      for (let km = 0; km < len; km += 1) neu.push(at(full, fc, km))
      neu.push(at(full, fc, len))
      const path = neu.map(([a, b]) => [r5(a), r5(b)] as P)
      const nc = cum(path)
      roadGeo.set(road.id, { old, oc, neu: path, nc })
      const mid = path[Math.floor(path.length / 2)]
      upd.push({ t: 'objects', id: road.id, v: { path, lat: mid[0], lng: mid[1] } })
      stat[road.code] = { old_km: Math.round(oc[oc.length - 1]), route_km: Math.round(fc[fc.length - 1]), new_km: Math.round(nc[nc.length - 1]), pts: path.length }
    }
    const mapOnRoad = (p: P, g: { old: P[]; oc: number[]; neu: P[]; nc: number[] }): P => {
      const pr = project(p, g.old, g.oc)
      const nf = at(g.neu, g.nc, Math.min(pr.km, g.nc[g.nc.length - 1]))
      return [r5(p[0] - pr.foot[0] + nf[0]), r5(p[1] - pr.foot[1] + nf[1])]
    }
    for (const o of orders) {
      const g = roadGeo.get(o.object_id)
      if (!g || o.lat == null) continue
      const np = mapOnRoad([o.lat, o.lng], g)
      orderDelta.set(o.id, [np[0] - o.lat, np[1] - o.lng])
      upd.push({ t: 'orders', id: o.id, v: { lat: np[0], lng: np[1] } })
    }
    // Треки: та же часть дороги (по километрам), точки через ~1 км, как вершины новой линии
    for (const tr of tracks) {
      const pts = tr.points as number[][]
      if (!pts?.length) continue
      let best: { id: string; d: number } | null = null
      for (const [id, g] of roadGeo) {
        const d = project([pts[0][0], pts[0][1]], g.old, g.oc).d + project([pts[pts.length - 1][0], pts[pts.length - 1][1]], g.old, g.oc).d
        if (!best || d < best.d) best = { id, d }
      }
      if (!best) continue
      const g = roadGeo.get(best.id)!
      const k0 = project([pts[0][0], pts[0][1]], g.old, g.oc).km, k1 = project([pts[pts.length - 1][0], pts[pts.length - 1][1]], g.old, g.oc).km
      const [lo, hi] = [Math.min(k0, k1), Math.max(k0, k1)]
      const t0 = pts[0][2], t1 = pts[pts.length - 1][2]
      const idx = g.nc.map((km, i) => [km, i]).filter(([km]) => km >= lo - 0.01 && km <= hi + 0.01).map(([, i]) => i)
      const np = idx.map((i, j) => [r5(g.neu[i][0] + (Math.random() - 0.5) * 0.0006), r5(g.neu[i][1] + (Math.random() - 0.5) * 0.0006), Math.round(t0 + ((t1 - t0) * j) / Math.max(1, idx.length - 1))])
      if (np.length < 2) continue
      let km = 0; for (let i = 1; i < np.length; i++) km += hav([np[i - 1][0], np[i - 1][1]], [np[i][0], np[i][1]]) / 1000
      upd.push({ t: 'tracks', id: tr.id, v: { points: np, km: Math.round(km) } })
    }

    // ---------- Конаев: объекты на реальные здания ----------
    const bld = part === 'city' ? await overpassBuildings() : []
    stat.buildings = bld.length
    const used = new Set<number>()
    const objDelta = new Map<string, P>()
    const city = objects.filter((o) => part === 'city' && o.module !== 'road' && o.lat != null).sort((a, b) => a.code.localeCompare(b.code))
    for (const o of city) {
      const anc = ANCHOR[o.district] || ANCHOR['Центр']
      const cand = bld.map((p, i) => ({ i, d: hav(anc, p) })).filter((x) => !used.has(x.i)).sort((a, b) => a.d - b.d).slice(0, 25)
      const pick = cand[Math.floor(Math.random() * cand.length)]
      used.add(pick.i)
      // Для стройки и площадки точка рядом со зданием, а не на крыше
      const p = bld[pick.i]
      const np: P = [r5(p[0] + (Math.random() - 0.5) * 0.0003), r5(p[1] + (Math.random() - 0.5) * 0.0004)]
      objDelta.set(o.id, [np[0] - o.lat, np[1] - o.lng])
      upd.push({ t: 'objects', id: o.id, v: { lat: np[0], lng: np[1] } })
    }
    for (const o of orders) {
      const d = objDelta.get(o.object_id)
      if (d && o.lat != null) { orderDelta.set(o.id, d); upd.push({ t: 'orders', id: o.id, v: { lat: r5(o.lat + d[0]), lng: r5(o.lng + d[1]) } }) }
    }

    // ---------- Фото и обращения сдвигаются вместе со своей заявкой или объектом ----------
    for (const e of evidence) {
      if (e.lat == null) continue
      const d = (e.order_id && orderDelta.get(e.order_id)) || objDelta.get(e.object_id)
      if (d) { upd.push({ t: 'evidence', id: e.id, v: { lat: r5(e.lat + d[0]), lng: r5(e.lng + d[1]) } }); continue }
      const g = roadGeo.get(e.object_id)
      if (g) { const np = mapOnRoad([e.lat, e.lng], g); upd.push({ t: 'evidence', id: e.id, v: { lat: np[0], lng: np[1] } }) }
    }
    for (const rp of reports) {
      if (rp.lat == null) continue
      const d = objDelta.get(rp.object_id)
      if (d) { upd.push({ t: 'reports', id: rp.id, v: { lat: r5(rp.lat + d[0]), lng: r5(rp.lng + d[1]) } }); continue }
      const g = roadGeo.get(rp.object_id)
      if (g) { const np = mapOnRoad([rp.lat, rp.lng], g); upd.push({ t: 'reports', id: rp.id, v: { lat: np[0], lng: np[1] } }) }
    }

    const counts: Record<string, number> = {}
    for (const u of upd) counts[u.t] = (counts[u.t] || 0) + 1
    if (!apply) return json({ dry_run: true, counts, stat, sample: upd.slice(0, 3) })

    // Дороги и треки последними: по длине пути функция понимает, что привязка уже сделана
    const order = ['evidence', 'reports', 'orders', 'tracks', 'objects']
    upd.sort((a, b) => order.indexOf(a.t) - order.indexOf(b.t))
    let done = 0
    for (let i = 0; i < upd.length; i += 25) {
      await Promise.all(upd.slice(i, i + 25).map(async (u) => {
        const { error } = await sb.from(u.t).update(u.v).eq('id', u.id)
        if (error) throw new Error(`${u.t} ${u.id}: ${error.message}`)
        done++
      }))
    }
    return json({ applied: done, counts, stat })
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
