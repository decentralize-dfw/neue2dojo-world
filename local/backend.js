// Backend for the static (GitHub Pages) build of the world, loaded by
// index.html right after env.js and before Hyperfy's client.
//
// Hyperfy's client talks to hyperfy-api over fetch and to the game server over
// a WebSocket. Here the API is answered in the page (the visitor's guest
// account lives in localStorage, uploaded avatars in IndexedDB) and the game
// server is Hyperfy's own hyperfy-server running in a Web Worker
// (local/server-worker.js). Each visitor gets their own instance of the world,
// which starts fresh on every visit, like an instance on hyperfy.io.
;(function () {
  const BASE = new URL('.', document.baseURI).href // the world's folder (<base href>)
  const SHARED = new URL('../', document.currentScript.src).href // the site's shared client/ and local/
  const API = window.env.API_URL
  const R2 = window.env.R2_URL
  const WORLD_FILE = BASE + `api.hyperfy.io/worlds/${window.env.WORLD_ID}.json`
  const ENTITY_META = BASE + 'api.hyperfy.io/entities/'
  const AVATAR_VERSION = 4 // hyperfy-avatar version hyperfy.io serves to visitors
  const UPLOADS = BASE + '__uploads/'
  const SERVER_URL = 'ws://hyperfy.local/server'
  // Hosts the client and components hard-code, mirrored under BASE.
  const MIRRORS = ['https://data.hyperfy.xyz/', 'https://fonts.gstatic.com/']

  // hyperfy.io/ is Hyperfy's home page; the world lives at /<slug>. On a
  // project site (/whyweexist/) the first path segment already is the slug.
  if (!location.pathname.split('/')[1]) history.replaceState(null, '', '/' + window.env.DEFAULT_WORLD + location.search)
  const SLUG = location.pathname.split('/')[1]

  const realFetch = window.fetch.bind(window)
  const mirror = url => {
    for (const host of MIRRORS) {
      if (url.startsWith(host)) return BASE + host.slice('https://'.length) + url.slice(host.length)
    }
    return null
  }
  const localize = text => MIRRORS.reduce((t, host) => t.split(host).join(mirror(host)), text)

  // ------------------------------------------------------------ storage

  const store = {
    read() {
      try {
        return JSON.parse(localStorage.getItem('hyperfy-local:accounts')) || {}
      } catch (err) {
        return {}
      }
    },
    write(accounts) {
      try {
        localStorage.setItem('hyperfy-local:accounts', JSON.stringify(accounts))
      } catch (err) {}
    },
  }

  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('hyperfy-local', 1)
      open.onupgradeneeded = () => open.result.createObjectStore('uploads')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const tx = open.result.transaction('uploads', mode)
        const req = fn(tx.objectStore('uploads'))
        tx.oncomplete = () => resolve(req.result)
        tx.onerror = () => reject(tx.error)
      }
    })
  }

  // ------------------------------------------------------------ data

  let worldPromise = null
  function loadWorld() {
    worldPromise ||= realFetch(WORLD_FILE)
      .then(r => r.text())
      .then(text => {
        const world = JSON.parse(localize(text))
        world.slug = SLUG
        return world
      })
    return worldPromise
  }

  const metaCache = {}
  async function entityInfo(id) {
    const world = await loadWorld()
    const versions = { 'hyperfy-avatar': AVATAR_VERSION }
    for (const e of JSON.parse(world.entities)) versions[e.id] = Math.max(versions[e.id] || 0, e.version)
    if (!versions[id]) return null
    metaCache[id] ||= realFetch(ENTITY_META + id + '.json').then(r => (r.ok ? r.json() : null))
    const meta = await metaCache[id]
    return meta && { ...meta, version: versions[id], secrets: null }
  }

  // ------------------------------------------------------------ game server

  let worker = null
  let server = null
  let workerSeq = 0
  const workerPending = new Map()

  function workerCall(msg) {
    const id = ++workerSeq
    return new Promise((resolve, reject) => {
      workerPending.set(id, { resolve, reject })
      worker.postMessage({ ...msg, id })
    })
  }

  function startWorker() {
    worker = new Worker(SHARED + 'local/server-worker.js')
    const ready = new Promise((resolve, reject) => {
      worker.onmessage = async e => {
        const msg = e.data
        if (msg.type === 'ready') resolve()
        if (msg.type === 'started') workerPending.get(msg.id)?.resolve(msg.result)
        if (msg.type === 'error') {
          console.error('[hyperfy worker]', msg.message)
          if (workerPending.has(msg.id)) workerPending.get(msg.id).reject(new Error(msg.message))
          else reject(new Error(msg.message))
        }
        // The game server's own API calls (entity info, account lookups, ...).
        if (msg.type === 'api') {
          const res = await api(msg.method, msg.url, msg.headers, msg.body)
          worker.postMessage({ type: 'api-response', id: msg.id, ...res })
        }
      }
      worker.onerror = e => reject(e)
    })
    worker.postMessage({ type: 'init', apiUrl: API, r2Url: R2 })
    return ready
  }

  // GET /server: load the world into the game server on first use.
  function gameServer() {
    server ||= (async () => {
      const world = await loadWorld()
      await startWorker()
      const shard = '~' + Math.random().toString(36).slice(2, 6)
      const result = await workerCall({ type: 'start', world, shard })
      if (result.status !== 200) throw new Error('world failed to start')
      const now = new Date().toISOString()
      return { id: 'local', ip: null, port: null, worldId: world.id, shard, clients: 0, createdAt: now, updatedAt: now, url: SERVER_URL }
    })()
    return server
  }

  // ------------------------------------------------------------ API

  class ApiError extends Error {}
  const fail = code => {
    throw new ApiError(code)
  }

  function account(headers) {
    const token = headers['x-auth-token'] || ''
    const id = token.startsWith('local:') ? token.slice(6) : null
    const acc = id && store.read()[id]
    return acc || null
  }

  const routes = [
    ['POST', /^\/guest$/, () => {
      const accounts = store.read()
      const id = crypto.randomUUID().replace(/-/g, '').slice(0, 21)
      const now = new Date().toISOString()
      accounts[id] = { id, name: 'Anonymous', imageUrl: null, address: null, signature: null, avatarState: null, guardian: false, createdAt: now, updatedAt: now }
      store.write(accounts)
      return { authToken: 'local:' + id }
    }],
    ['GET', /^\/account$/, ({ acc }) => acc || fail('unauthorized')],
    ['PUT', /^\/account$/, ({ acc, body }) => {
      if (!acc) fail('unauthorized')
      const accounts = store.read()
      for (const key of ['name', 'imageUrl', 'avatarState']) if (body && key in body) acc[key] = body[key]
      acc.updatedAt = new Date().toISOString()
      accounts[acc.id] = acc
      store.write(accounts)
      return acc
    }],
    ['GET', /^\/entities\/([^/]+)$/, async ({ match }) => (await entityInfo(decodeURIComponent(match[1]))) || fail('not_found')],
    ['GET', /^\/entities$/, async () => {
      const world = await loadWorld()
      const ids = [...new Set(JSON.parse(world.entities).map(e => e.id))]
      return (await Promise.all(ids.map(entityInfo))).filter(e => e && e.public)
    }],
    ['GET', /^\/world$/, () => loadWorld()],
    ['GET', /^\/worlds\/([^/]+)$/, () => loadWorld()],
    ['GET', /^\/worlds$/, async () => [await loadWorld()]],
    ['GET', /^\/server$/, () => gameServer()],
    ['PUT', /^\/servers$/, () => null],
    ['POST', /^\/events$/, () => null],
    ['GET', /^\/(collaborators|servers|world-events|nfts|accounts)$/, () => []],
  ]

  // Answers one API request with hyperfy-api's response format.
  async function api(method, url, headers, rawBody) {
    const u = new URL(url)
    const path = u.pathname.slice(new URL(API).pathname.length)
    const lower = {}
    for (const [k, v] of Object.entries(headers || {})) lower[k.toLowerCase()] = v
    let body = null
    try {
      body = rawBody ? JSON.parse(rawBody) : null
    } catch (err) {}
    for (const [m, re, fn] of routes) {
      const match = path.match(re)
      if (m !== method || !match) continue
      try {
        const result = await fn({ match, query: u.searchParams, body, acc: account(lower) })
        return { status: 200, body: JSON.stringify(result ?? { success: true }) }
      } catch (err) {
        if (err instanceof ApiError) return { status: 400, body: JSON.stringify({ code: err.message }) }
        console.error('[hyperfy api]', method, path, err)
        return { status: 500, body: JSON.stringify({ code: 'internal_error' }) }
      }
    }
    return { status: 400, body: JSON.stringify({ code: 'not_found' }) }
  }

  // "Upload VRM" in the avatar menu (POST /static-upload with a file).
  async function upload(form) {
    const file = form.get('file')
    const ext = String(file?.name || '').split('.').pop().toLowerCase()
    if (!file || !/^[a-z0-9]{1,10}$/.test(ext)) return { status: 400, body: JSON.stringify({ code: 'invalid_upload' }) }
    let hash = form.get('hash')
    if (!/^[a-f0-9]{64}$/.test(hash || '')) {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
      hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
    }
    const name = `${hash}.${ext}`
    await idb('readwrite', s => s.put(file, name))
    return { status: 201, body: JSON.stringify({ fileUrl: UPLOADS + name }) }
  }

  // ------------------------------------------------------------ fetch

  window.fetch = async function (input, init = {}) {
    const req = input instanceof Request ? input : null
    const url = new URL(req ? req.url : String(input), document.baseURI).href
    if (url === API || url.startsWith(API + '/') || url.startsWith(API + '?')) {
      if (init.body instanceof FormData) {
        const res = await upload(init.body)
        return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } })
      }
      const headers = {}
      new Headers(init.headers || req?.headers || {}).forEach((v, k) => (headers[k] = v))
      const res = await api(init.method || req?.method || 'GET', url, headers, init.body ?? null)
      return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.startsWith(UPLOADS)) {
      const blob = await idb('readonly', s => s.get(url.slice(UPLOADS.length)))
      return blob ? new Response(blob) : new Response('', { status: 404 })
    }
    const mirrored = mirror(url)
    if (mirrored) return realFetch(req ? new Request(mirrored, req) : mirrored, init)
    return realFetch(input, init)
  }

  // ------------------------------------------------------------ WebSocket

  // The browser end of a connection to the game server in the worker.
  class LocalSocket extends EventTarget {
    constructor(url) {
      super()
      this.url = url
      this.readyState = 0
      this.protocol = ''
      this.extensions = ''
      this.binaryType = 'blob'
      this.bufferedAmount = 0
      this.onopen = this.onmessage = this.onclose = this.onerror = null
      gameServer().then(
        () => {
          const channel = new MessageChannel()
          this.port = channel.port1
          this.port.onmessage = e => this.receive(e.data)
          worker.postMessage({ type: 'connect', port: channel.port2 }, [channel.port2])
        },
        () => {
          this.fire(new Event('error'))
          this.closed(1011)
        }
      )
    }
    receive(msg) {
      if (msg.t === 'open') {
        this.readyState = 1
        this.fire(new Event('open'))
      }
      if (msg.t === 'msg') this.fire(new MessageEvent('message', { data: msg.d }))
      if (msg.t === 'close') this.closed(msg.code)
    }
    fire(event) {
      this['on' + event.type]?.call(this, event)
      this.dispatchEvent(event)
    }
    send(data) {
      if (this.readyState !== 1) throw new DOMException('WebSocket is not open', 'InvalidStateError')
      this.port.postMessage({ t: 'msg', d: data })
    }
    close(code = 1000) {
      if (this.readyState >= 2) return
      this.port?.postMessage({ t: 'close', code })
      this.closed(code)
    }
    closed(code) {
      if (this.readyState === 3) return
      this.readyState = 3
      this.fire(new CloseEvent('close', { code, wasClean: code === 1000 }))
    }
  }
  for (const [i, name] of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].entries()) {
    LocalSocket[name] = LocalSocket.prototype[name] = i
  }

  const RealWebSocket = window.WebSocket
  window.WebSocket = class WebSocket extends RealWebSocket {
    constructor(url, protocols) {
      if (String(url).startsWith(SERVER_URL)) return new LocalSocket(String(url))
      super(url, protocols)
    }
  }
})()
