// In-memory stand-in for express as used by hyperfy-server: routes are
// recorded so the worker can call them directly.
function express() {
  const app = {
    routes: { GET: {}, POST: {} },
    use() {},
    get(path, fn) {
      app.routes.GET[path] = fn
    },
    post(path, fn) {
      app.routes.POST[path] = fn
    },
    listen() {
      throw new Error('express shim: listen is not available in the browser')
    },
  }
  return app
}
express.json = () => (req, res, next) => next()
express.static = () => (req, res, next) => next()
module.exports = express
module.exports.default = express
