import { html } from 'htm/preact'
import { Icon, Logo, Wordmark } from './icons.js'
import { useState, useEffect } from 'preact/hooks'
import { Photo } from './common.js'
import { fmtDate, fmtMoney, humanDuration } from '../lib/verify.js'

// Публичные страницы без входа: карточка объекта по QR и статус обращения жителя.
// Показываются только открытые сведения (как на информационном щите стройки), без персональных данных.

export { useLang, tr } from '../lib/i18n.js'
import { useLang } from '../lib/i18n.js'

export function LangSwitch({ dark }) {
  const [lang, setLang] = useLang()
  return html`<div class=${`chips lang-sw ${dark ? 'dark' : ''}`}><button class=${`chip ${lang === 'ru' ? 'on' : ''}`} onClick=${() => setLang('ru')}>РУС</button><button class=${`chip ${lang === 'kz' ? 'on' : ''}`} onClick=${() => setLang('kz')}>ҚАЗ</button></div>`
}

function Head({ lang, setLang }) {
  return html`<div class="row between"><a href="#/" class="wordmark"><${Logo} s=${30} /><span><b>Rastau</b></span></a>
    <div class="chips"><button class=${`chip ${lang === 'ru' ? 'on' : ''}`} onClick=${() => setLang('ru')}>РУС</button><button class=${`chip ${lang === 'kz' ? 'on' : ''}`} onClick=${() => setLang('kz')}>ҚАЗ</button></div></div>`
}

export function PublicObject({ api, code }) {
  const [lang, setLang, t] = useLang()
  const [o, setO] = useState(undefined)
  useEffect(() => { api.publicObject(code).then(setO).catch(() => setO(null)) }, [code])
  if (o === undefined) return html`<div class="boot"><${Logo} s=${52} /></div>`
  if (!o) return html`<div class="page narrow"><${Head} lang=${lang} setLang=${setLang} /><div class="card" style="margin-top:14px">${t('Объект не найден', 'Нысан табылмады')}: ${code}</div></div>`
  const tone = { green: [t('В норме', 'Қалыпты'), 'green'], amber: [t('Требует внимания', 'Назар аударуды қажет етеді'), 'amber'], red: [t('Есть проблема, акимат в курсе', 'Мәселе бар, әкімдік хабардар'), 'red'] }[o.tone] || ['', '']
  const kind = { waste: t('Контейнерная площадка', 'Контейнер алаңы'), road: t('Автомобильная дорога', 'Автомобиль жолы'), build: t('Строительный объект', 'Құрылыс нысаны') }[o.module]
  const age = o.last_fact_at ? Date.now() - new Date(o.last_fact_at).getTime() : null
  return html`<div class="page narrow">
    <${Head} lang=${lang} setLang=${setLang} />
    <div class="pub-hero" style="margin-top:12px">
      <div class="small" style="opacity:.8">${kind} · ${o.code}</div>
      <h1 style="color:#fff;margin-top:4px">${o.name}</h1>
      <div class="small" style="opacity:.85">${o.address || ''}</div>
      <div class="st">${tone[1] && html`<span class=${`dot ${tone[1]}`}></span>`} ${tone[0]}</div>
    </div>
    <div class="card">
      <dl class="kv">
        <dt>${t('Исполнитель', 'Орындаушы')}</dt><dd>${o.contractor || '—'}</dd>
        ${o.contract_no && html`<dt>${t('Договор', 'Шарт')}</dt><dd>${o.contract_no}</dd>`}
        ${o.module === 'build' && o.amount && html`<dt>${t('Сумма', 'Сомасы')}</dt><dd>${fmtMoney(o.amount)}</dd>`}
        ${o.module === 'build' && html`<dt>${t('Сроки', 'Мерзімі')}</dt><dd>${fmtDate(o.start_date)} — ${fmtDate(o.end_date)}</dd>
          <dt>${t('Готовность, подтверждённая фото', 'Фотомен расталған дайындығы')}</dt><dd><b>${o.progress_confirmed ?? 0}%</b></dd>`}
        <dt>${o.module === 'waste' ? t('Последний подтверждённый вывоз', 'Соңғы расталған шығару') : t('Последний подтверждённый фотоотчёт', 'Соңғы расталған фотоесеп')}</dt>
        <dd>${o.last_fact_at ? html`${fmtDate(o.last_fact_at, true)} <span class="muted">(${humanDuration(age)} ${t('назад', 'бұрын')})</span>` : '—'}</dd>
        ${o.open_reports > 0 && html`<dt>${t('Открытых обращений', 'Ашық өтініштер')}</dt><dd>${o.open_reports}</dd>`}
      </dl>
      ${o.last_photo && html`<div style="margin-top:10px"><${Photo} api=${api} url=${o.last_photo} /></div>`}
    </div>
    <a class="btn primary big" style="margin-top:12px;width:100%" href=${`#/report?o=${encodeURIComponent(o.code)}&m=${o.module}`}>${o.module === 'waste' ? t('Сообщить: переполнено / не вывезли', 'Хабарлау: толып кетті / шығарылмады') : t('Сообщить о проблеме', 'Мәселе туралы хабарлау')}</a>
    <p class="small muted" style="text-align:center;margin-top:12px">${t('Работа исполнителя засчитывается только по фото с места, проверенному сервером: место, время, повтор снимка.', 'Орындаушының жұмысы тек сервер тексерген орыннан түсірілген фото бойынша есептеледі.')}</p>
  </div>`
}

export function ReportStatus({ api, id }) {
  const [lang, setLang, t] = useLang()
  const [r, setR] = useState(undefined)
  const [q, setQ] = useState(id || '')
  useEffect(() => { if (id) api.reportStatus(id).then(setR).catch(() => setR(null)); else setR(null) }, [id])
  const steps = r ? [
    [t('Обращение принято', 'Өтініш қабылданды'), fmtDate(r.created_at, true), true],
    [t('Передано исполнителю', 'Орындаушыға жіберілді'), r.contractor || '', r.status !== 'new' || (r.module === 'waste' && !!r.contractor)],
    [t('Устранено и подтверждено фото с места', 'Жойылды және орнынан фотомен расталды'), r.closed_at ? `${fmtDate(r.closed_at, true)}${r.resolution ? ' · ' + r.resolution : ''}` : '', r.status === 'closed'],
  ] : []
  return html`<div class="page narrow">
    <${Head} lang=${lang} setLang=${setLang} />
    <h1 style="margin-top:14px">${t('Статус обращения', 'Өтініш мәртебесі')}</h1>
    <form class="row" onSubmit=${(e) => { e.preventDefault(); location.hash = `#/status/${encodeURIComponent(q.trim())}` }}>
      <input class="i grow" placeholder="RP…" value=${q} onInput=${(e) => setQ(e.target.value)} /><button class="btn primary">${t('Проверить', 'Тексеру')}</button></form>
    ${r === null && id && html`<div class="card" style="margin-top:12px">${t('Обращение не найдено', 'Өтініш табылмады')}</div>`}
    ${r && html`<div class="card" style="margin-top:12px">
      <b>${r.text}</b><div class="small muted">№ ${r.id.toUpperCase()}${r.object_code ? html` · <a href=${`#/o/${encodeURIComponent(r.object_code)}`}>${r.object_code} ${r.object_name || ''}</a>` : ''}</div>
      <div class="steps" style="margin-top:10px">${steps.map(([l, d, done], i) => html`<div class=${`s ${done ? 'done' : steps[i - 1]?.[2] ? 'now' : ''}`}><i>${done ? html`<${Icon} n="check" s=${13} />` : i + 1}</i><div>${l}${d && html`<div class="small muted">${d}</div>`}</div></div>`)}</div>
      ${r.closed_at && html`<div class="chain-ok" style="margin-top:8px">${t('Решено за', 'Шешілген уақыты')} ${humanDuration(new Date(r.closed_at) - new Date(r.created_at))}</div>`}
    </div>`}
    <p class="small muted" style="margin-top:12px">${t('Обращение закрывается только после фото с места, проверенного системой. Отписка «выполнено» без фото не принимается.', 'Өтініш тек жүйе тексерген орыннан түсірілген фотодан кейін жабылады.')}</p>
    <a class="btn" href="#/report" style="width:100%">${t('Новое обращение', 'Жаңа өтініш')}</a>
  </div>`
}

