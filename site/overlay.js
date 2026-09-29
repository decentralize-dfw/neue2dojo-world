// Interface added on top of Hyperfy's client (whose chat panel is removed in
// site/client-patches.js). Loaded by index.html after the client.
//
//   - Subtitles: chat messages (the show's lines from trigger actions)
//     appear centred near the bottom of the page.
//   - Mode buttons on the left (e.g. Cinematic and Immersive) run the world's
//     commands for its show modes (site.json). They hide while the show runs
//     and come back when its action list has finished (the sum of its waits).
;(function () {
  const MODES = window.env.MODES || [] // [label, command] pairs from the world's site.json
  const MAX_LINES = 3
  const JOIN_LEAVE = / (joined|left)\.$/ // the game server's presence messages

  const style = document.createElement('style')
  style.textContent = `
    .hyp-subtitles {
      position: fixed;
      left: 50%;
      bottom: calc(96px + env(safe-area-inset-bottom));
      transform: translateX(-50%);
      width: min(900px, calc(100vw - 32px));
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      pointer-events: none;
      z-index: 10;
    }
    .hyp-subtitles div {
      max-width: 100%;
      padding: 6px 14px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      font-family: NeueHaasGroteskDP, system-ui, sans-serif;
      font-size: clamp(16px, 2vw, 24px);
      line-height: 1.35;
      text-align: center;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
      transition: opacity 0.6s;
    }
    .hyp-subtitles div.out {
      opacity: 0;
    }
    .hyp-modes {
      position: fixed;
      left: calc(20px + env(safe-area-inset-left));
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      flex-direction: column;
      gap: 12px;
      z-index: 10;
      transition: opacity 0.4s;
    }
    .hyp-modes.hidden {
      opacity: 0;
      pointer-events: none;
    }
    .hyp-modes button {
      height: 48px;
      padding: 0 22px;
      border: 1px solid transparent;
      border-radius: 24px;
      background: rgba(0, 0, 0, 0.3);
      color: #fff;
      font-family: NeueHaasGroteskDP, system-ui, sans-serif;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    .hyp-modes button:hover {
      background: rgba(22, 22, 28, 1);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      border-color: rgba(255, 255, 255, 0.03);
    }
  `
  document.head.appendChild(style)

  const subtitles = document.createElement('div')
  subtitles.className = 'hyp-subtitles'
  const modes = document.createElement('div')
  modes.className = 'hyp-modes hidden'
  document.body.append(subtitles, modes)

  function show(msg) {
    if (!msg || !msg.text) return
    if (!msg.from && JOIN_LEAVE.test(msg.text)) return
    const line = document.createElement('div')
    line.textContent = msg.from ? `${msg.from}: ${msg.text}` : msg.text
    subtitles.appendChild(line)
    while (subtitles.children.length > MAX_LINES) subtitles.firstChild.remove()
    // Long enough to read: ~70 ms per character, 3-10 s.
    const ms = Math.min(10000, Math.max(3000, line.textContent.length * 70))
    setTimeout(() => line.classList.add('out'), ms)
    setTimeout(() => line.remove(), ms + 600)
  }

  // How long a command's action list runs: only its waits take time.
  function duration(engine, cmd) {
    const entity = engine.entities.list.find(e => e.id === 'hyperfy-command' && e.state?.$fields?.cmd === '/' + cmd)
    const actions = entity?.state.$fields.$onuse || []
    return actions.reduce((s, a) => s + (a.type === 'wait' ? parseFloat(a.seconds) || 0 : 0), 0)
  }

  function start(engine) {
    engine.chat.subscribe(messages => messages.forEach(show))

    let timer = null
    for (const [label, cmd] of MODES) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.addEventListener('click', () => {
        modes.classList.add('hidden')
        engine.chat.callCommand(cmd, [])
        if (!engine.driver.touchControls?.enabled) engine.driver.desktopControls.requestPointerLock()
        clearTimeout(timer)
        timer = setTimeout(() => modes.classList.remove('hidden'), (duration(engine, cmd) + 1) * 1000)
      })
      modes.appendChild(button)
    }
    if (MODES.length) modes.classList.remove('hidden')
  }

  // window.e is Hyperfy's engine; wait until the visitor is in the world.
  const wait = setInterval(() => {
    const engine = window.e
    if (engine?.chat?.subscribe && engine.driver?.avatarEntity) {
      clearInterval(wait)
      start(engine)
    }
  }, 200)
})()
