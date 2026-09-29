#!/usr/bin/env node
// Builds the static site (GitHub Pages) that runs each mirrored world in the
// browser with Hyperfy's own client and game server (hyperfy-client and
// hyperfy-server 2.40.0, MIT).
//
// Each world folder (whyweexist/, hatch/, ...) holds a world mirrored by
// tools/hyperfy_mirror.py plus a site.json, and gets:
//
//   index.html            the client's page (<base href> = the world's folder)
//   env.js                the client's settings (live-site values) + this world
//
// Shared by all worlds, at the site root:
//
//   client/               the hyperfy-client build, asset paths adjusted
//   local/backend.js      API + game-server connection in the page (site/backend.js)
//   local/overlay.js      subtitles and mode buttons (site/overlay.js)
//   local/loading.js      audio and model loading order (site/loading.js)
//   local/server-worker.js  hyperfy-server + engine + PhysX, bundled for a Web Worker
//   cdn.jsdelivr.net/ ... third-party scripts hyperfy.io's page loads (site/web/)
//   index.html            redirects to the first world
//   404.html              sends deep links back to their world
//   .nojekyll
//
// site.json: { "modes": [["Label", "command"], ...] } buttons for the
// world's show modes (see site/overlay.js); [] for none.
//
// The site's URL and its worlds are listed in pages.json.
//
// usage: node tools/build_pages.js                 (npm run build:pages)
//        SITE_URL=https://example.com/ node tools/build_pages.js
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')
const { patchClient } = require('../site/client-patches')

const ROOT = path.join(__dirname, '..')
// pages.json: { "site": "<the site's URL>", "worlds": ["<folder>", ...] }; the
// first world is the site's front page.
const PAGES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pages.json'), 'utf8'))
const WORLDS = PAGES.worlds
const SITE_URL = (process.env.SITE_URL || PAGES.site).replace(/\/*$/, '/')
const CLIENT_BUILD = path.join(path.dirname(require.resolve('hyperfy-client/package.json')), 'build')
const BUILD = path.join(ROOT, 'node_modules/.cache/pages') // shared outputs, copied into each world
const root = (...p) => path.join(ROOT, ...p)

function replaceAll(text, from, to, { min = 1, label = from } = {}) {
  const count = text.split(from).length - 1
  if (count < min) throw new Error(`expected "${label}" (found ${count})`)
  return text.split(from).join(to)
}

// hyperfy-client's build with the patched bundle (shared by all worlds).
function buildClient() {
  const dir = path.join(BUILD, 'client')
  fs.rmSync(dir, { recursive: true, force: true })
  // Not copied: index.html (built per world) and the .fbx / .json versions of
  // the avatar animations, which the client does not load (it uses the .glb).
  const unused = src => path.basename(src) === 'index.html' || /\.fbx$|^avatar@.*\.json$/.test(path.basename(src))
  fs.cpSync(CLIENT_BUILD, dir, { recursive: true, filter: src => !unused(src) })

  const bundleName = fs.readdirSync(CLIENT_BUILD).find(f => /^app\.[a-f0-9]+\.js$/.test(f))
  const js = fs.readFileSync(path.join(CLIENT_BUILD, bundleName), 'utf8')
  // Root-absolute paths of files in the client build, made relative to <base>
  // (the world's folder); the client build is shared at the site root.
  const paths = [
    '/avatar@', '/sky.hdr', '/waternormals.jpg', '/vipe-logo.png', '/three-mesh-ui/', '/reticle.png',
    '/reticle-active.png', '/particles.js', '/particle-2.png', '/icon-primary-', '/draco/gltf/',
  ].map(p => [`"${p}`, `"../client${p}`])
  paths.push([`'/bg-grid.png'`, `'../client/bg-grid.png'`], ['setTranscoderPath("/")', 'setTranscoderPath("../client/")'])
  // Every visitor has their own instance here, so the URL keeps the world's
  // address instead of becoming /<first path segment>/<instance>.
  paths.push(['t.pathname=e?`/${n}/${e}`:`/${n}`,window.history.replaceState(null,"",t)', 'void 0'])
  fs.writeFileSync(path.join(dir, bundleName), patchClient(js, { paths }))

  const manifest = fs.readFileSync(path.join(CLIENT_BUILD, 'manifest.json'), 'utf8')
  fs.writeFileSync(path.join(dir, 'manifest.json'), manifest.split('"/').join('"'))
  return bundleName
}

// hyperfy-server + engine + PhysX for a Web Worker (shared by all worlds).
async function buildWorker() {
  const dir = path.join(BUILD, 'local')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const shim = name => root('site/shims', name)
  const nodeOnly = ['dotenv/config', 'perf_hooks', 'compression', 'cors', '@google-cloud/agones-sdk', 'livekit-server-sdk',
    'agora-access-token', 'node-os-utils', 'stream', 'http', 'https', 'url', 'zlib', 'punycode', 'encoding', 'fs', 'path']
  await esbuild.build({
    entryPoints: [root('site/worker.js')],
    outfile: path.join(dir, 'server-worker.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
    define: { global: 'globalThis', 'process.env.LIB': '"true"', 'process.env.NODE_ENV': '"production"' },
    inject: [shim('process.js')],
    plugins: [{
      // hyperfy-engine assigns to a const in its invalid-tone-mapping error
      // path, which esbuild rejects.
      name: 'engine-const-fix',
      setup(build) {
        build.onLoad({ filter: /hyperfy-engine[\\/]build[\\/]bundle\.cjs\.js$/ }, args => {
          const code = fs.readFileSync(args.path, 'utf8')
          const from = 'const t=ze[e];n.isNumber(t)||(console.error("ToneMapping invalid:",e),t=qe)'
          if (!code.includes(from)) throw new Error('hyperfy-engine tone mapping code not found')
          return { contents: code.replace(from, from.replace('const t', 'let t')), loader: 'js' }
        })
      },
    }],
    alias: {
      express: shim('express.js'),
      ws: shim('ws.js'),
      ...Object.fromEntries(nodeOnly.map(m => [m, shim('node.js')])),
    },
    logLevel: 'warning',
  })
  // hyperfy-physx loads its wasm from next to the script that runs it.
  fs.copyFileSync(path.join(path.dirname(require.resolve('hyperfy-physx')), 'physx.release.wasm'), path.join(dir, 'physx.release.wasm'))
}

// What every world shares, once at the site root: client/ (the client build),
// local/ (the game-server worker, backend, overlay, loading) and the
// third-party scripts. GitHub Pages sites are limited to 1 GB.
function buildShared() {
  for (const sub of ['client', 'local']) {
    fs.rmSync(root(sub), { recursive: true, force: true })
    fs.cpSync(path.join(BUILD, sub), root(sub), { recursive: true })
  }
  for (const file of ['backend.js', 'overlay.js', 'loading.js']) fs.copyFileSync(root('site', file), root('local', file))
  for (const host of fs.readdirSync(root('site/web'))) {
    fs.rmSync(root(host), { recursive: true, force: true })
    fs.cpSync(root('site/web', host), root(host), { recursive: true })
  }
}

function buildWorld(name, bundleName) {
  const dir = root(name)
  const worldUrl = `${SITE_URL}${name}/`
  const base = new URL(worldUrl).pathname
  const worldFile = fs.readdirSync(path.join(dir, 'api.hyperfy.io/worlds')).find(f => f.endsWith('.json'))
  const world = JSON.parse(fs.readFileSync(path.join(dir, 'api.hyperfy.io/worlds', worldFile), 'utf8'))
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8'))

  // Per-world copies of the shared files, from earlier builds.
  for (const sub of ['client', 'local', ...fs.readdirSync(root('site/web'))]) {
    fs.rmSync(path.join(dir, sub), { recursive: true, force: true })
  }

  let html = fs.readFileSync(path.join(CLIENT_BUILD, 'index.html'), 'utf8')
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  html = html
    .replace(/{{ title }}/g, esc(`${world.title} | Hyperfy`))
    .replace(/{{ description }}/g, esc(world.description))
    .replace(/{{ url }}/g, worldUrl)
    .replace(/{{ image }}/g, `${worldUrl}data.hyperfy.xyz/world-images/${world.id}.png`)
  html = html.replace(/<script[^>]*plausible\.io[^>]*><\/script>/, '')
  html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"( crossorigin)?\/>/g, '')
  html = html.replace(/<link href="https:\/\/fonts\.googleapis\.com\/[^"]*" rel="stylesheet"\/>/, '') // Roboto Mono, unused
  for (const host of fs.readdirSync(root('site/web'))) html = replaceAll(html, `https://${host}/`, `../${host}/`)
  html = html.replace(/(src|href)="\/(?!env\.js)/g, '$1="../client/').replace(/url\('\//g, "url('../client/")
  html = replaceAll(html, 'src="/env.js"></script>', 'src="env.js"></script><script src="../local/backend.js"></script><script src="../local/loading.js"></script>')
  // <base href> is the world's folder, worked out from the page's own
  // address so the site works under any repository name or domain.
  const baseScript = `<script>(function(){var p=location.pathname.split('/'),i=p.lastIndexOf(${JSON.stringify(name)});` +
    `document.write('<base href="'+(i>0?p.slice(0,i+1).join('/'):${JSON.stringify(base.replace(/\/$/, ''))})+'/"/>')})()</script>`
  html = html.replace('<head>', `<head>${baseScript}`)
  html = replaceAll(html, '</body>', '<script src="../local/overlay.js"></script></body>')
  if (!html.includes(`../client/${bundleName}`)) throw new Error('client bundle tag not found in index.html')
  fs.writeFileSync(path.join(dir, 'index.html'), html)

  // The client's settings as hyperfy.io sets them; component code and assets
  // load from the mirror (entitiesUrl = R2_URL), the API is answered by
  // local/backend.js.
  fs.writeFileSync(path.join(dir, 'env.js'), `// Generated by tools/build_pages.js
;(function () {
  var base = new URL('.', document.currentScript.src).href
  window.env = {
    PRODUCTION: 'true',
    API_URL: base + 'api',
    R2_URL: base + 'data.hyperfy.xyz',
    UPLOADS_TARGET: '',
    ENTITIES_TARGET: 'r2',
    DEFAULT_WORLD: ${JSON.stringify(world.slug)},
    AGORA_APP_ID: '',
    LIVEKIT_URL: '',
    SOCK: '',
    MODE: 'live',
    // mirrored hosts the client hard-codes (site/client-patches.js)
    CDN_URL: base + 'data.hyperfy.xyz',
    FONTS_URL: base + 'fonts.gstatic.com/',
    // this world (site/backend.js, site/overlay.js)
    WORLD_ID: ${JSON.stringify(world.id)},
    MODES: ${JSON.stringify(settings.modes || [])},
  }
})()
`)
}

// The site root: the front page opens the first world; GitHub Pages serves
// 404.html for unknown paths, which go back to the world they are under.
function buildRoot() {
  const front = WORLDS[0]
  fs.writeFileSync(root('index.html'), `<!doctype html><html lang="en"><head><meta charset="UTF-8"/>
<title>Hyperfy</title><meta http-equiv="refresh" content="0; url=${front}/"/>
<script>location.replace('${front}/' + location.search)</script></head><body></body></html>
`)
  fs.writeFileSync(root('404.html'), `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><title>Hyperfy</title>
<script>
  var worlds = ${JSON.stringify(WORLDS)}
  var parts = location.pathname.split('/')
  // the last segment naming a world (the site path may contain one too)
  for (var i = parts.length - 1; i >= 0; i--) {
    if (worlds.indexOf(parts[i]) >= 0) { location.replace(parts.slice(0, i + 1).join('/') + '/'); break }
  }
</script></head><body></body></html>
`)
  fs.writeFileSync(root('.nojekyll'), '')
}

;(async () => {
  fs.mkdirSync(BUILD, { recursive: true })
  const bundleName = buildClient()
  await buildWorker()
  buildShared()
  for (const name of WORLDS) buildWorld(name, bundleName)
  buildRoot()
  console.log(`built ${WORLDS.map(w => SITE_URL + w + '/').join(', ')}`)
})().catch(err => {
  console.error(err)
  process.exit(1)
})
