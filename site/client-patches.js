// Changes to Hyperfy's client bundle (hyperfy-client 2.40.0), applied by
// tools/build_pages.js and server/world.js when they serve it.
//
// Every patch is a literal string replacement that must match exactly, so a
// different client version fails loudly instead of silently shipping
// unpatched code.

// URLs the client hard-codes to Hyperfy's CDN and Google Fonts. They resolve
// at runtime against env.CDN_URL / env.FONTS_URL (the mirrored copies), so
// the page works on whatever origin serves it.
const URLS = [
  ['"url(https://fonts.gstatic.com/', '"url("+window.env.FONTS_URL+"'],
  ['"https://fonts.gstatic.com/', 'window.env.FONTS_URL+"'],
  ['"https://data.hyperfy.xyz/', 'window.env.CDN_URL+"/'],
]

const UI = [
  // HUD: no Explore (world directory) and no People buttons, in either the
  // corner or the compact layout.
  ['E=h&&!v,M=!E', 'E=!1,M=!1'],
  ['T=h&&!v,L=!T', 'T=!1,L=!1'],
  // HUD: no Backpack (wallet NFT inventory) button.
  ['(0,Q.tZ)(Lhe,{size:p,icon:uue,iconSize:g,mr:f,onClick:F,active:i.backpack}),', ''],
  // HUD: no avatar button. The avatar panel still opens when a collectable
  // VRM in the world is clicked.
  ['(0,Q.tZ)(Lhe,{size:p,icon:H3,iconSize:g,onClick:U,active:i.avatar,pulse:o})', 'null'],
  // HUD: no chat panel or chat button; site/overlay.js shows the messages
  // as subtitles and has buttons for the show's modes.
  ['A=h&&!v,x=!A,', 'A=!1,x=!1,'],
  // Avatar and backpack panels: no MetaMask / WalletConnect sign-in.
  ['function hhe(){', 'function hhe(){return null;'],
  // Avatar preview (e.g. equipping a collectable VRM): wait for the avatar
  // animation clips. The engine applies them to a new VRM asynchronously, so
  // while they are still downloading the preview finds no idle animation and
  // shows "Invalid VRM".
  [
    'this.vrm=await this.engine.vrm.load(this.url),this.vrm.action=this.vrm.actions.idle',
    'await this.engine.clips.corePending,this.vrm=await this.engine.vrm.load(this.url),this.vrm.actions.idle||await this.engine.clips.applyCoreClipsToVRM(this.vrm),this.vrm.action=this.vrm.actions.idle',
  ],
]

// Audio nodes load through site/loading.js (window.hypAudio): after the world
// is running, and each track only when it is cued. Without loading.js they
// load as before.
const DEFER = 'this.preload&&(window.hypAudio?window.hypAudio.defer(this):this.load())'
const AUDIO = [
  [
    'onMount(){UN&&(this.build(),this.preload&&this.load())}onUnmount(){UN&&(this.n++,this.clear(),this.sourceId&&this.engine.audioAnalysers',
    `onMount(){UN&&(this.build(),${DEFER})}onUnmount(){UN&&(this.n++,this.clear(),this.sourceId&&this.engine.audioAnalysers`,
  ],
  [
    't&&(this.clear(),this.build()),(t||n)&&this.preload&&this.load()}onDestroy(){}isPlaying(){var e;return!!UN&&(null===(e=this.audio)',
    `t&&(this.clear(),this.build()),(t||n)&&${DEFER}}onDestroy(){}isPlaying(){var e;return!!UN&&(null===(e=this.audio)`,
  ],
  // Preload nodes (smart objects' later-stage models) load once the world
  // is running.
  [
    'onMount(){this.load()}onUnmount(){this.n++,this.animateSlot&&this.entity.setAnimations(this.animateSlot,null)}',
    'onMount(){this.hypGone=!1,window.hypPreload?window.hypPreload(this):this.load()}onUnmount(){this.hypGone=!0,this.n++,this.animateSlot&&this.entity.setAnimations(this.animateSlot,null)}',
  ],
  // A script waiting on ready() usually means the track was just cued.
  [
    'ready(t){if(e.loading)return e.queue.push(t),()=>{e.queue=e.queue.filter((e=>e!==t))};t()},duration:()=>e.duration()',
    'ready(t){if(e.loading)return e.queue.push(t),window.hypAudio&&window.hypAudio.poke(),()=>{e.queue=e.queue.filter((e=>e!==t))};t()},duration:()=>e.duration()',
  ],
]

function replace(js, from, to) {
  if (!js.includes(from)) throw new Error(`client patch did not match: ${from}`)
  return js.split(from).join(to)
}

// paths: [from, to] pairs for root-absolute asset paths (static site only).
function patchClient(js, { paths = [] } = {}) {
  for (const [from, to] of [...URLS, ...UI, ...AUDIO, ...paths]) js = replace(js, from, to)
  return js
}

module.exports = { patchClient }
