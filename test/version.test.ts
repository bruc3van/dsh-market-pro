/**
 * The version-consistency gate.
 *
 * A version bump must keep package.json and dsh.plugin.json in sync, the
 * READMEs must reference the current package name, and the tag workflow
 * (`.github/workflows/release.yml`) must publish that version to npm.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'
import { parse } from 'yaml'
import { PACKAGE_NAME } from '../src/shapes.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
  name: string
  version: string
  exports: Record<string, string | Record<string, string>>
  files: string[]
  dsh: { client: { inject: string[] } }
  peerDependencies: Record<string, string>
  devDependencies: Record<string, string>
}
const plugin = JSON.parse(await readFile(resolve(root, 'dsh.plugin.json'), 'utf8')) as {
  name: string
  version: string
  entry: { name: string }
}

test('the host compatibility evaluator accepts every supported runtime without exemptions', () => {
  for (const version of [
    '0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3', '0.2.2-rc.4', '0.2.2-rc.5', '0.2.2', '0.2.3',
    '0.2.3-alpha.1', '0.2.3-alpha.2', '0.2.3-alpha.3',
  ]) {
    assert.equal(evaluatePluginCompatibility(pkg, {}, version), undefined, `runtime ${version} must be accepted`)
  }
  for (const version of ['0.1.7-rc.2', '0.2.0', '0.2.1-rc.4', '0.2.1-rc.5', '0.3.0']) {
    assert.ok(evaluatePluginCompatibility(pkg, {}, version), `runtime ${version} must be rejected`)
  }
})

test('DSH dependencies keep the declared runtime and development baseline', () => {
  const peers = Object.entries(pkg.peerDependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
  assert.ok(peers.length > 0, 'peerDependencies must declare DSH dependencies')
  for (const [name, version] of peers) {
    assert.equal(version, '>=0.2.2-rc.1 <0.3.0', `peerDependencies.${name} must use the DSH baseline`)
  }
  // The development lane is one self-consistent host version: every DSH devDependency
  // pins the same release, and that release stays inside the supported peer range.
  // Verification lanes install alternate supported hosts by rewriting these pins together.
  const devs = Object.entries(pkg.devDependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
  assert.ok(devs.length > 0, 'devDependencies must declare DSH dependencies')
  const baseline = devs[0]![1]
  for (const [name, version] of devs) {
    assert.equal(version, baseline, `devDependencies.${name} must pin the same host version as ${devs[0]![0]}`)
  }
  assert.equal(evaluatePluginCompatibility(pkg, {}, baseline), undefined, 'the development baseline must satisfy its own peer range')
  assert.ok('@deepseek-ai/dsh-client-ui-primitives' in pkg.peerDependencies)
  for (const injected of pkg.dsh.client.inject) {
    assert.ok(injected in pkg.peerDependencies, `dsh.client.inject entry ${injected} must be declared in peerDependencies`)
  }
})

test('package metadata and bundle entry agree on the plugin identity and version', async () => {
  assert.equal(pkg.name, PACKAGE_NAME)
  assert.equal(plugin.name, pkg.name)
  assert.equal(plugin.entry.name, pkg.name)
  const patch = parse(await readFile(resolve(root, 'cordis.patch.yml'), 'utf8'))
  assert.equal(patch[0].insert[0].id, pkg.name)
  assert.equal(patch[0].insert[0].name, pkg.name)
  assert.equal(
    plugin.version,
    pkg.version,
    `dsh.plugin.json says ${plugin.version} but package.json says ${pkg.version} — bump both together`,
  )
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
  assert.ok(pkg.files.includes('locale/*.json'))
  for (const lang of ['en', 'zh'] as const) {
    const locale = JSON.parse(await readFile(resolve(root, 'locale', `${lang}.json`), 'utf8')) as {
      meta?: { title?: string; description?: string }
    }
    assert.ok(typeof locale.meta?.title === 'string' && locale.meta.title.trim() !== '', `locale/${lang}.json must declare meta.title`)
    assert.ok(typeof locale.meta?.description === 'string' && locale.meta.description.trim() !== '', `locale/${lang}.json must declare meta.description`)
  }
})

for (const name of ['README.md', 'README_EN.md'] as const) {
  test(`${name} guides users to install ${ pkg.name }`, async () => {
    const markdown = await readFile(resolve(root, name), 'utf8')
    assert.ok(
      markdown.includes(pkg.name),
      `${name} must reference the package name \`${pkg.name}\` for installation`,
    )
  })
}

test('release workflow publishes to npm via Trusted Publishing', async () => {
  const yaml = await readFile(resolve(root, '.github/workflows/release.yml'), 'utf8')
  assert.match(
    yaml,
    /run:\s*npm publish --access public/,
    'release.yml must run `npm publish --access public` so a tag cannot ship GitHub-only',
  )
  assert.match(
    yaml,
    /^\s+id-token:\s*write\s*$/m,
    'release.yml must grant `id-token: write` for npm Trusted Publishing (OIDC)',
  )
})

test('workflows use the Node 24-compatible pnpm setup action', async () => {
  for (const name of ['check.yml', 'release.yml'] as const) {
    const yaml = await readFile(resolve(root, '.github/workflows', name), 'utf8')
    assert.match(
      yaml,
      /uses:\s*pnpm\/action-setup@f520eceda224fe1a4aed5a2a27a194379a409996(?:\s|$)/,
      `${name} must pin the verified Node 24-compatible pnpm/action-setup v6 commit`,
    )
    assert.doesNotMatch(
      yaml,
      /uses:\s*pnpm\/action-setup@v[1-5](?:\s|$)/,
      `${name} must not use a pnpm/action-setup release backed by the deprecated Node 20 action runtime`,
    )
  }
})
