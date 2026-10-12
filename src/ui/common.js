import { html } from 'htm/preact'
import { Icon, Logo, Wordmark } from './icons.js'
import { useEffect, useState, useRef } from 'preact/hooks'
import { genPhoto, isGen } from '../lib/genphoto.js'
import { VERDICT, STAGES, fmtDate } from '../lib/verify.js'
import { tr, checkLabel } from '../lib/i18n.js'

export { html }

export const toneOfScore = (s) => (s >= 80 ? 'green' : s >= 50 ? 'amber' : 'red')

export function Badge({ tone = 'gray', children }) {
  return html`<span class=${`badge ${tone}`}>${children}</span>`
}

export function VerdictBadge({ ev }) {
  if (!ev) return null
  const v = VERDICT[ev.verdict] || VERDICT.review
  const kz = { ok: 'Расталды', review: 'Тексеру қажет', rejected: 'Қабылданбады' }[ev.verdict]
  return html`<${Badge} tone=${v.tone}><${Icon} n=${{ ok: 'check', rejected: 'x' }[ev.verdict] || 'eye'} s=${12} />${tr(v.label, kz || v.label)} · ${ev.score}</${Badge}>`
}

// Фото: демо-картинка, локальное или подписанная ссылка из хранилища
export function Photo({ api, url, alt = '', cls = 'ph', onClick }) {
  const [src, setSrc] = useState(isGen(url) ? genPhoto(url) : null)
  useEffect(() => {
    let alive = true
    if (isGen(url)) setSrc(genPhoto(url))
    else api.photo(url).then((u) => alive && setSrc(u))
    return () => { alive = false }
  }, [url])
  if (!src) return html`<div class=${cls} style="aspect-ratio:4/3" />`
  return html`<img class=${cls} src=${src} alt=${alt} loading="lazy" onClick=${onClick} />`
}

export function usePhoto(api, url) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let alive = true
    if (!url) { setSrc(null); return }
    if (isGen(url)) setSrc(genPhoto(url))
    else api.photo(url).then((u) => alive && setSrc(u))
    return () => { alive = false }
  }, [url])
  return src
}

export function ScoreRing({ score, size = 86 }) {
  const r = 36, c = 2 * Math.PI * r
  const tone = toneOfScore(score)
  const color = tone === 'green' ? '#138a4b' : tone === 'amber' ? '#d38b00' : '#c62828'
  return html`<svg class="ring" viewBox="0 0 86 86" width=${size} height=${size} role="img" aria-label=${`Балл доверия ${score} из 100`}>
    <circle cx="43" cy="43" r=${r} fill="none" stroke="#e7ebf0" stroke-width="9" />
    <circle cx="43" cy="43" r=${r} fill="none" stroke=${color} stroke-width="9" stroke-linecap="round"
      stroke-dasharray=${`${(score / 100) * c} ${c}`} transform="rotate(-90 43 43)" />
    <text x="43" y="47" text-anchor="middle" font-size="22" font-weight="800" fill="#0f1b2d">${score}</text>
    <text x="43" y="62" text-anchor="middle" font-size="9" fill="#5b6b80">из 100</text>
  </svg>`
}

export function Checks({ checks }) {
  return html`<div class="checks">
    ${(checks || []).map((c) => html`<div class=${`check ${c.info ? 'info' : c.ok ? '' : 'bad'}`}>
      <span class="ck"><${Icon} n=${c.info ? 'info' : c.ok ? 'check' : 'x'} s=${13} /></span>
      <span>${checkLabel(c.label)}</span>
      ${!c.ok && c.penalty ? html`<span class="pen">−${c.penalty}</span>` : null}
    </div>`)}
  </div>`
}

export function VerdictBox({ ev }) {
  const tone = toneOfScore(ev.score)
  const title = ev.verdict === 'ok' ? tr('Факт подтверждён', 'Факт расталды') : ev.verdict === 'review' ? tr('Нужна проверка инспектором', 'Инспектордың тексеруі қажет') : tr('Доказательство отклонено', 'Дәлел қабылданбады')
  const sub = ev.verdict === 'ok' ? tr('Все ключевые проверки пройдены на сервере', 'Барлық негізгі тексерулер серверде өтті') : ev.verdict === 'review' ? tr('Есть сомнения, решение за инспектором', 'Күмән бар, шешімді инспектор қабылдайды') : tr('Оплата по этому доказательству невозможна', 'Бұл дәлел бойынша төлем мүмкін емес')
  return html`<div class=${`verdict-box ${tone}`}>
    <${ScoreRing} score=${ev.score} />
    <div><div class="vt">${title}</div><div class="small">${sub}</div>
      <div class="small muted" style="margin-top:4px">${STAGES[ev.stage] || ev.stage} · ${fmtDate(ev.server_time, true)} · ${ev.author_name || '—'}</div></div>
  </div>`
}

export function BeforeAfter({ api, before, after }) {
  const [pos, setPos] = useState(50)
  const ref = useRef()
  const a = usePhoto(api, before?.photo_url)
  const b = usePhoto(api, after?.photo_url)
  const move = (e) => {
    const r = ref.current.getBoundingClientRect()
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left
    setPos(Math.max(0, Math.min(100, (x / r.width) * 100)))
  }
  return html`<div class="ba" ref=${ref} style=${`--pos:${pos}%`}
      onMouseMove=${(e) => e.buttons && move(e)} onMouseDown=${move} onTouchMove=${move} onTouchStart=${move}>
    ${a && html`<img src=${a} alt="до" />`}
    ${b && html`<img class="after" src=${b} alt="после" />`}
    <div class="handle" />
    <span class="lab" style="left:8px">ДО</span><span class="lab" style="right:8px">ПОСЛЕ</span>
  </div>`
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [])
  return html`<div class="modal-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="modal" style=${wide ? 'width:min(980px,100%)' : ''} role="dialog" aria-label=${title}>
      <div class="modal-h"><h2>${title}</h2><button class="x" onClick=${onClose} aria-label="Закрыть">×</button></div>
      <div class="modal-b">${children}</div>
    </div>
  </div>`
}

let toastSet = null
export function Toaster() {
  const [msg, setMsg] = useState(null)
  toastSet = setMsg
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(null), 3800); return () => clearTimeout(t) } }, [msg])
  return msg ? html`<div class="toast" role="status">${msg}</div>` : null
}
export const toast = (m) => toastSet && toastSet(m)

export function Prog({ claimed = 0, confirmed = 0, plan }) {
  return html`<div class="prog" title=${`Подтверждено ${confirmed}%, заявлено ${claimed}%${plan != null ? `, по графику ${plan}%` : ''}`}>
    <div class="track">
      <div class="cl" style=${`width:${claimed}%`} />
      <div class="c" style=${`width:${confirmed}%`} />
      ${plan != null && html`<div class="pl" style=${`left:${plan}%`} />`}
    </div>
    <span class="small"><b>${confirmed}%</b>${claimed > confirmed ? html`<span style="color:var(--red)"> / ${claimed}%</span>` : ''}</span>
  </div>`
}

export function Empty({ children }) { return html`<div class="empty">${children}</div>` }
