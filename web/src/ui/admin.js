import { html } from 'htm/preact'
import { Icon, Logo, Wordmark } from './icons.js'
import { useState, useMemo, useEffect } from 'preact/hooks'
import { Badge, VerdictBadge, Photo, Prog, toast, Empty, Modal, BeforeAfter, Checks } from './common.js'
import { MapView } from './map.js'
import { EvidenceGrid } from './object.js'
import {
  MODULES, ORDER_STATUS, STAGES, VERDICT, fmtDate, fmtMoney, plannedProgress, objectHealth, isOverdue, isFresh,
  roadCoverage, contractorStats, daysAgo, DAY, humanDuration, wasteNorm, reactionStats, orderPenalty, objectPenalty, doneAt, CONFIG, DEFECTS,
} from '../lib/verify.js'

export function computeKpis(data, mod) {
  const objs = data.objects.filter((o) => mod === 'all' || o.module === mod)
  const ids = new Set(objs.map((o) => o.id))
  const health = new Map(objs.map((o) => [o.id, objectHealth(o, { orders: data.orders })]))
  const orders = data.orders.filter((o) => ids.has(o.object_id))
  const evs = data.evidence.filter((e) => ids.has(e.object_id))
  const fresh = objs.filter((o) => isFresh(o)).length
  const red = objs.filter((o) => health.get(o.id).tone === 'red').length
  const rejected30 = evs.filter((e) => e.verdict === 'rejected' && daysAgo(e.server_time) <= 30).length
  const unconfirmed = objs.filter((o) => o.module === 'build').reduce((s, o) => s + Math.max(0, (o.progress_claimed - o.progress_confirmed) / 100) * (o.amount || 0), 0)
    + orders.filter((o) => o.status === 'rejected').reduce((s, o) => s + (o.amount || 0), 0)
  const closed = orders.filter((o) => o.status === 'accepted')
  const onTime = closed.filter((o) => doneAt(o, data.evidence) <= new Date(o.due_at).getTime()).length
  const roads = objs.filter((o) => o.module === 'road')
  const roadKm = roads.reduce((s, r) => s + (r.length_km || 0), 0)
  const coveredKm = roads.reduce((s, r) => s + roadCoverage(r, data.tracks || []) * (r.length_km || 0), 0)
  const handover = orders.map((o) => { const b = data.evidence.find((e) => e.id === o.before_id); return b ? Math.abs(new Date(o.created_at) - new Date(b.server_time)) : null }).filter((x) => x != null)
  const builds = objs.filter((o) => o.module === 'build'), sites = objs.filter((o) => o.module === 'waste')
  return {
    objs, health, orders, evs, count: objs.length, fresh, freshPct: objs.length ? fresh / objs.length : 0, red, rejected30, unconfirmed,
    onTimePct: closed.length ? onTime / closed.length : null, overdue: orders.filter((o) => isOverdue(o)).length,
    roadKm, coveredKm, coverage: roadKm ? coveredKm / roadKm : null,
    handoverMin: handover.length ? handover.sort((a, b) => a - b)[Math.floor(handover.length / 2)] / 60000 : null,
    buildFresh: builds.length ? builds.filter((o) => isFresh(o)).length / builds.length : null,
    siteFresh: sites.length ? sites.filter((o) => isFresh(o)).length / sites.length : null,
    sitesFull: sites.filter((o) => o.site_state === 'full').length,
    reaction: reactionStats((data.reports || []).filter((r) => mod === 'all' || mod === 'waste')),
    repeats: orders.filter((o) => o.warranty_of).length,
    // Сколько бюджет не заплатил повторно: стоимость исходного ремонта по каждому гарантийному случаю
    warrantySaved: orders.filter((o) => o.warranty_of).reduce((a, o) => a + (data.orders.find((x) => x.id === o.warranty_of)?.amount || 0), 0),
    penalty: orders.reduce((a, o) => a + orderPenalty(o, data.evidence), 0) + objs.reduce((a, o) => a + objectPenalty(o), 0),
  }
}

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)

function Kpi({ v, l, t, tone, bar }) {
  return html`<div class=${`kpi ${tone || ''}`}><div class="v">${v}</div><div class="l">${l}</div>${t && html`<div class="t muted">${t}</div>`}
    ${bar != null && html`<div class="bar"><i style=${`width:${Math.round(bar * 100)}%;background:${bar >= 0.9 ? '#1aa25a' : bar >= 0.7 ? '#f0a400' : '#e03131'}`} /></div>`}</div>`
}

function Goal({ label, value, target, shown, note }) {
  const v = Math.max(0, Math.min(1, value ?? 0))
  const ok = value != null && value >= target
  return html`<div class="goal"><div><div class="gl">${label}</div><div class="gt">${note}</div></div>
    <div class="gv" style=${`color:${ok ? 'var(--green)' : 'var(--amber)'}`}>${shown}<div class="gt">цель ${Math.round(target * 100)}%</div></div>
    <div class="meter"><i style=${`width:${v * 100}%;background:${ok ? '#1aa25a' : '#f0a400'}`} /><b style=${`left:${target * 100}%`} /></div></div>`
}

export function ModuleChips({ mod, setMod }) {
  return html`<div class="chips">
    ${[['all', 'Все'], ['build', 'Стройки · Конаев'], ['road', 'Дороги · обл. Абай'], ['waste', 'Площадки · Конаев']].map(([k, l]) =>
      html`<button class=${`chip ${mod === k ? 'on' : ''}`} onClick=${() => setMod(k)}>${l}</button>`)}
  </div>`
}

export function mapItems(data, k) {
  return k.objs.map((o) => ({ ...o, kind: o.module, tone: k.health.get(o.id).tone, label: `${o.code} ${o.name}` }))
}

export function Dashboard({ api, data, mod, setMod, openObject, openEvidence, go }) {
  const k = useMemo(() => computeKpis(data, mod), [data, mod])
  const items = useMemo(() => mapItems(data, k), [k])
  // Конаев и Семей в 800 км друг от друга: на общей карте показываем один регион за раз
  const [region, setRegion] = useState('konaev')
  const focus = mod === 'all' ? (region === 'konaev' ? (it) => it.module !== 'road' : (it) => it.module === 'road') : null
  const defects = mod === 'road' ? data.orders.filter((o) => o.status !== 'accepted').map((o) => ({ ...o, id: o.id, kind: 'defect', tone: isOverdue(o) || o.status === 'rejected' ? 'red' : 'amber', label: o.title, order: true })) : []
  const tracks = mod === 'road' ? (data.tracks || []).filter((t) => daysAgo(t.ended_at) <= 30).map((t) => ({ points: t.points.map(([a, b]) => [a, b]) })) : []
  const flags = useMemo(() => {
    const out = []
    for (const o of k.objs) for (const f of k.health.get(o.id).flags) if (f.tone === 'red') out.push({ ...f, obj: o })
    for (const r of (data.reports || []).filter((x) => x.status !== 'closed' && (mod === 'all' || x.module === mod))) {
      const h = (Date.now() - new Date(r.created_at).getTime()) / 3600000
      const o = data.objects.find((x) => x.id === r.object_id)
      if (h > CONFIG.reaction_hours && o) out.push({ tone: 'red', text: `Жалоба жителя без реакции ${humanDuration(h * 3600000)}: ${r.text}`, obj: o, at: r.created_at })
    }
    for (const o of k.orders.filter((x) => x.warranty_of && x.status !== 'accepted')) {
      const obj = data.objects.find((x) => x.id === o.object_id)
      out.push({ tone: 'red', text: `Повторный дефект на гарантии: ${o.title}`, obj, ev: data.evidence.find((e) => e.id === o.before_id), at: o.created_at })
    }
    for (const e of k.evs.filter((x) => x.verdict === 'rejected' && daysAgo(x.server_time) <= 14)) {
      const o = data.objects.find((x) => x.id === e.object_id)
      out.push({ tone: 'red', text: `Отклонено фото: ${(e.checks || []).find((c) => !c.ok && c.penalty >= 25)?.label || 'низкий балл'}`, obj: o, ev: e, at: e.server_time })
    }
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 80)
  }, [k])
  const live = [...data.evidence].sort((a, b) => b.server_time.localeCompare(a.server_time)).slice(0, 6)

  return html`<div class="page">
    <div class="row between" style="margin-bottom:12px">
      <div><h1>Ситуационный центр</h1><div class="muted small">Обновлено ${fmtDate(new Date(), true)} · данные в реальном времени</div></div>
      <${ModuleChips} mod=${mod} setMod=${setMod} />
    </div>
    <div class="kpis">
      <${Kpi} v=${k.count} l="объектов под контролем" t=${mod === 'all' ? `${data.objects.filter((o) => o.module === 'build').length} строек · ${Math.round(data.objects.filter((o) => o.module === 'road').reduce((s, r) => s + r.length_km, 0))} км дорог · ${data.objects.filter((o) => o.module === 'waste').length} площадок` : MODULES[mod].full} />
      <${Kpi} v=${pct(k.freshPct)} l="с актуальным статусом" bar=${k.freshPct} tone=${k.freshPct >= 0.9 ? 'green' : 'amber'} />
      <${Kpi} v=${k.red} l="объектов с красным флагом" tone="red" t="нужна реакция" />
      <${Kpi} v=${k.rejected30} l="фото отклонено за 30 дней" tone="red" t="подлог, не то место, повтор" />
      <div class=${`kpi amber ${mod === 'all' || mod === 'road' ? 'wide' : 'full'}`}><div class="v">${fmtMoney(k.unconfirmed)}</div><div class="l">заявлено подрядчиками, но не подтверждено фото: к оплате не принимается</div>
        <div class="money">${k.penalty > 0 && html`<div><b>${fmtMoney(k.penalty)}</b>неустойка за просрочки</div>`}${(mod === 'all' || mod === 'road') && k.repeats > 0 && html`<div><b>${fmtMoney(k.warrantySaved)}</b>не оплачено повторно: гарантийных случаев ${k.repeats}</div>`}</div></div>
      ${(mod === 'all' || mod === 'road') && html`<${Kpi} v=${pct(k.onTimePct)} l="дефектов устранено в срок" bar=${k.onTimePct} />`}
      ${(mod === 'all' || mod === 'road') && html`<${Kpi} v=${pct(k.coverage)} l="сети дорог осмотрено за 30 дней" t=${`${Math.round(k.coveredKm)} из ${Math.round(k.roadKm)} км`} bar=${k.coverage} />`}
    </div>
    <div class="grid dash">
      <div class="card flush">
        <div class="card-h"><h2>Карта объектов</h2>${mod === 'all'
          ? html`<div class="seg"><button class=${region === 'konaev' ? 'on' : ''} onClick=${() => setRegion('konaev')}>Конаев: стройки и ТКО</button><button class=${region === 'abai' ? 'on' : ''} onClick=${() => setRegion('abai')}>Абай: дороги</button></div>`
          : html`<span class="small muted">Нажмите на объект, чтобы открыть карточку</span>`}</div>
        <${MapView} items=${[...items, ...defects]} lines=${tracks} fitKey=${mod + region} focus=${focus} height=${600} onSelect=${(it) => it.order ? openEvidence(data.evidence.find((e) => e.id === (it.after_id || it.before_id))) : openObject(it.id)} />
        <div class="legend"><span><i class="dot green" /> в норме</span><span><i class="dot amber" /> внимание</span><span><i class="dot red" /> проблема</span>
          ${mod === 'road' && html`<span>пунктир — треки инспекторов за 30 дней</span><span>точки — дефекты в работе</span>`}</div>
      </div>
      <div class="grid" style="align-content:start">
        <div class="card flush">
          <div class="card-h"><h2 class="h-ic"><${Icon} n="flag" cls="red" />Красные флаги</h2><${Badge} tone="red">${flags.length}</${Badge}></div>
          <div class="flags" style="max-height:330px">
            ${flags.length ? flags.map((f) => html`<div class="flag" onClick=${() => f.ev ? openEvidence(f.ev) : openObject(f.obj.id)}>
              <span class="dot red" /><div><div class="ft">${f.text}</div><div class="fo">${f.obj?.code} · ${f.obj?.name}${f.at ? ` · ${fmtDate(f.at)}` : ''}</div></div></div>`) : html`<${Empty}>Красных флагов нет</${Empty}>`}
          </div>
        </div>
        <div class="card">
          <div class="row between"><h2 style="margin:0">Цели задач G-TON</h2><a class="btn sm" href="#/pilot" target="_blank">План пилота</a></div>
          ${(mod === 'all' || mod === 'build') && html`<${Goal} label="№2 Конаев: объекты с актуальным статусом" value=${k.buildFresh ?? computeKpis(data, 'build').buildFresh} target=${0.9} shown=${pct(computeKpis(data, 'build').buildFresh)} note="Сводка по области: 1 клик вместо обзвона" />`}
          ${(mod === 'all' || mod === 'road') && html`
            <${Goal} label="А-3 Абай: дефекты устранены в срок" value=${computeKpis(data, 'road').onTimePct} target=${0.95} shown=${pct(computeKpis(data, 'road').onTimePct)} note=${`Передача в работу: ${computeKpis(data, 'road').handoverMin != null ? Math.max(1, Math.round(computeKpis(data, 'road').handoverMin)) + ' мин' : '—'} (цель ≤ 5 мин)`} />
            <${Goal} label="А-3 Абай: сеть осмотрена за месяц" value=${computeKpis(data, 'road').coverage} target=${1} shown=${pct(computeKpis(data, 'road').coverage)} note="По GPS-трекам инспекторов" />`}
          ${(mod === 'all' || mod === 'waste') && html`<${Goal} label="№6 Конаев: площадки с актуальным статусом" value=${computeKpis(data, 'waste').siteFresh} target=${0.9} shown=${pct(computeKpis(data, 'waste').siteFresh)} note=${`Сейчас переполнено: ${computeKpis(data, 'waste').sitesFull}`} />
            <${Goal} label=${`№6 Конаев: реакция на жалобу ≤ ${CONFIG.reaction_hours} ч`} value=${k.reaction.inTimePct} target=${0.9} shown=${pct(k.reaction.inTimePct)} note=${`От жалобы жителя до фото вывоза. Медиана ${k.reaction.median != null ? Math.round(k.reaction.median) + ' ч' : '—'}, без ответа ${k.reaction.lateOpen}`} />`}
        </div>
      </div>
    </div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><div class="row between"><h2>Последние доказательства</h2><button class="btn sm" onClick=${() => go('accept')}>Очередь приёмки →</button></div>
        <${EvidenceGrid} api=${api} list=${live} onOpen=${openEvidence} /></div>
      <${ContractorTop} data=${data} mod=${mod} go=${go} />
    </div>
  </div>`
}

function ContractorTop({ data, mod, go }) {
  const rows = data.contractors.filter((c) => mod === 'all' || c.module === mod).map((c) => ({ c, s: contractorStats(c, data) })).sort((a, b) => a.s.index - b.s.index)
  return html`<div class="card"><div class="row between"><h2>Рейтинг подрядчиков</h2><button class="btn sm" onClick=${() => go('contractors')}>Все →</button></div>
    <table class="tbl"><tbody>${rows.map(({ c, s }) => html`<tr><td style="width:40px"><span class=${`grade ${s.grade}`}>${s.grade}</span></td><td><b>${c.name}</b><div class="small muted">${MODULES[c.module].label} · индекс ${s.index}/100</div></td>
      <td class="small">${s.rejected ? html`<span style="color:var(--red)">${s.rejected} отклонено</span>` : html`<span style="color:var(--green)">без подлогов</span>`}</td></tr>`)}</tbody></table></div>`
}

export function ObjectsView({ data, mod, setMod, openObject }) {
  const [q, setQ] = useState('')
  const [tone, setTone] = useState('all')
  const [sort, setSort] = useState('risk')
  const k = useMemo(() => computeKpis(data, mod), [data, mod])
  let rows = k.objs.filter((o) => (tone === 'all' || k.health.get(o.id).tone === tone) && (!q || `${o.code} ${o.name} ${o.address}`.toLowerCase().includes(q.toLowerCase())))
  const rank = { red: 0, amber: 1, green: 2 }
  rows = [...rows].sort((a, b) => sort === 'risk' ? rank[k.health.get(a.id).tone] - rank[k.health.get(b.id).tone] : sort === 'amount' ? (b.amount || 0) - (a.amount || 0) : a.code.localeCompare(b.code))
  const cname = (id) => data.contractors.find((c) => c.id === id)?.name || '—'
  return html`<div class="page">
    <div class="row between" style="margin-bottom:12px"><h1>Объекты</h1><${ModuleChips} mod=${mod} setMod=${setMod} /></div>
    <div class="card flush">
      <div class="card-h">
        <input class="i search" placeholder="Поиск: код, название, адрес" value=${q} onInput=${(e) => setQ(e.target.value)} />
        <div class="chips">${[['all', 'Все'], ['red', 'Проблема'], ['amber', 'Внимание'], ['green', 'Норма']].map(([v, l]) => html`<button class=${`chip ${tone === v ? 'on' : ''}`} onClick=${() => setTone(v)}>${l}</button>`)}</div>
        <select class="i" style="width:auto" value=${sort} onChange=${(e) => setSort(e.target.value)}><option value="risk">Сначала проблемные</option><option value="amount">По сумме</option><option value="code">По коду</option></select>
      </div>
      <div class="scroll" style="max-height:70vh"><table class="tbl objs"><thead><tr><th></th><th>Код</th><th>Объект</th><th>Подрядчик</th><th>Сумма</th><th>Готовность / статус</th><th>Последний факт</th><th>Флаги</th></tr></thead><tbody>
        ${rows.slice(0, 400).map((o) => { const h = k.health.get(o.id); return html`<tr class="click" onClick=${() => openObject(o.id)}>
          <td><span class=${`dot ${h.tone}`} /></td><td><b>${o.code}</b></td><td>${o.name}<div class="small muted">${MODULES[o.module].label}</div></td><td class="small">${cname(o.contractor_id)}</td><td class="num">${fmtMoney(o.amount)}</td>
          <td>${o.module === 'build' ? html`<${Prog} claimed=${o.progress_claimed} confirmed=${o.progress_confirmed} plan=${plannedProgress(o)} />` : o.module === 'road' ? html`${o.length_km} км · осмотр ${fmtDate(o.last_inspected_at)}` : o.site_state === 'full' ? html`<${Badge} tone="red">Переполнена</${Badge}>` : html`<${Badge} tone="green">В норме</${Badge}>`}</td>
          <td class="small">${fmtDate(o.module === 'road' ? o.last_inspected_at : o.last_report_at, true)}</td>
          <td>${h.flags[0] ? html`<span class=${`issue ${h.tone}`}>${h.flags[0].text}${h.flags.length > 1 ? html`<b>+${h.flags.length - 1}</b>` : ''}</span>` : ''}</td></tr>` })}
      </tbody></table></div>
      <div class="legend">Показано ${Math.min(rows.length, 400)} из ${rows.length}. Полоса: зелёная — подтверждено фактом, штриховка — заявлено без доказательств, чёрная риска — план по графику.</div>
    </div>
  </div>`
}

export function ContractorsView({ api, data, openObject, openEvidence }) {
  const [open, setOpen] = useState(null)
  const rows = data.contractors.map((c) => ({ c, s: contractorStats(c, data) })).sort((a, b) => b.s.index - a.s.index)
  return html`<div class="page">
    <h1>Рейтинг подрядчиков</h1><p class="sub">Индекс считается только по проверенным фактам: качество доказательств, честность (доля отклонённых фото), соблюдение сроков и графика. Это основа «кредитной истории подрядчика» для будущих закупок.</p>
    <div class="card flush"><div class="scroll" style="max-height:none"><table class="tbl"><thead><tr><th>Класс</th><th>Подрядчик</th><th>Направление</th><th>Индекс</th><th>Объектов</th><th>Доказательств</th><th>Отклонено</th><th>Заявки в срок</th><th>Просрочено</th><th>Повторы на гарантии</th><th>Не подтверждено</th><th>Неустойка (оценка)</th></tr></thead><tbody>
      ${rows.map(({ c, s }) => html`<tr class="click" onClick=${() => setOpen(c)}><td><span class=${`grade ${s.grade}`}>${s.grade}</span></td><td><b>${c.name}</b><div class="small muted">БИН ${c.bin} · ${c.head}</div></td><td>${MODULES[c.module].label}</td>
        <td><b>${s.index}</b>/100</td><td>${s.objects}</td><td>${s.evidence}</td><td>${s.rejected ? html`<${Badge} tone="red">${s.rejected} (${Math.round((s.rejected / Math.max(1, s.evidence)) * 100)}%)</${Badge}>` : '0'}</td>
        <td>${s.orders ? pct(s.onTimeRate) : '—'}</td><td>${s.overdue || '—'}</td><td>${s.repeats ? html`<span class="badge warranty">${s.repeats}</span>` : '—'}</td><td>${s.blocked ? fmtMoney(s.blocked) : '—'}</td><td>${s.penalty ? fmtMoney(s.penalty) : '—'}</td></tr>`)}
    </tbody></table></div></div>
    ${open && html`<${ContractorDossier} api=${api} data=${data} c=${open} onClose=${() => setOpen(null)} openObject=${openObject} openEvidence=${openEvidence} />`}
  </div>`
}

function ContractorDossier({ api, data, c, onClose, openEvidence }) {
  const s = contractorStats(c, data)
  const objs = data.objects.filter((o) => o.contractor_id === c.id)
  const bad = data.evidence.filter((e) => (e.contractor_id === c.id || objs.some((o) => o.id === e.object_id)) && e.verdict === 'rejected' && e.stage !== 'before').sort((a, b) => b.server_time.localeCompare(a.server_time))
  return html`<${Modal} title=${`Досье: ${c.name}`} onClose=${onClose} wide>
    <div class="row no-print" style="margin-bottom:10px"><button class="btn" onClick=${() => print()}><${Icon} n="printer" s=${16} />Печать досье для претензии</button></div>
    <div class="print-area"><div class="grid g3">
      <div class="kpi"><div class="v"><span class=${`grade ${s.grade}`}>${s.grade}</span> ${s.index}</div><div class="l">индекс надёжности</div></div>
      <div class="kpi red"><div class="v">${s.rejected}</div><div class="l">отклонённых доказательств</div></div>
      <div class="kpi amber"><div class="v">${fmtMoney(s.blocked)}</div><div class="l">не подтверждено к оплате</div></div>
    </div>
    ${(s.penalty > 0 || s.repeats > 0) && html`<div class="grid g2" style="margin-top:12px">
      <div class="kpi amber"><div class="v">${fmtMoney(s.penalty)}</div><div class="l">неустойка за просрочки (оценка: ${(CONFIG.penalty_rate * 100).toFixed(1).replace('.', ',')}% в день, не более ${Math.round(CONFIG.penalty_cap * 100)}%)</div></div>
      <div class="kpi red"><div class="v">${s.repeats}</div><div class="l">повторных дефектов на гарантии, устраняются за счёт подрядчика</div></div></div>`}
    <div style="height:12px" />
    <dl class="kv"><dt>БИН</dt><dd>${c.bin}</dd><dt>Руководитель</dt><dd>${c.head}</dd><dt>Телефон</dt><dd>${c.phone}</dd><dt>Объектов</dt><dd>${objs.length}</dd>
      <dt>Заявок</dt><dd>${s.orders}, закрыто ${s.closed}, в срок ${s.orders ? pct(s.onTimeRate) : '—'}, просрочено ${s.overdue}</dd></dl>
    <h3 style="margin-top:16px">Отклонённые доказательства (${bad.length})</h3>
    ${bad.length ? html`<${EvidenceGrid} api=${api} list=${bad.slice(0, 24)} onOpen=${openEvidence} />` : html`<${Empty}>Подлогов не выявлено</${Empty}>`}
    </div>
  </${Modal}>`
}

// Зона ответственности инспектора: технадзор видит стройки и площадки Конаева, инспектор дорог видит дороги.
export const inspScope = (me) => me?.role !== 'inspector' ? null : /строит|технадзор/i.test(me.position || '') ? 'build' : 'road'
export function acceptQueues(data, me) {
  const scope = inspScope(me), mod = (id) => data.objects.find((x) => x.id === id)?.module
  const queue = data.orders.filter((o) => o.status === 'submitted' && (!scope || (scope === 'road') === (mod(o.object_id) === 'road'))).sort((a, b) => a.due_at.localeCompare(b.due_at))
  const reviews = scope === 'road' ? [] : data.evidence.filter((e) => e.stage === 'progress' && e.verdict === 'review' && !e.review).sort((a, b) => b.server_time.localeCompare(a.server_time))
  return { scope, queue, reviews }
}

export function AcceptView({ api, data, me, openEvidence, onChanged }) {
  const { scope, queue, reviews } = acceptQueues(data, me)
  const [tab, setTab] = useState(scope === 'build' && !queue.length ? 'reviews' : 'orders')
  return html`<div class="page">
    <h1>Приёмка работ</h1><p class="sub">Подрядчик сдал работу с фото. Сервер уже проверил место, время и повторы. Решение об оплате принимает человек.</p>
    ${scope !== 'road' && html`<div class="tabs" style="max-width:520px"><button class=${tab === 'orders' ? 'on' : ''} onClick=${() => setTab('orders')}>${scope === 'build' ? 'Заявки на приёмке' : 'Ремонты на приёмке'} <span class="count">${queue.length}</span></button>
      <button class=${tab === 'reviews' ? 'on' : ''} onClick=${() => setTab('reviews')}>Отчёты строек с сомнениями <span class="count">${reviews.length}</span></button></div>`}
    ${tab === 'orders' ? (queue.length ? html`<div class="grid g2">${queue.map((o) => html`<${AcceptCard} key=${o.id} api=${api} data=${data} o=${o} openEvidence=${openEvidence} onChanged=${onChanged} />`)}</div>` : html`<div class="card"><${Empty}>Очередь пуста: всё принято</${Empty}></div>`)
      : (reviews.length ? html`<div class="card"><${EvidenceGrid} api=${api} list=${reviews} onOpen=${openEvidence} /></div>` : html`<div class="card"><${Empty}>Нет отчётов с сомнениями</${Empty}></div>`)}
  </div>`
}

export function AcceptCard({ api, data, o, openEvidence, onChanged }) {
  const before = data.evidence.find((e) => e.id === o.before_id)
  const after = data.evidence.find((e) => e.id === o.after_id)
  const obj = data.objects.find((x) => x.id === o.object_id)
  const c = data.contractors.find((x) => x.id === o.contractor_id)
  const [busy, setBusy] = useState(false)
  async function decide(ok) {
    let reason = null
    if (!ok) { reason = prompt('Причина возврата работы подрядчику:', (after?.checks || []).find((x) => !x.ok)?.label || ''); if (reason === null) return }
    setBusy(true)
    try { await api.decideOrder(o.id, ok, reason); toast(ok ? 'Работа принята. Запись добавлена в журнал.' : 'Работа возвращена подрядчику'); onChanged && onChanged() } finally { setBusy(false) }
  }
  return html`<div class="card">
    <div class="row between"><div><b>${o.title}</b><div class="small muted">${obj?.code} · ${c?.name} · срок ${fmtDate(o.due_at)}</div>
      ${o.warranty_of && html`<span class="badge warranty">по гарантии, без оплаты</span>`}</div>${after && html`<${VerdictBadge} ev=${after} />`}</div>
    <div style="height:10px" />
    ${before && after ? html`<${BeforeAfter} api=${api} before=${before} after=${after} />` : html`<${Photo} api=${api} url=${(after || before)?.photo_url} />`}
    ${after && html`<div style="margin-top:10px"><${Checks} checks=${(after.checks || []).filter((x) => !x.ok || x.code === 'distance' || x.code === 'scene')} /></div>`}
    <div class="row decide" style="margin-top:12px">
      <button class="btn green grow" disabled=${busy} onClick=${() => decide(true)}><${Icon} n="check" s=${17} />Принять к оплате</button>
      <button class="btn red" disabled=${busy} onClick=${() => decide(false)}>Вернуть</button>
      ${after && html`<button class="btn" onClick=${() => openEvidence(after)}>Подробно</button>`}
    </div>
  </div>`
}

export function ReportsView({ api, data, me, openObject }) {
  const [f, setF] = useState('open')
  const all = [...(data.reports || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const list = all.filter((r) => f === 'all' || (f === 'open' ? r.status !== 'closed' : r.status === 'closed'))
  const set = async (r, status) => { await api.updateReport(r.id, { status }); toast('Статус обращения обновлён') }
  const tones = { new: 'red', in_work: 'amber', closed: 'green' }
  const labels = { new: 'Новое', in_work: 'В работе', closed: 'Закрыто' }
  const rs = reactionStats(all)
  const staff = me?.role === 'admin' || me?.role === 'inspector'
  async function toOrder(r) {
    const o = data.objects.find((x) => x.id === r.object_id)
    if (!o) { toast('Обращение не привязано к объекту'); return }
    const type = r.module === 'road' ? (/знак/i.test(r.text) ? 'sign' : 'pothole') : null
    const days = type ? DEFECTS[type].days : 7
    await api.createOrder({
      object_id: o.id, contractor_id: o.contractor_id, kind: r.module === 'road' ? 'defect' : 'issue', title: `По обращению жителя: ${r.text}, ${o.code}`, defect_type: type,
      severity: 'mid', lat: r.lat ?? o.lat, lng: r.lng ?? o.lng, due_at: new Date(Date.now() + days * DAY).toISOString(), amount: null, report_id: r.id,
    })
    toast(`Заявка отправлена подрядчику, срок ${days} сут. Обращение закроется после приёмки работы по фото.`)
  }
  return html`<div class="page">
    <div class="row between"><div><h1>Обращения жителей</h1><p class="sub">Жители сообщают о проблеме по ссылке или QR-коду на объекте, без регистрации. Обращение закрывается только фотографией с места: вывозом мусора или принятой работой подрядчика.</p></div>
      <a class="btn" href="#/report" target="_blank">Открыть форму для жителей ↗</a></div>
    <div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="v">${all.filter((r) => r.status !== 'closed').length}</div><div class="l">открытых обращений</div></div>
      <div class="kpi ${rs.inTimePct != null && rs.inTimePct >= 0.9 ? 'green' : 'amber'}"><div class="v">${pct(rs.inTimePct)}</div><div class="l">жалоб на мусор закрыто за ${CONFIG.reaction_hours} ч</div></div>
      <div class="kpi"><div class="v">${rs.median != null ? Math.round(rs.median) + ' ч' : '—'}</div><div class="l">медиана реакции перевозчика</div></div>
      <div class="kpi red"><div class="v">${rs.lateOpen}</div><div class="l">без реакции дольше ${CONFIG.reaction_hours} ч</div></div>
    </div>
    <div class="chips" style="margin-bottom:12px">${[['open', 'Открытые'], ['closed', 'Закрытые'], ['all', 'Все']].map(([k, l]) => html`<button class=${`chip ${f === k ? 'on' : ''}`} onClick=${() => setF(k)}>${l}</button>`)}</div>
    <div class="grid g3">${list.slice(0, 60).map((r) => { const o = data.objects.find((x) => x.id === r.object_id); const ord = r.order_id && data.orders.find((x) => x.id === r.order_id); const h = ((r.closed_at ? new Date(r.closed_at) : Date.now()) - new Date(r.created_at)) / 3600000
      return html`<div class="card">
      <${Photo} api=${api} url=${r.photo_url} />
      <div class="row between" style="margin-top:8px"><b>${r.text}</b><${Badge} tone=${tones[r.status]}>${labels[r.status]}</${Badge}></div>
      <div class="small muted">№ ${r.id.toUpperCase()} · ${fmtDate(r.created_at, true)}${o ? html` · <a href="#" onClick=${(e) => { e.preventDefault(); openObject(o.id) }}>${o.code} ${o.name}</a>` : ''}</div>
      ${r.status === 'closed' ? html`<div class="small" style="margin-top:6px;color:var(--green)">✓ ${r.resolution || 'Закрыто'}${r.closed_at ? `, через ${humanDuration(h * 3600000)}` : ''}</div>`
        : html`<div class="small" style=${`margin-top:6px;color:${h > CONFIG.reaction_hours ? 'var(--red)' : 'var(--muted)'}`}>Ждёт ${humanDuration(h * 3600000)}${ord ? ` · заявка «${ORDER_STATUS[ord.status].label}», срок ${fmtDate(ord.due_at)}` : r.module === 'waste' ? ' · закроется фото вывоза' : ''}</div>`}
      ${staff && r.status !== 'closed' && html`<div class="row" style="margin-top:10px">
        ${r.module !== 'waste' && !ord && o && html`<button class="btn sm primary" onClick=${() => toOrder(r)}>Заявка подрядчику</button>`}
        ${r.status === 'new' && html`<button class="btn sm" onClick=${() => set(r, 'in_work')}>В работу</button>`}
        <button class="btn sm" onClick=${() => { if (confirm('Закрыть без фото подтверждения? Это будет видно в журнале.')) set(r, 'closed') }}>Закрыть вручную</button></div>`}
    </div>` })}</div>
    ${!list.length && html`<div class="card"><${Empty}>Обращений нет</${Empty}></div>`}
  </div>`
}

export function JournalView({ api, data }) {
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const verify = async () => { setBusy(true); try { setRes(await api.verifyChain()) } finally { setBusy(false) } }
  const tamper = async () => {
    const r = await api.tamperDemo()
    if (r.blocked) toast('Сервер отклонил изменение: ' + r.message)
    else { toast(`Запись №${r.id} изменена задним числом. Проверьте цепочку.`); setRes(null) }
  }
  const rows = [...(data.audit || [])].reverse().slice(0, 200)
  return html`<div class="page">
    <h1>Журнал действий</h1><p class="sub">Каждое действие (фото, заявка, приёмка, вход) записывается с хэшем предыдущей записи. Изменить запись задним числом незаметно нельзя: цепочка ломается.</p>
    <div class="card" style="margin-bottom:14px"><div class="row">
      <button class="btn primary" onClick=${verify} disabled=${busy}>${busy ? 'Проверяем…' : html`<${Icon} n="shield" s=${16} />Проверить целостность журнала`}</button>
      <button class="btn red" onClick=${tamper}>Попробовать подделать запись</button>
      ${res && (res.ok ? html`<div class="chain-ok grow">✓ Цепочка цела: ${res.count} записей, подделок нет</div>` : html`<div class="chain-bad grow">✕ Цепочка нарушена на записи №${res.brokenAt}: обнаружено изменение задним числом</div>`)}
    </div></div>
    <div class="card flush"><div class="scroll" style="max-height:70vh"><table class="tbl"><thead><tr><th>№</th><th>Время</th><th>Кто</th><th>Действие</th><th>Хэш записи</th></tr></thead><tbody>
      ${rows.map((a) => html`<tr><td>${a.id}</td><td class="small">${fmtDate(a.at, true)}</td><td class="small">${a.actor}</td><td>${a.summary}</td><td class="hash">${(a.hash || '').slice(0, 16)}…</td></tr>`)}
    </tbody></table></div></div>
  </div>`
}

export function SummaryView({ api, data }) {
  const all = computeKpis(data, 'all'), b = computeKpis(data, 'build'), r = computeKpis(data, 'road'), w = computeKpis(data, 'waste')
  const top = (k) => k.objs.filter((o) => k.health.get(o.id).tone === 'red').slice(0, 8)
  function exportJson() {
    const payload = {
      source: 'Rastau', generated_at: new Date().toISOString(), version: '1.0',
      indicators: [
        { code: 'G2_FRESH_STATUS', task: '№2', name: 'Доля объектов с актуальным статусом', value: b.buildFresh, target: 0.9 },
        { code: 'A3_ON_TIME', task: 'А-3', name: 'Доля дефектов, устранённых в срок', value: r.onTimePct, target: 0.95 },
        { code: 'A3_COVERAGE', task: 'А-3', name: 'Доля сети, осмотренной за 30 дней', value: r.coverage, target: 1 },
        { code: 'G6_FRESH_STATUS', task: '№6', name: 'Доля площадок с актуальным статусом', value: w.siteFresh, target: 0.9 },
        { code: 'G6_REACTION_24H', task: '№6', name: `Доля жалоб на площадки, закрытых фото вывоза за ${CONFIG.reaction_hours} ч`, value: w.reaction.inTimePct, target: 0.9 },
        { code: 'A3_WARRANTY_REPEATS', task: 'А-3', name: 'Повторные дефекты на гарантии', value: r.repeats },
        { code: 'UNCONFIRMED_KZT', name: 'Не подтверждено к оплате, тенге', value: Math.round(all.unconfirmed) },
        { code: 'PENALTY_KZT', name: 'Неустойка за просрочки (оценка), тенге', value: Math.round(all.penalty) },
        { code: 'REJECTED_30D', name: 'Отклонено доказательств за 30 дней', value: all.rejected30 },
      ],
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    a.download = `rastau-indicators-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
  }
  function exportCsv() {
    const rows = [['Код', 'Объект', 'Модуль', 'Подрядчик', 'Сумма', 'Заявлено %', 'Подтверждено %', 'Статус', 'Флаги']]
    for (const o of all.objs) rows.push([o.code, o.name, MODULES[o.module].label, data.contractors.find((c) => c.id === o.contractor_id)?.name, o.amount, o.progress_claimed ?? '', o.progress_confirmed ?? '', all.health.get(o.id).tone, all.health.get(o.id).flags.map((f) => f.text).join('; ')])
    const csv = String.fromCharCode(0xfeff) + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `rastau-objects-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }
  return html`<div class="page">
    <div class="row between no-print" style="margin-bottom:12px"><div><h1>Сводка для акима</h1><div class="muted small">Формируется автоматически, за 1 клик вместо обзвона</div></div>
      <div class="row"><button class="btn primary" onClick=${() => print()}><${Icon} n="printer" s=${16} />Печать / PDF</button><button class="btn" onClick=${exportCsv}>Excel (CSV)</button><button class="btn" onClick=${exportJson} title="Показатели для Smart Data Ukimet">Показатели JSON (Smart Data Ukimet)</button></div></div>
    <div class="print-area"><div class="act" style="max-width:none">
      <h1>СВОДКА RASTAU НА ${fmtDate(new Date(), true)}</h1>
      <table><thead><tr><th>Направление</th><th>Объектов</th><th>Актуальный статус</th><th>Красные флаги</th><th>Отклонено фото (30 дн)</th><th>Не подтверждено к оплате</th><th>Неустойка (оценка)</th></tr></thead><tbody>
        ${[['Стройки, Конаев (№2)', b], ['Дороги, обл. Абай (А-3)', r], ['Площадки ТКО, Конаев (№6)', w]].map(([n, k]) => html`<tr><td>${n}</td><td>${k.count}</td><td>${pct(k.freshPct)}</td><td>${k.red}</td><td>${k.rejected30}</td><td>${fmtMoney(k.unconfirmed)}</td><td>${fmtMoney(k.penalty)}</td></tr>`)}
        <tr><th>Итого</th><th>${all.count}</th><th>${pct(all.freshPct)}</th><th>${all.red}</th><th>${all.rejected30}</th><th>${fmtMoney(all.unconfirmed)}</th><th>${fmtMoney(all.penalty)}</th></tr>
      </tbody></table>
      <p>Дороги: устранено в срок ${pct(r.onTimePct)} (цель 95%), сеть осмотрена ${pct(r.coverage)} (${Math.round(r.coveredKm)} из ${Math.round(r.roadKm)} км), просрочено заявок: ${r.overdue}, повторных дефектов на гарантии: ${r.repeats}. Площадки: переполнено сейчас ${w.sitesFull}; жалоб жителей закрыто фото вывоза за ${CONFIG.reaction_hours} ч: ${pct(w.reaction.inTimePct)} (медиана ${w.reaction.median != null ? Math.round(w.reaction.median) + ' ч' : '—'}); график вывоза ниже санитарной нормы (${wasteNorm().label}) на ${data.objects.filter((o) => o.module === 'waste' && o.pickups_per_week < wasteNorm().perWeek).length} из ${data.objects.filter((o) => o.module === 'waste').length} площадок.</p>
      ${[['Стройки: требуют вмешательства', b], ['Дороги: требуют вмешательства', r], ['Площадки: требуют вмешательства', w]].map(([n, k]) => html`<b>${n}</b><table><tbody>${top(k).map((o) => html`<tr><td style="width:90px">${o.code}</td><td>${o.name}</td><td>${k.health.get(o.id).flags.map((f) => f.text).join('; ')}</td></tr>`)}</tbody></table>`)}
      <p class="small">Источник: Rastau. Все показатели рассчитаны по фото с проверкой GPS, времени сервера и уникальности снимка.</p>
    </div></div>
  </div>`
}
