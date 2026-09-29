// Loading changes on top of Hyperfy's client (see site/client-patches.js for
// the hooks it relies on). Loaded by index.html before the client.
//
// Audio. The engine's audio node downloads and decodes its whole file as soon
// as it mounts (preload, the default), and the engine keeps every decoded
// buffer. hatch mounts 35 tracks: 230 MB of mp3 that decode to about 3.7 GB
// of PCM, all during the loading screen. Instead:
//   - Nothing loads before the world is running.
//   - Then tracks are decoded in the background, up to a memory budget, and
//     the remaining files are downloaded into the HTTP cache.
//   - A track gets its buffer when it is cued: for hyperfy-audio, when its
//     synced state says it is playing. Its ready() callbacks wait until then,
//     as they would for a preload in progress; hyperfy-audio then starts it at
//     the position the server's clock gives. Tracks cued together get their
//     buffers in the same task, so they start sample-aligned, as when
//     everything was preloaded. A pre-decoded track starts at once; any other
//     starts after decoding, still in sync with the show.
//   - Over the budget, decoded tracks that have not played or been cued for
//     a while give their memory back, oldest first.
//   - Other audio nodes (e.g. a smart object's stage sound) are cued as soon
//     as the world is running.
//
// Models. Smart objects preload the models of their later stages, and the
// loading screen waits for those too: most of the models a world downloads
// before it opens (balloon: 99 of 103 MB) are for stages that only appear
// later in the show. Those preloads now run once the world is running; the
// models on show load as before. A stage reached before its model has
// loaded shows the model once it arrives.
//
// Graphics. Shader programs compile without a blocking status check, and the
// visitor's avatar model downloads while they compile (see below).
;(function () {
  // Decoded audio kept in memory. Worlds under it (Why We Exist: ~0.9 GB)
  // end up fully decoded, as before.
  const BUDGET = Math.min(1200, (navigator.deviceMemory || 4) * 150) * 1e6
  const IDLE = 10 * 1000 // ms without playing or a cue before a track may be released
  const PREFETCH_AT_ONCE = 2
  const PRELOAD_AT_ONCE = 4
  const TICK = 250 // ms

  const cdn = url => (url.startsWith('https://data.hyperfy.xyz/') ? window.env.CDN_URL + '/' + url.slice(25) : url)

  // ------------------------------------------------------------ audio

  let audio = null // the engine's audio system: load(url), cache[url] = AudioBuffer
  let running = false
  const waiting = new Set() // mounted nodes without their buffer (ready() callbacks queued)
  const active = new Set() // nodes given their buffer
  const decoding = new Map() // url -> promise
  const lastUsed = new Map() // url -> ms
  const warmed = new Set() // urls decoded in the background once (never again)

  const urlOf = node => node.entity.getAssetUrl(node.src)
  const mounted = node => !!node.audio
  const bytes = buffer => buffer.length * buffer.numberOfChannels * 4
  const usage = () => Object.values(audio.cache).reduce((sum, buffer) => sum + bytes(buffer), 0)
  const busy = node => node.loading || node.audio.isPlaying || cued(node)

  // hyperfy-audio keeps its play state (action, start time, offset) in its
  // synced entity state; a track is cued while that says it is playing and
  // has not run past its end. Any other audio node plays when it is mounted
  // (smart objects set autoplay).
  function cued(node) {
    if (node.entity.id !== 'hyperfy-audio') return true
    const state = node.entity.state
    if (state?.action !== 'play') return false
    const duration = node.audio.buffer?.duration || audio.cache[urlOf(node)]?.duration || node.hypDuration
    if (node.loop || !duration) return true
    return node.engine.serverTime - state.time + (state.offset || 0) < duration
  }

  window.hypAudio = {
    // Replaces node.load() for preloading audio nodes (onMount / onModify).
    defer(node) {
      node.loading = true
      node.loaded = false
      active.delete(node)
      waiting.add(node)
      if (!audio) {
        audio = node.engine.audio
        startPreloads(node.engine) // background audio waits for the preloads
        node.engine.driver.running.then(() => {
          running = true
          setInterval(tick, TICK)
          tick()
          preloaded.then(prefetch)
        })
      }
    },
    // A script is waiting on a node's ready(): its track may just have been cued.
    poke() {
      if (running) tick()
    },
  }

  function decode(url) {
    if (audio.cache[url]) return Promise.resolve(audio.cache[url])
    if (!decoding.has(url)) {
      const promise = audio.load(url).finally(() => decoding.delete(url))
      decoding.set(url, promise)
    }
    return decoding.get(url)
  }

  function tick() {
    const now = performance.now()

    const batch = []
    for (const node of waiting) {
      if (!mounted(node)) waiting.delete(node)
      else if (cued(node)) {
        waiting.delete(node)
        batch.push(node)
      }
    }
    if (batch.length) give(batch)

    for (const node of active) {
      if (!mounted(node)) active.delete(node)
      else if (busy(node)) lastUsed.set(urlOf(node), now)
    }

    let used = usage()
    while (used > BUDGET) {
      const url = oldestIdle(now)
      if (!url) break
      used -= bytes(audio.cache[url])
      release(url)
    }

    if (preloadsDone && !decoding.size && used < BUDGET * 0.9) {
      for (const node of waiting) {
        const url = mounted(node) && urlOf(node)
        if (url && !audio.cache[url] && !warmed.has(url)) {
          warmed.add(url)
          decode(url).then(() => lastUsed.set(url, performance.now()), () => {})
          break
        }
      }
    }
  }

  // Buffers for tracks cued together, handed over in one task.
  async function give(batch) {
    await Promise.all(batch.map(node => decode(urlOf(node)).catch(err => console.error('audio failed to load', urlOf(node), err))))
    for (const node of batch) {
      if (!mounted(node)) continue
      active.add(node)
      lastUsed.set(urlOf(node), performance.now())
      node.load() // finds the buffer in the engine's cache
    }
  }

  function oldestIdle(now) {
    let oldest = null
    for (const url of Object.keys(audio.cache)) {
      const users = [...waiting, ...active].filter(node => mounted(node) && urlOf(node) === url)
      if (!users.length || users.some(node => active.has(node) && busy(node))) continue
      const last = lastUsed.get(url) || 0
      if (now - last > IDLE && (!oldest || last < lastUsed.get(oldest))) oldest = url
    }
    return oldest
  }

  function release(url) {
    delete audio.cache[url]
    lastUsed.delete(url)
    for (const node of [...active]) {
      if (urlOf(node) !== url) continue
      node.hypDuration = node.audio.buffer?.duration
      node.audio.setBuffer(null)
      node.loading = true
      node.loaded = false
      active.delete(node)
      waiting.add(node)
    }
  }

  // Background download of the files not decoded yet, into the HTTP cache.
  async function prefetch() {
    const seen = new Set()
    const next = () => {
      for (const node of waiting) {
        const url = mounted(node) && urlOf(node)
        if (url && !seen.has(url) && !audio.cache[url] && !decoding.has(url)) {
          seen.add(url)
          return cdn(url)
        }
      }
      return null
    }
    const worker = async () => {
      for (let url = next(); url; url = next()) {
        try {
          const res = await fetch(url, { priority: 'low' })
          await res.arrayBuffer()
        } catch (err) {}
      }
    }
    await Promise.all(Array.from({ length: PREFETCH_AT_ONCE }, worker))
  }

  // ------------------------------------------------------------ preloads

  const preloadQueue = []
  let preloading = 0
  let preloadsLive = false
  let preloadsDone = false
  let donePreloading
  const preloaded = new Promise(resolve => (donePreloading = resolve)).then(() => (preloadsDone = true))

  // Replaces node.load() when a preload node mounts.
  window.hypPreload = node => {
    preloadQueue.push(node)
    startPreloads(node.engine)
    pumpPreloads()
  }

  let preloadsHooked = false
  function startPreloads(engine) {
    if (preloadsHooked) return
    preloadsHooked = true
    engine.driver.running.then(() => {
      preloadsLive = true
      pumpPreloads()
    })
  }

  function pumpPreloads() {
    if (!preloadsLive) return
    while (preloading < PRELOAD_AT_ONCE && preloadQueue.length) {
      const node = preloadQueue.shift()
      if (node.hypGone) continue // unmounted while waiting
      preloading++
      Promise.resolve()
        .then(() => node.load())
        .catch(err => console.error('preload failed', node.src, err))
        .finally(() => {
          preloading--
          pumpPreloads()
        })
    }
    if (!preloading && !preloadQueue.length) donePreloading()
  }

  // ------------------------------------------------------------ graphics

  const hookGraphics = setInterval(() => {
    const graphics = window.e?.graphics
    const driver = window.e?.driver
    if (!graphics?.renderer || !driver) return
    clearInterval(hookGraphics)
    // three.js checks every shader program's link status right after linking,
    // which makes the GPU process compile them one at a time. Without the
    // check they compile in parallel where the browser can; only the error
    // log is lost.
    graphics.renderer.debug.checkShaderErrors = false
    // The loading screen's last steps are compiling every shader (a long
    // task on the main thread) and then loading the visitor's avatar. The
    // avatar model downloads during the compile instead, from a worker so the
    // busy main thread does not stall it; the avatar then loads from the HTTP
    // cache.
    const compile = graphics.compile
    graphics.compile = function () {
      warmAvatar(driver)
      return compile.apply(this, arguments)
    }
  }, 20)

  function warmAvatar(driver) {
    let src = null
    try {
      src = JSON.parse(driver.account?.avatarState || 'null')?.src
    } catch (err) {}
    const url = new URL(cdn(src || 'https://data.hyperfy.xyz/core/hyperbot-v2.vrm'), document.baseURI).href
    if (url.includes('/__uploads/')) return // an upload kept in this browser (site/backend.js)
    try {
      const code = `fetch(${JSON.stringify(url)}).then(r => r.arrayBuffer()).catch(() => {}).then(() => close())`
      new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })))
    } catch (err) {}
  }
})()
