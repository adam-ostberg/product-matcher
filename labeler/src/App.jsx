import { useEffect, useState } from 'react'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

async function fetchJson(url) {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? `${url}: ${res.status}`)
  return data
}

// Coop images are .tiff, which most browsers can't show. Cloudinary converts based on the extension.
function imageUrl(url) {
  if (!url) return null
  return url.replace(/\.tiff?$/i, '.jpg').replace('/image/upload/', '/image/upload/w_400/')
}

function formatSize(p) {
  if (p.size_value == null) return 'no size'
  if (p.size_unit === 'g' && p.size_value >= 1000) return `${p.size_value / 1000} kg`
  if (p.size_unit === 'ml' && p.size_value >= 1000) return `${p.size_value / 1000} l`
  return `${p.size_value} ${p.size_unit}`
}

function formatPrice(price) {
  return price == null ? '–' : `${price.toFixed(2)} kr`
}

// true / false, or null when one of them has no parsed size
function sameSize(a, b) {
  if (a.size_value == null || b.size_value == null) return null
  if (a.size_unit !== b.size_unit) return false
  return Math.abs(a.size_value - b.size_value) <= 0.02 * Math.max(a.size_value, b.size_value)
}

function ProductImage({ url }) {
  const [failed, setFailed] = useState(false)
  const src = imageUrl(url)
  if (!src || failed) return <div className="image placeholder">no image</div>
  return <img className="image" src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

export default function App() {
  const [items, setItems] = useState(null)
  const [labels, setLabels] = useState(new Map()) // coop_key -> latest label
  const [idx, setIdx] = useState(0)
  const [selected, setSelected] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    Promise.all([fetchJson('/api/candidates'), fetchJson('/api/labels')])
      .then(([candidates, labelLines]) => {
        const byKey = new Map(labelLines.map((l) => [l.coop_key, l])) // later lines win
        setItems(candidates.items)
        setLabels(byKey)
        // Continue where you left off
        const firstOpen = candidates.items.findIndex((it) => !byKey.has(it.coop.product_key))
        setIdx(firstOpen === -1 ? candidates.items.length : firstOpen)
      })
      .catch((err) => setLoadError(err.message))
  }, [])

  const item = items?.[idx]
  const current = item ? labels.get(item.coop.product_key) : null

  // When coming back to a labeled product, start from its saved answer
  useEffect(() => {
    setSelected(new Set(current?.matches ?? []))
    setMessage(null)
  }, [item, current])

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  async function save(status) {
    if (saving) return
    if (status === 'match' && selected.size === 0) {
      setMessage('Select at least one match, or press N for "none of these".')
      return
    }
    const label = {
      coop_key: item.coop.product_key,
      order: item.order,
      status,
      matches: status === 'match' ? [...selected] : [],
      shown: item.candidates.map((c) => c.product_key), // the unselected ones are the negatives
      labeled_at: new Date().toISOString(),
    }
    setSaving(true)
    try {
      const res = await fetch('/api/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(label),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setLabels((prev) => new Map(prev).set(label.coop_key, label))
      setIdx((i) => i + 1)
    } catch (err) {
      setMessage(`Could not save: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // Re-registered every render so the handler always sees the current state
  useEffect(() => {
    function onKey(e) {
      if (!items || e.metaKey || e.ctrlKey || e.altKey) return
      const k = KEYS.indexOf(e.key)
      const key = e.key.toLowerCase()
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1))
      else if (e.key === 'ArrowRight') setIdx((i) => Math.min(items.length, i + 1))
      else if (!item) return
      else if (k !== -1 && item.candidates[k]) toggle(item.candidates[k].product_key)
      else if (e.key === 'Enter') save('match')
      else if (key === 'n') save('none')
      else if (key === 's') save('skip')
      else return
      e.preventDefault() // e.g. stop Enter from also clicking a focused button
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (loadError) return <div className="center error">{loadError}</div>
  if (!items) return <div className="center">Loading…</div>

  const counts = { match: 0, none: 0, skip: 0 }
  for (const l of labels.values()) counts[l.status]++

  return (
    <div className="app">
      <header>
        <strong>Product labeler</strong>
        <span>
          #{Math.min(idx + 1, items.length)} of {items.length}
        </span>
        <span>
          {labels.size} labeled · {counts.match} match · {counts.none} none · {counts.skip} skipped
        </span>
        <span className="help">1–0 select · Enter save · N none · S skip · ← → navigate</span>
      </header>

      {item ? (
        <>
          <section className="coop">
            <ProductImage key={item.coop.image_url} url={item.coop.image_url} />
            <div className="coop-info">
              <div className="store">
                Coop
                {current && (
                  <span className={`badge ${current.status}`}>
                    labeled: {current.status}
                    {current.status === 'match' && ` (${current.matches.length})`}
                  </span>
                )}
              </div>
              <h1>{item.coop.name}</h1>
              <div className="meta">
                <span>{item.coop.brand}</span>
                <span>{formatSize(item.coop)}</span>
                <span>{formatPrice(item.coop.price)}</span>
              </div>
              <div className="ean">EAN {item.coop.product_key}</div>
            </div>
            <div className="actions">
              <button className="primary" onClick={() => save('match')} disabled={selected.size === 0 || saving}>
                Save {selected.size} match{selected.size === 1 ? '' : 'es'} (Enter)
              </button>
              <button onClick={() => save('none')} disabled={saving}>
                None of these (N)
              </button>
              <button onClick={() => save('skip')} disabled={saving}>
                Unsure, skip (S)
              </button>
            </div>
          </section>

          {message && <div className="message">{message}</div>}

          <section className="grid">
            {item.candidates.map((c, i) => {
              const size = sameSize(item.coop, c)
              return (
                <div
                  key={c.product_key}
                  className={`card ${selected.has(c.product_key) ? 'selected' : ''}`}
                  onClick={() => toggle(c.product_key)}
                >
                  <span className="hotkey">{KEYS[i]}</span>
                  <ProductImage key={c.image_url} url={c.image_url} />
                  <div className="name">{c.name}</div>
                  <div className={c.brand_norm !== item.coop.brand_norm ? 'differs' : ''}>{c.brand}</div>
                  <div className={size === false ? 'differs' : size === null ? 'unknown' : ''}>{formatSize(c)}</div>
                  <div>{formatPrice(c.price)}</div>
                  <div className="score">
                    rank {c.rank} · score {c.score.toFixed(2)}
                  </div>
                </div>
              )
            })}
          </section>
        </>
      ) : (
        <div className="center">
          All {items.length} exported products are labeled. Export more from the notebook to continue.
        </div>
      )}
    </div>
  )
}
