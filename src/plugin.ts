/**
 * The market's actual body: mounts the `dshMarketPro` Typert Remote service
 * (the reduced community plugin catalog, the deployment's resolvable skills,
 * and the market's own durable settings) and registers its strict Typert
 * manifest. The client half ships in the same package (`./client`); the web
 * server serves it under /plugins/dsh-market-pro/client.js.
 *
 * The client can use the official pluginManager Remote for direct installs,
 * or stage a review prompt. This service owns the catalog and legacy management.
 *
 * DELIBERATELY NOT THE PACKAGE ENTRY. Everything that can fail to resolve on
 * an unfamiliar runtime is reached from here and from nowhere else: the
 * `defineDomain(...)` helper and the `TypertRemoteService` base class are
 * evaluated the moment this file is imported, and either missing throws. A throw at
 * import time fails the WHOLE plugin tree, taking the deployment's own
 * plugins and any CLI sharing the profile down with the market. So `index.ts`
 * imports this file dynamically, inside a guard: an incompatible runtime
 * costs the market and nothing else. See the note there.
 * @module dsh-market-pro/plugin
 */
import type {} from '@deepseek-ai/dsh-app-boot'
import { resolveActiveProfile } from './activeProfile.ts'
import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: brings the `ctx.typert` Context merge into this program.
import type {} from '@deepseek-ai/dsh-typert-registry'
// Type-only: brings the `ctx.settings` Context merge in.
import type {} from '@deepseek-ai/dsh-settings'
// Type-only: brings the `ctx.storageDomain` Context merge in.
import type {} from '@deepseek-ai/dsh-storage-domain'
// Type-only: brings the `ctx.loader` Context merge in.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { CATALOG_FORMAT, createCatalogSource, isOfficialCatalogBase, type CatalogCache } from './catalog.ts'
import { createInstalledManager } from './installed.ts'
import { SafeMarketRuntime } from './runtime.ts'
import { registerSafeMarketSettings } from './settings.ts'
import { readSkills } from './skills.ts'
import { deleteInstalledSkillOnHost, installFeaturedSkillOnHost } from './skillInstall.ts'
import { adoptMcp, inspectMcpContext, probeManagedMcp, type McpLoaderEntry } from './mcp.ts'
import { registerMarketAiSkill } from './aiSkill.ts'
import { registerMarketAiTool, type HostPluginManagerUpdateFace, type HostPluginMarketUpdateFace, type MarketApprovalServiceFace } from './aiTools.ts'
import { registerMarketAiMcpTool } from './aiMcpTools.ts'
import { registerMarketAiSkillsTool } from './aiSkillsTools.ts'
import { adoptDomainState, initialDomainState, safeMarketDomainSpec, type SafeMarketDomainState } from './store.ts'
import { packageNameFromInstallSpec, parseGitHubRepoSlug } from './installInfo.ts'
import { isValidSemver } from './compatibility.ts'
import { detectDshVersion } from './hostRuntime.ts'
import { classifyInstallError, createTelemetryReporter, isTelemetryEnvSuppressed } from './telemetry.ts'
import { TYPERT_MANIFEST } from './typert.ts'
import type { InstallFeaturedSkillResult, MarketPlugin, SafeMarketSettingsUpdate } from './contract.ts'
import { PACKAGE_NAME } from './shapes.ts'
import type { Config } from './index.ts'

/**
 * This package's own version, for the section header.
 *
 * Read from the manifest rather than baked in by the build, so there is no
 * third seat to drift (the build gate already pins package.json against
 * `dsh.plugin.json`). `../package.json` resolves to the package root from
 * both the bundle at `lib/plugin.js` and the source at `src/plugin.ts`, so
 * the value is the same under the Loader and under a source run. A market
 * that cannot read its own manifest still runs — the header just omits the
 * version.
 */
function readSelfVersion(): string {
  try {
    const manifest = createRequire(import.meta.url)('../package.json') as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : ''
  } catch (error) {
    console.warn('[dsh-market-pro] could not read own version:', error)
    return ''
  }
}

/**
 * Mount the market service.
 * @param ctx - host cordis context.
 * @param resolved - plugin configuration, already validated by the entry.
 * @returns a disposer for the entry's effect seat.
 */
export function applyMarket(ctx: Context, resolved: Config): () => void {
  const profile = resolveActiveProfile(ctx.get('profileContext'), resolved.profile)
  // The durable enable switch: the runtime reads its live value on every
  // call, so toggling it in the Web settings takes effect immediately.
  const settings = registerSafeMarketSettings(ctx, resolved)
  const readSettings = () => settings.get()
  let syncAiAssistant: (() => void) | undefined
  const writeSettings = async (update: SafeMarketSettingsUpdate) => {
    // Write the field the update names. The wire codec (a discriminated
    // union) has already rejected any unknown field, so the computed key can
    // only be a real one — and the day a second field joins the union, it is
    // written under its own name instead of silently becoming `enabled`.
    await settings.update({ [update.field]: update.value })
    const next = settings.get()
    syncAiAssistant?.()
    if (update.field === 'enabled' && next.enabled) catalog.warmup()
    if (update.field === 'telemetryEnabled' && !next.telemetryEnabled) {
      if (seat.status === 'opening') telemetryClearedWhileOpening = true
      updateSeatData({
        ...seat.data,
        telemetryId: '',
        telemetryLastPingDay: '',
        telemetryLastPingKind: '',
      })
    }
    return next
  }

  // The reduction's durable seat. The domain opens asynchronously, so the
  // cache port answers from memory until it is there — a market opened in the
  // first moments of boot waits briefly for the domain to open instead of
  // bypassing a warm disk cache with a cold network download.
  type StorageSeatState =
    | { readonly status: 'opening'; readonly data: SafeMarketDomainState }
    | {
      readonly status: 'durable'
      readonly data: SafeMarketDomainState
      readonly persist: (next: SafeMarketDomainState) => void
      readonly close: () => Promise<void>
    }
    | { readonly status: 'memory-only'; readonly data: SafeMarketDomainState }
    | { readonly status: 'disposed'; readonly data: SafeMarketDomainState }

  let seat: StorageSeatState = { status: 'opening', data: initialDomainState }
  let telemetryClearedWhileOpening = false
  const disposeController = new AbortController()
  let resolveDomainReady!: () => void
  const domainReady = new Promise<void>((resolve) => { resolveDomainReady = resolve })

  const updateSeatData = (next: SafeMarketDomainState): void => {
    seat = { ...seat, data: next }
    if (seat.status === 'durable') seat.persist(next)
  }

  const selfVersion = readSelfVersion()
  const rawDshVersion = detectDshVersion()
  const dshVersion = isValidSemver(rawDshVersion) ? rawDshVersion : ''
  const hostTelemetryDisabled = (ctx.get('profileContext')?.telemetryDisabledEnv ?? '').trim() !== ''
  const telemetrySuppressedByEnv = hostTelemetryDisabled || isTelemetryEnvSuppressed()
  const resolvePublicPluginTarget = (candidate: string): string | null => {
    if (!isOfficialCatalogBase(resolved.catalogBase)) return null
    if (seat.data.catalogBase !== '' && !isOfficialCatalogBase(seat.data.catalogBase)) return null
    const cached = seat.data.catalog
    if (cached === null) return null
    const needle = candidate.toLowerCase()
    const matchItem = (item: MarketPlugin): string | null => {
      if (item.fullName.toLowerCase() === needle) return item.fullName
      if (item.packageName?.toLowerCase() === needle) return item.fullName || item.packageName
      for (const target of item.installInfo?.targets ?? []) {
        const pkg = packageNameFromInstallSpec(target.install).toLowerCase()
        const repo = parseGitHubRepoSlug(target.install, { allowCodeload: true }).toLowerCase()
        if ((pkg !== '' && pkg === needle) || (repo !== '' && repo === needle)) {
          return item.fullName || candidate
        }
      }
      return null
    }
    for (const entry of cached.featured?.entries ?? []) {
      const matched = matchItem(entry.item)
      if (matched !== null) return matched
    }
    for (const item of cached.items) {
      const matched = matchItem(item)
      if (matched !== null) return matched
    }
    return null
  }
  const telemetry = createTelemetryReporter({
    pluginVersion: selfVersion,
    dshVersion: rawDshVersion,
    isEnabled: () => !hostTelemetryDisabled && readSettings().telemetryEnabled,
    resolvePublicPluginTarget,
    storage: {
      ready: domainReady,
      read: () => ({
        telemetryId: seat.data.telemetryId,
        telemetryLastPingDay: seat.data.telemetryLastPingDay,
        telemetryLastPingKind: seat.data.telemetryLastPingKind,
      }),
      write: (patch) => {
        updateSeatData({
          ...seat.data,
          ...(patch.telemetryId !== undefined ? { telemetryId: patch.telemetryId } : {}),
          ...(patch.telemetryLastPingDay !== undefined ? { telemetryLastPingDay: patch.telemetryLastPingDay } : {}),
          ...(patch.telemetryLastPingKind !== undefined ? { telemetryLastPingKind: patch.telemetryLastPingKind } : {}),
        })
      },
    },
    disposeSignal: disposeController.signal,
  })

  const disposeSeat = (): void => {
    telemetry.dispose()
    disposeController.abort()
    resolveDomainReady()
    const previous = seat
    seat = { status: 'disposed', data: previous.data }
    if (previous.status === 'durable') {
      void previous.close()
    }
  }

  // A stored reduction answers a different question than the current config
  // asked, so only adopt state cut with the same market size and base — and
  // derived by a parse of the same shape as this build's.
  const usable = (candidate: SafeMarketDomainState): boolean =>
    candidate.catalog !== null && candidate.catalogFormat === CATALOG_FORMAT
    && candidate.marketSize === resolved.marketSize && candidate.catalogBase === resolved.catalogBase
    && candidate.dshVersion === dshVersion
  const cache: CatalogCache = {
    ready: domainReady,
    read: () => (
      usable(seat.data)
        ? { catalog: seat.data.catalog, marketEtag: seat.data.marketEtag, activeBase: seat.data.activeBase }
        : { catalog: null, marketEtag: '', activeBase: '' }
    ),
    write: (next) => {
      updateSeatData({
        ...seat.data,
        catalog: next.catalog,
        marketEtag: next.marketEtag,
        activeBase: next.activeBase,
        catalogFormat: CATALOG_FORMAT,
        marketSize: resolved.marketSize,
        catalogBase: resolved.catalogBase,
        dshVersion,
      })
    },
  }

  const catalog = createCatalogSource({
    base: resolved.catalogBase,
    marketSize: resolved.marketSize,
    cache,
    disposeSignal: disposeController.signal,
    ...(dshVersion !== '' ? { dshVersion } : {}),
  })

  // The installed panel uses native bundle management when available. Its
  // desktop seats and legacy profiles still use the profile patch and Loader.
  // The pending-uninstall record lives in a
  // small file under the harness home — deliberately NOT in the storage
  // domain — so the boot sweep runs even when the domain is unavailable:
  // losing the record is what strands stop rows in the user's patch file.
  const installed = createInstalledManager({
    profile: profile.name,
    profileDir: profile.dir,
    home: profile.home,
    selfName: PACKAGE_NAME,
    loader: ctx.loader,
    pluginManager: () => ctx.get('pluginManager'),
    notifyLegacyChange: reason => ctx.emit('plugin-manager/changed', { reason }),
  })

  ctx.effect(async () => {
    let legacyPending: SafeMarketDomainState['pendingUninstall'] = []
    try {
      const domain = await ctx.storageDomain.open(safeMarketDomainSpec)
      if (seat.status === 'disposed' || disposeController.signal.aborted) {
        void domain.close()
        return disposeSeat
      }
      const persist = (next: SafeMarketDomainState): void => {
        // Durability is an optimization, and a failed write must not take the
        // market down with it — the reduction is still in memory either way.
        void domain.global.set(next).catch((error: unknown) => {
          console.warn('[dsh-market-pro] catalog cache write failed:', error)
        })
      }
      const stored = domain.global.get()
      const hadMemoryCatalog = seat.data.catalog !== null
      const clearTelemetry = !readSettings().telemetryEnabled || telemetryClearedWhileOpening
      const adopted = adoptDomainState(seat.data, stored, usable, { clearTelemetry })
      const telemetryChanged =
        adopted.telemetryId !== stored.telemetryId
        || adopted.telemetryLastPingDay !== stored.telemetryLastPingDay
        || adopted.telemetryLastPingKind !== stored.telemetryLastPingKind
      seat = { status: 'durable', data: adopted, persist, close: () => domain.close() }
      resolveDomainReady()
      if (
        hadMemoryCatalog
        || telemetryChanged
        || (adopted.catalog !== null && stored.catalog !== null && adopted.catalog !== stored.catalog)
      ) {
        // A read landed while the domain was opening, stored telemetry state was
        // cleared/updated, or the adopted disk catalog was compacted (legacy
        // subscription stripped): flush now instead of keeping stale or bloated
        // data on disk.
        persist(adopted)
      }
      legacyPending = adopted.pendingUninstall
    } catch (error) {
      if (seat.status !== 'disposed') {
        seat = { status: 'memory-only', data: seat.data }
      }
      resolveDomainReady()
      // A damaged or version-mismatched store must not take the market down
      // with it: the catalog and the skills page still run from memory, and
      // the next successful read simply cannot survive the restart.
      console.warn('[dsh-market-pro] catalog cache unavailable, running memory-only:', error)
    }
    if (seat.status === 'disposed' || disposeController.signal.aborted) {
      return disposeSeat
    }
    if (readSettings().enabled) catalog.warmup()
    if (!hostTelemetryDisabled && readSettings().telemetryEnabled) telemetry.scheduleBootPing()
    // A pending-uninstall record an older build kept in the domain store:
    // seed the file seat so this boot's sweep still takes its rows back,
    // then forget the field — the file is the seat from now on. Failures here
    // must never downgrade an already-open durable storage domain.
    if (legacyPending.length > 0) {
      try {
        await installed.adoptPending(legacyPending)
        updateSeatData({ ...seat.data, pendingUninstall: [] })
      } catch (error) {
        console.warn('[dsh-market-pro] legacy pending-uninstall migration failed:', error)
      }
    }
    // Take back last session's uninstall stop rows before serving: the
    // composition no longer carries their targets (or a reinstall wants
    // them gone), and the user's patch file should not keep our litter.
    try {
      await installed.sweep()
    } catch (error) {
      console.warn('[dsh-market-pro] boot uninstall sweep failed:', error)
    }
    return disposeSeat
  }, 'dsh-market-pro: catalog cache')

  const readMcp = () => inspectMcpContext(ctx, ctx.loader.entries() as Iterable<McpLoaderEntry>)

  const aiSkill = registerMarketAiSkill(ctx, {
    profile: profile.name,
    readSettings,
  })
  const safeGet = <T>(serviceName: string): T | undefined => {
    try {
      return (ctx as unknown as { get(name: string): T | undefined }).get(serviceName)
    } catch {
      return undefined
    }
  }
  const aiTool = registerMarketAiTool(ctx, {
    profile: profile.name,
    ...(dshVersion !== '' ? { dshVersion } : {}),
    readSettings,
    readCatalog: (force, signal) => catalog.read(force, signal),
    listInstalled: () => installed.list(),
    readMcp,
    pluginManager: () => safeGet<HostPluginManagerUpdateFace>('pluginManager'),
    pluginMarket: () => safeGet<HostPluginMarketUpdateFace>('pluginMarket'),
    getApprover: () => safeGet<MarketApprovalServiceFace>('approval'),
    onInstallOutcome: outcome => {
      telemetry.reportPluginInstall({
        target: outcome.spec,
        mode: 'ai',
        result: outcome.result,
        ...(outcome.result === 'failed'
          ? {
              errorCode: classifyInstallError(outcome.message, {
                inspectProblem: outcome.inspectProblem,
                errorCode: outcome.errorCode,
                packageKind: outcome.packageKind,
                timedOut: outcome.timedOut,
              }),
            }
          : {}),
      })
    },
  })
  const aiMcpTool = registerMarketAiMcpTool(ctx, {
    profile: profile.name,
    readSettings,
    entries: () => ctx.loader.entries() as Iterable<McpLoaderEntry>,
    onInstallOutcome: outcome => {
      telemetry.reportMcpInstall({
        target: outcome.featuredId,
        mode: 'ai',
        result: outcome.ok ? 'ok' : 'failed',
        ...(outcome.ok ? {} : { errorCode: classifyInstallError(outcome.error ?? '') }),
      })
    },
  })
  const reportSkillOutcome = (mode: 'featured' | 'ai', result: InstallFeaturedSkillResult): void => {
    if (result.ok) {
      telemetry.reportSkillInstall({ target: result.id, mode, result: 'ok' })
      return
    }
    if (result.code === 'already-exists' || result.code === 'invalid-project-dir' || result.code === 'not-found') {
      return
    }
    telemetry.reportSkillInstall({
      target: result.id,
      mode,
      result: 'failed',
      errorCode: classifyInstallError(result.error, { skillErrorCode: result.code }),
    })
  }
  const aiSkillsTool = registerMarketAiSkillsTool(ctx, {
    profile: profile.name,
    readSettings,
    onInstallOutcome: result => reportSkillOutcome('ai', result),
  })
  syncAiAssistant = () => {
    aiSkill.sync()
    aiTool.sync()
    aiMcpTool.sync()
    aiSkillsTool.sync()
  }
  ctx.on('loader/volatile-update', () => {
    syncAiAssistant?.()
    if (readSettings().enabled) catalog.warmup()
  })

  new SafeMarketRuntime(
    ctx,
    catalog,
    readSettings,
    writeSettings,
    (sessionId, signal) => readSkills(ctx, sessionId, signal),
    { profile: profile.name, version: selfVersion, ...(dshVersion !== '' ? { dshVersion } : {}), telemetrySuppressedByEnv },
    installed,
    readMcp,
    (name, signal) => probeManagedMcp(ctx, ctx.loader.entries() as Iterable<McpLoaderEntry>, name, signal),
    loaderId => adoptMcp(ctx, ctx.loader.entries() as Iterable<McpLoaderEntry>, loaderId),
    event => telemetry.handleClientEvent(event),
    async (request, signal) => {
      const result = await installFeaturedSkillOnHost(request, signal)
      reportSkillOutcome('featured', result)
      return result
    },
    request => deleteInstalledSkillOnHost(request),
  )

  // Strict endpoint registration: the gateway resolves the market's calls
  // from this manifest, independent of decorator marker state.
  ctx.effect(() => {
    const dispose = ctx.typert.register(TYPERT_MANIFEST)
    return () => { void dispose() }
  }, 'dsh-market-pro: typert manifest')

  // Everything above is owned by `ctx` and torn down with the fiber; abort
  // any in-flight catalog refresh immediately so teardown never waits on I/O.
  return disposeSeat
}
