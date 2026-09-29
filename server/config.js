// Shared settings for the self-hosted world (see README "Running the world").
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.join(__dirname, '..')
// Which mirrored world folder to serve (neue2dojo, ...).
const WORLD = process.env.WORLD || 'neue2dojo'
const WORLD_DIR = path.join(ROOT, WORLD)
const WORLD_FILE = path.join(WORLD_DIR, 'api.hyperfy.io/worlds',
  fs.readdirSync(path.join(WORLD_DIR, 'api.hyperfy.io/worlds')).find(f => f.endsWith('.json')))
const SITE = JSON.parse(fs.readFileSync(path.join(WORLD_DIR, 'site.json'), 'utf8'))
const PORT = parseInt(process.env.PORT || '4000', 10)
// The API and game server talk to each other on this port, bound to loopback.
const INTERNAL_PORT = parseInt(process.env.INTERNAL_PORT || String(PORT + 1), 10)
if (INTERNAL_PORT === PORT) throw new Error('INTERNAL_PORT must differ from PORT')
// Origin browsers use to reach this server. Asset URLs in the world data
// must be absolute, so they are rewritten to this origin at every start.
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '')
{
  const u = new URL(PUBLIC_URL)
  // The client, API and router are served from the root of this origin.
  if (u.pathname !== '/' || u.search || u.hash) {
    throw new Error(`PUBLIC_URL must be an origin without a path (got ${PUBLIC_URL})`)
  }
}
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, '.data', WORLD))

// JWT secret for guest accounts; kept across restarts so visitors keep their
// account (name, equipped avatar).
function secret() {
  if (process.env.SECRET) return process.env.SECRET
  const file = path.join(DATA_DIR, 'secret')
  if (!fs.existsSync(file)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 })
  }
  try { fs.chmodSync(file, 0o600) } catch (err) {} // files from older versions
  return fs.readFileSync(file, 'utf8').trim()
}

// The live site's hosts, mirrored in this repo under the same paths.
const MIRROR = {
  'https://data.hyperfy.xyz/': `${PUBLIC_URL}/api/static/`,
  'https://fonts.gstatic.com/': `${PUBLIC_URL}/fonts.gstatic.com/`,
}

function localize(text) {
  for (const [from, to] of Object.entries(MIRROR)) text = text.split(from).join(to)
  return text
}

module.exports = {
  ROOT,
  WORLD_DIR,
  SITE,
  PORT,
  INTERNAL_PORT,
  PUBLIC_URL,
  PUBLIC_HOST: new URL(PUBLIC_URL).host,
  SSL: new URL(PUBLIC_URL).protocol === 'https:',
  DATA_DIR,
  DB_FILE: path.join(DATA_DIR, 'hyperfy.db'),
  UPLOADS_DIR: path.join(DATA_DIR, 'uploads'),
  CDN_DIR: path.join(WORLD_DIR, 'data.hyperfy.xyz'),
  WORLD_FILE,
  ENTITY_META_DIR: path.join(WORLD_DIR, 'api.hyperfy.io/entities'),
  CLIENT_DIR: path.dirname(require.resolve('hyperfy-client/package.json')) + '/build',
  AVATAR_VERSION: 4, // hyperfy-avatar version live serves to visitors
  secret,
  localize,
}
