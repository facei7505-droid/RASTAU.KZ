import { html } from 'htm/preact'
import { Icon, Logo, Wordmark } from './icons.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Modal, VerdictBox, Checks, toast } from './common.js'
import { frameFromVideo, canvasFromFile, stamp, toBlob, sha256Blob, analyze, sceneSimilarity, loadImage } from '../lib/image.js'
import { genPhoto, isGen } from '../lib/genphoto.js'
import { distanceToTarget, fmtDist, scoreEvidence, targetFor } from '../lib/verify.js'
import { findFaces, pixelate } from '../lib/privacy.js'
import { tr } from './public.js'

const copyCanvas = (src) => { const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0); return c }
// Штамп и хэш делаются после маскировки: на сервер уходит только закрытая версия
async function finalize(base, lines) {
  const c = copyCanvas(base)
  stamp(c, lines)
  const blob = await toBlob(c)
  return { blob, url: URL.createObjectURL(blob), sha256: await sha256Blob(blob) }
}

// Съёмка доказательства: камера + GPS + время, анализ кадра, отправка на сервер.
// Галерея недоступна: файл можно выбрать только как запасной вариант, и сервер снизит балл.
export function CaptureFlow({ api, me, title, object, order, stage, beforeUrl, form, onSubmit, onClose, submitLabel = tr('Отправить на проверку', 'Тексеруге жіберу'), doneLabel = tr('Готово', 'Дайын') }) {
  const video = useRef()
  const fileRef = useRef()
  const [stream, setStream] = useState(null)
  const [camErr, setCamErr] = useState(null)
  const [pos, setPos] = useState(null)
  const [geoErr, setGeoErr] = useState(null)
  const [sim, setSim] = useState('real')
  const [shot, setShot] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [fields, setFields] = useState({})
  const target = targetFor(object, stage === 'before' ? null : order)
  const isDemo = /@fakt\.example$/.test(me?.email || '') || api.mode === 'offline'

  useEffect(() => {
    let s = null
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
        .then((st) => { s = st; setStream(st); if (video.current) { video.current.srcObject = st; video.current.play().catch(() => {}) } })
        .catch((e) => setCamErr(e.name === 'NotAllowedError' ? tr('Нет доступа к камере. Разрешите камеру в настройках браузера.', 'Камераға рұқсат жоқ. Браузер баптауларында камераға рұқсат беріңіз.') : tr('Камера недоступна на этом устройстве.', 'Бұл құрылғыда камера қолжетімсіз.')))
    } else setCamErr(tr('Браузер не поддерживает камеру. Откройте Rastau в Chrome или Safari.', 'Браузер камераны қолдамайды. Rastau-ды Chrome немесе Safari-да ашыңыз.'))
    let wid = null
    if (navigator.geolocation) {
      wid = navigator.geolocation.watchPosition(
        (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); setGeoErr(null) },
        (e) => setGeoErr(e.code === 1 ? tr('Нет доступа к геолокации', 'Геолокацияға рұқсат жоқ') : tr('GPS не определён', 'GPS анықталмады')),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 })
    } else setGeoErr(tr('Геолокация недоступна', 'Геолокация қолжетімсіз'))
    return () => { s && s.getTracks().forEach((t) => t.stop()); wid != null && navigator.geolocation.clearWatch(wid) }
  }, [])

  useEffect(() => { if (stream && video.current && !shot) { video.current.srcObject = stream; video.current.play().catch(() => {}) } }, [stream, shot])

  // Позиция для съёмки: реальная или имитация для демонстрации
  const anchor = target?.path ? { lat: target.path[Math.floor(target.path.length / 2)][0], lng: target.path[Math.floor(target.path.length / 2)][1] } : target
  const effective = sim === 'onsite' && anchor ? { lat: anchor.lat + (Math.random() - 0.5) * 0.00012, lng: anchor.lng + (Math.random() - 0.5) * 0.00012, accuracy: 6 }
    : sim === 'offsite' && anchor ? { lat: anchor.lat + 0.016, lng: anchor.lng + 0.021, accuracy: 9 } : pos
  const dist = effective && target ? distanceToTarget(effective, target) : null

  async function process(canvas, capture) {
    setBusy(true)
    try {
      const at = new Date()
      const capture_perf = performance.now()
      const metrics = await analyze(canvas)
      let similarity = null
      if (beforeUrl) {
        try {
          const src = isGen(beforeUrl) ? genPhoto(beforeUrl) : beforeUrl.startsWith('blob:') ? beforeUrl : await api.photo(beforeUrl)
          const img = await loadImage(src)
          const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
          c.getContext('2d').drawImage(img, 0, 0)
          similarity = sceneSimilarity(c, canvas)
        } catch { similarity = null }
      }
      const p = effective
      const lines = [
        `Rastau • ${at.toLocaleDateString('ru-RU')} ${at.toLocaleTimeString('ru-RU')}`,
        p ? `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} ±${Math.round(p.accuracy)} м` : 'GPS: нет данных',
        `${object?.code || ''} ${capture === 'camera' ? '' : '• из файла'}`.trim(),
      ]
      const base = copyCanvas(canvas)
      const { blob, url, sha256 } = await finalize(base, lines)
      const meta = {
        object_id: object?.id, order_id: order?.id || null, stage, lat: p?.lat ?? null, lng: p?.lng ?? null, accuracy: p?.accuracy ?? null,
        device_time: at.toISOString(), capture, simulated: sim !== 'real', sha256, ...metrics, similarity, capture_perf, masked: 0,
      }
      const preview = scoreEvidence(meta, { target: target && (stage === 'before' ? { ...target, radius: Math.max(target.radius, 60) } : target), others: [] })
      setShot({ base, lines, blob, url, meta, preview })
    } catch (e) {
      toast(tr('Не удалось обработать снимок: ', 'Суретті өңдеу мүмкін болмады: ') + e.message)
    } finally { setBusy(false) }
  }

  // Закрыть области на снимке (лица, номера) и пересобрать файл
  async function mask(boxes) {
    if (!boxes.length) return
    for (const b of boxes) pixelate(shot.base, b)
    const f = await finalize(shot.base, shot.lines)
    URL.revokeObjectURL(shot.url)
    setShot({ ...shot, blob: f.blob, url: f.url, meta: { ...shot.meta, sha256: f.sha256, masked: (shot.meta.masked || 0) + boxes.length } })
  }
  function tapMask(e) {
    const r = e.currentTarget.getBoundingClientRect()
    const k = shot.base.width / r.width
    const side = shot.base.width * 0.12
    mask([{ x: (e.clientX - r.left) * k - side / 2, y: (e.clientY - r.top) * k - side / 2, w: side, h: side }])
  }
  const [faceBusy, setFaceBusy] = useState(false)
  async function autoFaces() {
    setFaceBusy(true)
    try {
      const boxes = await findFaces(shot.base)
      await mask(boxes)
      toast(boxes.length ? `${tr('Скрыто лиц', 'Жасырылған беттер')}: ${boxes.length}` : tr('Лица не найдены. Если человек есть в кадре, коснитесь его на фото.', 'Беттер табылмады. Кадрда адам болса, фотодағы оны басыңыз.'))
    } catch (e) { toast(tr('Автопоиск лиц недоступен: ', 'Беттерді автоіздеу қолжетімсіз: ') + e.message + tr('. Коснитесь фото, чтобы скрыть вручную.', '. Қолмен жасыру үшін фотоны басыңыз.')) } finally { setFaceBusy(false) }
  }

  const shoot = () => video.current?.videoWidth && process(frameFromVideo(video.current), 'camera')
  const fromFile = async (e) => { const f = e.target.files?.[0]; if (f) process(await canvasFromFile(f), 'file') }

  async function send() {
    setBusy(true)
    try {
      const ev = await onSubmit({ ...shot.meta, ...fields }, shot.blob)
      setResult(ev)
    } catch (e) { toast(tr('Ошибка отправки: ', 'Жіберу қатесі: ') + e.message) } finally { setBusy(false) }
  }

  if (result?.queued) {
    return html`<${Modal} title=${tr('Сохранено на телефоне', 'Телефонда сақталды')} onClose=${() => onClose(result)}>
      <div class="verdict-box amber"><div class="vb-ic"><${Icon} n="upload" s=${30} /></div><div><div class="vt">${tr('Нет связи. Фото в очереди', 'Байланыс жоқ. Фото кезекте')}</div><div class="small">${tr('Снимок, координаты и время съёмки сохранены. Фото уйдёт на сервер само, когда появится связь, и тогда получит балл доверия. Не удаляйте приложение и не очищайте данные браузера.', 'Сурет, координаттар және түсірілген уақыт сақталды. Байланыс пайда болғанда фото серверге өзі жіберіледі және сенім балын алады. Қосымшаны жоймаңыз және браузер деректерін тазаламаңыз.')}</div></div></div>
      <div style="height:12px" />
      <button class="btn primary big" onClick=${() => onClose(result)}>${doneLabel}</button>
    </${Modal}>`
  }
  if (result) {
    return html`<${Modal} title=${tr('Результат проверки', 'Тексеру нәтижесі')} onClose=${() => onClose(result)}>
      <${VerdictBox} ev=${result} />
      <div class="sec-title">${tr('Проверки на сервере', 'Сервердегі тексерулер')}</div>
      <${Checks} checks=${result.checks} />
      <div style="height:12px" />
      <button class="btn primary big" onClick=${() => onClose(result)}>${result.verdict === 'rejected' ? tr('Понятно', 'Түсінікті') : doneLabel}</button>
    </${Modal}>`
  }

  return html`<${Modal} title=${title} onClose=${() => onClose(null)}>
    ${!shot ? html`
      <div class="cam">
        ${stream ? html`<video ref=${video} playsinline muted autoplay />` : html`<div style="color:#fff;padding:40px 20px;text-align:center">${camErr || tr('Включаем камеру…', 'Камера қосылуда…')}</div>`}
        <div class="hud">
          <span>${effective ? `GPS ±${Math.round(effective.accuracy)} м` : geoErr || tr('Ищем GPS…', 'GPS ізделуде…')}</span>
          ${dist != null && html`<span style=${dist > (target?.radius || 80) ? 'background:rgba(198,40,40,.85)' : 'background:rgba(19,138,75,.85)'}>${tr('до точки', 'нүктеге дейін')} ${fmtDist(dist)}</span>`}
          <span>${object?.code}</span>
        </div>
        ${stream && html`<button class="shoot" aria-label=${tr('Сделать снимок', 'Суретке түсіру')} onClick=${shoot} disabled=${busy} />`}
      </div>
      <div style="height:10px" />
      ${isDemo && html`<label class="switch">
        <span><${Icon} n="play" s=${16} /> ${tr('Демо-режим позиции', 'Орын демо-режимі')}</span>
        <select class="i" style="flex:1" value=${sim} onChange=${(e) => setSim(e.target.value)}>
          <option value="real">${tr('Реальный GPS телефона', 'Телефонның нақты GPS-і')}</option>
          <option value="onsite">${tr('Я на объекте (имитация)', 'Мен нысандамын (имитация)')}</option>
          <option value="offsite">${tr('Я в 2 км от объекта (проверка обмана)', 'Мен нысаннан 2 км қашықтамын (алдауды тексеру)')}</option>
        </select>
      </label>`}
      <div class="row" style="margin-top:10px">
        <button class="btn sm" onClick=${() => fileRef.current.click()}>${tr('Нет камеры? Загрузить файл', 'Камера жоқ па? Файл жүктеу')}</button>
        <span class="small muted">${tr('Файл снижает балл доверия на 40', 'Файл сенім балын 40-қа төмендетеді')}</span>
        <input ref=${fileRef} type="file" accept="image/*" hidden onChange=${fromFile} />
      </div>
    ` : html`
      <img class="ph" src=${shot.url} alt="Снимок" onClick=${tapMask} style="cursor:crosshair" />
      <div class="row" style="margin-top:8px">
        <button class="btn sm" onClick=${autoFaces} disabled=${faceBusy || busy}>${faceBusy ? tr('Ищем лица…', 'Беттер ізделуде…') : tr('Скрыть лица автоматически', 'Беттерді автоматты жасыру')}</button>
        <span class="small muted">${shot.meta.masked ? `${tr('Закрыто областей', 'Жабылған аймақтар')}: ${shot.meta.masked}. ` : ''}${tr('Коснитесь фото, чтобы закрыть лицо или номер машины', 'Бетті немесе көлік нөмірін жабу үшін фотоны басыңыз')}</span>
      </div>
      <div style="height:10px" />
      <div class="sec-title">${tr('Предварительная проверка на телефоне', 'Телефондағы алдын ала тексеру')}</div>
      <${Checks} checks=${shot.preview.checks.filter((c) => c.code !== 'duplicate')} />
      <p class="small muted">${tr('Окончательный балл ставит сервер: он сверит время, расстояние и повторы фото по всей базе.', 'Соңғы балды сервер қояды: ол уақытты, қашықтықты және фотоның бүкіл база бойынша қайталануын тексереді.')}</p>
      ${form && form(fields, (patch) => setFields({ ...fields, ...patch }))}
      <div class="row">
        <button class="btn" onClick=${() => setShot(null)} disabled=${busy}>${tr('Переснять', 'Қайта түсіру')}</button>
        <button class="btn primary grow" onClick=${send} disabled=${busy}>${busy ? tr('Отправляем…', 'Жіберілуде…') : submitLabel}</button>
      </div>
    `}
  </${Modal}>`
}
