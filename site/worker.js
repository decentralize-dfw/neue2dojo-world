// Web Worker that runs Hyperfy's own game server (hyperfy-server 2.40.0 with
// hyperfy-engine and PhysX) in the visitor's browser, so the world needs no
// backend. Bundled by tools/build_pages.js into local/server-worker.js.
//
// hyperfy-server is an express app with a `ws` websocket server. Those Node
// modules are replaced (site/shims/) by in-memory versions: express routes are
// called directly, and each browser connection arrives over a MessagePort.
// API requests the server makes are answered by the page (site/backend.js),
// which holds the visitor's account.

let apiUrl = null
let apiSeq = 0
const apiPending = new Map()

// hyperfy-server/engine call the API with fetch; send those to the page.
const realFetch = self.fetch.bind(self)
self.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url
  if (!apiUrl || !url.startsWith(apiUrl)) return realFetch(input, init)
  const id = ++apiSeq
  const headers = {}
  new Headers(init.headers || {}).forEach((v, k) => (headers[k] = v))
  self.postMessage({ type: 'api', id, method: init.method || 'GET', url, headers, body: init.body ?? null })
  return new Promise(resolve => apiPending.set(id, resolve)).then(
    r => new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json' } })
  )
}

// The server side of one websocket, backed by a MessagePort. Implements the
// parts of a `ws` WebSocket that hyperfy-server uses.
class PortSocket {
  constructor(port) {
    this.port = port
    this.listeners = {}
    this.closed = false
    port.onmessage = e => {
      const msg = e.data
      if (msg.t === 'msg') this.emit('message', msg.d, false)
      if (msg.t === 'close') this.shutdown(msg.code)
    }
  }
  on(event, fn) {
    ;(this.listeners[event] ||= []).push(fn)
    return this
  }
  emit(event, ...args) {
    for (const fn of this.listeners[event] || []) fn(...args)
  }
  send(data) {
    if (!this.closed) this.port.postMessage({ t: 'msg', d: data })
  }
  // The server pings every 10 s and drops sockets that do not answer.
  ping() {
    setTimeout(() => this.emit('pong'), 0)
  }
  close(code = 1000) {
    if (this.closed) return
    this.port.postMessage({ t: 'close', code })
    this.shutdown(code)
  }
  terminate() {
    this.close(1006)
  }
  shutdown(code) {
    if (this.closed) return
    this.closed = true
    this.port.close()
    this.emit('close', code)
  }
}

let app = null

async function init({ apiUrl: url, r2Url }) {
  apiUrl = url
  const { createApp } = require('hyperfy-server')
  app = await createApp({
    useAgones: 'false',
    apiUrl: url,
    r2Url,
    entitiesTarget: 'r2',
    port: 0,
  })
  await app.ready()
}

// POST /server/start, as hyperfy-api sends it.
function start(world, shard) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code
        return this
      },
      send(body) {
        resolve({ status: this.statusCode, body })
      },
    }
    app.routes.POST['/start']({ body: { world, shard } }, res)
  })
}

self.onmessage = async e => {
  const msg = e.data
  try {
    if (msg.type === 'init') {
      await init(msg)
      self.postMessage({ type: 'ready' })
    }
    if (msg.type === 'start') {
      const result = await start(msg.world, msg.shard)
      self.postMessage({ type: 'started', id: msg.id, result })
    }
    if (msg.type === 'connect') {
      app.handleUpgrade({ url: '/server', headers: {} }, new PortSocket(msg.port), null)
      msg.port.postMessage({ t: 'open' })
    }
    if (msg.type === 'api-response') {
      apiPending.get(msg.id)?.(msg)
      apiPending.delete(msg.id)
    }
  } catch (err) {
    console.error('[hyperfy worker]', err)
    self.postMessage({ type: 'error', id: msg.id, message: String(err?.stack || err) })
  }
}
