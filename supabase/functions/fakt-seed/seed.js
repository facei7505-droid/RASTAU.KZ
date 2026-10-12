// Демо-данные FAKT. Все организации, люди, объекты и суммы вымышлены.
// Один и тот же набор используется в офлайн-режиме и для заливки в Supabase.
import { scoreEvidence, DEFECTS, DAY, pathLengthKm, plannedProgress } from './verify.js'

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const USERS = [
  { id: 'a0000000-0000-4000-8000-000000000001', email: 'akim@fakt.example', full_name: 'Ерлан Сапаров', role: 'admin', position: 'Заместитель акима, куратор строительства и ЖКХ', contractor_id: null },
  { id: 'a0000000-0000-4000-8000-000000000002', email: 'tehnadzor@fakt.example', full_name: 'Айгерим Нурланова', role: 'inspector', position: 'Технадзор, отдел строительства г. Конаев', contractor_id: null },
  { id: 'a0000000-0000-4000-8000-000000000003', email: 'inspector@fakt.example', full_name: 'Данияр Касымов', role: 'inspector', position: 'Инспектор, управление пассажирского транспорта и автодорог обл. Абай', contractor_id: null },
  { id: 'a0000000-0000-4000-8000-000000000004', email: 'stroy@fakt.example', full_name: 'Бауыржан Ахметов', role: 'contractor', position: 'Прораб', contractor_id: 'c3' },
  { id: 'a0000000-0000-4000-8000-000000000005', email: 'jol@fakt.example', full_name: 'Серик Омаров', role: 'contractor', position: 'Мастер участка', contractor_id: 'c5' },
  { id: 'a0000000-0000-4000-8000-000000000006', email: 'taza@fakt.example', full_name: 'Нурлан Жумабаев', role: 'contractor', position: 'Водитель мусоровоза', contractor_id: 'c6' },
]
export const DEMO_PASSWORD = 'fakt2026'

export const CONTRACTORS = [
  { id: 'c1', name: 'ТОО «Капшагай Курылыс»', bin: '180240011223', head: 'Нуржанов А.К.', phone: '+7 701 000 11 01', module: 'build' },
  { id: 'c2', name: 'ТОО «Жетысу Инфрастрой»', bin: '160540022334', head: 'Ким В.Л.', phone: '+7 701 000 11 02', module: 'build' },
  { id: 'c3', name: 'ТОО «СтройГарант-К»', bin: '210840033445', head: 'Ахметов Б.С.', phone: '+7 701 000 11 03', module: 'build' },
  { id: 'c4', name: 'ТОО «Семей Жол Сервис»', bin: '150340044556', head: 'Исабеков Е.М.', phone: '+7 701 000 11 04', module: 'road' },
  { id: 'c5', name: 'ТОО «Ертіс Автожол»', bin: '190940055667', head: 'Омаров С.Т.', phone: '+7 701 000 11 05', module: 'road' },
  { id: 'c6', name: 'ТОО «Таза Аймақ»', bin: '170640066778', head: 'Жумабаев Н.Е.', phone: '+7 701 000 11 06', module: 'waste' },
  { id: 'c7', name: 'ИП «Эко-Вывоз»', bin: '880101300111', head: 'Сериков Д.А.', phone: '+7 701 000 11 07', module: 'waste' },
]

// Конаев: примерные границы застройки
const KONAEV = { lat: [43.842, 43.893], lng: [77.035, 77.105] }
const DISTRICTS = ['мкр. 1', 'мкр. 2', 'мкр. 3', 'мкр. 4', 'мкр. Шенгельды', 'мкр. Кербулак', 'Новый город', 'Центр', 'Промзона', 'мкр. Жана Конаев', 'Набережная']

const BUILD_TYPES = [
  ['Школа на 600 мест', 4.2e9, 540], ['Школа на 1200 мест', 7.8e9, 720], ['Детский сад на 280 мест', 1.6e9, 420],
  ['Поликлиника на 250 посещений', 3.1e9, 540], ['Сети водоснабжения', 0.9e9, 300], ['Канализационный коллектор', 1.2e9, 360],
  ['Реконструкция улицы', 1.4e9, 240], ['Наружное освещение улицы', 0.25e9, 120], ['Благоустройство сквера', 0.35e9, 150],
  ['Арендный жилой дом, 9 этажей', 2.6e9, 480], ['Газопровод низкого давления', 0.6e9, 210], ['Спортивный комплекс', 2.2e9, 450],
  ['Капремонт Дома культуры', 0.8e9, 270], ['Котельная', 1.9e9, 360], ['Подстанция 10 кВ', 0.7e9, 240], ['Пешеходный мост', 0.5e9, 200],
  ['Ливневая канализация', 0.75e9, 240], ['Центр обслуживания населения', 1.1e9, 330],
]
const STREETS = ['ул. Конаева', 'ул. Индустриальная', 'пр. Абая', 'ул. Байтурсынова', 'ул. Желтоксан', 'ул. Жамбыла', 'ул. Наурызбай батыра', 'ул. Сейфуллина', 'ул. Ауэзова', 'ул. Толе би', 'ул. Кунаева', 'ул. Абылай хана']

// Область Абай: дороги между районными центрами (демо-геометрия)
const TOWNS = {
  semey: [50.411, 80.227], kurchatov: [50.756, 78.541], beskaragay: [50.884, 79.493], borodulikha: [50.719, 80.933],
  shulbinsk: [50.420, 81.090], zhangiztobe: [49.225, 81.215], karaul: [48.948, 79.255], kokpekty: [48.752, 82.400],
  ayagoz: [47.966, 80.439], barshatas: [48.170, 78.670], aksuat: [47.758, 82.807], urzhar: [47.093, 81.629], makanshi: [46.827, 82.000],
}
const ROADS = [
  ['KS-1', 'Семей — Курчатов', ['semey', 'kurchatov'], 'c4'],
  ['KS-2', 'Курчатов — Бескарагай', ['kurchatov', 'beskaragay'], 'c4'],
  ['KS-3', 'Семей — Бородулиха', ['semey', 'borodulikha'], 'c4'],
  ['KS-4', 'Семей — Шульбинск', ['semey', 'shulbinsk'], 'c5'],
  ['KS-5', 'Семей — Жангизтобе', ['semey', 'zhangiztobe'], 'c5'],
  ['KS-6', 'Семей — Караул', ['semey', 'karaul'], 'c4'],
  ['KS-7', 'Жангизтобе — Кокпекты', ['zhangiztobe', 'kokpekty'], 'c5'],
  ['KS-8', 'Караул — Баршатас', ['karaul', 'barshatas'], 'c4'],
  ['KS-9', 'Баршатас — Аягоз', ['barshatas', 'ayagoz'], 'c5'],
  ['KS-10', 'Аягоз — Аксуат', ['ayagoz', 'aksuat'], 'c5'],
  ['KS-11', 'Аягоз — Урджар', ['ayagoz', 'urzhar'], 'c4'],
  ['KS-12', 'Урджар — Маканчи', ['urzhar', 'makanshi'], 'c5'],
  ['KS-13', 'Курчатов — Караул', ['kurchatov', 'karaul'], 'c4'],
  ['KS-14', 'Кокпекты — Аксуат', ['kokpekty', 'aksuat'], 'c5'],
]

function wiggle(a, b, r, stepKm = 6) {
  const dist = Math.hypot((b[0] - a[0]) * 111, (b[1] - a[1]) * 74)
  const n = Math.max(2, Math.round(dist / stepKm))
  const pts = []
  let off = 0
  for (let i = 0; i <= n; i++) {
    const t = i / n
    off = i === 0 || i === n ? 0 : off * 0.7 + (r() - 0.5) * 0.025
    const lat = a[0] + (b[0] - a[0]) * t + off * (b[1] - a[1] > 0 ? 1 : -1)
    const lng = a[1] + (b[1] - a[1]) * t - off
    pts.push([+lat.toFixed(5), +lng.toFixed(5)])
  }
  return pts
}

const iso = (t) => new Date(t).toISOString()

export function buildSeed(anchor = Date.now()) {
  const r = rng(20261012)
  const pick = (arr) => arr[Math.floor(r() * arr.length)]
  const rand = (a, b) => a + r() * (b - a)
  const objects = [], orders = [], evidence = [], tracks = [], reports = []
  const hex = () => Array.from({ length: 16 }, () => Math.floor(r() * 16).toString(16)).join('')
  const sha = () => Array.from({ length: 64 }, () => Math.floor(r() * 16).toString(16)).join('')
  let evN = 0, ordN = 0
  const user = (id) => USERS.find((u) => u.id === id)

  const addEvidence = (e, ctxExtra = {}) => {
    const id = `e${++evN}`
    const ev = {
      id, accuracy: Math.round(rand(4, 18)), capture: 'camera', simulated: false, sha256: sha(), phash: hex(),
      blur: Math.round(rand(90, 400)), brightness: Math.round(rand(90, 170)), similarity: null, progress: null, comment: '',
      ...e,
    }
    ev.device_time = ev.device_time || ev.server_time
    const { checks, score, verdict } = scoreEvidence(ev, { serverNow: new Date(ev.server_time).getTime(), others: evidence.map((x) => ({ ...x, object_name: objects.find((o) => o.id === x.object_id)?.name })), ...ctxExtra })
    Object.assign(ev, { checks, score, verdict })
    evidence.push(ev)
    return ev
  }

  // ---------- Стройки Конаева: 127 объектов (как в задаче №2) ----------
  const buildContractors = ['c1', 'c1', 'c2', 'c2', 'c3']
  for (let i = 1; i <= 127; i++) {
    const [type, baseAmount, durDays] = pick(BUILD_TYPES)
    const street = pick(STREETS)
    const district = pick(DISTRICTS)
    const name = /улиц|освещ|газопр|коллект|сети|ливнев/i.test(type) ? `${type}, ${street}` : `${type}, ${district}`
    const startOffset = rand(60, durDays + 200)
    const start = anchor - startOffset * DAY
    const end = start + durDays * DAY
    const contractor_id = pick(buildContractors)
    const o = {
      id: `b${i}`, module: 'build', code: `КН-${String(i).padStart(3, '0')}`, name, district, address: `г. Конаев, ${district}, ${street}`,
      lat: +rand(KONAEV.lat[0], KONAEV.lat[1]).toFixed(5), lng: +rand(KONAEV.lng[0], KONAEV.lng[1]).toFixed(5), radius: 120,
      contractor_id, contract_no: `№ ${100 + i}-ГЗ/2025`, amount: Math.round(baseAmount * rand(0.6, 1.4) / 1e6) * 1e6,
      start_date: iso(start).slice(0, 10), end_date: iso(end).slice(0, 10), status: 'active',
      progress_claimed: 0, progress_confirmed: 0, last_report_at: null,
    }
    objects.push(o)
    if (end < anchor - 30 * DAY && r() < 0.6) o.status = 'done'
    const plan = plannedProgress(o, anchor) ?? 0
    // Поведение подрядчика
    const honest = contractor_id !== 'c3'
    let actual = honest ? Math.max(0, Math.min(100, plan + (r() < 0.18 ? rand(-25, -10) : rand(-7, 5)))) : Math.max(0, plan - rand(10, 35))
    if (o.status === 'done') actual = 100
    actual = Math.round(actual)
    // Сколько фотоотчётов и когда
    const nReports = o.status === 'done' ? 3 : Math.floor(rand(1, 5))
    let staleDays = honest ? (r() < 0.86 ? rand(0, 6) : rand(8, 25)) : rand(4, 30)
    let p = Math.max(0, actual - nReports * rand(4, 9))
    for (let k = nReports - 1; k >= 0; k--) {
      p = k === 0 ? actual : Math.min(actual, p + rand(3, 9))
      const t = anchor - (staleDays + k * rand(6, 9)) * DAY
      if (t < start) continue
      const cheat = !honest && k === 0 && r() < 0.5
      const reported = Math.round(cheat ? Math.min(100, p + rand(18, 30)) : p)
      const ev = addEvidence({
        object_id: o.id, order_id: null, contractor_id, stage: 'progress', photo_url: `gen:build:${i}:${reported}`,
        lat: o.lat + (cheat ? rand(0.02, 0.05) : rand(-0.0006, 0.0006)), lng: o.lng + (cheat ? rand(0.02, 0.05) : rand(-0.0006, 0.0006)),
        server_time: iso(t), progress: reported, ...(honest && r() < 0.1 ? { accuracy: Math.round(rand(110, 180)), blur: Math.round(rand(15, 35)) } : {}), author_id: contractor_id === 'c3' ? 'a0000000-0000-4000-8000-000000000004' : null,
        author_name: contractor_id === 'c3' ? 'Бауыржан Ахметов' : 'Прораб подрядчика', comment: cheat ? 'Монтаж выполнен согласно графику' : 'Работы ведутся по графику',
      }, { target: { lat: o.lat, lng: o.lng, radius: 120 } })
      o.last_report_at = ev.server_time
      o.progress_claimed = Math.max(o.progress_claimed, reported)
      if (ev.verdict !== 'rejected') o.progress_confirmed = Math.max(o.progress_confirmed, reported)
    }
    if (!honest && r() < 0.35) {
      // Повтор старого фото на другом объекте — ловится перцептивным хэшем
      const src = evidence.filter((e) => e.stage === 'progress' && e.object_id !== o.id).slice(-3)[0]
      if (src) {
        const t = anchor - rand(1, 4) * DAY
        const ev = addEvidence({
          object_id: o.id, contractor_id, stage: 'progress', photo_url: src.photo_url, phash: src.phash,
          lat: o.lat + 0.0003, lng: o.lng - 0.0002, server_time: iso(t), progress: Math.min(100, o.progress_claimed + 15),
          author_id: 'a0000000-0000-4000-8000-000000000004', author_name: 'Бауыржан Ахметов', comment: 'Фасадные работы завершены',
        }, { target: { lat: o.lat, lng: o.lng, radius: 120 } })
        o.progress_claimed = Math.max(o.progress_claimed, ev.progress)
      }
    }
  }

  // ---------- Дороги области Абай ----------
  for (const [code, name, [a, b], contractor_id] of ROADS) {
    const path = wiggle(TOWNS[a], TOWNS[b], r)
    objects.push({
      id: `r-${code}`, module: 'road', code, name: `Автодорога ${name}`, district: 'область Абай', address: name,
      lat: path[Math.floor(path.length / 2)][0], lng: path[Math.floor(path.length / 2)][1], path,
      length_km: Math.round(pathLengthKm(path)), contractor_id, contract_no: `№ ${code}-СОД/2026`, amount: Math.round(pathLengthKm(path)) * 4.1e6,
      start_date: '2026-01-01', end_date: '2026-12-31', status: 'active', last_inspected_at: null, radius: 60,
    })
  }
  const roads = objects.filter((o) => o.module === 'road')
  // Треки инспектора за месяц: часть сети осмотрена
  roads.forEach((road, idx) => {
    if (idx % 3 === 2) return
    const t0 = anchor - rand(1, 26) * DAY
    const part = idx % 2 ? road.path : road.path.slice(0, Math.ceil(road.path.length * 0.6))
    tracks.push({ id: `t${idx}`, inspector_id: 'a0000000-0000-4000-8000-000000000003', started_at: iso(t0), ended_at: iso(t0 + 3.5 * 3600000), points: part.map(([la, ln], k) => [la + rand(-0.0004, 0.0004), ln + rand(-0.0004, 0.0004), t0 + k * 300000]), km: Math.round(pathLengthKm(part)) })
    road.last_inspected_at = iso(t0 + 3.5 * 3600000)
  })
  // Дефекты и заявки
  const defectKeys = Object.keys(DEFECTS)
  for (let k = 0; k < 46; k++) {
    const road = pick(roads)
    const vi = Math.floor(rand(1, road.path.length - 1))
    const [lat, lng] = road.path[vi]
    const type = k < 30 ? (r() < 0.75 ? 'pothole' : 'pothole_danger') : pick(defectKeys)
    const created = anchor - rand(0.3, 40) * DAY
    const due = created + DEFECTS[type].days * DAY
    const id = `o${++ordN}`
    const fraud = road.contractor_id === 'c5'
    const ord = {
      id, object_id: road.id, contractor_id: road.contractor_id, kind: 'defect', title: `${DEFECTS[type].label}, ${road.code} км ${Math.round(pathLengthKm(road.path.slice(0, vi + 1)))}`,
      defect_type: type, severity: type === 'pothole_danger' ? 'high' : type === 'crack' || type === 'marking' ? 'low' : 'mid', lat, lng,
      created_at: iso(created), due_at: iso(due), status: 'open', created_by: 'a0000000-0000-4000-8000-000000000003', amount: Math.round(rand(0.3, 2.8) * 1e6 / 1e3) * 1e3,
      before_id: null, after_id: null, accepted_at: null, accepted_by: null, reject_reason: null,
    }
    const before = addEvidence({ object_id: road.id, order_id: id, contractor_id: null, stage: 'before', photo_url: `gen:road:${k}:0`, lat: lat + rand(-0.0001, 0.0001), lng: lng + rand(-0.0001, 0.0001), server_time: iso(created), author_id: 'a0000000-0000-4000-8000-000000000003', author_name: 'Данияр Касымов', comment: DEFECTS[type].label }, { target: { lat, lng, radius: 40 } })
    ord.before_id = before.id
    const age = (anchor - created) / DAY
    const doneRoll = r()
    if (age > 1 && doneRoll < (fraud ? 0.7 : 0.92)) {
      const workT = created + Math.min(age - 0.2, DEFECTS[type].days * (fraud ? rand(0.5, 1.8) : rand(0.3, 1.1))) * DAY
      let afterSpec = { photo_url: `gen:road:${k}:1`, lat: lat + rand(-0.0002, 0.0002), lng: lng + rand(-0.0002, 0.0002), similarity: +rand(0.6, 0.86).toFixed(3) }
      let comment = 'Ямочный ремонт выполнен'
      if (fraud && doneRoll < 0.3) {
        // Фото «после» снято в другом месте
        afterSpec = { photo_url: `gen:road:${k + 100}:1`, lat: lat + rand(0.015, 0.03), lng: lng + rand(0.01, 0.03), similarity: +rand(0.12, 0.3).toFixed(3) }
        comment = 'Ремонт выполнен в полном объёме'
      }
      const after = addEvidence({ object_id: road.id, order_id: id, contractor_id: road.contractor_id, stage: 'after', server_time: iso(workT), author_id: fraud ? 'a0000000-0000-4000-8000-000000000005' : null, author_name: fraud ? 'Серик Омаров' : 'Мастер подрядчика', comment, ...afterSpec }, { target: { lat, lng, radius: 40 }, pairId: before.id })
      ord.after_id = after.id
      if (after.verdict === 'rejected') { ord.status = 'rejected'; ord.reject_reason = `Автоматически: ${after.checks.find((c) => !c.ok && c.penalty >= 25)?.label || 'низкий балл доверия'}` }
      else if (age > 3 && r() < 0.8) { ord.status = 'accepted'; ord.accepted_at = iso(Math.min(anchor - 0.02 * DAY, workT + rand(0.1, 1) * DAY)); ord.accepted_by = 'a0000000-0000-4000-8000-000000000003' }
      else ord.status = 'submitted'
    }
    orders.push(ord)
  }

  // ---------- Контейнерные площадки Конаева ----------
  for (let i = 1; i <= 84; i++) {
    const contractor_id = i % 3 === 0 ? 'c7' : 'c6'
    const district = pick(DISTRICTS)
    const o = {
      id: `w${i}`, module: 'waste', code: `КП-${String(i).padStart(3, '0')}`, name: `Контейнерная площадка ${district}, ${pick(STREETS)}, ${Math.floor(rand(1, 90))}`,
      district, address: `г. Конаев, ${district}`, lat: +rand(KONAEV.lat[0], KONAEV.lat[1]).toFixed(5), lng: +rand(KONAEV.lng[0], KONAEV.lng[1]).toFixed(5), radius: 50,
      contractor_id, contract_no: contractor_id === 'c6' ? '№ 14-ТКО/2026' : '№ 15-ТКО/2026', amount: 2.4e6, containers: Math.floor(rand(2, 7)),
      pickups_per_week: pick([3, 3, 7, 2]), site_state: 'ok', last_report_at: null, start_date: '2026-01-01', end_date: '2026-12-31', status: 'active',
    }
    objects.push(o)
    const lag = contractor_id === 'c7' ? rand(0.2, 6) : rand(0.1, 2.6)
    const t = anchor - lag * DAY
    const b = addEvidence({ object_id: o.id, contractor_id, stage: 'pickup_before', photo_url: `gen:waste:${i}:full`, lat: o.lat + rand(-0.0002, 0.0002), lng: o.lng + rand(-0.0002, 0.0002), server_time: iso(t), author_name: 'Водитель', comment: 'До вывоза' }, { target: { lat: o.lat, lng: o.lng, radius: 50 } })
    const cheat = contractor_id === 'c7' && r() < 0.25
    const a = addEvidence({ object_id: o.id, contractor_id, stage: 'pickup_after', photo_url: cheat ? `gen:waste:${i}:full` : `gen:waste:${i}:clean`, lat: o.lat + rand(-0.0002, 0.0002), lng: o.lng + rand(-0.0002, 0.0002), server_time: iso(t + 240000), similarity: cheat ? 0.99 : +rand(0.55, 0.85).toFixed(3), phash: cheat ? b.phash : hex(), ...(cheat ? { sha256: b.sha256 } : {}), author_name: 'Водитель', comment: 'Вывоз выполнен' }, { target: { lat: o.lat, lng: o.lng, radius: 50 }, pairId: b.id })
    if (a.verdict !== 'rejected') o.last_report_at = a.server_time
    else o.last_report_at = iso(t - 3 * DAY)
    if (lag > 3 || a.verdict === 'rejected') o.site_state = r() < 0.6 ? 'full' : 'ok'
  }

  // ---------- Обращения жителей ----------
  const cats = [['waste', 'Переполнена мусорная площадка'], ['road', 'Яма на дороге'], ['build', 'Стройка: пыль и мусор на тротуаре'], ['waste', 'Мусор не вывозят неделю'], ['road', 'Нет знака после ремонта'], ['build', 'Стройка стоит, рабочих нет']]
  cats.forEach(([module, text], i) => {
    const near = pick(objects.filter((o) => o.module === module))
    reports.push({ id: `rp${i + 1}`, created_at: iso(anchor - rand(0.1, 5) * DAY), module, text, lat: near.lat + 0.0003, lng: near.lng + 0.0003, object_id: near.id, status: i < 3 ? 'new' : i < 5 ? 'in_work' : 'closed', photo_url: module === 'waste' ? `gen:waste:${90 + i}:full` : module === 'road' ? `gen:road:${200 + i}:0` : `gen:build:${300 + i}:40`, author: 'Житель' })
  })

  // Добросовестные подрядчики, почти закончившие объект после срока, считаются сдавшими его
  for (const o of objects) if (o.module === 'build' && o.contractor_id !== 'c3' && o.status !== 'done' && new Date(o.end_date).getTime() < anchor && o.progress_confirmed >= 90) Object.assign(o, { status: 'done', progress_claimed: 100, progress_confirmed: 100 })
  for (const rp of reports) if (rp.status === 'closed') { rp.closed_at = iso(Math.min(anchor - 0.05 * DAY, new Date(rp.created_at).getTime() + 0.6 * DAY)); rp.resolution = 'Устранено, подтверждено фото' }

  // Дополнение v2 (своя последовательность случайных чисел, чтобы не менять данные выше)
  const extra = seedExtra(anchor, { objects, orders, evidence, reports, addEvidence })
  evidence.sort((a, b) => a.server_time.localeCompare(b.server_time))
  // Как на сервере: принятое фото вывоза после жалобы закрывает её
  for (const rp of reports) {
    if (rp.module !== 'waste' || rp.status === 'closed') continue
    const a = evidence.find((e) => e.object_id === rp.object_id && e.stage === 'pickup_after' && e.verdict !== 'rejected' && e.server_time > rp.created_at)
    if (a) Object.assign(rp, { status: 'closed', closed_at: a.server_time, resolution: `Вывоз подтверждён фото (${a.score}/100)`, evidence_id: a.id })
  }
  // Свежие жалобы на переполненные площадки: видно, как идёт отсчёт норматива реакции
  ;[['c6', 2.5, 'Контейнеры переполнены, мусор на земле'], ['c7', 9, 'Переполнена мусорная площадка']].forEach(([cid, hours, text], i) => {
    const site = objects.find((o) => o.module === 'waste' && o.contractor_id === cid && o.site_state === 'full') || objects.find((o) => o.module === 'waste' && o.contractor_id === cid)
    if (!site) return
    site.site_state = 'full'
    const rp = { id: `rp${120 + i}`, created_at: iso(anchor - hours * 3600000), module: 'waste', text, lat: site.lat + 0.0002, lng: site.lng + 0.0002, object_id: site.id, status: 'new', photo_url: `gen:waste:${420 + i}:full`, author: 'Житель' }
    reports.push(rp); extra.reports.push(rp)
  })
  return { users: USERS.map((u) => ({ ...u })), contractors: CONTRACTORS.map((c) => ({ ...c })), objects, orders, evidence, tracks, reports, settings: {}, extra }
}

// №6: обращения жителей о переполнении и время реакции перевозчика; А-3: повторные дефекты на гарантии
function seedExtra(anchor, { objects, orders, evidence, reports, addEvidence }) {
  const r = rng(77001)
  const rand = (a, b) => a + r() * (b - a)
  const added = { orders: [], evidence: [], reports: [] }
  const sites = objects.filter((o) => o.module === 'waste')
  const texts = ['Переполнена мусорная площадка', 'Мусор вокруг контейнеров', 'Контейнеры не вывезли с утра', 'Мусор не вывозят третий день']
  for (let i = 0; i < 18; i++) {
    const site = sites[Math.floor(r() * sites.length)]
    const slow = site.contractor_id === 'c7'
    const created = anchor - rand(0.3, 28) * DAY
    const rp = { id: `rp${100 + i}`, created_at: iso(created), module: 'waste', text: texts[i % texts.length], lat: site.lat + 0.0002, lng: site.lng - 0.0002, object_id: site.id, status: 'new', photo_url: `gen:waste:${400 + i}:full`, author: 'Житель' }
    const react = (slow ? rand(10, 60) : rand(3, 22)) * 3600000
    if (created + react < anchor - 0.1 * DAY) {
      const t = created + react
      const b = addEvidence({ object_id: site.id, contractor_id: site.contractor_id, stage: 'pickup_before', photo_url: `gen:waste:${400 + i}:full`, lat: site.lat + rand(-0.0002, 0.0002), lng: site.lng + rand(-0.0002, 0.0002), server_time: iso(t), author_name: 'Водитель', comment: 'До вывоза' }, { target: { lat: site.lat, lng: site.lng, radius: 50 } })
      const a = addEvidence({ object_id: site.id, contractor_id: site.contractor_id, stage: 'pickup_after', photo_url: `gen:waste:${400 + i}:clean`, lat: site.lat + rand(-0.0002, 0.0002), lng: site.lng + rand(-0.0002, 0.0002), server_time: iso(t + 300000), similarity: +rand(0.55, 0.85).toFixed(3), author_name: 'Водитель', comment: 'Вывоз по обращению' }, { target: { lat: site.lat, lng: site.lng, radius: 50 }, pairId: b.id })
      added.evidence.push(b, a)
      Object.assign(rp, { status: 'closed', closed_at: a.server_time, resolution: `Вывоз подтверждён фото (${a.score}/100)`, evidence_id: a.id })
      if (new Date(a.server_time) > new Date(site.last_report_at || 0)) { site.last_report_at = a.server_time; site.site_state = 'ok' }
    } else { rp.status = r() < 0.5 ? 'new' : 'in_work'; site.site_state = 'full' }
    reports.push(rp); added.reports.push(rp)
  }
  // Повторные ямы рядом с принятым ремонтом: подрядчик устраняет за свой счёт
  const accepted = orders.filter((o) => o.status === 'accepted' && o.defect_type?.startsWith('pothole')).sort((a, b) => (b.contractor_id === 'c5') - (a.contractor_id === 'c5')).slice(0, 3)
  accepted.forEach((src, i) => {
    const created = Math.min(anchor - rand(0.5, 3) * DAY, new Date(src.accepted_at).getTime() + rand(5, 20) * DAY)
    if (created <= new Date(src.accepted_at).getTime()) return
    const id = `o${900 + i}`
    const ord = { ...src, id, title: `Повторная яма на месте ремонта, ${src.title.split(', ').slice(1).join(', ')}`, created_at: iso(created), due_at: iso(created + 7 * DAY), status: 'open', amount: 0, warranty_of: src.id,
      lat: src.lat + 0.00008, lng: src.lng - 0.00006, before_id: null, after_id: null, accepted_at: null, accepted_by: null, reject_reason: null }
    const before = addEvidence({ object_id: src.object_id, order_id: id, contractor_id: null, stage: 'before', photo_url: `gen:road:${600 + i}:0`, lat: ord.lat, lng: ord.lng, server_time: iso(created), author_id: 'a0000000-0000-4000-8000-000000000003', author_name: 'Данияр Касымов', comment: 'Яма появилась снова на месте ремонта' }, { target: { lat: ord.lat, lng: ord.lng, radius: 40 } })
    ord.before_id = before.id
    orders.push(ord); added.orders.push(ord); added.evidence.push(before)
  })
  return added
}
