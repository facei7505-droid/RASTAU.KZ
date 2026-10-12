import { html } from 'htm/preact'
import { Icon, Logo, Wordmark } from './icons.js'
import { useState, useEffect, useMemo } from 'preact/hooks'
import { Badge, Modal, toast, Empty } from './common.js'
import { MapView } from './map.js'
import { MODULES, DEFECTS, CONFIG, DEFAULT_DEFECT_DAYS, fmtMoney, fmtDate, pathLengthKm } from '../lib/verify.js'
import { loadLib, qrSvg, publicUrl } from '../lib/ext.js'
const BOM = String.fromCharCode(0xfeff)
const stripBom = (t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t)

const ROLE = { admin: 'Руководитель', inspector: 'Инспектор', contractor: 'Подрядчик' }
const PREFIX = { build: 'КН-', road: 'KS-', waste: 'КП-' }

// Справочники: всё, что акимат заводит сам, без разработчиков
export function DirectoryView(props) {
  const [tab, setTab] = useState('objects')
  const tabs = [['objects', 'Объекты'], ['contractors', 'Подрядчики'], ['users', 'Пользователи'], ['norms', 'Нормативы'], ['qr', 'QR-таблички'], ['guides', 'Памятки']]
  return html`<div class="page">
    <h1>Справочники и настройки</h1><p class="sub">Акимат сам заводит объекты, подрядчиков и сотрудников, загружает реестр из Excel и меняет нормативы. Каждое изменение пишется в журнал.</p>
    <div class="tabs no-print" style="max-width:760px">${tabs.map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}</button>`)}</div>
    ${tab === 'objects' && html`<${ObjectsTab} ...${props} />`}
    ${tab === 'contractors' && html`<${ContractorsTab} ...${props} />`}
    ${tab === 'users' && html`<${UsersTab} ...${props} />`}
    ${tab === 'norms' && html`<${NormsTab} ...${props} />`}
    ${tab === 'qr' && html`<${QrTab} ...${props} />`}
    ${tab === 'guides' && html`<${GuidesTab} />`}
  </div>`
}

// Памятки для запуска пилота: раздаются подрядчикам и инспекторам на установочном совещании
const GUIDES = [
  { k: 'contractor', title: 'Памятка подрядчику и перевозчику', kz: 'Мердігер мен тасымалдаушыға жадынама', items: [
    ['Вход', 'Откройте ссылку, которую прислал акимат, войдите по логину и паролю. Нажмите «Добавить на главный экран»: Rastau будет открываться как приложение.'],
    ['Фото только из приложения', 'Снимайте камерой внутри приложения, стоя на объекте. Фото из галереи, мессенджеров и чужие снимки система распознает и снизит балл.'],
    ['До и после', 'Ремонт и вывоз мусора подтверждаются парой снимков с одной точки: до работ и после. Держите тот же ракурс, чтобы сервер увидел изменения.'],
    ['Без связи', 'Нет интернета: всё равно снимайте. Фото сохранится в телефоне и отправится само. Не удаляйте приложение, пока очередь не отправлена.'],
    ['Люди в кадре', 'Не снимайте людей и номера машин. Если попали в кадр, нажмите «Скрыть лица» или коснитесь места на фото перед отправкой.'],
    ['Сроки', 'У каждой заявки свой срок по нормативу. Жалоба жителя на площадку закрывается только вашим фото вывоза, норматив реакции указан в задании.'],
    ['Индекс надёжности', 'Индекс растёт за честные фото и работу в срок. Его видит заказчик при следующих закупках. Подлог снижает индекс сразу.'],
  ] },
  { k: 'inspector', title: 'Памятка инспектору и технадзору', kz: 'Инспектор мен техқадағалауға жадынама', items: [
    ['Дефект за минуту', '«Поле» → «Фиксация» → участок → фото дефекта → тип. Заявка уходит подрядчику со сроком по нормативу.'],
    ['Объезд', 'Включайте запись маршрута во время объезда: покрытие сети считается по GPS-треку.'],
    ['Приёмка', 'Сравните фото «до/после» шторкой, посмотрите проверки сервера. «Принять к оплате» или «Вернуть» с причиной. Решение пишется в журнал.'],
    ['Повтор на гарантии', 'Новый дефект рядом с принятым ремонтом (до 12 месяцев, 50 м) система помечает как гарантийный: устраняется за счёт подрядчика.'],
    ['Акт', 'В карточке объекта кнопка «Акт»: приложение к форме Р-1 с фото, хэшами и QR, подписывается ЭЦП через NCALayer.'],
  ] },
  { k: 'citizen', title: 'Текст для жителей (сайт акимата, соцсети)', kz: 'Тұрғындарға арналған мәтін', items: [
    ['Как сообщить', 'На каждой контейнерной площадке и стройке есть QR-код. Наведите камеру телефона, откройте страницу объекта и нажмите «Сообщить». Регистрация не нужна.'],
    ['Что будет дальше', 'Обращение сразу видит ответственная служба и исполнитель. Оно закрывается только фотографией с места, отписка «выполнено» не принимается.'],
    ['Статус', 'Сохраните номер обращения: по нему на сайте видно, когда проблему устранили.'],
    ['Личные данные', 'Снимайте проблему, а не людей и номера машин. Ваши ФИО и телефон не нужны.'],
  ] },
]
function GuidesTab() {
  const [k, setK] = useState('contractor')
  const g = GUIDES.find((x) => x.k === k)
  return html`<div class="card">
    <div class="row between no-print" style="margin-bottom:12px"><div class="chips">${GUIDES.map((x) => html`<button class=${`chip ${k === x.k ? 'on' : ''}`} onClick=${() => setK(x.k)}>${x.title}</button>`)}</div>
      <button class="btn primary" onClick=${() => print()}><${Icon} n="printer" s=${16} />Печать</button></div>
    <div class="print-area guide"><h2>Rastau · ${g.title}</h2><div class="small muted">${g.kz}</div>
      <ol>${g.items.map(([h, t]) => html`<li><b>${h}.</b> ${t}</li>`)}</ol>
      <div class="small muted">Вопросы по работе системы: ответственный сотрудник акимата. Все действия в Rastau записываются в журнал.</div></div>
  </div>`
}

export function nextCode(objects, module) {
  const p = PREFIX[module]
  const n = Math.max(0, ...objects.filter((o) => o.code?.startsWith(p)).map((o) => parseInt(o.code.slice(p.length), 10) || 0))
  return `${p}${String(n + 1).padStart(module === 'road' ? 1 : 3, '0')}`
}

function ObjectsTab({ api, data, openObject }) {
  const [form, setForm] = useState(null)
  const [imp, setImp] = useState(false)
  const [q, setQ] = useState('')
  const [mod, setMod] = useState('all')
  const cname = (id) => data.contractors.find((c) => c.id === id)?.name || html`<span style="color:var(--red)">не назначен</span>`
  const rows = data.objects.filter((o) => (mod === 'all' || o.module === mod) && (!q || `${o.code} ${o.name} ${o.address}`.toLowerCase().includes(q.toLowerCase())))
  const noGeo = data.objects.filter((o) => o.lat == null && !o.path?.length).length
  return html`<div class="card flush">
    <div class="card-h">
      <button class="btn primary" onClick=${() => setForm({})}>+ Добавить объект</button>
      <button class="btn" onClick=${() => setImp(true)}><${Icon} n="upload" s=${16} />Загрузить из Excel / CSV</button>
      <input class="i search" placeholder="Поиск" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="chips">${[['all', 'Все'], ['build', 'Стройки'], ['road', 'Дороги'], ['waste', 'Площадки']].map(([k, l]) => html`<button class=${`chip ${mod === k ? 'on' : ''}`} onClick=${() => setMod(k)}>${l}</button>`)}</div>
    </div>
    ${noGeo > 0 && html`<div class="callout" style="margin:10px 14px">Без координат: ${noGeo}. Откройте объект и отметьте точку на карте, иначе фото нельзя проверить по месту.</div>`}
    <div class="scroll" style="max-height:62vh"><table class="tbl"><thead><tr><th>Код</th><th>Объект</th><th>Подрядчик</th><th>Договор</th><th>Сумма</th><th>Сроки</th><th></th></tr></thead><tbody>
      ${rows.slice(0, 300).map((o) => html`<tr>
        <td><b>${o.code}</b></td><td class="click" onClick=${() => openObject(o.id)}>${o.name}<div class="small muted">${MODULES[o.module].label}${o.lat == null && !o.path?.length ? html` · <span style="color:var(--red)">нет координат</span>` : ''}</div></td>
        <td class="small">${cname(o.contractor_id)}</td><td class="small">${o.contract_no || '—'}</td><td>${fmtMoney(o.amount)}</td>
        <td class="small">${fmtDate(o.start_date)} — ${fmtDate(o.end_date)}</td>
        <td><button class="btn sm" onClick=${() => setForm(o)}>Изменить</button></td></tr>`)}
    </tbody></table></div>
    <div class="legend">Показано ${Math.min(300, rows.length)} из ${rows.length}</div>
    ${form && html`<${ObjectForm} api=${api} data=${data} obj=${form.id ? form : null} onClose=${() => setForm(null)} />`}
    ${imp && html`<${ImportModal} api=${api} data=${data} onClose=${() => setImp(false)} />`}
  </div>`
}

export function ObjectForm({ api, data, obj, onClose }) {
  const [f, setF] = useState(() => obj ? { ...obj } : { module: 'build', code: nextCode(data.objects, 'build'), name: '', address: '', contractor_id: '', contract_no: '', amount: '', start_date: new Date().toISOString().slice(0, 10), end_date: '', containers: 4, pickups_per_week: 7, radius: 120 })
  const [busy, setBusy] = useState(false)
  const set = (p) => setF({ ...f, ...p })
  const isRoad = f.module === 'road'
  const contractors = data.contractors.filter((c) => c.module === f.module)
  function pick(p) {
    if (isRoad) setF((x) => ({ ...x, path: [...(x.path || []), [+p.lat.toFixed(5), +p.lng.toFixed(5)]] }))
    else setF((x) => ({ ...x, lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }))
  }
  async function save() {
    if (!f.code?.trim() || !f.name?.trim()) { toast('Укажите код и название'); return }
    if (!obj && data.objects.some((o) => o.code.toLowerCase() === f.code.trim().toLowerCase())) { toast('Объект с таким кодом уже есть'); return }
    if (isRoad ? !(f.path?.length >= 2) : f.lat == null) { toast(isRoad ? 'Отметьте на карте хотя бы 2 точки дороги' : 'Отметьте место объекта на карте'); return }
    const row = {
      module: f.module, code: f.code.trim(), name: f.name.trim(), address: f.address || '', district: f.district || '', contractor_id: f.contractor_id || null, contract_no: f.contract_no || null,
      amount: f.amount === '' || f.amount == null ? null : +String(f.amount).replace(/\s/g, '').replace(',', '.'), start_date: f.start_date || null, end_date: f.end_date || null,
      radius: +f.radius || (f.module === 'waste' ? 50 : f.module === 'road' ? 60 : 120),
      ...(isRoad ? { path: f.path, lat: f.path[Math.floor(f.path.length / 2)][0], lng: f.path[Math.floor(f.path.length / 2)][1], length_km: Math.round(pathLengthKm(f.path) * 10) / 10 } : { lat: f.lat, lng: f.lng }),
      ...(f.module === 'waste' ? { containers: +f.containers || 1, pickups_per_week: +f.pickups_per_week || 7 } : {}),
    }
    setBusy(true)
    try {
      if (obj) await api.updateObject(obj.id, row)
      else await api.addObject({ ...row, site_state: f.module === 'waste' ? 'ok' : null })
      toast(obj ? 'Объект сохранён' : 'Объект добавлен и появился на карте')
      onClose()
    } catch (e) { toast('Ошибка: ' + e.message) } finally { setBusy(false) }
  }
  const items = isRoad ? (f.path?.length ? [{ path: f.path, tone: 'gray', kind: 'road' }] : []) : f.lat != null ? [{ lat: f.lat, lng: f.lng, tone: 'red', kind: f.module }] : []
  return html`<${Modal} title=${obj ? `Объект ${obj.code}` : 'Новый объект'} onClose=${onClose} wide>
    <div class="grid g2">
      <div>
        ${!obj && html`<label class="f">Направление<select class="i" value=${f.module} onChange=${(e) => set({ module: e.target.value, code: nextCode(data.objects, e.target.value), contractor_id: '', path: null, lat: null, lng: null, radius: e.target.value === 'waste' ? 50 : e.target.value === 'road' ? 60 : 120 })}>
          ${Object.entries(MODULES).map(([k, m]) => html`<option value=${k}>${m.full} (${m.region}, задача ${m.task})</option>`)}</select></label>`}
        <div class="row" style="align-items:flex-start"><label class="f" style="width:130px">Код<input class="i" value=${f.code} onInput=${(e) => set({ code: e.target.value })} /></label>
          <label class="f grow">Название<input class="i" value=${f.name} onInput=${(e) => set({ name: e.target.value })} placeholder=${isRoad ? 'Автодорога Семей — Курчатов' : f.module === 'waste' ? 'Контейнерная площадка, ул. Абая, 12' : 'Школа на 600 мест, мкр. 3'} /></label></div>
        <label class="f">Адрес / участок<input class="i" value=${f.address || ''} onInput=${(e) => set({ address: e.target.value })} /></label>
        <label class="f">Подрядчик<select class="i" value=${f.contractor_id || ''} onChange=${(e) => set({ contractor_id: e.target.value })}><option value="">— не назначен —</option>${contractors.map((c) => html`<option value=${c.id}>${c.name}, БИН ${c.bin}</option>`)}</select></label>
        <div class="row"><label class="f grow">№ договора<input class="i" value=${f.contract_no || ''} onInput=${(e) => set({ contract_no: e.target.value })} /></label>
          <label class="f grow">Сумма, ₸<input class="i" inputmode="decimal" value=${f.amount ?? ''} onInput=${(e) => set({ amount: e.target.value })} /></label></div>
        <div class="row"><label class="f grow">Начало<input class="i" type="date" value=${f.start_date || ''} onInput=${(e) => set({ start_date: e.target.value })} /></label>
          <label class="f grow">Окончание<input class="i" type="date" value=${f.end_date || ''} onInput=${(e) => set({ end_date: e.target.value })} /></label></div>
        ${f.module === 'waste' && html`<div class="row"><label class="f grow">Контейнеров<input class="i" type="number" min="1" value=${f.containers} onInput=${(e) => set({ containers: e.target.value })} /></label>
          <label class="f grow">Вывозов в неделю по графику<input class="i" type="number" min="1" max="14" value=${f.pickups_per_week} onInput=${(e) => set({ pickups_per_week: e.target.value })} /></label></div>`}
        <label class="f">Допуск по месту съёмки, м<input class="i" type="number" min="20" max="500" value=${f.radius} onInput=${(e) => set({ radius: e.target.value })} /></label>
      </div>
      <div>
        <div class="sec-title">${isRoad ? 'Нарисуйте дорогу: нажимайте на карту по ходу трассы' : 'Нажмите на карту, чтобы отметить объект'}</div>
        <${MapView} cls="map small" height=${340} picker onPick=${pick} center=${f.lat != null ? [f.lat, f.lng] : f.path?.[0] || (isRoad ? [50.41, 80.23] : [43.866, 77.07])} fitKey=${f.module + (obj?.id || '')} items=${items} />
        <div class="row small muted" style="margin-top:6px">${isRoad ? html`<span>Точек: ${f.path?.length || 0}${f.path?.length > 1 ? `, ${pathLengthKm(f.path).toFixed(1)} км` : ''}</span><button class="btn sm" onClick=${() => set({ path: (f.path || []).slice(0, -1) })}>Убрать последнюю</button><button class="btn sm" onClick=${() => set({ path: [] })}>Очистить</button>`
          : html`<span>${f.lat != null ? `${f.lat}, ${f.lng}` : 'Точка не отмечена'}</span>`}</div>
      </div>
    </div>
    <div class="row" style="margin-top:12px"><button class="btn primary grow" disabled=${busy} onClick=${save}>${busy ? 'Сохраняем…' : 'Сохранить'}</button><button class="btn" onClick=${onClose}>Отмена</button></div>
  </${Modal}>`
}

// ---------- Импорт реестра объектов из Excel ----------
const FIELDS = [
  ['code', 'Код', /^(код|№|номер|code|id)$/i], ['name', 'Наименование', /наимен|назван|объект|name/i], ['address', 'Адрес', /адрес|улиц|участ|address/i],
  ['contractor', 'Подрядчик (название или БИН)', /подряд|исполн|бин|contractor/i], ['contract_no', '№ договора', /договор|контракт|contract/i],
  ['amount', 'Сумма', /сумм|стоим|amount|тенге|₸/i], ['start_date', 'Начало', /начал|старт|start/i], ['end_date', 'Окончание', /оконч|заверш|срок|end/i],
  ['lat', 'Широта', /широт|lat/i], ['lng', 'Долгота', /долгот|lng|lon/i],
]

function toDate(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10)
  const m = String(v).trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/)
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
const toNum = (v) => { if (v == null || v === '') return null; const n = +String(v).replace(/[\s ₸]/g, '').replace(',', '.'); return Number.isNaN(n) ? null : n }

function parseCsv(text) {
  const sep = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ','
  const rows = []; let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false; else cell += ch }
    else if (ch === '"') q = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => String(c).trim()))
}

export function ImportModal({ api, data, onClose }) {
  const [rows, setRows] = useState(null)
  const [map, setMap] = useState({})
  const [module, setModule] = useState('build')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setErr(null)
    try {
      let table
      if (/\.csv$/i.test(file.name)) table = parseCsv(stripBom(await file.text()))
      else {
        const XLSX = await loadLib('xlsx')
        const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
        table = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })
      }
      table = table.filter((r) => r.some((c) => String(c ?? '').trim()))
      // Строка заголовков: первая, где найдено хотя бы 2 знакомых названия колонок
      const hi = Math.max(0, table.findIndex((r) => r.filter((c) => FIELDS.some(([, , re]) => re.test(String(c).trim()))).length >= 2))
      const head = table[hi].map((c) => String(c).trim())
      const auto = {}
      for (const [k, , re] of FIELDS) { const i = head.findIndex((h, j) => re.test(h) && !Object.values(auto).includes(j)); if (i >= 0) auto[k] = i }
      setMap(auto)
      setRows({ head, body: table.slice(hi + 1) })
    } catch (x) { setErr(x.message) }
  }
  const prepared = useMemo(() => {
    if (!rows) return []
    const used = new Set(data.objects.map((o) => o.code.toLowerCase()))
    const p = PREFIX[module]
    let n = Math.max(0, ...data.objects.filter((o) => o.code?.startsWith(p)).map((o) => parseInt(o.code.slice(p.length), 10) || 0))
    return rows.body.map((r) => {
      const g = (k) => (map[k] != null ? r[map[k]] : null)
      const cRaw = String(g('contractor') ?? '').trim()
      const c = cRaw && data.contractors.find((x) => x.bin === cRaw.replace(/\D/g, '') || x.name.toLowerCase().includes(cRaw.toLowerCase()) || cRaw.toLowerCase().includes(x.name.toLowerCase().replace(/^(тоо|ип|ао)\s*/i, '').replace(/[«»"]/g, '')))
      let code = String(g('code') ?? '').trim()
      while (!code || used.has(code.toLowerCase())) code = `${p}${String(++n).padStart(module === 'road' ? 1 : 3, '0')}`
      used.add(code.toLowerCase())
      const lat = toNum(g('lat')), lng = toNum(g('lng'))
      return {
        module, code, name: String(g('name') ?? '').trim(), address: String(g('address') ?? '').trim(), contractor_id: c?.id || null, contract_no: String(g('contract_no') ?? '').trim() || null,
        amount: toNum(g('amount')), start_date: toDate(g('start_date')), end_date: toDate(g('end_date')),
        lat: lat != null && Math.abs(lat) <= 90 ? lat : null, lng: lng != null && Math.abs(lng) <= 180 ? lng : null,
        radius: module === 'waste' ? 50 : 120, _contractor: cRaw, ...(module === 'waste' ? { containers: 4, pickups_per_week: 7, site_state: 'ok' } : {}),
      }
    }).filter((x) => x.name)
  }, [rows, map, module])
  async function run() {
    setBusy(true)
    try {
      const n = await api.importObjects(prepared.map(({ _contractor, ...x }) => x))
      toast(`Загружено объектов: ${n}`)
      onClose()
    } catch (x) { toast('Ошибка импорта: ' + x.message) } finally { setBusy(false) }
  }
  function template() {
    const csv = BOM + ['Код;Наименование;Адрес;Подрядчик;№ договора;Сумма;Начало;Окончание;Широта;Долгота', 'КН-201;Школа на 600 мест, мкр. 5;г. Конаев, мкр. 5;180240011223;№ 201-ГЗ/2026;4200000000;01.03.2026;30.09.2027;43.8712;77.0655'].join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'rastau-shablon-obektov.csv'; a.click()
  }
  const noC = prepared.filter((x) => !x.contractor_id).length, noGeo = prepared.filter((x) => x.lat == null).length
  return html`<${Modal} title="Загрузка реестра объектов" onClose=${onClose} wide>
    <p class="small muted" style="margin-top:0">Подходит выгрузка, которую акимат уже ведёт в Excel. Колонки распознаются по названиям, их можно поправить вручную. Объекты без координат загрузятся, точку можно отметить позже.</p>
    <div class="row"><label class="f grow" style="margin:0">Направление<select class="i" value=${module} onChange=${(e) => setModule(e.target.value)}>${Object.entries(MODULES).map(([k, m]) => html`<option value=${k}>${m.full}</option>`)}</select></label>
      <label class="f grow" style="margin:0">Файл .xlsx, .xls или .csv<input class="i" type="file" accept=".xlsx,.xls,.csv" onChange=${onFile} /></label></div>
    <div class="row small" style="margin:8px 0"><a href="#" onClick=${(e) => { e.preventDefault(); template() }}>Скачать шаблон</a></div>
    ${err && html`<div class="chain-bad">${err}</div>`}
    ${rows && html`
      <div class="sec-title" style="margin-top:10px">Соответствие колонок</div>
      <div class="grid g3">${FIELDS.map(([k, l]) => html`<label class="f" style="margin:0">${l}<select class="i" value=${map[k] ?? ''} onChange=${(e) => setMap({ ...map, [k]: e.target.value === '' ? undefined : +e.target.value })}>
        <option value="">— нет —</option>${rows.head.map((h, i) => html`<option value=${i}>${h || `Колонка ${i + 1}`}</option>`)}</select></label>`)}</div>
      <div class="sec-title" style="margin-top:12px">Предпросмотр: ${prepared.length} объектов${noC ? `, без подрядчика ${noC}` : ''}${noGeo ? `, без координат ${noGeo}` : ''}</div>
      <div class="scroll" style="max-height:260px"><table class="tbl"><thead><tr><th>Код</th><th>Наименование</th><th>Подрядчик</th><th>Сумма</th><th>Сроки</th><th>Место</th></tr></thead><tbody>
        ${prepared.slice(0, 50).map((x) => html`<tr><td>${x.code}</td><td>${x.name}<div class="small muted">${x.address}</div></td>
          <td class="small">${x.contractor_id ? data.contractors.find((c) => c.id === x.contractor_id)?.name : html`<span style="color:var(--amber)">${x._contractor || '—'} (не найден)</span>`}</td>
          <td>${fmtMoney(x.amount)}</td><td class="small">${fmtDate(x.start_date)} — ${fmtDate(x.end_date)}</td><td class="small">${x.lat != null ? '✓' : html`<span style="color:var(--amber)">нет</span>`}</td></tr>`)}
      </tbody></table></div>
      ${noC > 0 && html`<div class="small muted" style="margin-top:6px">Подрядчик не найден: сначала заведите его во вкладке «Подрядчики» или назначьте позже в карточке объекта.</div>`}
      <div class="row" style="margin-top:12px"><button class="btn primary grow" disabled=${busy || !prepared.length} onClick=${run}>${busy ? 'Загружаем…' : `Загрузить ${prepared.length} объектов`}</button></div>`}
  </${Modal}>`
}

// ---------- Подрядчики ----------
function ContractorsTab({ api, data }) {
  const [form, setForm] = useState(null)
  return html`<div class="card flush">
    <div class="card-h"><button class="btn primary" onClick=${() => setForm({ module: 'build' })}>+ Добавить подрядчика</button><span class="small muted">Подрядчик получает доступ только к своим объектам и заявкам</span></div>
    <table class="tbl"><thead><tr><th>Организация</th><th>БИН</th><th>Руководитель</th><th>Телефон</th><th>Направление</th><th>Объектов</th><th>Сотрудников</th><th></th></tr></thead><tbody>
      ${data.contractors.map((c) => html`<tr><td><b>${c.name}</b></td><td>${c.bin}</td><td>${c.head}</td><td>${c.phone}</td><td>${MODULES[c.module]?.label}</td>
        <td>${data.objects.filter((o) => o.contractor_id === c.id).length}</td><td>${(data.users || []).filter((u) => u.contractor_id === c.id).length}</td>
        <td><button class="btn sm" onClick=${() => setForm(c)}>Изменить</button></td></tr>`)}
    </tbody></table>
    ${form && html`<${ContractorForm} api=${api} c=${form} onClose=${() => setForm(null)} />`}
  </div>`
}

function ContractorForm({ api, c, onClose }) {
  const [f, setF] = useState({ name: '', bin: '', head: '', phone: '', ...c })
  const [busy, setBusy] = useState(false)
  const set = (p) => setF({ ...f, ...p })
  async function save() {
    if (f.name.trim().length < 3) { toast('Укажите название организации'); return }
    if (!/^\d{12}$/.test(f.bin.trim())) { toast('БИН/ИИН: 12 цифр'); return }
    setBusy(true)
    try { await api.saveContractor({ ...f, name: f.name.trim(), bin: f.bin.trim() }); toast('Подрядчик сохранён'); onClose() } catch (e) { toast('Ошибка: ' + e.message) } finally { setBusy(false) }
  }
  return html`<${Modal} title=${c.id ? 'Подрядчик' : 'Новый подрядчик'} onClose=${onClose}>
    <label class="f">Название<input class="i" value=${f.name} onInput=${(e) => set({ name: e.target.value })} placeholder="ТОО «Название»" /></label>
    <div class="row"><label class="f grow">БИН / ИИН<input class="i" inputmode="numeric" maxlength="12" value=${f.bin} onInput=${(e) => set({ bin: e.target.value.replace(/\D/g, '') })} /></label>
      <label class="f grow">Направление<select class="i" value=${f.module} onChange=${(e) => set({ module: e.target.value })}>${Object.entries(MODULES).map(([k, m]) => html`<option value=${k}>${m.full}</option>`)}</select></label></div>
    <div class="row"><label class="f grow">Руководитель<input class="i" value=${f.head} onInput=${(e) => set({ head: e.target.value })} /></label>
      <label class="f grow">Телефон<input class="i" type="tel" value=${f.phone} onInput=${(e) => set({ phone: e.target.value })} /></label></div>
    <button class="btn primary big" disabled=${busy} onClick=${save}>Сохранить</button>
  </${Modal}>`
}

// ---------- Пользователи ----------
function UsersTab({ api, data }) {
  const [form, setForm] = useState(false)
  const [created, setCreated] = useState(null)
  const users = data.users || []
  return html`<div class="card flush">
    <div class="card-h"><button class="btn primary" onClick=${() => setForm(true)}>+ Добавить сотрудника</button><span class="small muted">В пилоте вход по ЭЦП и eGov; сейчас по email и паролю</span></div>
    ${created && html`<div class="chain-ok" style="margin:10px 14px">Учётная запись создана: <b>${created.email}</b>, пароль <b class="hash" style="color:inherit;font-size:14px">${created.password}</b>. Передайте его сотруднику лично, повторно пароль не показывается.</div>`}
    <table class="tbl"><thead><tr><th>ФИО</th><th>Email</th><th>Роль</th><th>Должность</th><th>Организация</th></tr></thead><tbody>
      ${users.map((u) => html`<tr><td><b>${u.full_name}</b></td><td class="small">${u.email}</td><td><${Badge} tone=${u.role === 'admin' ? 'blue' : u.role === 'inspector' ? 'green' : 'amber'}>${ROLE[u.role]}</${Badge}></td>
        <td class="small">${u.position || '—'}</td><td class="small">${data.contractors.find((c) => c.id === u.contractor_id)?.name || 'Акимат'}</td></tr>`)}
    </tbody></table>
    ${form && html`<${UserForm} api=${api} data=${data} onClose=${() => setForm(false)} onCreated=${setCreated} />`}
  </div>`
}

function UserForm({ api, data, onClose, onCreated }) {
  const [f, setF] = useState({ email: '', full_name: '', role: 'inspector', position: '', contractor_id: '' })
  const [busy, setBusy] = useState(false)
  const set = (p) => setF({ ...f, ...p })
  async function save() {
    setBusy(true)
    try { const r = await api.addUser(f); onCreated({ email: r.email, password: r.password }); toast('Сотрудник добавлен'); onClose() } catch (e) { toast(e.message) } finally { setBusy(false) }
  }
  return html`<${Modal} title="Новый сотрудник" onClose=${onClose}>
    <label class="f">ФИО<input class="i" value=${f.full_name} onInput=${(e) => set({ full_name: e.target.value })} /></label>
    <label class="f">Email<input class="i" type="email" value=${f.email} onInput=${(e) => set({ email: e.target.value })} /></label>
    <div class="row"><label class="f grow">Роль<select class="i" value=${f.role} onChange=${(e) => set({ role: e.target.value })}>${Object.entries(ROLE).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
      <label class="f grow">Должность<input class="i" value=${f.position} onInput=${(e) => set({ position: e.target.value })} placeholder="Инспектор отдела ЖКХ" /></label></div>
    ${f.role === 'contractor' && html`<label class="f">Организация-подрядчик<select class="i" value=${f.contractor_id} onChange=${(e) => set({ contractor_id: e.target.value })}><option value="">— выберите —</option>${data.contractors.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select></label>`}
    <div class="small muted" style="margin-bottom:10px">${f.role === 'admin' ? 'Руководитель видит всё и управляет справочниками.' : f.role === 'inspector' ? 'Инспектор фиксирует дефекты, проводит осмотры и принимает работы.' : 'Подрядчик видит только свои объекты и сдаёт работы фотографиями.'}</div>
    <button class="btn primary big" disabled=${busy} onClick=${save}>${busy ? 'Создаём…' : 'Создать учётную запись'}</button>
  </${Modal}>`
}

// ---------- Нормативы ----------
function NormsTab({ api, data }) {
  const s = data.settings || {}
  const [f, setF] = useState(() => ({
    defects: Object.fromEntries(Object.keys(DEFECTS).map((k) => [k, s.defects?.[k] ?? DEFAULT_DEFECT_DAYS[k]])),
    warranty_months: s.warranty_months ?? CONFIG.warranty_months, warranty_radius: s.warranty_radius ?? CONFIG.warranty_radius,
    penalty_pct: ((s.penalty_rate ?? CONFIG.penalty_rate) * 100).toFixed(2), cap_pct: ((s.penalty_cap ?? CONFIG.penalty_cap) * 100).toFixed(0), reaction_hours: s.reaction_hours ?? CONFIG.reaction_hours,
  }))
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      await api.saveSettings({
        defects: Object.fromEntries(Object.entries(f.defects).map(([k, v]) => [k, Math.max(1, +v || DEFAULT_DEFECT_DAYS[k])])),
        warranty_months: +f.warranty_months || 12, warranty_radius: +f.warranty_radius || 50,
        penalty_rate: (+String(f.penalty_pct).replace(',', '.') || 0.1) / 100, penalty_cap: (+f.cap_pct || 10) / 100, reaction_hours: +f.reaction_hours || 24,
      })
      toast('Нормативы сохранены и применяются ко всем новым заявкам')
    } catch (e) { toast('Ошибка: ' + e.message) } finally { setBusy(false) }
  }
  return html`<div class="grid g2">
    <div class="card"><h3>Сроки устранения дефектов дорог, суток</h3><p class="small muted">По умолчанию заданы по практике содержания дорог (СТ РК 1912-2023). Акимат может установить свои сроки по договору.</p>
      ${Object.entries(DEFECTS).map(([k, d]) => html`<label class="row between" style="padding:5px 0;border-bottom:1px dashed var(--line)"><span>${d.label}</span>
        <input class="i" style="width:90px" type="number" min="1" max="365" value=${f.defects[k]} onInput=${(e) => setF({ ...f, defects: { ...f.defects, [k]: e.target.value } })} /></label>`)}</div>
    <div class="card"><h3>Гарантия, неустойка, реакция</h3>
      <label class="f">Гарантийный срок на ремонт, месяцев<input class="i" type="number" min="1" max="120" value=${f.warranty_months} onInput=${(e) => setF({ ...f, warranty_months: e.target.value })} /></label>
      <label class="f">Повторный дефект считается гарантийным, если он ближе, м<input class="i" type="number" min="5" max="500" value=${f.warranty_radius} onInput=${(e) => setF({ ...f, warranty_radius: e.target.value })} /></label>
      <div class="row"><label class="f grow">Неустойка за день просрочки, % от суммы<input class="i" inputmode="decimal" value=${f.penalty_pct} onInput=${(e) => setF({ ...f, penalty_pct: e.target.value })} /></label>
        <label class="f grow">Не более, % от суммы<input class="i" type="number" min="1" max="100" value=${f.cap_pct} onInput=${(e) => setF({ ...f, cap_pct: e.target.value })} /></label></div>
      <label class="f">Норматив реакции перевозчика на переполнение, часов<input class="i" type="number" min="1" max="168" value=${f.reaction_hours} onInput=${(e) => setF({ ...f, reaction_hours: e.target.value })} /></label>
      <div class="callout small">Санитарная норма вывоза ТКО применяется автоматически: при температуре выше 0 °C вывоз не реже раза в сутки, при 0 °C и ниже не реже раза в 3 суток. Температура берётся с метеосервиса.</div>
      <div class="small muted" style="margin:10px 0">Неустойка в Rastau это оценка для претензионной работы. Точный размер определяется условиями договора.</div>
      <button class="btn primary big" disabled=${busy} onClick=${save}>${busy ? 'Сохраняем…' : 'Сохранить нормативы'}</button></div>
  </div>`
}

// ---------- QR-таблички ----------
function QrCard({ o }) {
  const [svg, setSvg] = useState(null)
  const url = publicUrl(`#/o/${encodeURIComponent(o.code)}`)
  useEffect(() => { qrSvg(url).then(setSvg).catch(() => setSvg('')) }, [url])
  return html`<div class="qr-card">
    <div class="qr-h"><${Logo} s=${30} /><div><b>Rastau</b><div>${o.module === 'waste' ? 'Контейнерная площадка' : o.module === 'road' ? 'Автодорога' : 'Строительный объект'} ${o.code}</div></div></div>
    <div class="qr-svg" dangerouslySetInnerHTML=${{ __html: svg || '' }} />
    <div class="qr-t">${o.module === 'waste' ? 'Переполнено? Не вывезли мусор?' : 'Видите проблему на объекте?'}<br /><b>Наведите камеру телефона на код</b></div>
    <div class="qr-k">Мәселе бар ма? Телефон камерасын кодқа бағыттаңыз</div>
    <div class="qr-n">${o.name}</div>
  </div>`
}

function QrTab({ data }) {
  const [mod, setMod] = useState('waste')
  const [q, setQ] = useState('')
  const list = data.objects.filter((o) => o.module === mod && (!q || `${o.code} ${o.name}`.toLowerCase().includes(q.toLowerCase())))
  const [n, setN] = useState(12)
  return html`<div>
    <div class="card no-print" style="margin-bottom:12px"><div class="row">
      <div class="chips">${[['waste', 'Площадки ТКО'], ['build', 'Стройки'], ['road', 'Дороги']].map(([k, l]) => html`<button class=${`chip ${mod === k ? 'on' : ''}`} onClick=${() => setMod(k)}>${l}</button>`)}</div>
      <input class="i search" placeholder="Поиск" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <select class="i" style="width:auto" value=${n} onChange=${(e) => setN(+e.target.value)}><option value="12">12 шт.</option><option value="48">48 шт.</option><option value="1000">все (${list.length})</option></select>
      <button class="btn primary" onClick=${() => print()}><${Icon} n="printer" s=${16} />Печать табличек</button></div>
      <div class="small muted" style="margin-top:8px">Житель сканирует код и видит, кто отвечает за объект, когда был последний подтверждённый вывоз или отчёт, и может сообщить о проблеме без регистрации. Обращение сразу привязано к объекту и подрядчику.</div></div>
    ${list.length ? html`<div class="print-area"><div class="qr-grid">${list.slice(0, n).map((o) => html`<${QrCard} key=${o.id} o=${o} />`)}</div></div>` : html`<div class="card"><${Empty}>Объектов нет</${Empty}></div>`}
  </div>`
}
