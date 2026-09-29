// Stand-in for `ws`: hyperfy-server hands upgrades to WebSocketServer, which
// here just passes on the socket the worker created.
const EventEmitter = require('eventemitter3')

class WebSocketServer extends EventEmitter {
  handleUpgrade(req, socket, head, callback) {
    callback(socket)
  }
}
module.exports = { WebSocketServer, Server: WebSocketServer }
