import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Input is exported by the last cell of notebooks/explore.ipynb.
// Labels are hand-made work, so they live in labels/ rather than the gitignored data/ folder.
const CANDIDATES = fileURLToPath(new URL('../data/labeling/candidates.json', import.meta.url))
const LABELS = fileURLToPath(new URL('../labels/labels.jsonl', import.meta.url))
const STATUSES = ['match', 'none', 'skip']

function sendJson(res, data, status = 200) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

// A tiny API inside the dev server: read the candidates, read labels, append a label.
// Labels are append-only (one JSON line per save); the latest line for a coop_key wins.
function labelsApi() {
  return {
    name: 'labels-api',
    configureServer(server) {
      server.middlewares.use('/api/candidates', (req, res) => {
        if (!fs.existsSync(CANDIDATES)) {
          return sendJson(res, { error: `Missing ${CANDIDATES}. Run the export cell in notebooks/explore.ipynb.` }, 404)
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(fs.readFileSync(CANDIDATES))
      })

      server.middlewares.use('/api/labels', (req, res) => {
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk) => (body += chunk))
          req.on('end', () => {
            try {
              const label = JSON.parse(body)
              if (typeof label.coop_key !== 'string' || !STATUSES.includes(label.status)) {
                throw new Error('invalid label')
              }
              fs.mkdirSync(path.dirname(LABELS), { recursive: true })
              fs.appendFileSync(LABELS, JSON.stringify(label) + '\n')
              sendJson(res, { ok: true })
            } catch (err) {
              sendJson(res, { error: err.message }, 400)
            }
          })
          return
        }

        const lines = fs.existsSync(LABELS) ? fs.readFileSync(LABELS, 'utf8').split('\n').filter(Boolean) : []
        sendJson(res, lines.map((line) => JSON.parse(line)))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), labelsApi()],
})
