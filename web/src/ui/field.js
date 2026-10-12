import { html } from 'htm/preact'
import { Icon, Logo, Wordmark } from './icons.js'
import { useState, useEffect, useRef, useMemo } from 'preact/hooks'
import { Badge, VerdictBadge, Photo, toast, Empty, Prog } from './common.js'
import { CaptureFlow } from './camera.js'
import { AcceptCard } from './admin.js'
import { MapView } from './map.js'
import { useLang, tr } from './public.js'
import { publicUrl } from '../lib/ext.js'
import { DEFECTS, ORDER_STATUS, MODULES, fmtDate, fmtDist, haversine, isOverdue, plannedProgress, objectHealth, contractorStats, roadCoverage, pathLengthKm, humanDuration, daysAgo, DAY, wasteNorm, CONFIG } from '../lib/verify.js'

function useGps() {
  const [pos, setPos] = useState(null)
  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition((p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }), () => {}, { enableHighAccuracy: true, maximumAge: 10000 })
    return () => navigator.geolocation.clearWatch(id)
  }, [])
  return pos
}

function Countdown({ due }) {
  const ms = new Date(due).getTime() - Date.now()
  if (ms < 0) return html`<${Badge} tone="red">просрочено на ${humanDuration(-ms)}</${Badge}>`
  return html`<${Badge} tone=${ms < DAY ? 'amber' : 'blue'}>осталось ${humanDuration(ms)}</${Badge}>`
}

// Длительность на языке интерфейса
const dur = (ms) => tr(humanDuration(ms), humanDuration(ms).replace(/ ч$/, ' сағ').replace(/ дн$/, ' күн').replace(/ г$/, ' жыл'))

// ---------------- Инспектор ----------------
export function InspectorField({ api, data, me, openEvidence, openObject, onChanged }) {
  const roadsMode = /дорог/i.test(me.position || '')
  const [mod, setMod] = useState(roadsMode ? 'road' : 'build')
  const [tab, setTab] = useState('accept')
  const [capture, setCapture] = useState(null)
  const pos = useGps()
  const queue = data.orders.filter((o) => o.status === 'submitted' && data.objects.find((x) => x.id === o.object_id)?.module === mod)
  const objs = data.objects.filter((o) => o.module === mod)
  const sorted = [...objs].map((o) => ({ o, d: pos ? (o.path ? Math.min(...o.path.map(([a, b]) => haversine(pos, { lat: a, lng: b }))) : haversine(pos, o)) : null, h: objectHealth(o, { orders: data.orders }) }))
    .sort((a, b) => (a.d != null && b.d != null ? a.d - b.d : ({ red: 0, amber: 1, green: 2 })[a.h.tone] - ({ red: 0, amber: 1, green: 2 })[b.h.tone]))
  const roads = data.objects.filter((o) => o.module === 'road')
  const covKm = roads.reduce((s, r) => s + roadCoverage(r, data.tracks || []) * r.length_km, 0)
  const totalKm = roads.reduce((s, r) => s + r.length_km, 0)

  function startDefect(road) {
    setCapture({
      title: `Новый дефект · ${road.code}`, object: road, stage: 'before',
      form: (f, set) => html`<label class="f">Тип дефекта<select class="i" value=${f.defect_type || 'pothole'} onChange=${(e) => set({ defect_type: e.target.value })}>
          ${Object.entries(DEFECTS).map(([k, d]) => html`<option value=${k}>${d.label} — срок ${d.days} сут.</option>`)}</select></label>
        <label class="f">Комментарий<input class="i" value=${f.comment || ''} onInput=${(e) => set({ comment: e.target.value })} placeholder="Например: глубина 8 см, правая полоса" /></label>`,
      submitLabel: 'Создать заявку подрядчику',
      onSubmit: async (meta, blob) => {
        const type = meta.defect_type || 'pothole'
        const km = road.path ? Math.round(pathLengthKm(road.path.slice(0, 1 + road.path.reduce((bi, p, i) => (haversine({ lat: p[0], lng: p[1] }, meta) < haversine({ lat: road.path[bi][0], lng: road.path[bi][1] }, meta) ? i : bi), 0)))) : null
        const ord = await api.createOrder({
          object_id: road.id, contractor_id: road.contractor_id, kind: 'defect', title: `${DEFECTS[type].label}, ${road.code}${km != null ? ` км ${km}` : ''}`,
          defect_type: type, severity: type === 'pothole_danger' ? 'high' : 'mid', lat: meta.lat, lng: meta.lng, due_at: new Date(Date.now() + DEFECTS[type].days * DAY).toISOString(), amount: null,
        })
        const { defect_type, ...ev } = meta
        const saved = await api.addEvidence({ ...ev, order_id: ord.id, comment: meta.comment || DEFECTS[type].label }, blob)
        await api.linkBefore(ord.id, saved.id)
        onChanged()
        toast(ord.queued || saved.queued ? 'Нет связи: заявка и фото сохранены в телефоне и уйдут подрядчику, когда появится сеть' : `Заявка отправлена подрядчику. Срок: ${DEFECTS[type].days} сут.`)
        return saved
      },
    })
  }

  function startInspection(o) {
    setCapture({
      title: `Осмотр · ${o.code}`, object: o, stage: 'inspection',
      form: (f, set) => html`${o.module === 'build' && html`<label class="f">Фактическая готовность по осмотру: <b>${f.progress ?? o.progress_confirmed}%</b>
          <input type="range" min="0" max="100" step="5" value=${f.progress ?? o.progress_confirmed} onInput=${(e) => set({ progress: +e.target.value })} /></label>`}
        <label class="f">Замечания<textarea class="i" rows="2" value=${f.comment || ''} onInput=${(e) => set({ comment: e.target.value })} placeholder="Что увидели на объекте" /></label>`,
      submitLabel: 'Сохранить осмотр',
      onSubmit: async (meta, blob) => {
        const saved = await api.addEvidence({ ...meta, progress: o.module === 'build' ? (meta.progress ?? o.progress_confirmed) : null }, blob)
        onChanged(); return saved
      },
    })
  }

  return html`<div class="page narrow">
    <div class="hero-field">
      <div class="row between"><div class="hl">${me.full_name} · ${me.position}</div></div>
      <div class="row" style="margin-top:10px;gap:22px">
        <div><div class="hv">${queue.length}</div><div class="hl">на приёмке</div></div>
        <div><div class="hv">${data.orders.filter((o) => isOverdue(o)).length}</div><div class="hl">просрочено</div></div>
        ${mod === 'road' && html`<div><div class="hv">${Math.round((covKm / Math.max(1, totalKm)) * 100)}%</div><div class="hl">сети осмотрено</div></div>`}
      </div>
    </div>
    <div class="chips" style="margin-bottom:10px">${['road', 'build', 'waste'].map((k) => html`<button class=${`chip ${mod === k ? 'on' : ''}`} onClick=${() => setMod(k)}>${MODULES[k].label}</button>`)}</div>
    <div class="tabs">
      <button class=${tab === 'accept' ? 'on' : ''} onClick=${() => setTab('accept')}>Приёмка${queue.length ? html`<span class="count">${queue.length}</span>` : ''}</button>
      <button class=${tab === 'objects' ? 'on' : ''} onClick=${() => setTab('objects')}>${mod === 'road' ? 'Фиксация' : 'Осмотр'}</button>
      ${mod === 'road' && html`<button class=${tab === 'route' ? 'on' : ''} onClick=${() => setTab('route')}>Объезд</button>`}
    </div>
    ${tab === 'accept' && (queue.length ? html`<div class="tasks">${queue.map((o) => html`<${AcceptCard} key=${o.id} api=${api} data=${data} o=${o} openEvidence=${openEvidence} onChanged=${onChanged} />`)}</div>` : html`<div class="card"><${Empty}>Работ на приёмке нет</${Empty}></div>`)}
    ${tab === 'objects' && html`<div class="tasks">
      ${mod === 'road' && html`<div class="callout">Выберите участок и сфотографируйте дефект. Заявка уйдёт подрядчику автоматически, срок по нормативу.</div>`}
      ${sorted.slice(0, 40).map(({ o, d, h }) => html`<div class="task">
        <div class="row between"><div class="tt"><span class=${`dot ${h.tone}`} /> ${o.code} ${o.name}</div>${d != null && html`<span class="small muted">${fmtDist(d)}</span>`}</div>
        <div class="tm">${h.flags[0]?.text || 'Без замечаний'}</div>
        ${o.module === 'build' && html`<${Prog} claimed=${o.progress_claimed} confirmed=${o.progress_confirmed} plan=${plannedProgress(o)} />`}
        <div class="row">
          ${mod === 'road' ? html`<button class="btn primary sm" onClick=${() => startDefect(o)}><${Icon} n="camera" s=${16} />Зафиксировать дефект</button>` : html`<button class="btn primary sm" onClick=${() => startInspection(o)}><${Icon} n="camera" s=${16} />Осмотр</button>`}
          <button class="btn sm" onClick=${() => openObject(o.id)}>Карточка</button>
        </div>
      </div>`)}
    </div>`}
    ${tab === 'route' && html`<${RouteRecorder} api=${api} data=${data} onChanged=${onChanged} />`}
    ${capture && html`<${CaptureFlow} key=${capture.title} api=${api} me=${me} ...${capture} onClose=${(r) => { const next = capture.next; setCapture(null); if (r && next && r.verdict !== 'rejected') setTimeout(() => next(r), 60) }} />`}
  </div>`
}

function RouteRecorder({ api, data, onChanged }) {
  const [rec, setRec] = useState(null)
  const [pts, setPts] = useState([])
  const [road, setRoad] = useState(data.objects.find((o) => o.module === 'road')?.id)
  const wid = useRef(null)
  const roads = data.objects.filter((o) => o.module === 'road')
  const km = pathLengthKm(pts.map(([a, b]) => [a, b]))
  function start() {
    setPts([]); setRec(new Date().toISOString())
    wid.current = navigator.geolocation?.watchPosition((p) => setPts((x) => [...x, [p.coords.latitude, p.coords.longitude, Date.now()]]), () => toast('Нет доступа к GPS'), { enableHighAccuracy: true })
  }
  async function stop(points = pts, started = rec) {
    if (wid.current != null) navigator.geolocation.clearWatch(wid.current)
    wid.current = null
    setRec(null)
    if (points.length < 2) { toast('Слишком короткий трек'); return }
    await api.saveTrack({ started_at: started, ended_at: new Date().toISOString(), points, km: Math.round(pathLengthKm(points) * 10) / 10 })
    toast(`Объезд сохранён: ${Math.round(pathLengthKm(points))} км`)
    onChanged()
  }
  async function simulate() {
    const r = roads.find((x) => x.id === road)
    const t0 = Date.now() - 3 * 3600000
    const points = r.path.map(([a, b], i) => [a + (Math.random() - 0.5) * 0.0004, b + (Math.random() - 0.5) * 0.0004, t0 + i * 240000])
    await stop(points, new Date(t0).toISOString())
  }
  const r = roads.find((x) => x.id === road)
  return html`<div class="card">
    <h3>GPS-трек объезда</h3>
    <p class="small muted">Маршрут инспектора записывается автоматически. Руководитель видит, какие участки реально осмотрены за месяц: это KPI «100% сети за месяц».</p>
    ${rec ? html`<div class="callout">Идёт запись: ${pts.length} точек, ${km.toFixed(1)} км</div><div style="height:10px" /><button class="btn red big" onClick=${() => stop()}>Остановить и сохранить</button>`
      : html`<button class="btn primary big" onClick=${start}>▶ Начать объезд</button>`}
    <div style="height:14px" />
    <label class="switch" style="display:grid;gap:8px"><span><${Icon} n="play" s=${16} /> Демо: имитировать объезд участка</span>
      <select class="i" value=${road} onChange=${(e) => setRoad(e.target.value)}>${roads.map((x) => html`<option value=${x.id}>${x.name} · ${x.length_km} км · осмотрено ${Math.round(roadCoverage(x, data.tracks || []) * 100)}%</option>`)}</select>
      <button class="btn sm" onClick=${simulate}>Имитировать объезд</button></label>
    ${r && html`<div style="margin-top:12px"><${MapView} cls="map small" height=${240} fitKey=${road} items=${[{ path: r.path, tone: roadCoverage(r, data.tracks || []) > 0.9 ? 'green' : 'amber', kind: 'road' }]}
      lines=${(data.tracks || []).filter((t) => daysAgo(t.ended_at) <= 30).map((t) => ({ points: t.points.map(([a, b]) => [a, b]) }))} /></div>`}
  </div>`
}

// ---------------- Подрядчик ----------------
export function ContractorField({ api, data, me, openEvidence, onChanged }) {
  const [, , t] = useLang()
  const c = data.contractors.find((x) => x.id === me.contractor_id)
  const objs = data.objects.filter((o) => o.contractor_id === me.contractor_id)
  const module = c?.module || objs[0]?.module || 'road'
  const orders = data.orders.filter((o) => o.contractor_id === me.contractor_id)
  const stats = c ? contractorStats(c, data) : null
  const [capture, setCapture] = useState(null)
  const [tab, setTab] = useState('work')
  const myEv = data.evidence.filter((e) => objs.some((o) => o.id === e.object_id) && e.stage !== 'before').sort((a, b) => b.server_time.localeCompare(a.server_time))

  function submitRepair(o) {
    const obj = data.objects.find((x) => x.id === o.object_id)
    const before = data.evidence.find((e) => e.id === o.before_id)
    setCapture({
      title: `${t('Сдать работу', 'Жұмысты тапсыру')} · ${o.title}`, object: obj, order: o, stage: 'after', beforeUrl: before?.photo_url,
      form: (f, set) => html`<label class="f">${t('Что сделано', 'Не істелді')}<input class="i" value=${f.comment || ''} onInput=${(e) => set({ comment: e.target.value })} placeholder=${t('Например: ямочный ремонт 2,4 м²', 'Мысалы: шұңқырды жөндеу 2,4 м²')} /></label>`,
      submitLabel: t('Сдать на приёмку', 'Қабылдауға тапсыру'),
      onSubmit: async (meta, blob) => { const ev = await api.addEvidence(meta, blob); onChanged(); return ev },
    })
  }
  function reportProgress(o) {
    setCapture({
      title: `${t('Фотоотчёт', 'Фотоесеп')} · ${o.code}`, object: o, stage: 'progress',
      form: (f, set) => html`<label class="f">${t('Готовность объекта', 'Нысанның дайындығы')}: <b>${f.progress ?? o.progress_claimed}%</b>
          <input type="range" min="0" max="100" step="5" value=${f.progress ?? o.progress_claimed} onInput=${(e) => set({ progress: +e.target.value })} /></label>
        <label class="f">${t('Что сделано за период', 'Кезең ішінде не істелді')}<textarea class="i" rows="2" value=${f.comment || ''} onInput=${(e) => set({ comment: e.target.value })} /></label>`,
      submitLabel: t('Отправить отчёт', 'Есепті жіберу'),
      onSubmit: async (meta, blob) => { const ev = await api.addEvidence({ ...meta, progress: meta.progress ?? o.progress_claimed }, blob); onChanged(); return ev },
    })
  }
  function pickup(o) {
    const step = (stage, beforeUrl) => setCapture({
      title: stage === 'pickup_before' ? `${t('Шаг 1 из 2: площадка до вывоза', '1-қадам: шығаруға дейінгі алаң')} · ${o.code}` : `${t('Шаг 2 из 2: после вывоза', '2-қадам: шығарғаннан кейін')} · ${o.code}`, object: o, stage, beforeUrl,
      submitLabel: stage === 'pickup_before' ? t('Далее', 'Әрі қарай') : t('Подтвердить вывоз', 'Шығаруды растау'),
      doneLabel: stage === 'pickup_before' ? t('Шаг 2: снять площадку после вывоза →', '2-қадам: шығарғаннан кейін түсіру →') : t('Готово', 'Дайын'),
      next: stage === 'pickup_before' ? (ev) => step('pickup_after', ev.photo_url) : null,
      onSubmit: async (meta, blob) => { const ev = await api.addEvidence(meta, blob); onChanged(); return ev },
    })
    step('pickup_before')
  }

  const open = orders.filter((o) => o.status === 'open' || o.status === 'rejected').sort((a, b) => a.due_at.localeCompare(b.due_at))
  const done = orders.filter((o) => o.status === 'submitted' || o.status === 'accepted').sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 15)
  // Площадки ТКО: сначала жалобы жителей (норматив реакции), затем переполненные, затем просроченные по санитарной норме
  const norm = wasteNorm()
  const complaints = (data.reports || []).filter((r) => r.status !== 'closed' && objs.some((o) => o.id === r.object_id))
  const siteInfo = (o) => {
    const cs = complaints.filter((r) => r.object_id === o.id)
    const late = daysAgo(o.last_report_at) > norm.days
    return { cs, late, rank: (cs.length ? 4 : 0) + (o.site_state === 'full' ? 2 : 0) + (late ? 1 : 0) }
  }
  const sites = objs.filter((o) => o.module === 'waste').map((o) => ({ o, ...siteInfo(o) }))
    .sort((a, b) => b.rank - a.rank || (a.o.last_report_at || '').localeCompare(b.o.last_report_at || ''))
  const urgent = sites.filter((x) => x.rank >= 2 && x.o.lat != null).slice(0, 10)
  const routeUrl = urgent.length ? `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${urgent[urgent.length - 1].o.lat},${urgent[urgent.length - 1].o.lng}${urgent.length > 1 ? '&waypoints=' + urgent.slice(0, -1).map((x) => `${x.o.lat},${x.o.lng}`).join('%7C') : ''}` : null
  const builds = objs.filter((o) => o.module === 'build' && o.status !== 'done').sort((a, b) => (a.last_report_at || '').localeCompare(b.last_report_at || ''))
  const statusLabel = (s) => ({ submitted: t('На приёмке', 'Қабылдауда'), accepted: t('Принято', 'Қабылданды') })[s] || ORDER_STATUS[s].label
  const Due = ({ due }) => { const ms = new Date(due).getTime() - Date.now(); return ms < 0 ? html`<${Badge} tone="red">${t('просрочено на', 'мерзімі өтті')} ${dur(-ms)}</${Badge}>` : html`<${Badge} tone=${ms < DAY ? 'amber' : 'blue'}>${t('осталось', 'қалды')} ${dur(ms)}</${Badge}>` }

  return html`<div class="page narrow">
    <div class="hero-field">
      <div class="hl">${c?.name} · ${me.full_name}</div>
      <div class="row" style="margin-top:10px;gap:22px">
        ${stats && html`<div><div class="hv"><span class=${`grade ${stats.grade}`} style="width:36px;height:36px;font-size:20px">${stats.grade}</span> ${stats.index}</div><div class="hl">${t('индекс надёжности', 'сенімділік индексі')}</div></div>`}
        ${module === 'road' && html`<div><div class="hv">${open.length}</div><div class="hl">${t('заявок в работе', 'жұмыстағы өтінімдер')}</div></div>`}
        ${module === 'build' && html`<div><div class="hv">${builds.length}</div><div class="hl">${t('объектов', 'нысан')}</div></div>`}
        ${module === 'waste' && html`<div><div class="hv" style=${complaints.length ? 'color:#ffd27a' : ''}>${complaints.length}</div><div class="hl">${t('жалоб', 'шағым')}</div></div>
          <div><div class="hv">${sites.filter((x) => x.o.site_state === 'full').length}</div><div class="hl">${t('переполнено', 'толып кетті')}</div></div>`}
        ${stats?.rejected > 0 && html`<div><div class="hv" style="color:#ffb3b3">${stats.rejected}</div><div class="hl">${t('фото отклонено', 'фото қабылданбады')}</div></div>`}
      </div>
    </div>
    <div class="tabs"><button class=${tab === 'work' ? 'on' : ''} onClick=${() => setTab('work')}>${t('Задания', 'Тапсырмалар')}</button><button class=${tab === 'history' ? 'on' : ''} onClick=${() => setTab('history')}>${t('Мои фото и рейтинг', 'Менің фотоларым мен рейтинг')}</button></div>
    ${tab === 'work' && module === 'road' && html`<div class="tasks">
      ${open.map((o) => { const b = data.evidence.find((e) => e.id === o.before_id); return html`<div class="task media">
        ${b ? html`<${Photo} api=${api} url=${b.photo_url} cls="thumb" onClick=${() => openEvidence(b)} />` : html`<div class="thumb" />`}
        <div class="tt">${o.title}</div>
        <div class="row" style="gap:6px"><${Due} due=${o.due_at} />${o.warranty_of && html`<${Badge} tone="warranty">${t('гарантия, без оплаты', 'кепілдік, ақысыз')}</${Badge}>`}</div>
        <div class="tm">${o.status === 'rejected' ? html`<span class="issue red">${t('Возвращено', 'Қайтарылды')}: ${String(o.reject_reason || '').replace(/^Автоматически:\s*/, '')}</span>` : o.warranty_of ? t('Дефект появился на месте принятого ремонта. Устранение за счёт подрядчика.', 'Ақау қабылданған жөндеу орнында пайда болды. Мердігердің есебінен жойылады.') : `${t('Срок', 'Мерзімі')}: ${fmtDate(o.due_at, true)}`}</div>
        <div class="row acts"><button class="btn primary grow" onClick=${() => submitRepair(o)}><${Icon} n="camera" s=${16} />${t('Сдать работу', 'Жұмысты тапсыру')}</button>
          <a class="btn" href=${`https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}`} target="_blank" rel="noopener"><${Icon} n="nav" s=${16} />${t('Маршрут', 'Бағыт')}</a></div>
      </div>` })}
      ${!open.length && html`<div class="card"><${Empty}>${t('Открытых заявок нет', 'Ашық өтінімдер жоқ')}</${Empty}></div>`}
      ${done.length > 0 && html`<div class="sec-title" style="margin-top:8px">${t('Сданные', 'Тапсырылғандар')}</div>${done.map((o) => html`<div class="task"><div class="row between"><div class="tt">${o.title}</div><${Badge} tone=${ORDER_STATUS[o.status].tone}>${statusLabel(o.status)}</${Badge}></div></div>`)}`}
    </div>`}
    ${tab === 'work' && module !== 'road' && open.length > 0 && html`<div class="tasks" style="margin-bottom:12px">
      <div class="sec-title">${t('Заявки и замечания', 'Өтінімдер мен ескертулер')}</div>
      ${open.map((o) => html`<div class="task">
        <div class="row between"><div class="tt">${o.title}</div><${Due} due=${o.due_at} /></div>
        ${o.status === 'rejected' && html`<div class="callout bad">${t('Возвращено', 'Қайтарылды')}: ${o.reject_reason}</div>`}
        <button class="btn primary" onClick=${() => submitRepair(o)}><${Icon} n="camera" s=${16} />${t('Сдать работу', 'Жұмысты тапсыру')}</button></div>`)}
    </div>`}
    ${tab === 'work' && module === 'build' && html`<div class="tasks">
      <div class="callout">${t('Раз в неделю отправляйте фото с объекта. Оплачивается только подтверждённый процент.', 'Аптасына бір рет нысаннан фото жіберіңіз. Тек расталған пайыз төленеді.')}</div>
      ${builds.map((o) => { const age = daysAgo(o.last_report_at); return html`<div class="task">
        <div class="row between"><div class="tt">${o.code} ${o.name}</div>${age > 7 ? html`<${Badge} tone="red">${age === Infinity ? t('отчёт не сдан', 'есеп тапсырылмаған') : t(`отчёт ${Math.floor(age)} дн назад`, `есеп ${Math.floor(age)} күн бұрын`)}</${Badge}>` : html`<${Badge} tone="green">${t('актуально', 'өзекті')}</${Badge}>`}</div>
        <${Prog} claimed=${o.progress_claimed} confirmed=${o.progress_confirmed} plan=${plannedProgress(o)} />
        <button class="btn primary" onClick=${() => reportProgress(o)}><${Icon} n="camera" s=${16} />${t('Фотоотчёт', 'Фотоесеп')}</button>
      </div>` })}
    </div>`}
    ${tab === 'work' && module === 'waste' && html`<div class="tasks">
      <div class="callout">${t(`На каждой площадке: фото до и после вывоза. Без фото вывоз не засчитывается. Санитарная норма сейчас: ${norm.label}. Жалоба жителя закрывается вашим фото вывоза, норматив реакции ${CONFIG.reaction_hours} ч.`, `Әр алаңда: шығаруға дейін және кейін фото. Фотосыз шығару есептелмейді. Қазіргі санитарлық норма: ${norm.warm ? 'күн сайын (0 °C жоғары)' : '3 тәулікте кемінде бір рет (0 °C және төмен)'}. Тұрғынның шағымы сіздің шығару фотоңызбен жабылады, әрекет ету нормативі ${CONFIG.reaction_hours} сағ.`)}</div>
      ${routeUrl && html`<a class="btn big" style="width:100%" href=${routeUrl} target="_blank" rel="noopener"><${Icon} n="map" s=${17} />${t('Маршрут по срочным площадкам', 'Шұғыл алаңдар бағыты')} (${urgent.length})</a>`}
      ${sites.slice(0, 40).map(({ o, cs, late }) => html`<div class="task">
        <div class="row between"><div class="tt">${o.code} ${o.name}</div>${o.site_state === 'full' ? html`<${Badge} tone="red">${t('переполнена', 'толып кетті')}</${Badge}>` : late ? html`<${Badge} tone="amber">${t('вывоз', 'шығару')} ${fmtDate(o.last_report_at)} · ${t('ниже нормы', 'нормадан төмен')}</${Badge}>` : html`<${Badge} tone="gray">${t('вывоз', 'шығару')} ${fmtDate(o.last_report_at)}</${Badge}>`}</div>
        ${cs.map((r) => { const left = new Date(r.created_at).getTime() + CONFIG.reaction_hours * 3600000 - Date.now(); return html`<div class="callout" style=${left < 0 ? 'background:var(--red-bg);color:var(--red)' : 'background:var(--amber-bg);color:var(--amber)'}>${t('Жалоба жителя', 'Тұрғын шағымы')}: ${r.text}. ${left < 0 ? t(`Норматив ${CONFIG.reaction_hours} ч превышен на ${dur(-left)}`, `${CONFIG.reaction_hours} сағ нормативі ${dur(-left)} асып кетті`) : t(`До норматива осталось ${dur(left)}`, `Нормативке дейін ${dur(left)} қалды`)}</div>` })}
        <button class="btn primary" onClick=${() => pickup(o)}><${Icon} n="camera" s=${16} />${t('Подтвердить вывоз', 'Шығаруды растау')}</button>
      </div>`)}
    </div>`}
    ${tab === 'history' && html`<div class="tasks">
      ${stats && html`<div class="card"><b>${t('Как растёт индекс', 'Индекс қалай өседі')}</b><div class="small muted" style="margin-top:4px">${t('Снимайте только в приложении, на месте работ, без повторов старых фото. Сдавайте в срок. Индекс видят заказчики при следующих закупках.', 'Тек қосымшада, жұмыс орнында, ескі фотоларды қайталамай түсіріңіз. Мерзімінде тапсырыңыз. Индексті тапсырыс берушілер келесі сатып алуларда көреді.')}</div></div>`}
      ${myEv.slice(0, 30).map((e) => html`<div class="task" onClick=${() => openEvidence(e)}>
        <div class="row between"><div class="tt">${data.objects.find((o) => o.id === e.object_id)?.code} · ${fmtDate(e.server_time, true)}</div><${VerdictBadge} ev=${e} /></div>
        ${e.verdict !== 'ok' && html`<div class="tm" style="color:var(--red)">${(e.checks || []).filter((x) => !x.ok).map((x) => x.label).join(' · ')}</div>`}
      </div>`)}
    </div>`}
    ${capture && html`<${CaptureFlow} key=${capture.title} api=${api} me=${me} ...${capture} onClose=${(r) => { const next = capture.next; setCapture(null); if (r && next && r.verdict !== 'rejected') setTimeout(() => next(r), 60) }} />`}
  </div>`
}

// ---------------- Житель ----------------
export function CitizenView({ api }) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '')
  const [module, setModule] = useState(MODULES[params.get('m')] ? params.get('m') : 'waste')
  const [pinned, setPinned] = useState(null)
  useEffect(() => { const code = params.get('o'); if (code) api.publicObject(code).then((o) => o && setPinned(o)).catch(() => {}) }, [])
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState(null)
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])
  const [pos, setPos] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [lang, setLang, t] = useLang()
  useEffect(() => { navigator.geolocation?.getCurrentPosition((p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {}, { enableHighAccuracy: true, timeout: 15000 }) }, [])
  const cats = { waste: [t('Мусорная площадка', 'Қоқыс алаңы'), [t('Переполнена площадка', 'Алаң толып кетті'), t('Мусор не вывозят', 'Қоқыс шығарылмайды'), t('Сломан контейнер', 'Контейнер сынған')]],
    road: [t('Дорога', 'Жол'), [t('Яма на дороге', 'Жолда шұңқыр'), t('Нет знака', 'Белгі жоқ'), t('Плохой ремонт', 'Сапасыз жөндеу')]],
    build: [t('Стройка', 'Құрылыс'), [t('Стройка стоит', 'Құрылыс тоқтап тұр'), t('Грязь и пыль от стройки', 'Құрылыстан шаң мен балшық'), t('Опасное ограждение', 'Қауіпті қоршау')]] }
  async function send() {
    if (!pos && !pinned) { toast(t('Отметьте место на карте', 'Картадан орынды белгілеңіз')); return }
    setBusy(true)
    try {
      let blob = null
      if (file) {
        const { canvasFromFile, toBlob } = await import('../lib/image.js')
        blob = await toBlob(await canvasFromFile(file), 0.8)
      }
      const near = pinned && pinned.module === module ? { id: pinned.id, code: pinned.code, name: pinned.name, dist: 0 } : await api.nearest(pos.lat, pos.lng, module)
      const r = await api.addReport({ module, text: [text || cats[module][1][0], note.trim()].filter(Boolean).join('. '), lat: pos?.lat ?? null, lng: pos?.lng ?? null, object_id: near && near.dist < 1500 ? near.id : null }, blob)
      setDone({ id: r.id, near })
    } catch (e) { toast(e.message) } finally { setBusy(false) }
  }
  if (done) return html`<div class="page narrow"><div class="card" style="text-align:center;padding:30px">
    <div class="done-ic"><${Icon} n="check" s=${34} /></div><h1>${t('Спасибо! Обращение принято', 'Рахмет! Өтініш қабылданды')}</h1>
    <p class="muted">${t('Номер', 'Нөмірі')}: <b>${done.id.toUpperCase()}</b>${done.near ? html`<br />${t('Объект', 'Нысан')}: ${done.near.code} ${done.near.name}` : ''}</p>
    <p class="small muted">${t('Ответственная служба увидит обращение сразу. Исполнитель обязан подтвердить устранение фотографией с места.', 'Жауапты қызмет өтінішті бірден көреді. Орындаушы жоюды орнынан фотосуретпен растауы тиіс.')}</p>
    <div class="row" style="justify-content:center"><a class="btn primary" href=${`#/status/${done.id}`}>${t('Следить за статусом', 'Мәртебені бақылау')}</a>
    <button class="btn" onClick=${() => { setDone(null); setText(''); setNote(''); setFile(null) }}>${t('Новое обращение', 'Жаңа өтініш')}</button></div>
    <div class="row" style="justify-content:center;margin-top:10px">${(() => {
      const url = publicUrl(`#/status/${done.id}`)
      const msg = `${t('Моё обращение в акимат', 'Әкімдікке өтінішім')} № ${done.id.toUpperCase()}: ${url}`
      return html`<a class="btn sm" target="_blank" rel="noopener" href=${`https://wa.me/?text=${encodeURIComponent(msg)}`}>WhatsApp</a>
        <a class="btn sm" target="_blank" rel="noopener" href=${`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`${t('Моё обращение в акимат', 'Әкімдікке өтінішім')} № ${done.id.toUpperCase()}`)}`}>Telegram</a>
        ${navigator.share && html`<button class="btn sm" onClick=${() => navigator.share({ title: 'Rastau', text: msg, url }).catch(() => {})}>${t('Поделиться', 'Бөлісу')}</button>`}`
    })()}</div>
    <p class="small muted">${t('Сохраните номер: по нему можно проверить, когда проблему устранили.', 'Нөмірді сақтаңыз: ол арқылы мәселенің қашан жойылғанын тексеруге болады.')}</p></div></div>`
  return html`<div class="page narrow">
    <div class="row between"><a href="#/" class="wordmark"><${Logo} s=${30} /><span><b>Rastau</b></span></a>
      <div class="chips"><button class=${`chip ${lang === 'ru' ? 'on' : ''}`} onClick=${() => setLang('ru')}>РУС</button><button class=${`chip ${lang === 'kz' ? 'on' : ''}`} onClick=${() => setLang('kz')}>ҚАЗ</button></div></div>
    <h1 style="margin-top:14px">${t('Сообщить о проблеме', 'Мәселе туралы хабарлау')}</h1>
    ${pinned && html`<div class="callout" style="margin-bottom:10px">${t('Объект', 'Нысан')}: <b>${pinned.code}</b> ${pinned.name}${pinned.contractor ? html`<br /><span class="small">${t('Исполнитель', 'Орындаушы')}: ${pinned.contractor}</span>` : ''}</div>`}
    <p class="sub">${t('Без регистрации. Обращение уйдёт ответственной службе и исполнителю.', 'Тіркеусіз. Өтініш жауапты қызметке және орындаушыға жіберіледі.')}</p>
    <div class="card">
      <div class="chips" style="margin-bottom:12px">${Object.entries(cats).map(([k, [l]]) => html`<button class=${`chip ${module === k ? 'on' : ''}`} onClick=${() => { setModule(k); setText('') }}>${l}</button>`)}</div>
      <div class="chips" style="margin-bottom:12px">${cats[module][1].map((x) => html`<button class=${`chip ${text === x ? 'on' : ''}`} onClick=${() => setText(x)}>${x}</button>`)}</div>
      <label class="f">${t('Подробнее (необязательно)', 'Толығырақ (міндетті емес)')}<textarea class="i" rows="2" maxlength="500" value=${note} onInput=${(e) => setNote(e.target.value)} /></label>
      <label class="photo-pick">${file ? html`<img src=${preview} alt="" /><span>${t('Заменить фото', 'Фотоны ауыстыру')}</span>` : html`<b><${Icon} n="camera" s=${26} /></b><span>${t('Сфотографировать проблему', 'Мәселені суретке түсіру')}</span>`}
        <input type="file" accept="image/*" capture="environment" onChange=${(e) => setFile(e.target.files?.[0] || null)} /></label>
      <div class="small muted" style="margin:-4px 0 10px">${t('Снимайте проблему, а не людей и номера машин. Личные данные не нужны.', 'Адамдарды және көлік нөмірлерін емес, мәселені түсіріңіз. Жеке деректер қажет емес.')}</div>
      <div class="sec-title">${t('Место', 'Орны')} ${pos ? html`<span style="color:var(--green)"><${Icon} n="check" s=${14} /> ${t('определено', 'анықталды')}</span>` : ''}</div>
      <${MapView} cls="map small" height=${220} picker center=${pos ? [pos.lat, pos.lng] : [43.866, 77.07]} fitKey=${pos ? 'p' : 'n'} onPick=${setPos} items=${pos ? [{ lat: pos.lat, lng: pos.lng, tone: 'red' }] : []} />
      <div class="small muted" style="margin:6px 0 12px">${t('Нажмите на карту, чтобы уточнить место', 'Орынды нақтылау үшін картаны басыңыз')}</div>
      <button class="btn primary big" onClick=${send} disabled=${busy}>${busy ? '…' : t('Отправить', 'Жіберу')}</button>
      <p class="small muted" style="margin-top:8px">${t('Фото и место нужны только для устранения проблемы и видны акимату и исполнителю. Личные данные не собираются.', 'Фото мен орын тек мәселені жою үшін қажет және әкімдік пен орындаушыға ғана көрінеді. Жеке деректер жиналмайды.')}</p>
    </div>
  </div>`
}
