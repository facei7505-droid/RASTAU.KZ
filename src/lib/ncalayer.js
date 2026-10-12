// Подписание ЭЦП НУЦ РК через NCALayer (локальное приложение на компьютере пользователя, wss://127.0.0.1:13579).
// Если NCALayer не запущен, возвращаем { ok: false } и интерфейс предлагает демо-подпись.
const URL_NCALAYER = 'wss://127.0.0.1:13579/'

const toBase64 = (text) => btoa(unescape(encodeURIComponent(text)))

export function signWithNcaLayer(text, { timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    let ws
    let settled = false
    const done = (r) => { if (!settled) { settled = true; try { ws && ws.close() } catch {} resolve(r) } }
    try { ws = new WebSocket(URL_NCALAYER) } catch { return done({ ok: false, reason: 'NCALayer не найден на этом компьютере' }) }
    const connectTimer = setTimeout(() => done({ ok: false, reason: 'NCALayer не запущен' }), 2500)
    ws.onerror = () => { clearTimeout(connectTimer); done({ ok: false, reason: 'NCALayer не запущен' }) }
    ws.onopen = () => {
      clearTimeout(connectTimer)
      setTimeout(() => done({ ok: false, reason: 'Подпись не завершена' }), timeout)
      ws.send(JSON.stringify({
        module: 'kz.gov.pki.knca.basics', method: 'sign',
        args: {
          allowedStorages: ['PKCS12', 'AKKaztokenStore', 'AKKZIDCardStore'], format: 'cms', data: toBase64(text),
          signingParams: { decode: true, encapsulate: true, digested: false, tsaProfile: {} },
          signerParams: { extKeyUsageOids: ['1.3.6.1.5.5.7.3.4'], chain: [] }, locale: 'ru',
        },
      }))
    }
    ws.onmessage = (m) => {
      let r
      try { r = JSON.parse(m.data) } catch { return }
      if (r.status === undefined) return // приветствие с версией
      if (r.status === true) done({ ok: true, cms: r.body?.result?.[0] || '' })
      else done({ ok: false, reason: r.body?.message || r.message || 'Подпись отменена' })
    }
  })
}
