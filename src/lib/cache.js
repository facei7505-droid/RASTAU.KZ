// Последние загруженные данные на телефоне: без связи приложение открывается с ними, а фото уходят в очередь
const DB = 'fakt-cache', ST = 'kv'
let dbp = null
function db() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(ST)
    r.onsuccess = () => res(r.result)
    r.onerror = () => { dbp = null; rej(r.error) }
  }))
}
async function run(mode, fn) {
  const d = await db()
  return new Promise((res, rej) => {
    const t = d.transaction(ST, mode)
    const req = fn(t.objectStore(ST))
    t.oncomplete = () => res(req?.result)
    t.onerror = () => rej(t.error)
  })
}
export const cacheGet = (key) => run('readonly', (s) => s.get(key)).catch(() => undefined)
export const cacheSet = (key, value) => run('readwrite', (s) => s.put(value, key)).catch(() => {})
export const cacheDel = (key) => run('readwrite', (s) => s.delete(key)).catch(() => {})
