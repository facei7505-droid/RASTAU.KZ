import { html } from 'htm/preact'
import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { Toaster, toast } from './common.js'
import { Dashboard, ObjectsView, ContractorsView, AcceptView, ReportsView, JournalView, SummaryView, acceptQueues } from './admin.js'
import { InspectorField, ContractorField, CitizenView } from './field.js'
import { ObjectDrawer, EvidenceModal } from './object.js'
import { DirectoryView } from './directory.js'
import { PublicObject, ReportStatus, LangSwitch } from './public.js'
import { tr, useLang } from '../lib/i18n.js'
import { DEMO_PASSWORD } from '../lib/seed.js'
import { applySettings, setAirTemp, fmtDate } from '../lib/verify.js'
import { onOutbox, remove as removeQueued } from '../lib/outbox.js'
import { fetchAirTemp } from '../lib/ext.js'
import { BRAND, BRAND_TAG } from '../lib/brand.js'
import { Icon, Logo, Wordmark } from './icons.js'
import { PilotView } from './pilot.js'

const ROLE_LABEL = { admin: 'Руководитель', inspector: 'Инспектор', contractor: 'Подрядчик' }
const DEMO = () => [
  { email: 'akim@fakt.example', icon: 'landmark', title: tr('Руководитель акимата', 'Әкімдік басшысы'), text: tr('Карта, флаги, цели G-TON, рейтинг, сводка', 'Карта, белгілер, G-TON мақсаттары, рейтинг, жиынтық') },
  { email: 'inspector@fakt.example', icon: 'route', title: tr('Инспектор дорог (Абай)', 'Жол инспекторы (Абай)'), text: tr('Фиксация дефектов, объезд, приёмка', 'Ақауларды тіркеу, айналып шығу, қабылдау') },
  { email: 'tehnadzor@fakt.example', icon: 'helmet', title: tr('Технадзор строек (Конаев)', 'Құрылыс техқадағалауы (Қонаев)'), text: tr('Осмотр 127 объектов, приёмка', '127 нысанды тексеру, қабылдау') },
  { email: 'jol@fakt.example', icon: 'cone', title: tr('Подрядчик: дороги', 'Мердігер: жолдар'), text: tr('Заявки, фото «после», сроки', 'Өтінімдер, «кейінгі» фото, мерзімдер') },
  { email: 'stroy@fakt.example', icon: 'bricks', title: tr('Подрядчик: стройка', 'Мердігер: құрылыс'), text: tr('Еженедельный фотоотчёт', 'Апталық фотоесеп') },
  { email: 'taza@fakt.example', icon: 'truck', title: tr('Перевозчик ТКО', 'ҚТҚ тасымалдаушысы'), text: tr('Вывоз: фото до и после', 'Шығару: дейін және кейін фото') },
]

// Сценарии для жюри: вход в нужную роль сразу на нужном экране с подсказкой
const SCENARIOS = () => [
  { icon: 'shieldAlert', email: 'jol@fakt.example', view: 'field', title: tr('Подлог: фото не с места', 'Алаяқтық: фото орнынан емес'),
    hint: tr('Нажмите «Сдать работу» у любой заявки. В поле «Демо-режим позиции» выберите «Я в 2 км от объекта» и сделайте снимок: сервер отклонит фото, а индекс подрядчика упадёт.', 'Кез келген өтінімде «Жұмысты тапсыру» басыңыз. «Орын демо-режимі» өрісінде «Мен нысаннан 2 км қашықтамын» таңдап, суретке түсіріңіз: сервер фотоны қабылдамайды, мердігер индексі төмендейді.') },
  { icon: 'accept', email: 'inspector@fakt.example', view: 'accept', title: tr('Приёмка ремонта «до/после»', 'Жөндеуді «дейін/кейін» қабылдау'),
    hint: tr('Сдвиньте шторку на фото «до/после», посмотрите проверки сервера и нажмите «Принять к оплате» или «Вернуть». Решение попадает в журнал с цепочкой хэшей.', 'Фотодағы перденің жылжытыңыз, сервер тексерулерін қараңыз да «Төлемге қабылдау» немесе «Қайтару» басыңыз. Шешім хэш тізбегі бар журналға жазылады.') },
  { icon: 'qr', hash: '#/o/КП-012', title: tr('Житель сканирует QR на площадке', 'Тұрғын алаңдағы QR-ды сканерлейді') },
  { icon: 'timer', email: 'taza@fakt.example', view: 'field', title: tr('Жалоба жителя: таймер 24 часа', 'Тұрғын шағымы: 24 сағаттық таймер'),
    hint: tr('Жалобы жителей стоят первыми с отсчётом норматива. Жалоба закрывается только фото вывоза «до/после». В шапке можно включить казахский язык.', 'Тұрғындардың шағымдары нормативтің кері санағымен бірінші тұр. Шағым тек шығарудың «дейін/кейін» фотосымен жабылады. Жоғарыда қазақ тілін қосуға болады.') },
  { icon: 'file', email: 'akim@fakt.example', view: 'summary', title: tr('Сводка акиму в один клик', 'Әкімге бір басуда жиынтық'),
    hint: tr('Печать в PDF, выгрузка в Excel (CSV) и показатели в JSON для Smart Data Ukimet. Карта и красные флаги на вкладке «Обзор».', 'PDF-ке басып шығару, Excel (CSV) және Smart Data Ukimet үшін JSON көрсеткіштері. Карта мен қызыл белгілер «Шолу» бетінде.') },
  { icon: 'wifiOff', email: 'stroy@fakt.example', view: 'field', title: tr('Работа без связи', 'Байланыссыз жұмыс'),
    hint: tr('Включите режим полёта и сделайте фотоотчёт: фото встанет в очередь на телефоне и уйдёт само, когда связь вернётся. Сервер увидит, через сколько оно отправлено.', 'Ұшақ режимін қосып, фотоесеп жасаңыз: фото телефонда кезекке тұрады және байланыс қалпына келгенде өзі жіберіледі. Сервер қанша уақыттан кейін жіберілгенін көреді.') },
]
let nextView = null, nextHint = null

function useHash() {
  const [h, setH] = useState(location.hash)
  useEffect(() => { const f = () => setH(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return h
}

function Login({ api, onIn }) {
  useLang()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  async function go(e, p) {
    setBusy(true); setErr(null)
    try { onIn(await api.signIn(e, p)) } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  const tasks = [
    ['helmet', tr('№2 Конаев · стройки', '№2 Қонаев · құрылыс'), tr('127 строек на одной карте: план, заявлено, подтверждено фото', '127 құрылыс бір картада: жоспар, мәлімделгені, фотомен расталғаны')],
    ['route', tr('А-3 область Абай · дороги', 'А-3 Абай облысы · жолдар'), tr('Дефект за минуту уходит подрядчику, ремонт принимается по фото «до/после»', 'Ақау бір минутта мердігерге жетеді, жөндеу «дейін/кейін» фотосымен қабылданады')],
    ['truck', tr('№6 Конаев · вывоз мусора', '№6 Қонаев · қоқыс шығару'), tr('Рейс засчитывается только по фото площадки до и после', 'Рейс тек алаңның дейін және кейін фотосымен есептеледі')],
  ]
  const pick = (x) => { if (x.hash) { location.hash = x.hash; return } nextView = x.view; nextHint = x.hint; go(x.email, DEMO_PASSWORD) }
  return html`<div class="login">
    <aside class="login-l">
      <${Wordmark} s=${40} light sub=${tr(BRAND_TAG.ru, BRAND_TAG.kz)} />
      <div class="login-hero">
        ${tr(html`<h1>Акимат платит за <em>факт</em>, а не за бумагу</h1>`, html`<h1>Әкімдік қағазға емес, <em>фактіге</em> төлейді</h1>`)}
        <p>${tr('Подрядчик подтверждает работу фото с GPS прямо с места. Сервер проверяет, что снимок сделан там, сейчас и впервые. Руководитель видит все объекты на одной карте.', 'Мердігер жұмысты орнынан GPS бар фотомен растайды. Сервер суреттің сол жерде, дәл қазір және алғаш рет түсірілгенін тексереді. Басшы барлық нысанды бір картада көреді.')}</p>
      </div>
      <ul class="login-tasks">${tasks.map(([ic, t, d]) => html`<li><span class="lt-ic"><${Icon} n=${ic} s=${20} /></span><div><b>${t}</b><span>${d}</span></div></li>`)}</ul>
      <a class="login-plan" href="#/pilot"><${Icon} n="flag" s=${16} />${tr('План пилота на 8 недель и что нужно от акимата', '8 апталық пилот жоспары және әкімдіктен не керек')}<${Icon} n="chevron" s=${16} /></a>
      <div class="login-foot">G-TON 2026 · Smart City Kazakhstan</div>
    </aside>
    <main class="login-r"><div class="login-card">
      <div class="row between"><div><h2 class="lc-title">${tr('Вход в демо', 'Демоға кіру')}</h2><div class="muted small">${api.mode === 'online' ? tr('Онлайн-стенд для жюри и акимата', 'Қазылар мен әкімдікке арналған онлайн-стенд') : tr('Офлайн-режим: данные хранятся в браузере', 'Офлайн-режим: деректер браузерде сақталады')}</div></div><${LangSwitch} /></div>
      <section>
        <div class="sec-title">${tr('Показ для жюри · 3 минуты', 'Қазыларға көрсету · 3 минут')}</div>
        <div class="scen-list">${SCENARIOS().map((x, i) => html`<button class="scen-btn" disabled=${busy} onClick=${() => pick(x)}><i>${i + 1}</i><${Icon} n=${x.icon} /><span>${x.title}</span><${Icon} n="chevron" cls="chev" /></button>`)}</div>
      </section>
      <section>
        <div class="sec-title">${tr('Или войдите в роль', 'Немесе рөлге кіріңіз')}</div>
        <div class="roles">${DEMO().map((d) => html`<button class="role" disabled=${busy} onClick=${() => go(d.email, DEMO_PASSWORD)}><i><${Icon} n=${d.icon} s=${20} /></i><b>${d.title}</b><span>${d.text}</span></button>`)}</div>
      </section>
      <details class="pw"><summary>${tr('Войти по логину и паролю', 'Логин мен құпиясөз арқылы кіру')}</summary>
        <form onSubmit=${(e) => { e.preventDefault(); go(email, pw) }}>
          <label class="f">Email<input class="i" type="email" autocomplete="username" value=${email} onInput=${(e) => setEmail(e.target.value)} /></label>
          <label class="f">${tr('Пароль', 'Құпиясөз')}<input class="i" type="password" autocomplete="current-password" value=${pw} onInput=${(e) => setPw(e.target.value)} /></label>
          <button class="btn primary" disabled=${busy}>${tr('Войти', 'Кіру')}</button>
        </form></details>
      ${err && html`<div class="chain-bad">${err}</div>`}
      <div class="login-links small"><a href="#/pilot"><${Icon} n="flag" s=${16} />${tr('План пилота', 'Пилот жоспары')}</a><a href="#/report"><${Icon} n="message" s=${16} />${tr('Я житель: сообщить о проблеме', 'Мен тұрғынмын: мәселе туралы хабарлау')}</a>${api.mode === 'online' && html`<a href="?offline"><${Icon} n="wifiOff" s=${16} />${tr('Офлайн-демо', 'Офлайн-демо')}</a>`}</div>
      <div class="muted small"><${Icon} n="lock" s=${14} /> ${tr('В пилоте вход по ЭЦП (NCALayer) и eGov', 'Пилотта ЭЦҚ (NCALayer) және eGov арқылы кіру')}</div>
    </div></main>
  </div>`
}

// Состояние связи и очередь фото, снятых без сети
function NetBar({ api, data, onChanged }) {
  const [online, setOnline] = useState(navigator.onLine !== false)
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const up = () => { setOnline(true); onChanged() }, down = () => setOnline(false)
    addEventListener('online', up); addEventListener('offline', down)
    const off = onOutbox(setItems)
    return () => { removeEventListener('online', up); removeEventListener('offline', down); off() }
  }, [])
  const prev = useRef(items.length)
  useEffect(() => { if (items.length < prev.current) onChanged(); prev.current = items.length }, [items.length])
  if (online && !items.length && !data.stale) return null
  const errs = items.filter((x) => x.last_error)
  async function send() {
    setBusy(true)
    try { const r = await api.flushOutbox(); toast(r.sent ? `${tr('Отправлено фото', 'Жіберілген фото')}: ${r.sent}` : tr('Связи пока нет, фото остаются в очереди', 'Әзірге байланыс жоқ, фото кезекте қалады')) } finally { setBusy(false) }
  }
  return html`<div class=${`netbar no-print ${online ? '' : 'off'}`}>
    <${Icon} n=${online ? 'wifi' : 'wifiOff'} /><span>${online ? (items.length ? tr('Связь есть.', 'Байланыс бар.') : tr('Связь восстановлена.', 'Байланыс қалпына келді.')) : tr('Нет связи.', 'Байланыс жоқ.')}
      ${data.stale ? ` ${tr('Данные на', 'Деректер уақыты:')} ${fmtDate(data.stale, true)}.` : ''}
      ${items.length ? ` ${tr('В очереди фото', 'Кезектегі фото')}: ${items.length}${errs.length ? `, ${tr('с ошибкой', 'қатемен')}: ${errs.length}` : ''}. ${tr('Отправятся автоматически.', 'Автоматты түрде жіберіледі.')}` : !online ? ' ' + tr('Снимать можно: фото сохранятся в телефоне.', 'Түсіре беріңіз: фото телефонда сақталады.') : ''}</span>
    ${items.length > 0 && online && html`<button class="btn sm" disabled=${busy} onClick=${send}>${busy ? tr('Отправляем…', 'Жіберілуде…') : tr('Отправить сейчас', 'Қазір жіберу')}</button>`}
    ${errs.length > 0 && html`<details class="small"><summary>Почему не ушли</summary>${errs.map((x) => html`<div>${fmtDate(x.meta.device_time, true)}: ${x.last_error} <button class="btn sm" onClick=${() => confirm('Удалить это фото из очереди? Оно не будет отправлено.') && removeQueued(x.id)}>Удалить</button></div>`)}</details>`}
  </div>`
}

export function App({ api }) {
  useLang()
  const hash = useHash()
  const [me, setMe] = useState(api.me())
  const [data, setData] = useState(null)
  const [view, setView] = useState(null)
  const [mod, setMod] = useState('all')
  const [objId, setObjId] = useState(null)
  const [ev, setEv] = useState(null)
  const [err, setErr] = useState(null)
  const [menu, setMenu] = useState(false)

  const reload = useCallback(async () => {
    try { const d = await api.load(); applySettings(d.settings); setData(d); setErr(null) } catch (e) { setErr(e.message) }
  }, [api])
  // Санитарная норма вывоза ТКО зависит от температуры воздуха
  useEffect(() => { fetchAirTemp().then((t) => { if (t != null) { setAirTemp(t); setData((d) => d && { ...d }) } }) }, [])

  useEffect(() => { if (me) { reload(); return api.subscribe(reload) } }, [me])
  const [hint, setHint] = useState(null)
  // После входа и при смене раздела страница открывается сверху
  useEffect(() => { scrollTo(0, 0) }, [view, me])
  useEffect(() => { if (me && !view) { setView(nextView || (me.role === 'admin' ? 'dash' : 'field')); setHint(nextHint); nextView = nextHint = null } }, [me])

  if (hash.startsWith('#/pilot')) return html`<${PilotView} />`
  if (hash.startsWith('#/report')) return html`<${CitizenView} key=${hash} api=${api} /><${Toaster} />`
  if (hash.startsWith('#/o/')) return html`<${PublicObject} key=${hash} api=${api} code=${decodeURIComponent(hash.slice(4))} /><${Toaster} />`
  if (hash.startsWith('#/status')) return html`<${ReportStatus} key=${hash} api=${api} id=${decodeURIComponent(hash.slice(9))} /><${Toaster} />`
  if (!me) return html`<${Login} api=${api} onIn=${setMe} /><${Toaster} />`
  if (!data) return html`<div class="boot"><${Logo} s=${52} /><div>${err ? `Ошибка загрузки: ${err}` : 'Загружаем данные…'}</div>${err && html`<div class="row"><button class="btn" onClick=${reload}>Повторить</button><a class="btn" href="?offline">Открыть офлайн-демо</a></div>`}</div>`

  const tabs = me.role === 'admin'
    ? [['dash', tr('Обзор', 'Шолу'), 'overview'], ['objects', tr('Объекты', 'Нысандар'), 'list'], ['accept', tr('Приёмка', 'Қабылдау'), 'accept'], ['reports', tr('Обращения', 'Өтініштер'), 'message'], ['contractors', tr('Подрядчики', 'Мердігерлер'), 'building'], ['summary', tr('Сводка', 'Жиынтық'), 'file'], ['journal', tr('Журнал', 'Журнал'), 'shield'], ['directory', tr('Настройки', 'Баптаулар'), 'sliders']]
    : me.role === 'inspector'
      ? [['field', tr('Поле', 'Дала'), 'camera'], ['accept', tr('Приёмка', 'Қабылдау'), 'accept'], ['dash', tr('Карта', 'Карта'), 'map'], ['reports', tr('Обращения', 'Өтініштер'), 'message'], ['objects', tr('Объекты', 'Нысандар'), 'list'], ['journal', tr('Журнал', 'Журнал'), 'shield']]
      : []
  const openObject = (id) => setObjId(id)
  const openEvidence = (e) => e && setEv(e)
  const obj = objId && data.objects.find((o) => o.id === objId)
  const evFresh = ev && (data.evidence.find((x) => x.id === ev.id) || ev)
  const common = { api, data, me, openObject, openEvidence, onChanged: reload, go: setView }
  const aq = acceptQueues(data, me), pendingAccept = aq.queue.length + (aq.scope === 'build' ? aq.reviews.length : 0)

  async function logout() { setMenu(false); await api.signOut(); setMe(null); setData(null); setView(null); setHint(null) }
  async function resetDemo() { if (confirm('Вернуть демо-данные к исходному состоянию?')) { await api.reset(); await reload(); toast('Демо-данные восстановлены') } }

  return html`
    <header class="top no-print">
      <${Wordmark} s=${32} sub=${me.role === 'contractor' ? tr('кабинет подрядчика', 'мердігер кабинеті') : tr('контроль работ акимата', 'әкімдік жұмыс бақылауы')} />
      <nav class="nav">${tabs.map(([k, l, ic]) => html`<button class=${view === k ? 'on' : ''} onClick=${() => setView(k)}><${Icon} n=${ic} s=${17} />${l}${k === 'accept' && pendingAccept ? html`<span class="count">${pendingAccept}</span>` : ''}</button>`)}</nav>
      <div class="who">${me.role === 'contractor' && html`<${LangSwitch} dark />`}<button class="ava-btn" title=${tr('Профиль и настройки', 'Профиль және баптаулар')} onClick=${() => setMenu(true)}><span class="ava">${me.full_name[0]}</span><span class="who-n">${me.full_name}<small>${me.role === 'contractor' ? tr('Подрядчик', 'Мердігер') : ROLE_LABEL[me.role]}</small></span></button></div>
    </header>
    <div class="demo-strip no-print"><${Icon} n="info" s=${14} /><b>${tr('Демо-стенд G-TON.', 'G-TON демо-стенді.')}</b> ${tr('Организации, люди и суммы вымышлены.', 'Ұйымдар, адамдар мен сомалар ойдан алынған.')}<span class="long"> ${tr('В пилоте данные хранятся в ЦОД на территории РК, вход по ЭЦП.', 'Пилотта деректер ҚР аумағындағы ДӨО-да сақталады, кіру ЭЦҚ арқылы.')}</span>
      ${api.mode === 'offline' && html`<button class="btn sm long" onClick=${resetDemo}>${tr('Сбросить демо-данные', 'Демо-деректерді қалпына келтіру')}</button>`}</div>
    <${NetBar} api=${api} data=${data} onChanged=${reload} />
    ${hint && html`<div class="hintbar no-print"><${Icon} n="sparkles" /><span>${hint}</span><button class="btn sm" onClick=${() => setHint(null)}>${tr('Понятно', 'Түсінікті')}</button></div>`}
    ${view === 'dash' && html`<${Dashboard} ...${common} mod=${mod} setMod=${setMod} />`}
    ${view === 'objects' && html`<${ObjectsView} ...${common} mod=${mod} setMod=${setMod} />`}
    ${view === 'accept' && html`<${AcceptView} ...${common} />`}
    ${view === 'contractors' && html`<${ContractorsView} ...${common} />`}
    ${view === 'reports' && html`<${ReportsView} ...${common} />`}
    ${view === 'journal' && html`<${JournalView} ...${common} />`}
    ${view === 'summary' && html`<${SummaryView} ...${common} />`}
    ${view === 'directory' && me.role === 'admin' && html`<${DirectoryView} ...${common} />`}
    ${view === 'field' && me.role === 'inspector' && html`<${InspectorField} ...${common} />`}
    ${view === 'field' && me.role === 'contractor' && html`<${ContractorField} ...${common} />`}
    ${obj && html`<${ObjectDrawer} ...${common} obj=${obj} onClose=${() => setObjId(null)} onOpenEvidence=${openEvidence} />`}
    ${evFresh && html`<${EvidenceModal} ...${common} ev=${evFresh} onClose=${() => setEv(null)} />`}
    ${tabs.length > 1 && html`<nav class="tabbar no-print">${(tabs.length > 5 ? tabs.slice(0, 4) : tabs).map(([k, l, ic]) => html`<button class=${view === k ? 'on' : ''} onClick=${() => setView(k)}><i><${Icon} n=${ic} s=${22} /></i><span>${l}</span>${k === 'accept' && pendingAccept ? html`<b class="count">${pendingAccept}</b>` : ''}</button>`)}
      ${tabs.length > 5 && html`<button class=${tabs.slice(4).some(([k]) => k === view) ? 'on' : ''} onClick=${() => setMenu(true)}><i><${Icon} n="menu" s=${22} /></i><span>${tr('Ещё', 'Тағы')}</span></button>`}</nav>`}
    ${menu && html`<div class="sheet-bg no-print" onClick=${() => setMenu(false)}><div class="sheet" onClick=${(e) => e.stopPropagation()}>
      <div class="sheet-who"><span class="ava">${me.full_name[0]}</span><div><b>${me.full_name}</b><div class="small muted">${me.role === 'contractor' ? tr('Подрядчик', 'Мердігер') : ROLE_LABEL[me.role]} · ${me.email || ''}</div></div></div>
      ${tabs.length > 5 && html`<div class="sheet-tabs">${tabs.slice(4).map(([k, l, ic]) => html`<button class=${view === k ? 'on' : ''} onClick=${() => { setView(k); setMenu(false) }}><${Icon} n=${ic} />${l}</button>`)}</div>`}
      <div class="row between"><span class="small muted">${tr('Язык интерфейса', 'Интерфейс тілі')}</span><${LangSwitch} /></div>
      ${api.mode === 'offline' && html`<button class="btn" onClick=${() => { setMenu(false); resetDemo() }}>${tr('Сбросить демо-данные', 'Демо-деректерді қалпына келтіру')}</button>`}
      <button class="btn red" onClick=${logout}><${Icon} n="logout" s=${16} />${tr('Выйти', 'Шығу')}</button>
    </div></div>`}
    <${Toaster} />`
}
