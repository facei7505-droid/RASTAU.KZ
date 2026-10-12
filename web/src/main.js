import { html, render } from 'htm/preact'
import { App } from './ui/app.js'
import { createLocalApi } from './api/local.js'
import { SUPABASE_URL } from './config.js'
import { withOutbox } from './lib/outbox.js'

// Онлайн по умолчанию; ?offline или отсутствие связи с базой = офлайн-режим в браузере
async function boot() {
  const wantOffline = new URLSearchParams(location.search).has('offline') || !SUPABASE_URL || window.FAKT_LOCAL
  let api = null
  if (!wantOffline) {
    try {
      const { createSupabaseApi } = await import('./api/supabase.js')
      api = await createSupabaseApi()
      await api.init()
    } catch (e) {
      console.warn('Онлайн-режим недоступен, включаю офлайн', e)
      api = null
    }
  }
  if (!api) { api = createLocalApi(); await api.init() }
  withOutbox(api)
  render(html`<${App} api=${api} />`, document.getElementById('app'))
}
boot()

// Офлайн-оболочка приложения (в продакшене)
if ('serviceWorker' in navigator && !window.FAKT_LOCAL && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {})
