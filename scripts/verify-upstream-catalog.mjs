/** Cross-project acceptance against the actual publisher and consumer implementations.
 * node scripts/verify-upstream-catalog.mjs ../awesome-dsh-plugin-pro
 */
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { deriveMarket } from '../src/catalog.ts'
import { marketCatalogSchema } from '../src/contract.ts'
import { marketKey, pageOf } from '../src/client/rows.ts'
import { FEATURED_CATEGORY, SUBSCRIPTION_CATEGORY } from '../src/shapes.ts'

const root = pathToFileURL(`${resolve(process.argv[2] ?? '../awesome-dsh-plugin-pro')}/`)
const { buildCompactMarketCatalog, readSafeMarketCatalog } = await import(
  new URL('scripts/safe-market-catalog.mjs', root).href,
)
const { catalogRepositories, loadState } = await import(new URL('scripts/render.mjs', root).href)
const { marketBlockedRepoNames } = await import(new URL('scripts/market-pool.mjs', root).href)
const [feed3, state, index] = await Promise.all([
  readSafeMarketCatalog(root),
  loadState(),
  readFile(new URL('data/dsh-market-index.json', root), 'utf8').then(JSON.parse),
])
const feed4 = buildCompactMarketCatalog(feed3)

const start3 = performance.now()
const catalog3 = marketCatalogSchema.parse(deriveMarket(feed3, 1000))
const parseAndValidateSchema3Ms = Math.round(performance.now() - start3)

const start4 = performance.now()
const catalog4 = marketCatalogSchema.parse(deriveMarket(feed4, 1000))
const parseAndValidateSchema4Ms = Math.round(performance.now() - start4)

// Verify full subscription parsing & wire validation by deriving without editorial picks.
const subscriptionOnly = marketCatalogSchema.parse(deriveMarket({ ...feed4, featured: undefined }, 1000))
const featured = catalog4.featured.entries.map(entry => entry.item)
const picks = subscriptionOnly.featured.entries.map(entry => entry.item)

const blocked = marketBlockedRepoNames(state.curated)
const expectedRepoNames = catalogRepositories(state)
  .filter(repo => !blocked.has(repo.full_name.toLowerCase()))
  .map(repo => repo.full_name)

for (const [label, catalog] of [['schema3', catalog3], ['schema4', catalog4]]) {
  assert.deepEqual(catalog.items.map(item => item.fullName), expectedRepoNames, `${label} repo list mismatch`)
  if (feed3.featured) {
    assert.equal(catalog.subscription, undefined, `${label} should drop redundant subscription payload when editorial picks exist`)
    assert.equal(catalog.featured.count, feed3.featured.entries.length, `${label} featured count mismatch`)
    assert.deepEqual(
      catalog.featured.entries.map(entry => entry.item.fullName.toLowerCase()),
      feed3.featured.entries.map(entry => entry.full_name.toLowerCase()),
      `${label} featured order mismatch`,
    )
  }
  assert.equal(
    catalog.featured.categories.reduce((n, category) => n + category.count, 0),
    catalog.featured.entries.length,
    `${label} featured category count sum mismatch`,
  )
  assert.equal(
    catalog.categories
      .filter(category => category.key !== FEATURED_CATEGORY && category.key !== SUBSCRIPTION_CATEGORY)
      .reduce((n, category) => n + category.count, 0),
    catalog.items.length,
    `${label} catalog category count sum mismatch`,
  )
}

// Verify schema 4 compact projection hydrates the same repository metadata, icons, and featured picks as schema 3.
assert.equal(catalog4.items.length, catalog3.items.length)
for (let i = 0; i < catalog3.items.length; i++) {
  const a = catalog3.items[i]
  const b = catalog4.items[i]
  assert.equal(b.fullName, a.fullName)
  assert.equal(b.category, a.category)
  assert.equal(b.categoryZh, a.categoryZh)
  assert.equal(b.icon, a.icon, `schema4 icon hydration mismatch for ${a.fullName}`)
  assert.equal(b.installStatus, a.installStatus, `schema4 installStatus mismatch for ${a.fullName}`)
  assert.deepEqual(b.installInfo, a.installInfo, `schema4 installInfo mismatch for ${a.fullName}`)
}
assert.deepEqual(
  catalog4.featured.entries.map(entry => ({
    key: marketKey(entry.item),
    icon: entry.item.icon,
    install: entry.item.installInfo?.targets[0]?.install,
  })),
  catalog3.featured.entries.map(entry => ({
    key: marketKey(entry.item),
    icon: entry.item.icon,
    install: entry.item.installInfo?.targets[0]?.install,
  })),
)

// Verify every published subscription plugin survives identity, metadata, icon, and install-source checks.
assert.deepEqual(picks.map(item => item.packageName), index.plugins.map(plugin => plugin.name))
assert.equal(new Set(picks.map(marketKey)).size, index.plugins.length)
for (let i = 0; i < index.plugins.length; i++) {
  const plugin = index.plugins[i]
  const item = picks[i]
  const version = plugin.versions[0]
  const source = version.source
  assert.equal(item.category, plugin.metadata.category)
  assert.equal(item.categoryZh, index.metadata.categories[item.category].title.zh)
  assert.equal(item.icon, plugin.icon)
  assert.equal(item.installInfo.targets[0].install, source.type === 'npm'
    ? `${plugin.name}@${version.version}`
    : `${source.url.replace(/\.git$/, '')}#${source.commit}${source.path ? `&path:${source.path}` : ''}`)
}

assert.equal(pageOf(catalog4.items, 0).items.length, Math.min(50, catalog4.items.length))
assert.equal(pageOf(featured, 0).items.length, Math.min(50, featured.length))
assert.equal(pageOf(featured, 0).pages, Math.ceil(featured.length / 50))
const serialized3 = JSON.stringify(feed3)
const serialized4 = JSON.stringify(feed4)
console.log(JSON.stringify({
  repositories: catalog4.items.length,
  featuredPicks: featured.length,
  subscriptionPlugins: picks.length,
  categories: catalog4.featured.categories,
  npmOnlyPlugins: picks.filter(item => !item.fullName).length,
  archivedOrDisabledRepositories: catalog4.items.filter(item => item.archived || item.disabled).length,
  subscriptionLogos: picks.filter(item => item.icon).length,
  repositoryLogos: catalog4.items.filter(item => item.icon).length,
  schema3Bytes: Buffer.byteLength(serialized3),
  schema3GzipBytes: gzipSync(serialized3).length,
  schema4Bytes: Buffer.byteLength(serialized4),
  schema4GzipBytes: gzipSync(serialized4).length,
  parseAndValidateSchema3Ms,
  parseAndValidateSchema4Ms,
  subscriptionSha256: feed4.subscription_sha256,
  schema3And4Parity: true,
  identityAndOrderMatch: true,
  installSourcesMatch: true,
  categoryCountsMatch: true,
}, null, 2))
