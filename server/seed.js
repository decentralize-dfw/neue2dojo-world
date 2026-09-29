// Writes the world into the local hyperfy-api database.
//
// hyperfy-api has no migrations; this is the schema hyperfy-tools@2.40.0
// creates. Runs before every start: the world and component rows are
// rewritten from the mirrored api.hyperfy.io records (URLs pointed at
// PUBLIC_URL), accounts are kept, and stale game-server rows are cleared.
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const config = require('./config')

const TABLES = [
  'configs (`id` varchar(255), `value` varchar(255) not null, `createdAt` datetime not null, `updatedAt` datetime not null, primary key (`id`))',
  'accounts (`id` varchar(255), `name` varchar(255) not null, `imageUrl` varchar(255), `address` varchar(255), `signature` varchar(255), `avatarState` text, `guardian` boolean, `createdAt` datetime not null, `updatedAt` datetime not null, primary key (`id`))',
  'walletLinks (`id` varchar(255), `code` varchar(255) not null, `codePretty` varchar(255) not null, `value` text, `createdAt` datetime not null, `updatedAt` datetime not null, primary key (`id`))',
  'authHooks (`id` varchar(255), `authToken` varchar(255), `expiresAt` datetime not null, `createdAt` datetime not null, `updatedAt` datetime not null, primary key (`id`))',
  'worlds (`id` varchar(255), `title` varchar(255), `description` varchar(255), `image` varchar(255), `slug` varchar(255), `capacity` integer, `singleton` boolean not null, `privates` boolean, `entities` text, `settings` text, `ownerId` varchar(255), `featuredPos` integer, `createdAt` datetime not null, `updatedAt` datetime not null, primary key (`id`))',
  'entities (`id` varchar(255), `version` integer not null, `name` varchar(255) not null, `description` varchar(255), `image` varchar(255), `category` varchar(255), `public` boolean not null, `secrets` text, `ownerId` varchar(255), `createdAt` datetime not null, `updatedAt` datetime not null, primary key (`id`))',
  'collaborators (`id` varchar(255), `worldId` varchar(255) not null, `address` varchar(255) not null, `role` varchar(255) not null, `createdAt` datetime not null, `updatedAt` datetime not null, primary key (`id`))',
  'servers (`id` varchar(255), `ip` varchar(255), `port` varchar(255), `worldId` varchar(255), `shard` varchar(255), `clients` integer not null, `createdAt` datetime not null, `updatedAt` datetime not null, primary key (`id`))',
  'rewards (`id` varchar(255), `address` varchar(255) not null, `type` varchar(255) not null, `amount` integer not null, `createdAt` datetime not null, primary key (`id`))',
  'parkourScores (`id` varchar(255), `name` varchar(255) not null, `time` float not null, `createdAt` datetime not null, `updatedAt` datetime not null, primary key (`id`))',
  'scores (`id` varchar(255), `board` varchar(255) not null, `address` varchar(255), `name` varchar(255) not null, `value` float not null, `createdAt` datetime not null, `updatedAt` datetime not null, primary key (`id`))',
  'guestbook (`id` varchar(255), `event` varchar(255) not null, `name` varchar(255) not null, `address` varchar(255) not null, `createdAt` datetime not null, primary key (`id`))',
  'worldEvents (`id` varchar(255), `title` varchar(255) not null, `startAt` datetime not null, `endAt` datetime not null, `slug` varchar(255) not null, `desc` varchar(255) not null, `active` boolean not null, `creatorId` varchar(255) not null, `discordEventId` varchar(255), `createdAt` datetime not null, `updatedAt` datetime not null, primary key (`id`))',
]

function seed() {
  fs.mkdirSync(config.DATA_DIR, { recursive: true })
  const db = new Database(config.DB_FILE)
  try {
    for (const t of TABLES) db.exec(`CREATE TABLE IF NOT EXISTS ${t}`)
    db.exec('DELETE FROM servers') // one game server per process; old rows would claim the world

    const world = JSON.parse(fs.readFileSync(config.WORLD_FILE, 'utf8'))
    const entities = JSON.parse(world.entities)

    // Each entity loads the component code of its own version; a world can
    // use a component at more than one version. The row holds the newest one
    // the world uses (live's metadata may list versions it never loaded).
    const used = { 'hyperfy-avatar': new Set([config.AVATAR_VERSION]) }
    for (const e of entities) (used[e.id] ||= new Set()).add(e.version)
    const upsertEntity = db.prepare(
      'INSERT OR REPLACE INTO entities (id, version, name, description, image, category, public, secrets, ownerId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)'
    )
    for (const [id, set] of Object.entries(used)) {
      for (const v of set) {
        const bundle = path.join(config.CDN_DIR, 'components', id, `v${v}`, 'index.js')
        if (!fs.existsSync(bundle)) throw new Error(`missing component bundle ${bundle} (run tools/hyperfy_mirror.py)`)
      }
      const version = Math.max(...set)
      const meta = JSON.parse(fs.readFileSync(path.join(config.ENTITY_META_DIR, `${id}.json`), 'utf8'))
      upsertEntity.run(id, version, meta.name, meta.description ?? null, meta.image ?? null, meta.category ?? null,
        meta.public ? 1 : 0, meta.ownerId ?? null, meta.createdAt, meta.updatedAt)
    }

    // Capacity: live opens another instance when 20 people are in one; this
    // process runs a single game server, so it takes everyone instead of
    // turning the 21st visitor away. Private instances need a game server
    // each, so they are off; server/world.js sends private-instance links to
    // the running instance.
    db.prepare(
      'INSERT OR REPLACE INTO worlds (id, title, description, image, slug, capacity, singleton, privates, entities, settings, ownerId, featuredPos, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, ?, ?, ?, ?)'
    ).run(world.id, world.title, world.description, world.image && config.localize(world.image), world.slug,
      world.singleton ? 1 : 0, config.localize(world.entities), world.settings,
      world.ownerId, world.featuredPos, world.createdAt, world.updatedAt)

    // Equipped avatars are stored as absolute URLs; follow PUBLIC_URL changes.
    const rebase = s => config.localize(s).replace(/https?:\/\/[^"]*?\/api\/static\//g, `${config.PUBLIC_URL}/api/static/`)
    const accounts = db.prepare("SELECT id, avatarState FROM accounts WHERE avatarState IS NOT NULL AND avatarState != 'null'").all()
    const updateAvatar = db.prepare('UPDATE accounts SET avatarState = ? WHERE id = ?')
    for (const a of accounts) {
      const next = rebase(a.avatarState)
      if (next !== a.avatarState) updateAvatar.run(next, a.id)
    }
    return { world: world.id, slug: world.slug, components: Object.keys(used).length }
  } finally {
    db.close()
  }
}

module.exports = seed

if (require.main === module) console.log(seed())
