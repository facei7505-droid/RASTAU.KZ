import { html } from 'htm/preact'
import { useEffect, useRef } from 'preact/hooks'

const TONE = { green: '#1aa25a', amber: '#f0a400', red: '#e03131', gray: '#8a97a8' }

// Карта на Leaflet. items: [{id, lat, lng, path?, tone, label, kind}]
export function MapView({ items = [], lines = [], onSelect, height = 520, cls = 'map', fitKey, center, picker, onPick, focus }) {
  const el = useRef()
  const map = useRef()
  const layer = useRef()
  const pickMarker = useRef()
  const fitted = useRef(null)

  useEffect(() => {
    if (!window.L) return
    const L = window.L
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true, preferCanvas: true }).setView(center || [43.866, 77.07], 12)
    // Подложка OpenStreetMap: без ключа. На пилоте можно заменить на свой сервер плиток в РК.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    if (picker) {
      map.current.on('click', (e) => {
        if (pickMarker.current) pickMarker.current.setLatLng(e.latlng)
        else pickMarker.current = L.marker(e.latlng).addTo(map.current)
        onPick && onPick({ lat: e.latlng.lat, lng: e.latlng.lng })
      })
    }
    setTimeout(() => map.current && map.current.invalidateSize(), 50)
    return () => { map.current.remove(); map.current = null }
  }, [])

  useEffect(() => {
    if (!map.current) return
    const L = window.L
    layer.current.clearLayers()
    const bounds = []
    for (const ln of lines) {
      L.polyline(ln.points, { color: ln.color || '#1d5fbf', weight: ln.weight || 2, dashArray: ln.dash || '4 6', opacity: 0.8 }).addTo(layer.current)
    }
    for (const it of items) {
      const color = TONE[it.tone] || it.color || TONE.gray
      let m
      if (it.path) {
        m = L.polyline(it.path, { color, weight: 6, opacity: 0.85 })
        if (!focus || focus(it)) it.path.forEach((p) => bounds.push(p))
      } else if (it.lat != null) {
        const r = it.kind === 'waste' ? 5 : it.kind === 'defect' ? 6 : 8
        m = L.circleMarker([it.lat, it.lng], {
          radius: r, color: it.kind === 'waste' ? '#0b3d6e' : '#fff', weight: it.kind === 'waste' ? 1.5 : 2,
          fillColor: color, fillOpacity: 0.95,
        })
        if (!focus || focus(it)) bounds.push([it.lat, it.lng])
      }
      if (!m) continue
      if (it.label) m.bindTooltip(it.label, { direction: 'top', opacity: 0.95 })
      if (onSelect) m.on('click', () => onSelect(it))
      m.addTo(layer.current)
    }
    if (fitted.current !== String(fitKey)) {
      fitted.current = String(fitKey)
      if (bounds.length && !picker) map.current.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 })
      else if (center) map.current.setView(center, 15)
    }
  }, [items, lines, fitKey])

  // Карточка могла поменять размер (адаптивная вёрстка): пересчитываем карту
  useEffect(() => { if (map.current) map.current.invalidateSize() }, [height])

  return html`<div ref=${el} class=${cls} style=${`height:${height}px`} />`
}
