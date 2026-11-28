/** Verify the plugin against an alternate supported host lane in an isolated copy.
 * The repository itself develops against the current stable/RC host (0.2.2-rc.5);
 * this script rewires a temporary copy to another lane (by default the upcoming
 * 0.2.3-alpha.3 / React 19 host) and runs typecheck, build, and the full test
 * suite there. Tests read their expected baseline from package.json, so no test
 * content is patched.
 *
 * Usage: node scripts/verify-host-lane.mjs [next|rc5]
 */
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const LANES = {
  // Upcoming 0.2.3 line: React 19 client runtime, Cordis 4.2, ProfileContext.overlayPaths.
  next: {
    dsh: '0.2.3-alpha.3',
    cordis: '4.2.0-alpha.2',
    loader: '1.2.0-alpha.2',
    schemastery: '3.20.0-alpha.2',
    react: '19.3.1',
    typesReact: '19.3.3',
  },
  // The 0.2.2 release line: React 18 client runtime, pre-rename ProfileContext.
  rc5: {
    dsh: '0.2.2-rc.5',
    cordis: '4.1.0',
    loader: '1.1.0',
    schemastery: '3.19.0',
    react: '18.2.0',
    typesReact: '18.3.31',
  },
}

const laneName = process.argv[2] ?? 'next'
const lane = LANES[laneName]
if (lane === undefined) {
  console.error(`unknown lane "${laneName}"; available: ${Object.keys(LANES).join(', ')}`)
  process.exit(2)
}

const root = fileURLToPath(new URL('..', import.meta.url))
const work = await mkdtemp(join(tmpdir(), `dsh-market-pro-lane-${laneName}-`))
console.log(`lane ${laneName}: copying to ${work}`)

const runPnpm = args => {
  if (process.platform === 'win32') {
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'pnpm.cmd', ...args], { cwd: work, stdio: 'inherit' })
    return
  }
  execFileSync('pnpm', args, { cwd: work, stdio: 'inherit' })
}

let failed = false
try {
  await cp(root, work, {
    recursive: true,
    filter: source => {
      const rel = relative(root, source).replaceAll('\\', '/')
      if (rel === '') return true
      return !/^(node_modules|lib|output|\.git|\.verification|\.playwright-cli)(\/|$)/.test(rel)
        && !rel.endsWith('.tgz')
    },
  })

  const manifestPath = join(work, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  for (const name of Object.keys(manifest.devDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) manifest.devDependencies[name] = lane.dsh
  }
  manifest.devDependencies['@deepseek-ai/cordis'] = lane.cordis
  manifest.devDependencies['@deepseek-ai/cordis-plugin-loader'] = lane.loader
  manifest.devDependencies['@deepseek-ai/schemastery'] = lane.schemastery
  manifest.devDependencies.react = lane.react
  manifest.devDependencies['@types/react'] = lane.typesReact
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  // The lockfile describes the development lane; the copy resolves its lane fresh.
  await rm(join(work, 'pnpm-lock.yaml'), { force: true })

  runPnpm(['install', '--no-frozen-lockfile'])
  for (const [label, command] of [
    ['typecheck', ['run', 'typecheck']],
    ['build', ['run', 'build']],
    ['test', ['test']],
  ]) {
    console.log(`lane ${laneName}: ${label}`)
    runPnpm(command)
  }
  console.log(`lane ${laneName}: PASS`)
} catch (error) {
  failed = true
  if (!(error && typeof error === 'object' && 'status' in error && typeof error.status === 'number')) {
    console.error(error)
  }
  console.error(`lane ${laneName}: FAIL — copy kept at ${work}`)
  process.exitCode = 1
} finally {
  if (!failed) await rm(work, { recursive: true, force: true })
}
