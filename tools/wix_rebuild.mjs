#!/usr/bin/env node
// Rebuilds a Wix site as plain HTML pages: the content of every page linked
// from the home page (texts, images, videos, boxes and lines, backgrounds,
// embeds, menus), in the same place and style, with no Wix code.
//
// Each page is opened in Chromium (Playwright) at 1280x800 and scrolled to
// the end so every lazy image loads. Every visible element is then measured
// and written out as an absolutely positioned element of a new page:
//   - texts keep their markup (paragraphs, spans, links) with the styles they
//     are shown with (font, size, colour, spacing, alignment) written inline;
//   - images and videos keep their size, crop and position;
//   - backgrounds, borders, lines and shadows are redrawn as boxes;
//   - embeds (iframes) keep their source.
// Horizontal positions are kept relative to the page's centre, as on Wix, so
// the layout stays centred at any window width. Only media (images, videos,
// fonts) is downloaded from Wix, into media/ and fonts/.
//
// usage: node tools/wix_rebuild.mjs <site-url> <out-dir>
//   e.g. node tools/wix_rebuild.mjs https://yigitozen8.wixsite.com/website-2 web
//   ONLY=slug,slug  rebuilds just those pages ('/' is the home page)
//
// Needs playwright-core and a Chromium (PLAYWRIGHT_CHROMIUM or
// /opt/pw-browsers/chromium-1194/chrome-linux/chrome).
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'child_process'
import { chromium } from 'playwright-core'

const [SITE, OUT] = process.argv.slice(2)
if (!SITE || !OUT) {
  console.error('usage: node tools/wix_rebuild.mjs <site-url> <out-dir>')
  process.exit(1)
}
const BASE = SITE.replace(/\/+$/, '')
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const VIEWPORT = { width: 1280, height: 800 }
const MEDIA_RE = /(?:https?:)?\/\/(?:static\.wixstatic\.com|video\.wixstatic\.com)\/[^\s"'()<>\\]*/g
const FONT_RE = /(?:https?:)?\/\/(?:static\.parastorage\.com|static\.wixstatic\.com|fonts\.gstatic\.com)\/[^\s"'()<>\\]*\.(?:woff2?|ttf|otf|eot)(?:\?[^\s"'()<>\\]*)?/g

const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const absolute = u => (u.startsWith('//') ? 'https:' + u : u).replace(/&amp;/g, '&')

// ------------------------------------------------------------ in the page

// Runs in the page: measures every visible element and returns the page as
// a list of positioned items.
function extractPage() {
  const vw = document.documentElement.clientWidth
  const sy = window.scrollY
  const TEXT = ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing', 'color',
    'text-align', 'text-decoration-line', 'text-decoration-color', 'text-transform', 'text-shadow', 'text-indent', 'white-space', 'direction']
  const BLOCK = ['margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'list-style-type', 'list-style-position']
  const KEEP_ATTRS = ['href', 'target', 'src', 'alt', 'colspan', 'rowspan']
  const items = []

  const visible = e => {
    if (e.checkVisibility && !e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false
    const r = e.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    // Visually hidden text for screen readers ("top of page", ...).
    for (let a = e, n = 0; a && n < 4; a = a.parentElement, n++) {
      const acs = getComputedStyle(a)
      if (/rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(acs.clip) || /inset\(50%\)/.test(acs.clipPath)) return false
    }
    return true
  }
  const transparent = c => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c)
  const styleOf = (cs, props) => props.map(p => `${p}:${cs.getPropertyValue(p)}`).join(';')

  // Position and size; a transformed (e.g. rotated) element keeps its own
  // size and gets its transform.
  function geometry(e, cs) {
    const r = e.getBoundingClientRect()
    const g = { x: r.left, y: r.top + sy, w: r.width, h: r.height }
    if (cs.transform && cs.transform !== 'none' && e.offsetWidth) {
      g.w = e.offsetWidth
      g.h = e.offsetHeight
      g.x = r.left + r.width / 2 - g.w / 2
      g.y = r.top + sy + r.height / 2 - g.h / 2
      g.transform = cs.transform
    }
    // Cropped by an ancestor (overflow hidden): keep the visible part only.
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const acs = getComputedStyle(a)
      if (acs.overflowX === 'visible' && acs.overflowY === 'visible') continue
      const ar = a.getBoundingClientRect()
      const clip = { top: Math.max(0, ar.top - r.top), left: Math.max(0, ar.left - r.left), bottom: Math.max(0, r.bottom - ar.bottom), right: Math.max(0, r.right - ar.right) }
      if (clip.top || clip.left || clip.bottom || clip.right) {
        if (clip.top + clip.bottom >= r.height || clip.left + clip.right >= r.width) return null // fully hidden
        g.clip = clip
      }
      break
    }
    return g
  }
  const link = e => {
    const a = e.closest('a[href]')
    return a ? { href: a.getAttribute('href'), target: a.getAttribute('target') } : null
  }

  // Text with its markup, every element carrying the styles it is shown with.
  function richText(root) {
    const clone = root.cloneNode(true)
    const originals = [root, ...root.querySelectorAll('*')]
    const copies = [clone, ...clone.querySelectorAll('*')]
    originals.forEach((o, i) => {
      const c = copies[i]
      const cs = getComputedStyle(o)
      for (const attr of [...c.attributes]) if (!KEEP_ATTRS.includes(attr.name)) c.removeAttribute(attr.name)
      if (i === 0) return
      const block = /^(block|list-item|flex|grid|table)/.test(cs.display)
      let style = styleOf(cs, block ? [...TEXT, ...BLOCK] : TEXT)
      // A link Wix leaves unstyled shows in the text's own colour, not the
      // browser's default link blue.
      if (o.tagName === 'A' && cs.color === 'rgb(0, 0, 238)') style = style.replace(/(^|;)color:[^;]*/, `$1color:${getComputedStyle(o.parentElement).color}`)
      c.setAttribute('style', style)
    })
    clone.querySelectorAll('script, style, noscript').forEach(e => e.remove())
    return { html: clone.innerHTML, style: styleOf(getComputedStyle(root), [...TEXT, 'padding-top', 'padding-bottom', 'padding-left', 'padding-right']) }
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  for (let e = walker.currentNode; e; e = walker.nextNode()) {
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META)$/.test(e.tagName)) continue
    if (e.closest('#WIX_ADS, [id^="WIX_ADS"], [data-testid="freemium-banner"]')) continue
    const inText = e.closest('.wixui-rich-text')
    if (inText && inText !== e) continue
    if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') continue
    if (!visible(e)) continue
    const cs = getComputedStyle(e)
    const g = geometry(e, cs)
    if (!g) continue
    const opacity = +cs.opacity < 1 ? +cs.opacity : undefined
    // Fixed and sticky parts (the header) stay above the rest.
    let layer = 0
    for (let a = e; a && a !== document.body; a = a.parentElement) {
      const p = getComputedStyle(a).position
      if (p === 'fixed' || p === 'sticky') { layer = 1; break }
    }
    g.layer = layer
    const radius = cs.borderRadius !== '0px' ? cs.borderRadius : undefined

    // Box: background, border or shadow.
    const bgImage = cs.backgroundImage !== 'none' ? cs.backgroundImage : null
    const border = ['top', 'right', 'bottom', 'left'].some(s => parseFloat(cs.getPropertyValue(`border-${s}-width`)) > 0 && cs.getPropertyValue(`border-${s}-style`) !== 'none')
    if (!transparent(cs.backgroundColor) || bgImage || border || cs.boxShadow !== 'none') {
      items.push({
        kind: 'box', ...g, opacity, radius,
        style: [
          !transparent(cs.backgroundColor) && `background-color:${cs.backgroundColor}`,
          bgImage && `background-image:${bgImage};background-size:${cs.backgroundSize};background-position:${cs.backgroundPosition};background-repeat:${cs.backgroundRepeat}`,
          border && `border-style:${cs.borderStyle};border-width:${cs.borderWidth};border-color:${cs.borderColor}`,
          cs.boxShadow !== 'none' && `box-shadow:${cs.boxShadow}`,
        ].filter(Boolean).join(';'),
      })
    }

    const tag = e.tagName.toLowerCase()
    if (e.classList.contains('wixui-rich-text')) {
      items.push({ kind: 'text', ...g, opacity, link: null, ...richText(e) })
    } else if (tag === 'img') {
      // A lazy image may not have loaded yet: take its source from srcset or
      // from Wix's image data.
      let src = e.currentSrc || e.getAttribute('src') || (e.getAttribute('srcset') || '').split(/\s/)[0]
      if (!src || src.startsWith('data:')) {
        try {
          const info = JSON.parse(e.closest('wow-image')?.getAttribute('data-image-info') || 'null')
          if (info?.imageData?.uri) src = `https://static.wixstatic.com/media/${info.imageData.uri}`
        } catch (err) {}
      }
      if (!src) continue
      items.push({ kind: 'image', ...g, opacity, radius, src, alt: e.alt || '', fit: cs.objectFit, position: cs.objectPosition, link: link(e) })
    } else if (tag === 'video') {
      items.push({ kind: 'video', ...g, opacity, radius, src: e.currentSrc || e.src || e.querySelector('source')?.src, poster: e.poster, loop: e.loop, muted: true, fit: cs.objectFit, position: cs.objectPosition })
    } else if (tag === 'iframe') {
      if (e.src && !/^about:/.test(e.src)) items.push({ kind: 'embed', ...g, src: e.src })
    } else if (tag === 'svg') {
      const clone = e.cloneNode(true)
      const originals = [e, ...e.querySelectorAll('*')]
      const copies = [clone, ...clone.querySelectorAll('*')]
      originals.forEach((o, i) => {
        const ocs = getComputedStyle(o)
        copies[i].removeAttribute('class')
        copies[i].setAttribute('style', `fill:${ocs.fill};stroke:${ocs.stroke};stroke-width:${ocs.strokeWidth};opacity:${ocs.opacity}`)
      })
      clone.setAttribute('width', '100%')
      clone.setAttribute('height', '100%')
      items.push({ kind: 'svg', ...g, opacity, html: clone.outerHTML, link: link(e) })
    } else if (!inText) {
      // Text outside rich-text elements: menu items, buttons, labels.
      const own = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim()
      if (own) items.push({ kind: 'label', ...g, opacity, text: own, style: styleOf(cs, TEXT) + ';white-space:nowrap', link: link(e) })
    }
  }

  const bodyCs = getComputedStyle(document.body)
  const htmlCs = getComputedStyle(document.documentElement)
  return {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content || '',
    lang: document.documentElement.lang || 'en',
    vw,
    height: document.documentElement.scrollHeight,
    background: !transparent(bodyCs.backgroundColor) ? bodyCs.backgroundColor : !transparent(htmlCs.backgroundColor) ? htmlCs.backgroundColor : '#fff',
    fonts: [...new Set(items.flatMap(i => [i.style, i.html].filter(Boolean).join(' ').match(/font-family:[^;"]+/g) || []).flatMap(f => f.slice(12).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''))))],
    styleSheets: [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.href),
    inlineCss: [...document.querySelectorAll('style')].map(s => s.textContent).join('\n'),
    items,
  }
}

// ------------------------------------------------------------ writing

const media = new Map() // URL -> path under OUT
const missing = new Set()

function mediaPath(url, dir) {
  const u = new URL(url)
  const ext = (path.extname(u.pathname.split('/').pop() || '').match(/^\.[a-z0-9]{1,5}$/i) || [''])[0].toLowerCase()
  return `${dir}/${crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)}${ext}`
}

async function download(request, url, dir) {
  if (media.has(url)) return media.get(url)
  if (missing.has(url)) return null
  try {
    const res = await request.get(url, { timeout: 180000 })
    if (!res.ok()) throw new Error(`HTTP ${res.status()}`)
    const rel = mediaPath(url, dir)
    fs.mkdirSync(path.join(OUT, dir), { recursive: true })
    fs.writeFileSync(path.join(OUT, rel), await res.body())
    media.set(url, rel)
    return rel
  } catch (err) {
    missing.add(url)
    console.warn(`  [miss] ${url.slice(0, 120)} (${err.message})`)
    return null
  }
}

async function localize(request, text, re, dir, fromDir) {
  const found = [...new Set(text.match(re) || [])].sort((a, b) => b.length - a.length)
  for (const raw of found) {
    const rel = await download(request, absolute(raw), dir)
    if (rel) text = text.split(raw).join(path.relative(fromDir, rel).split(path.sep).join('/'))
  }
  return text
}

function itemStyle(item, vw, z) {
  // Spanning the window exactly (strips, section backgrounds): stretch with
  // it. Anything else keeps its size, placed from the centre.
  const full = Math.abs(item.x) <= 1 && Math.abs(item.w - vw) <= 2 && !item.transform
  const s = [
    full ? 'left:0;width:100%' : `left:calc(50% + ${(item.x - vw / 2).toFixed(1)}px);width:${item.w.toFixed(1)}px`,
    `top:${item.y.toFixed(1)}px`,
    `height:${item.h.toFixed(1)}px`,
    `z-index:${z}`,
  ]
  if (item.transform) s.push(`transform:${item.transform}`)
  if (item.opacity !== undefined) s.push(`opacity:${item.opacity}`)
  if (item.radius) s.push(`border-radius:${item.radius};overflow:hidden`)
  if (item.clip) s.push(`clip-path:inset(${item.clip.top.toFixed(1)}px ${item.clip.right.toFixed(1)}px ${item.clip.bottom.toFixed(1)}px ${item.clip.left.toFixed(1)}px)`)
  return s.join(';')
}

function renderItem(item, vw, z) {
  const pos = itemStyle(item, vw, z)
  const wrapLink = (html, link) => (link ? `<a href="${escapeHtml(link.href)}"${link.target ? ` target="${escapeHtml(link.target)}"` : ''}>${html}</a>` : html)
  switch (item.kind) {
    case 'box':
      return `<div class="i" style="${pos};${item.style}"></div>`
    case 'text':
      return `<div class="i t" style="${pos};${item.style}">${item.html}</div>`
    case 'label':
      return `<div class="i t" style="${pos};${item.style}">${wrapLink(escapeHtml(item.text), item.link)}</div>`
    case 'image': {
      const img = `<img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt)}" loading="lazy" style="object-fit:${item.fit};object-position:${item.position}">`
      return `<div class="i m" style="${pos}">${wrapLink(img, item.link)}</div>`
    }
    case 'video':
      return `<div class="i m" style="${pos}"><video src="${escapeHtml(item.src || '')}"${item.poster ? ` poster="${escapeHtml(item.poster)}"` : ''} autoplay muted playsinline${item.loop ? ' loop' : ''} style="object-fit:${item.fit};object-position:${item.position}"></video></div>`
    case 'embed':
      return `<div class="i m" style="${pos}"><iframe src="${escapeHtml(item.src)}" loading="lazy" allowfullscreen></iframe></div>`
    case 'svg':
      return `<div class="i" style="${pos}">${wrapLink(item.html, item.link)}</div>`
  }
  return ''
}

const SITE_CSS = `html, body { margin: 0; padding: 0; }
body { overflow-x: hidden; }
.page { position: relative; width: 100%; min-width: 980px; }
.i { position: absolute; box-sizing: border-box; }
.i > a { color: inherit; text-decoration: inherit; display: contents; }
.t { overflow-wrap: break-word; }
.t p, .t h1, .t h2, .t h3, .t h4, .t h5, .t h6 { margin: 0; }
.t a { color: inherit; }
.m img, .m video, .m iframe { display: block; width: 100%; height: 100%; border: 0; }
`

// ------------------------------------------------------------ main

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  // HTTP/2 and QUIC off: through some proxies Wix navigations otherwise fail
  // with ERR_TOO_MANY_RETRIES.
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--disable-http2', '--disable-quic'] })
  const context = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true })
  const request = context.request

  // The site's pages (from the page map in the home page), keeping those
  // linked from the home page. Wix leaves the map out of the HTML it sends
  // to Playwright's request client, so curl fetches it.
  const homeHtml = execFileSync('curl', ['-sS', '--compressed', '-A', 'Mozilla/5.0', BASE], { maxBuffer: 64 << 20 }).toString()
  const titles = new Map()
  for (const m of homeHtml.matchAll(/"pageId":"[a-z0-9]+","title":"((?:[^"\\]|\\.)*)","pageUriSEO":"([^"]+)"/g)) titles.set(m[2], JSON.parse(`"${m[1]}"`))
  const escapedBase = BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const linked = new Set([...homeHtml.matchAll(new RegExp(`${escapedBase}/([^"'#?\\s<>\\\\/]+)`, 'g'))].map(m => decodeURIComponent(m[1])))
  const pages = [['', 'Home'], ...[...titles].filter(([slug]) => linked.has(slug))]
  const copied = new Set(pages.map(([slug]) => slug))
  console.log(`${pages.length} pages: ${pages.map(([s]) => s || '/').join(', ')}`)

  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
  const manifestFile = path.join(OUT, 'manifest.json')
  const previous = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null
  if (only && previous) for (const m of previous.media) media.set(m.url, m.file)
  const results = only && previous ? previous.pages.filter(p => !only.has(p.slug)) : []
  const fontFamilies = new Set(only && previous ? previous.fonts : [])
  const cssSources = new Set()

  for (const [slug, title] of pages) {
    const key = slug || '/'
    if (only && !only.has(key)) continue
    const url = slug ? `${BASE}/${slug}` : BASE
    const dir = slug
    const page = await context.newPage()
    try {
      let res
      for (let attempt = 1; ; attempt++) {
        try {
          // A page with a widget that never finishes loading (e.g. a gallery
          // served from a blocked host) is taken once its DOM is ready.
          res = await page.goto(url, { waitUntil: ['networkidle', 'networkidle', 'load', 'domcontentloaded'][attempt - 1], timeout: 120000 })
          if (attempt === 4) await page.waitForTimeout(15000)
          break
        } catch (err) {
          if (attempt >= 4) throw err
          await new Promise(r => setTimeout(r, 5000 * attempt))
        }
      }
      if (!res || res.status() >= 400) throw new Error(`HTTP ${res && res.status()}`)
      await page.evaluate(async () => {
        const step = window.innerHeight * 0.8
        for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
          window.scrollTo(0, y)
          await new Promise(r => setTimeout(r, 300))
        }
        window.scrollTo(0, 0)
      })
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
      await page.waitForTimeout(1500)

      const data = await page.evaluate(extractPage)
      data.fonts.forEach(f => fontFamilies.add(f))
      data.styleSheets.forEach(s => cssSources.add(s))
      cssSources.add('inline:' + data.inlineCss)

      const up = slug ? '../' : ''
      let body = data.items.map((item, i) => renderItem(item, data.vw, i + 1 + item.layer * 100000)).join('\n')
      // Links between the copied pages point at the copies; any other link
      // (including pages not copied) stays as it is.
      body = body.replace(new RegExp(`${escapedBase}(/[^"'#?\\s<>]*)?(#[^"'\\s<>]*)?(?=["'\\s<>])`, 'g'), (all, p = '', hash = '') => {
        const target = decodeURIComponent((p || '').replace(/^\//, '').replace(/\/$/, ''))
        if (!copied.has(target)) return all
        const rel = path.relative(dir || '.', target || '.').split(path.sep).join('/')
        return (rel === '' ? './' : rel + '/') + hash
      })
      body = await localize(request, body, MEDIA_RE, 'media', dir || '.')

      const html = `<!DOCTYPE html>
<html lang="${escapeHtml(data.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${VIEWPORT.width}">
<title>${escapeHtml(data.title || title)}</title>
${data.description ? `<meta name="description" content="${escapeHtml(data.description)}">\n` : ''}<link rel="stylesheet" href="${up}site.css">
<link rel="stylesheet" href="${up}fonts.css">
</head>
<body style="background:${data.background}">
<div class="page" style="height:${data.height}px">
${body}
</div>
</body>
</html>
`
      const file = path.join(OUT, dir, 'index.html')
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, html)
      results.push({ slug: key, title, source: url, file: path.relative(OUT, file), items: data.items.length })
      console.log(`  [ok ] ${key} (${title}): ${data.items.length} items`)
    } catch (err) {
      results.push({ slug: key, title, source: url, error: err.message.split('\n')[0] })
      console.warn(`  [err] ${key}: ${err.message.split('\n')[0]}`)
    } finally {
      await page.close()
    }
  }

  // Fonts: the @font-face rules of the families the texts use, with their
  // files downloaded.
  const faces = []
  const seenFaces = new Set()
  for (const src of cssSources) {
    let css = ''
    if (src.startsWith('inline:')) css = src.slice(7)
    else {
      try {
        css = await (await request.get(src)).text()
      } catch (err) {}
    }
    for (const block of css.match(/@font-face\s*{[^}]*}/g) || []) {
      const family = (block.match(/font-family:\s*["']?([^;"']+)/) || [])[1]
      if (!family || ![...fontFamilies].some(f => f.toLowerCase() === family.trim().toLowerCase())) continue
      if (seenFaces.has(block)) continue
      seenFaces.add(block)
      faces.push(await localize(request, block, FONT_RE, 'fonts', '.'))
    }
  }
  if (!only || faces.length) fs.writeFileSync(path.join(OUT, 'fonts.css'), faces.join('\n') + '\n')
  fs.writeFileSync(path.join(OUT, 'site.css'), SITE_CSS)

  fs.writeFileSync(manifestFile, JSON.stringify({
    source: BASE,
    generatedAt: new Date().toISOString(),
    pages: results,
    fonts: [...fontFamilies],
    media: [...media].map(([url, file]) => ({ url, file })),
    missing: [...missing],
  }, null, 2))
  console.log(`done: ${results.filter(p => !p.error).length}/${results.length} pages, ${media.size} media files, ${faces.length} font faces, ${missing.size} missing`)
  await browser.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
