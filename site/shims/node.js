// Node built-ins and server-only packages hyperfy-server requires at load
// time but never uses in this setup (the bundled node-fetch, compression,
// cors, dotenv, Agones, LiveKit/Agora token builders, os stats).
class Stub {}
const noopMiddleware = () => (req, res, next) => next()
module.exports = new Proxy(noopMiddleware, {
  get(target, key) {
    if (key === '__esModule') return false
    if (key === 'default') return module.exports
    if (key === 'performance') return globalThis.performance
    if (key === 'STATUS_CODES' || key === 'constants') return {}
    if (typeof key === 'string' && /^[A-Z]/.test(key)) return Stub
    return noopMiddleware
  },
})
