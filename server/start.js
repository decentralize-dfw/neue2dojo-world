// Entry point (npm start): seeds the database, runs server/world.js and
// supervises it.
//
// On hyperfy.io a world instance shuts down 10 seconds after its last visitor
// leaves, so the next visitor gets the show from the beginning (smart objects
// at stage 1, audio stopped, flags and chat cleared). The SDK game server
// never unloads a world, so this restarts it the same way. It is also
// restarted if it crashes.
const path = require('path')
const { fork } = require('child_process')
const seed = require('./seed')

const EMPTY_SHUTDOWN = 10 * 1000 // after the last visitor leaves
const UNUSED_SHUTDOWN = 60 * 1000 // world loaded but nobody joined
const RETRY = 5 * 1000 // after a failed seed

let child = null
let stopping = false

function run() {
  if (stopping) return process.exit(0)
  try {
    const info = seed()
    console.log(`seeded ${info.world} (/${info.slug}, ${info.components} components)`)
  } catch (err) {
    console.error('seeding failed, retrying:', err.message)
    return setTimeout(run, RETRY)
  }
  const current = (child = fork(path.join(__dirname, 'world.js'), { stdio: 'inherit' }))
  let timer = null
  let clients = 0
  const resetIn = ms => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      console.log('world is empty, resetting the instance')
      current.kill('SIGTERM')
    }, ms)
  }

  current.on('message', msg => {
    if (msg?.type === 'world-start' && clients === 0) resetIn(UNUSED_SHUTDOWN)
    if (msg?.type === 'clients') {
      clients = msg.count
      if (clients > 0) clearTimeout(timer)
      else resetIn(EMPTY_SHUTDOWN)
    }
  })
  current.on('exit', (code, signal) => {
    clearTimeout(timer)
    child = null
    if (stopping) return process.exit(0)
    if (signal !== 'SIGTERM') console.error(`world server exited (${signal || code}), restarting`)
    setTimeout(run, 1000)
  })
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true
    if (child && child.exitCode === null) child.kill('SIGTERM')
    else process.exit(0)
  })
}

run()
