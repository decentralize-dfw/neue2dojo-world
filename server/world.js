// Hosts a mirrored world (WORLD=whyweexist: hyperfy.io/pill, WORLD=hatch,
// WORLD=balloon) with Hyperfy's own stack, all 2.40.0 and MIT licensed:
// hyperfy-api, hyperfy-server (the game server), hyperfy-router and the
// hyperfy-client build. The wiring follows hyperfy-tools@2.40.0 app.js with
// the settings of the live site (MODE live, PRODUCTION true, no dev reload
// socket) and everything served from this repository.
//
// Two listeners:
//   PORT (public)                 the client, the mirror, the API routes the
//                                 client uses, and the router's websocket to
//                                 the game server
//   127.0.0.1:INTERNAL_PORT       the whole API and the game server, for the
//                                 stack's own calls (API <-> game server)
//
// Started by server/start.js, which seeds the database first and restarts
// the world when it empties.

// hyperfy-physx's emscripten loader streams its wasm with fetch() whenever
// WebAssembly.instantiateStreaming exists (Node 18+), which fails for a file
// path. Without it the wasm is read from disk, as on Node 16.
delete WebAssembly.instantiateStreaming
// hyperfy-api, -server and -router start their own listeners unless LIB is set.
process.env.LIB = 'true'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const express = require('express')
const compression = require('compression')
const multer = require('multer')
const { getWorldTitle, getWorldDescription, getWorldImage } = require('hyperfy-utils')
const config = require('./config')
const { patchClient } = require('../site/client-patches')

const WORLD = JSON.parse(fs.readFileSync(config.WORLD_FILE, 'utf8'))
const SLUG = WORLD.slug
const LOCAL_API = `http://127.0.0.1:${config.INTERNAL_PORT}/api`
// internalUrl the API gives the router for the in-process game server
const GAME_SERVER = `localhost:${config.INTERNAL_PORT}/server`
// third-party hosts index.html loads from, mirrored under site/web/<host>/,
// and the fonts the client uses, mirrored in the world folder
const WEB_MIRRORS = { 'cdn.jsdelivr.net': 'site/web', 'd3js.org': 'site/web', 'vjs.zencdn.net': 'site/web', 'fonts.gstatic.com': null }
const DAY = 24 * 60 * 60

// API routes a visitor's client uses; everything else in hyperfy-api (file
// writes, proxies, server registration, admin routes) is internal only.
// Matched against the lower-cased path with repeated slashes collapsed, since
// Express routes ignore case and extra slashes.
const PUBLIC_API = [
  ['GET', /^\/api\/static\//],
  ['GET', /^\/api\/(account|entities|entities\/[^/]+|world|worlds|worlds\/[^/]+|server|collaborators|world-events|nfts)\/?$/],
  ['POST', /^\/api\/(guest|static-upload)\/?$/],
  ['PUT', /^\/api\/account\/?$/],
]
// Upload types the client offers (avatars, models, images, audio, video);
// nothing a browser would run as a page.
const UPLOAD_TYPES = new Set(['vrm', 'glb', 'gltf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'hdr', 'mp3', 'ogg', 'wav', 'mp4', 'webm'])

// hyperfy-physx's emscripten runtime aborts the process on any unhandled
// promise rejection, and the game server leaves some per-socket promises
// unhandled (e.g. a bad auth token). Log those instead.
function keepRejectionsNonFatal() {
  process.removeAllListeners('unhandledRejection')
  process.on('unhandledRejection', err => console.error('[unhandled rejection]', err?.message || err))
}

function indexTemplate(bundleName, patchedName) {
  let html = fs.readFileSync(path.join(config.CLIENT_DIR, 'index.html'), 'utf8')
  html = html.replace(/<script[^>]*plausible\.io[^>]*><\/script>/, '')
  html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"( crossorigin)?\/>/g, '')
  html = html.replace(/<link href="https:\/\/fonts\.googleapis\.com\/[^"]*" rel="stylesheet"\/>/, '') // Roboto Mono, unused
  for (const host of Object.keys(WEB_MIRRORS)) html = html.split(`https://${host}/`).join(`/${host}/`)
  html = html.replace(`src="/${bundleName}"`, `src="/${patchedName}"`)
  html = html.replace('src="/env.js"></script>', 'src="/env.js"></script><script src="/local/loading.js"></script>')
  return html.replace('</body>', '<script src="/local/overlay.js"></script></body>')
}

async function start() {
  fs.mkdirSync(config.UPLOADS_DIR, { recursive: true })
  const staticDir = path.join(config.DATA_DIR, 'static')
  fs.mkdirSync(staticDir, { recursive: true })

  const api = await require('hyperfy-api').createApp({
    production: true, // guests are not guardians, as on live
    host: `${config.PUBLIC_HOST}/api`,
    ssl: config.SSL,
    staticDir,
    secret: config.secret(),
    dbFile: config.DB_FILE,
    serverPath: '/server',
    routerHost: `${config.PUBLIC_HOST}/router`,
  })
  const server = await require('hyperfy-server').createApp({
    useAgones: 'false',
    apiUrl: LOCAL_API,
    livekitApiKey: process.env.LIVEKIT_API_KEY,
    livekitSecretKey: process.env.LIVEKIT_SECRET_KEY,
    port: config.INTERNAL_PORT, // the API reaches the game server here
  })
  const router = await require('hyperfy-router').createApp({})
  keepRejectionsNonFatal()

  const bundleName = fs.readdirSync(config.CLIENT_DIR).find(f => /^app\.[a-f0-9]+\.js$/.test(f))
  const bundle = patchClient(fs.readFileSync(path.join(config.CLIENT_DIR, bundleName), 'utf8'))
  // Named by content, so a change to the patches is never served from cache.
  const patchedName = `app.${crypto.createHash('sha256').update(bundle).digest('hex').slice(0, 20)}.js`
  const html = indexTemplate(bundleName, patchedName)
  const cors = (req, res, next) => (res.set('Access-Control-Allow-Origin', '*'), next()) // as the live CDNs

  // ---------------------------------------------------------------- mirror

  // data.hyperfy.xyz, mounted at /api/static on both listeners: browsers load
  // assets from it, the game server loads component code from it.
  const mirror = express.Router()
  // Component bundles, with their hard-coded data.hyperfy.xyz URLs
  // (hyperfy-avatar v4, hyperfy-vrm) pointed at the mirror.
  mirror.get('/components/:id/:version/index.js', cors, (req, res, next) => {
    const { id, version } = req.params
    if (!/^[a-z0-9-]+$/.test(id) || !/^v\d+$/.test(version)) return next()
    fs.readFile(path.join(config.CDN_DIR, 'components', id, version, 'index.js'), 'utf8', (err, code) => {
      if (err) return next()
      res.type('application/javascript').set('Cache-Control', `public, max-age=${DAY}`).send(config.localize(code))
    })
  })
  // Uploads and avatars are named by content hash.
  const immutable = /^\/(uploads|avatars)\//
  mirror.use(cors, express.static(config.CDN_DIR, {
    index: false,
    setHeaders: (res, file) => {
      const rel = '/' + path.relative(config.CDN_DIR, file).split(path.sep).join('/')
      res.set('Cache-Control', immutable.test(rel) ? `public, max-age=${365 * DAY}, immutable` : `public, max-age=${DAY}`)
    },
  }))
  // Visitors' uploads (the "Upload VRM" button).
  mirror.use('/uploads', express.static(config.UPLOADS_DIR, {
    index: false,
    immutable: true,
    maxAge: '365d',
    setHeaders: res => res.set('X-Content-Type-Options', 'nosniff'),
  }))

  // ---------------------------------------------------------------- internal

  const internal = express()
  internal.disable('x-powered-by')
  internal.use('/api/static', mirror)
  // Tell server/start.js when the world has loaded.
  internal.post('/server/start', (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode !== 200) return
      keepRejectionsNonFatal()
      process.send?.({ type: 'world-start' })
    })
    next()
  })
  internal.use('/api', api)
  internal.use('/server', server)

  // Visitors connected to the game server (each arrives as a websocket from
  // the router), reported to server/start.js.
  let sockets = 0
  const report = () => process.send?.({ type: 'clients', count: sockets })
  const onInternalUpgrade = (req, sock, head) => {
    if (new URL(req.url, 'http://localhost').pathname !== '/server') return sock.destroy()
    sockets++
    report()
    sock.once('close', () => {
      sockets--
      report()
    })
    server.handleUpgrade(req, sock, head)
  }

  // ---------------------------------------------------------------- public

  const app = express()
  app.disable('x-powered-by')
  app.use(compression())
  app.use((req, res, next) => {
    const p = req.path.toLowerCase().replace(/\/{2,}/g, '/')
    if (p === '/server' || p.startsWith('/server/')) return res.status(403).json({ code: 'forbidden' })
    if ((p === '/router' || p.startsWith('/router/')) && req.method !== 'GET') return res.status(403).json({ code: 'forbidden' })
    if (p === '/api' || p.startsWith('/api/')) {
      if (!PUBLIC_API.some(([m, re]) => m === req.method && re.test(p))) return res.status(403).json({ code: 'forbidden' })
      // One instance per process: a /pill/<name> (private instance) link
      // joins the running instance instead of asking for a free server.
      if (p.replace(/\/$/, '') === '/api/server') {
        const u = new URL(req.url, 'http://localhost')
        u.searchParams.delete('shard')
        req.url = u.pathname + u.search
        delete req.query.shard // already parsed by Express
      }
    }
    next()
  })
  const noStore = (req, res, next) => (res.set('Cache-Control', 'no-store'), next()) // as app.js

  // Avatar/editor uploads (the "Upload VRM" button). Same behaviour as
  // hyperfy-api's route, but the content hash and type are checked (the API
  // joins the client-sent hash into the path) and files go to DATA_DIR/uploads.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } })
  app.post('/api/static-upload', noStore, upload.single('file'), (req, res) => {
    const file = req.file
    const ext = (file?.originalname.split('.').pop() || '').toLowerCase()
    const hash = file && crypto.createHash('sha256').update(file.buffer).digest('hex')
    if (!file || !UPLOAD_TYPES.has(ext) || (req.body?.hash && req.body.hash !== hash)) {
      return res.status(400).json({ code: 'invalid_upload' })
    }
    const name = `${hash}.${ext}`
    const dest = path.join(config.UPLOADS_DIR, name)
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, file.buffer)
    res.status(201).send({ fileUrl: `${config.PUBLIC_URL}/api/static/uploads/${name}` })
  })
  app.use('/api/static', mirror)
  // hyperfy-api parses JSON bodies of up to 200 MB; visitors get 1 MB.
  app.use('/api', express.json({ limit: '1mb' }), noStore, api)
  // Unknown API paths would otherwise fall through to index.html with a 200,
  // which the engine then evaluates as a component script.
  app.use('/api', (req, res) => res.status(404).json({ code: 'not_found' }))
  app.use('/router', noStore, router)

  app.get('/env.js', noStore, (req, res) => {
    const env = {
      PRODUCTION: 'true',
      API_URL: `${config.PUBLIC_URL}/api`,
      R2_URL: '',
      UPLOADS_TARGET: '',
      ENTITIES_TARGET: '',
      DEFAULT_WORLD: SLUG,
      AGORA_APP_ID: '',
      LIVEKIT_URL: process.env.LIVEKIT_URL || '',
      SOCK: '',
      MODE: 'live',
      // mirrored hosts the client hard-codes (site/client-patches.js)
      CDN_URL: `${config.PUBLIC_URL}/api/static`,
      FONTS_URL: `${config.PUBLIC_URL}/fonts.gstatic.com/`,
      // this world (site/overlay.js)
      WORLD_ID: WORLD.id,
      MODES: config.SITE.modes || [],
    }
    res.type('application/javascript').send(`window.env = ${JSON.stringify(env, null, 2)};`)
  })
  for (const [host, dir] of Object.entries(WEB_MIRRORS)) {
    const from = dir ? path.join(config.ROOT, dir, host) : path.join(config.WORLD_DIR, host)
    app.use(`/${host}`, cors, express.static(from, { index: false, maxAge: '365d', immutable: true }))
  }
  for (const file of ['overlay.js', 'loading.js']) {
    app.get(`/local/${file}`, noStore, (req, res) => res.sendFile(path.join(config.ROOT, 'site', file)))
  }
  app.get(`/${patchedName}`, (req, res) => {
    res.type('application/javascript').set('Cache-Control', `public, max-age=${365 * DAY}, immutable`).send(bundle)
  })
  // The unpatched template and bundle are not served.
  app.get(['/index.html', `/${bundleName}`], noStore, (req, res) => res.redirect(301, `/${SLUG}`))
  app.use(express.static(config.CLIENT_DIR, { index: false, maxAge: '1d' }))

  // hyperfy.io/ is Hyperfy's home page; this host serves only the world.
  app.get('/', noStore, (req, res) => res.redirect(302, `/${SLUG}`))
  // index.html with the world's title and preview meta tags (as app.js).
  app.get('*', noStore, async (req, res) => {
    const slug = (req.path.split('/')[1] || '').toLowerCase()
    let meta = {}
    try {
      const resp = await fetch(`${LOCAL_API}/world?slug=${encodeURIComponent(slug)}`)
      if (resp.ok) {
        const world = await resp.json()
        meta = {
          title: getWorldTitle(world) || 'Untitled',
          description: getWorldDescription(world) || 'No description',
          image: getWorldImage(world),
          url: `${config.PUBLIC_URL}/${slug}`,
        }
      }
    } catch (err) {}
    const page = html
      .replace(/{{ title }}/g, meta.title ? `${meta.title} | Hyperfy` : 'Hyperfy')
      .replace(/{{ description }}/g, meta.description || 'Unleash your imagination. Explore and build the metaverse with others, instantly on the web.')
      .replace(/{{ url }}/g, meta.url || `${config.PUBLIC_URL}${req.path}`)
      .replace(/{{ image }}/g, meta.image || `${config.PUBLIC_URL}/logo-opengraph.png`)
    res.type('html').send(page)
  })

  // ---------------------------------------------------------------- listen

  const listen = (target, port, host) => new Promise((resolve, reject) => {
    const l = target.listen(port, host, () => resolve(l))
    l.once('error', reject)
  })
  // "localhost" (the API's and router's address for the game server) can
  // resolve to 127.0.0.1 or ::1.
  const internalListener = await listen(internal, config.INTERNAL_PORT, '127.0.0.1')
  internalListener.on('upgrade', onInternalUpgrade)
  try {
    const v6 = await listen(internal, config.INTERNAL_PORT, '::1')
    v6.on('upgrade', onInternalUpgrade)
  } catch (err) {} // no IPv6 loopback

  const publicListener = await listen(app, config.PORT)
  publicListener.on('upgrade', (req, sock, head) => {
    const url = new URL(req.url, 'http://localhost')
    // Browsers reach the game server through the router, which only proxies
    // to this process's game server.
    if (url.pathname === '/router/gs' && url.searchParams.get('url') === GAME_SERVER) {
      return router.handleUpgrade(req, sock, head)
    }
    sock.destroy()
  })
  await server.ready()
  console.log(`world running at ${config.PUBLIC_URL}/${SLUG}`)
  process.send?.('HYP_READY')
}

start().catch(err => {
  console.error(err)
  process.exit(1)
})
