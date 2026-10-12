import { html } from 'htm/preact'
import { Icon, Logo, Wordmark } from './icons.js'
import { useState, useMemo, useEffect } from 'preact/hooks'
import { Badge, VerdictBadge, Photo, Checks, VerdictBox, BeforeAfter, Modal, Prog, toast, Empty, usePhoto } from './common.js'
import { MapView } from './map.js'
import { sha256Hex } from '../lib/verify.js'
import { signWithNcaLayer } from '../lib/ncalayer.js'
import { wasteNorm } from '../lib/verify.js'
import { MODULES, STAGES, ORDER_STATUS, DEFECTS, fmtDate, fmtMoney, fmtDist, plannedProgress, objectHealth, isOverdue, roadCoverage, humanDuration, orderPenalty, objectPenalty, CONFIG } from '../lib/verify.js'
import { ObjectForm } from './directory.js'
import { qrSvg, publicUrl } from '../lib/ext.js'

export function EvidenceModal({ api, data, ev, onClose, me, onChanged }) {
  const [ai, setAi] = useState(null)
  const [aiBusy, setAiBusy] = useState(false)
  const obj = data.objects.find((o) => o.id === ev.object_id)
  const ord = ev.order_id ? data.orders.find((o) => o.id === ev.order_id) : null
  const before = ord?.before_id ? data.evidence.find((e) => e.id === ord.before_id) : null
  const after = ord?.after_id ? data.evidence.find((e) => e.id === ord.after_id) : null
  const staff = me?.role === 'admin' || me?.role === 'inspector'
  const skew = ev.device_time ? Math.abs(new Date(ev.server_time) - new Date(ev.device_time)) : 0

  async function review(ok) {
    let note = ''
    if (!ok) note = prompt('Причина отклонения отчёта:') || 'Не подтверждено инспектором'
    else if (ev.verdict === 'rejected') {
      // Система только рекомендует: инспектор может принять фото вопреки ей, но обязан объяснить почему
      note = prompt('Система отклонила фото. Почему вы его принимаете? (обязательно, попадёт в журнал)')
      if (!note) return
      note = `Принято вопреки системе: ${note}`
    }
    await api.reviewEvidence(ev.id, ok, note)
    toast(ok ? 'Отчёт подтверждён, процент засчитан' : 'Отчёт отклонён')
    onChanged && onChanged()
    onClose()
  }
  async function runAi() {
    setAiBusy(true)
    try { setAi(await api.aiAnalyze(ev.id)) } finally { setAiBusy(false) }
  }

  return html`<${Modal} title=${`${STAGES[ev.stage] || 'Доказательство'} · ${obj?.code || ''}`} onClose=${onClose} wide>
    <div class="grid g2">
      <div>
        ${before && after && (ev.id === after.id || ev.id === before.id)
          ? html`<${BeforeAfter} api=${api} before=${before} after=${after} /><div class="small muted" style="margin-top:6px">Двигайте ползунок: слева фото «до», справа «после»</div>`
          : html`<${Photo} api=${api} url=${ev.photo_url} />`}
        <div style="height:12px" />
        <dl class="kv">
          <dt>Объект</dt><dd>${obj?.code} ${obj?.name}</dd>
          ${ord && html`<dt>Заявка</dt><dd>${ord.title}</dd>`}
          <dt>Автор</dt><dd>${ev.author_name || '—'}</dd>
          <dt>Время сервера</dt><dd>${fmtDate(ev.server_time, true)}</dd>
          <dt>Время телефона</dt><dd>${fmtDate(ev.device_time, true)}${skew > 600000 ? html` <${Badge} tone="red">расхождение ${humanDuration(skew)}</${Badge}>` : ''}</dd>
          <dt>Координаты</dt><dd>${ev.lat != null ? `${(+ev.lat).toFixed(5)}, ${(+ev.lng).toFixed(5)} ±${Math.round(ev.accuracy || 0)} м` : 'нет'}</dd>
          <dt>Способ съёмки</dt><dd>${ev.capture === 'camera' ? 'Камера Rastau' : 'Файл'}${ev.simulated ? ' · демо-позиция' : ''}</dd>
          ${ev.progress != null && html`<dt>Заявленная готовность</dt><dd><b>${ev.progress}%</b></dd>`}
          ${ev.comment && html`<dt>Комментарий</dt><dd>${ev.comment}</dd>`}
          <dt>SHA-256 файла</dt><dd class="hash">${ev.sha256 || '—'}</dd>
          <dt>Отпечаток (pHash)</dt><dd class="hash">${ev.phash || '—'}</dd>
          ${ev.review && html`<dt>Решение инспектора</dt><dd><${Badge} tone=${ev.review === 'approved' ? 'green' : 'red'}>${ev.review === 'approved' ? 'Подтверждено' : 'Отклонено'}</${Badge}> ${ev.reviewed_by || ''} ${ev.review_note || ''}</dd>`}
        </dl>
      </div>
      <div>
        <${VerdictBox} ev=${ev} />
        <div class="sec-title">Почему такой балл</div>
        <${Checks} checks=${ev.checks} />
        <div style="height:14px" />
        <div class="card" style="padding:12px;background:#f8fafc">
          <div class="row between"><b class="h-ic"><${Icon} n="sparkles" />ИИ-эксперт</b><button class="btn sm" onClick=${runAi} disabled=${aiBusy}>${aiBusy ? 'Анализ…' : 'Проанализировать фото'}</button></div>
          <div class="small muted" style="margin-top:4px">Модель описывает, что на снимке, и есть ли видимый дефект. Только рекомендация: решение принимает инспектор.</div>
          ${ai && (ai.available === false
            ? html`<div class="callout" style="margin-top:8px">${ai.reason}</div>`
            : html`<div style="margin-top:8px" class="small">
                <div><b>Что на фото:</b> ${ai.description}</div>
                ${ai.defect && html`<div><b>Дефект:</b> ${ai.defect}</div>`}
                ${ai.work_done != null && html`<div><b>Работа видна:</b> ${ai.work_done ? 'да' : 'нет'}</div>`}
                ${ai.risk && html`<div><b>Риск подлога:</b> ${ai.risk}</div>`}
                <div class="muted" style="margin-top:4px">Оценка ИИ, не является решением.</div>
              </div>`)}
        </div>
        ${staff && (ev.stage === 'progress' || ev.stage === 'pickup_after') && !ev.review && html`
          <div class="row" style="margin-top:14px">
            ${ev.verdict === 'review' && html`<button class="btn green grow" onClick=${() => review(true)}><${Icon} n="check" s=${16} />Подтвердить отчёт</button>`}
            ${ev.verdict !== 'rejected' && html`<button class="btn red grow" onClick=${() => review(false)}><${Icon} n="x" s=${16} />Отклонить${ev.verdict === 'ok' ? ' (повторный осмотр)' : ''}</button>`}
            ${ev.verdict === 'rejected' && html`<button class="btn grow" onClick=${() => review(true)}>Принять вручную, вопреки системе…</button>`}
          </div>
          <div class="small muted" style="margin-top:6px">Система только рекомендует. Решение за инспектором и фиксируется в журнале с его именем.</div>`}
      </div>
    </div>
  </${Modal}>`
}

export function EvidenceGrid({ api, list, onOpen }) {
  if (!list.length) return html`<${Empty}>Доказательств пока нет</${Empty}>`
  return html`<div class="evs">
    ${list.map((e) => html`<div class=${`ev ${e.verdict}`} onClick=${() => onOpen(e)}>
      <${Photo} api=${api} url=${e.photo_url} cls="" />
      <span class="score"><span class=${`score-pill ${e.verdict === 'ok' ? 'green' : e.verdict === 'review' ? 'amber' : 'red'}`}>${e.score}</span></span>
      <div class="eb"><b>${STAGES[e.stage] || e.stage}</b>${e.progress != null ? ` · ${e.progress}%` : ''}<div class="muted">${fmtDate(e.server_time, true)}</div>
        ${e.verdict !== 'ok' && html`<div style="color:var(--red)">${(e.checks || []).find((c) => !c.ok && c.penalty >= 25)?.label || (e.checks || []).find((c) => !c.ok)?.label || ''}</div>`}
      </div>
    </div>`)}
  </div>`
}

function ProgressChart({ obj, evidence }) {
  const W = 560, H = 160, P = 26
  const s = new Date(obj.start_date).getTime(), e = new Date(obj.end_date).getTime()
  const now = Date.now()
  const end = Math.max(e, now)
  const x = (t) => P + ((t - s) / (end - s)) * (W - P * 2)
  const y = (v) => H - P - (v / 100) * (H - P * 1.6)
  const plan = []
  for (let i = 0; i <= 30; i++) { const t = s + ((end - s) * i) / 30; plan.push(`${x(t)},${y(plannedProgress(obj, t))}`) }
  const pts = evidence.filter((v) => v.progress != null).sort((a, b) => a.server_time.localeCompare(b.server_time))
  let conf = 0
  const confLine = [`${x(s)},${y(0)}`]
  for (const p of pts) { if (p.verdict === 'ok' || p.review === 'approved') conf = Math.max(conf, p.progress); confLine.push(`${x(new Date(p.server_time).getTime())},${y(conf)}`) }
  return html`<svg class="spark" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="График план и факт">
    ${[0, 50, 100].map((v) => html`<line x1=${P} x2=${W - P} y1=${y(v)} y2=${y(v)} stroke="#e3e8ef" /><text x="2" y=${y(v) + 4} font-size="10" fill="#5b6b80">${v}%</text>`)}
    <line x1=${x(now)} x2=${x(now)} y1="8" y2=${H - P} stroke="#0f1b2d" stroke-dasharray="3 3" /><text x=${x(now) + 4} y="16" font-size="10" fill="#0f1b2d">сегодня</text>
    <polyline points=${plan.join(' ')} fill="none" stroke="#8a97a8" stroke-width="2" stroke-dasharray="5 4" />
    <polyline points=${confLine.join(' ')} fill="none" stroke="#138a4b" stroke-width="3" />
    ${pts.map((p) => html`<circle cx=${x(new Date(p.server_time).getTime())} cy=${y(p.progress)} r="5" fill=${p.verdict === 'rejected' ? '#c62828' : p.verdict === 'review' ? '#d38b00' : '#138a4b'} stroke="#fff" stroke-width="1.5"><title>${fmtDate(p.server_time)}: заявлено ${p.progress}% (${p.score}/100)</title></circle>`)}
  </svg>
  <div class="legend" style="border:0;padding:0"><span><i class="dot" style="background:#8a97a8" /> план по графику</span><span><i class="dot green" /> подтверждено фактом</span><span><i class="dot red" /> отклонённый отчёт</span></div>`
}

export function ObjectDrawer({ api, data, obj, me, onClose, onOpenEvidence, onChanged }) {
  const [act, setAct] = useState(false)
  const [edit, setEdit] = useState(false)
  const contractor = data.contractors.find((c) => c.id === obj.contractor_id)
  const health = objectHealth(obj, { orders: data.orders })
  const evs = data.evidence.filter((e) => e.object_id === obj.id).sort((a, b) => b.server_time.localeCompare(a.server_time))
  const orders = data.orders.filter((o) => o.object_id === obj.id).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const audit = (data.audit || []).filter((a) => evs.some((e) => e.id === a.entity_id) || orders.some((o) => o.id === a.entity_id) || a.entity_id === obj.id).slice(-12).reverse()
  const plan = obj.module === 'build' ? plannedProgress(obj) : null
  const cov = obj.module === 'road' ? roadCoverage(obj, data.tracks || []) : null
  const unconfirmed = obj.module === 'build' ? Math.max(0, (obj.progress_claimed - obj.progress_confirmed) / 100) * (obj.amount || 0) : 0

  return html`<div class="drawer-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="drawer" role="dialog" aria-label=${obj.name}>
      <div class="drawer-h">
        <span class=${`dot ${health.tone}`} style="margin-top:8px" />
        <div class="grow"><div class="small muted">${obj.code} · ${MODULES[obj.module].full} · ${MODULES[obj.module].region} · задача ${MODULES[obj.module].task}</div><h2 style="margin:2px 0 0">${obj.name}</h2></div>
        ${me?.role === 'admin' && html`<button class="btn sm" onClick=${() => setEdit(true)}><${Icon} n="pen" s=${15} />Изменить</button>`}
        <a class="btn sm" href=${`#/o/${encodeURIComponent(obj.code)}`} target="_blank" title="Публичная карточка для QR-таблички">QR ↗</a>
        <button class="btn sm" onClick=${() => setAct(true)}><${Icon} n="file" s=${15} />Акт</button>
        <button class="x" onClick=${onClose} aria-label="Закрыть">×</button>
      </div>
      <div class="drawer-b">
        ${health.flags.length > 0 && html`<div class="card" style="padding:12px">
          ${health.flags.map((f) => html`<div class="row" style="padding:3px 0"><span class=${`dot ${f.tone}`} /> <span>${f.text}</span></div>`)}
        </div>`}
        <div class="grid g2">
          <div class="card">
            <dl class="kv">
              <dt>Подрядчик</dt><dd>${contractor?.name || '—'}<div class="small muted">БИН ${contractor?.bin || '—'}</div></dd>
              <dt>Договор</dt><dd>${obj.contract_no || '—'}</dd>
              <dt>Сумма</dt><dd>${fmtMoney(obj.amount)}</dd>
              <dt>Сроки</dt><dd>${fmtDate(obj.start_date)} — ${fmtDate(obj.end_date)}</dd>
              <dt>Адрес</dt><dd>${obj.address || '—'}</dd>
              ${obj.module === 'road' && html`<dt>Протяжённость</dt><dd>${obj.length_km} км</dd><dt>Осмотрено за 30 дн</dt><dd><b>${Math.round(cov * 100)}%</b> участка</dd>`}
              ${obj.module === 'waste' && html`<dt>Контейнеров</dt><dd>${obj.containers}</dd><dt>Вывоз по графику</dt><dd>${obj.pickups_per_week} раз в неделю${obj.pickups_per_week < wasteNorm().perWeek ? html` <${Badge} tone="amber">ниже санитарной нормы</${Badge}>` : ''}</dd><dt>Санитарная норма</dt><dd>${wasteNorm().label}</dd><dt>Последний вывоз</dt><dd>${fmtDate(obj.last_report_at, true)}</dd><dt>Состояние</dt><dd>${obj.site_state === 'full' ? html`<${Badge} tone="red">Переполнена</${Badge}>` : html`<${Badge} tone="green">В норме</${Badge}>`}</dd>`}
            </dl>
          </div>
          <div class="card">
            ${obj.module === 'build' ? html`
              <div class="sec-title">Готовность</div>
              <${Prog} claimed=${obj.progress_claimed} confirmed=${obj.progress_confirmed} plan=${plan} />
              <div class="grid g3" style="margin-top:12px;text-align:center">
                <div><div class="small muted">По графику</div><b style="font-size:20px">${plan}%</b></div>
                <div><div class="small muted">Заявлено</div><b style="font-size:20px">${obj.progress_claimed}%</b></div>
                <div><div class="small muted">Подтверждено</div><b style="font-size:20px;color:var(--green)">${obj.progress_confirmed}%</b></div>
              </div>
              ${unconfirmed > 0 && html`<div class="callout" style="margin-top:12px;background:var(--red-bg);color:var(--red)">Не подтверждено фактом: <b>${fmtMoney(unconfirmed)}</b>. К оплате только подтверждённый объём.</div>`}
              ${objectPenalty(obj) > 0 && html`<div class="callout" style="margin-top:8px;background:var(--amber-bg);color:var(--amber)">Срок договора истёк ${fmtDate(obj.end_date)}. Неустойка (оценка, ${(CONFIG.penalty_rate * 100).toFixed(1).replace('.', ',')}% в день, не более ${Math.round(CONFIG.penalty_cap * 100)}%): <b>${fmtMoney(objectPenalty(obj))}</b></div>`}
            ` : html`<${MapView} cls="map small" height=${220} fitKey=${obj.id}
                items=${[obj.module === 'road' ? { path: obj.path, tone: health.tone, kind: 'road' } : { lat: obj.lat, lng: obj.lng, tone: health.tone, kind: obj.module },
                  ...orders.map((o) => ({ lat: o.lat, lng: o.lng, kind: 'defect', tone: o.status === 'accepted' ? 'green' : isOverdue(o) || o.status === 'rejected' ? 'red' : 'amber', label: o.title }))]} />`}
          </div>
        </div>
        ${obj.module === 'build' && html`<div class="card"><h3>План и факт</h3><${ProgressChart} obj=${obj} evidence=${evs.filter((e) => e.stage === 'progress' || e.stage === 'inspection')} /></div>`}
        ${orders.length > 0 && html`<div class="card flush"><div class="card-h"><h2>Заявки подрядчику (${orders.length})</h2></div>
          <div class="scroll" style="max-height:340px"><table class="tbl"><thead><tr><th>Заявка</th><th>Создана</th><th>Срок</th><th>Статус</th><th></th></tr></thead><tbody>
          ${orders.map((o) => html`<tr class="click" onClick=${() => { const e = data.evidence.find((x) => x.id === (o.after_id || o.before_id)); e && onOpenEvidence(e) }}>
            <td>${o.title}${o.warranty_of ? html` <span class="badge warranty">гарантия</span>` : ''}</td><td>${fmtDate(o.created_at)}</td><td>${fmtDate(o.due_at)}${isOverdue(o) ? html` <${Badge} tone="red">просрочено</${Badge}>` : ''}${orderPenalty(o, data.evidence) > 0 ? html`<div class="small" style="color:var(--amber)">неустойка ${fmtMoney(orderPenalty(o, data.evidence))}</div>` : ''}</td>
            <td><${Badge} tone=${ORDER_STATUS[o.status].tone}>${ORDER_STATUS[o.status].label}</${Badge}></td><td>${fmtMoney(o.amount)}</td></tr>`)}
          </tbody></table></div></div>`}
        <div class="card"><h3>Доказательства (${evs.length})</h3><${EvidenceGrid} api=${api} list=${evs} onOpen=${onOpenEvidence} /></div>
        ${audit.length > 0 && html`<div class="card"><h3>Журнал по объекту</h3><div class="timeline">
          ${audit.map((a) => html`<div class="tl"><div class="tw">${fmtDate(a.at, true)}</div><div>${a.summary}<div class="small muted">${a.actor}</div></div></div>`)}
        </div></div>`}
      </div>
    </div>
    ${edit && html`<${ObjectForm} api=${api} data=${data} obj=${obj} onClose=${() => setEdit(false)} />`}
    ${act && html`<${ActModal} api=${api} me=${me} onChanged=${onChanged} data=${data} obj=${obj} evs=${evs} orders=${orders} onClose=${() => setAct(false)} />`}
  </div>`
}

function ActPhoto({ api, url }) {
  const src = usePhoto(api, url)
  return src ? html`<img src=${src} alt="" />` : null
}

// Печатная форма: приложение к акту выполненных работ (Р-1) с фотодоказательствами
export function ActModal({ api, me, data, obj, evs, orders, onClose, onChanged }) {
  const contractor = data.contractors.find((c) => c.id === obj.contractor_id)
  const good = evs.filter((e) => e.verdict === 'ok' || e.review === 'approved').slice(0, 6)
  const bad = evs.filter((e) => e.verdict === 'rejected' || e.review === 'declined')
  const accepted = orders.filter((o) => o.status === 'accepted')
  const code = (good[0]?.sha256 || '').slice(0, 12).toUpperCase()
  const actNo = `RST-${obj.code}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
  const [sig, setSig] = useState(null)
  const [signing, setSigning] = useState(false)
  const staff = me?.role === 'admin' || me?.role === 'inspector'
  const warranty = orders.filter((o) => o.warranty_of)
  const penalty = (obj.module === 'build' ? objectPenalty(obj) : 0) + orders.reduce((a, o) => a + orderPenalty(o, data.evidence), 0)
  const masked = evs.reduce((a, e) => a + (e.masked || 0), 0)
  // QR на акте ведёт на публичную карточку объекта: любой может сверить данные
  const [qr, setQr] = useState('')
  useEffect(() => { qrSvg(publicUrl(`#/o/${encodeURIComponent(obj.code)}`), 3).then(setQr).catch(() => {}) }, [obj.code])

  // Подписываем не картинку акта, а его содержимое: номер, объект, проценты и хэши всех фото
  async function sign() {
    setSigning(true)
    try {
      const doc = JSON.stringify({ act: actNo, object: obj.code, contractor: contractor?.bin, claimed: obj.progress_claimed, confirmed: obj.progress_confirmed,
        accepted: accepted.map((o) => o.id), evidence: good.map((e) => e.sha256), at: new Date().toISOString() })
      const digest = await sha256Hex(doc)
      const r = await signWithNcaLayer(doc)
      let method = 'ncalayer'
      if (!r.ok) {
        if (!confirm(`${r.reason}. Для подписи нужен NCALayer и ключ ЭЦП НУЦ РК.\n\nПоставить демо-подпись (без ключа), чтобы показать процесс?`)) return
        method = 'demo'
      }
      const cmsHash = r.ok ? (await sha256Hex(r.cms)).slice(0, 16) : null
      await api.signAct({ entity: 'object', entity_id: obj.id, summary: `Акт ${actNo} подписан ${method === 'ncalayer' ? 'ЭЦП (NCALayer)' : 'демо-подписью'}: ${obj.code}, подтверждено ${obj.progress_confirmed ?? '—'}%, SHA-256 ${digest.slice(0, 16)}${cmsHash ? `, CMS ${cmsHash}` : ''}` })
      setSig({ method, digest, at: new Date(), who: me?.full_name })
      toast(method === 'ncalayer' ? 'Акт подписан ЭЦП и записан в журнал' : 'Демо-подпись записана в журнал')
      onChanged && onChanged()
    } catch (e) { toast('Не удалось подписать: ' + e.message) } finally { setSigning(false) }
  }

  return html`<${Modal} title="Акт подтверждения факта работ" onClose=${onClose} wide>
    <div class="row no-print" style="margin-bottom:10px"><button class="btn primary" onClick=${() => print()}><${Icon} n="printer" s=${16} />Печать / сохранить PDF</button>
      ${staff && !sig && html`<button class="btn" onClick=${sign} disabled=${signing}>${signing ? 'Ждём NCALayer…' : html`<${Icon} n="lock" s=${16} />Подписать ЭЦП (NCALayer)`}</button>`}
      <span class="small muted">Приложение к акту выполненных работ (форма Р-1)</span></div>
    <div class="print-area"><div class="act">
      <div class="c small">Приложение к акту выполненных работ (оказанных услуг), форма Р-1</div>
      <h1>АКТ ПОДТВЕРЖДЕНИЯ ФАКТА ВЫПОЛНЕННЫХ РАБОТ</h1>
      <div class="c">№ ${actNo} от ${fmtDate(new Date())}</div>
      <table><tbody>
        <tr><th style="width:30%">Объект</th><td>${obj.code} ${obj.name}</td></tr>
        <tr><th>Адрес / участок</th><td>${obj.address}</td></tr>
        <tr><th>Подрядчик</th><td>${contractor?.name}, БИН ${contractor?.bin}</td></tr>
        <tr><th>Договор</th><td>${obj.contract_no}, сумма ${fmtMoney(obj.amount)}</td></tr>
        ${obj.module === 'build' && html`<tr><th>Готовность</th><td>заявлено подрядчиком ${obj.progress_claimed}%, <b>подтверждено фактом ${obj.progress_confirmed}%</b>, по графику ${plannedProgress(obj)}%</td></tr>
          <tr><th>Объём к оплате</th><td><b>${fmtMoney(((obj.progress_confirmed || 0) / 100) * (obj.amount || 0))}</b> (подтверждённая часть). Не подтверждено: ${fmtMoney(Math.max(0, obj.progress_claimed - obj.progress_confirmed) / 100 * (obj.amount || 0))}</td></tr>`}
        ${accepted.length > 0 && html`<tr><th>Принятые работы</th><td>${accepted.map((o) => html`<div>${o.title} — ${fmtMoney(o.amount)}, принято ${fmtDate(o.accepted_at)}</div>`)}</td></tr>`}
        ${warranty.length > 0 && html`<tr><th>Гарантийные работы</th><td>${warranty.map((o) => html`<div>${o.title}: устранено за счёт подрядчика по гарантии (${CONFIG.warranty_months} мес.), к оплате 0 ₸</div>`)}</td></tr>`}
        ${penalty > 0 && html`<tr><th>Неустойка (оценка)</th><td><b>${fmtMoney(penalty)}</b> за просрочку: ${(CONFIG.penalty_rate * 100).toFixed(2).replace(".", ",")}% в день, не более ${Math.round(CONFIG.penalty_cap * 100)}% суммы. Окончательно по условиям договора.</td></tr>`}
        <tr><th>Доказательств всего</th><td>${evs.length}, из них подтверждено ${good.length}, отклонено ${bad.length}${masked ? `. На фото закрыто областей с персональными данными: ${masked}` : ''}</td></tr>
      </tbody></table>
      <b>Фотодоказательства (проверены сервером Rastau)</b>
      <div class="photos">${good.map((e) => html`<div><${ActPhoto} api=${api} url=${e.photo_url} /><div class="small">${STAGES[e.stage]} · ${fmtDate(e.server_time, true)} · ${e.lat?.toFixed?.(5)}, ${e.lng?.toFixed?.(5)} · балл ${e.score}/100<br />SHA-256: ${(e.sha256 || '').slice(0, 32)}…</div></div>`)}</div>
      ${bad.length > 0 && html`<p><b>Отклонённые доказательства:</b> ${bad.map((e) => `${fmtDate(e.server_time)} — ${(e.checks || []).find((c) => !c.ok && c.penalty >= 25)?.label || 'не подтверждено'}`).join('; ')}</p>`}
      <p class="small">Проверки: съёмка камерой приложения, GPS и расстояние до точки работ, время сервера, уникальность снимка по всей базе (перцептивный хэш), сравнение «до/после». Записи защищены цепочкой хэшей журнала Rastau. Код проверки: ${code || '—'}.</p>
      ${sig && html`<div class="sigbox">${sig.method === 'ncalayer' ? 'Подписано ЭЦП НУЦ РК' : 'Демо-подпись (без ключа ЭЦП)'}: ${sig.who}, ${fmtDate(sig.at, true)}<br />SHA-256 документа: <span class="hash">${sig.digest}</span></div>`}
      ${qr && html`<div class="act-qr"><div dangerouslySetInnerHTML=${{ __html: qr }} /><div class="small">Проверить данные объекта: отсканируйте код. Публичная карточка Rastau, ${obj.code}</div></div>`}
      <div class="sign"><div>Представитель заказчика (технический надзор) / ЭЦП</div><div>Представитель подрядчика / ЭЦП</div></div>
    </div></div>
  </${Modal}>`
}
