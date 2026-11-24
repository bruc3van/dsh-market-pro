import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REPOSITORY_SLUG_PATTERN } from '../src/shapes.ts'
import { en, zh, type SafeMarketLocaleKey } from '../src/client/locales.ts'
import {
  FEATURED_SKILLS,
  FEATURED_SKILL_CATEGORIES,
  featuredForSkill,
  featuredSkillGithubUrl,
  featuredSkillIconUrl,
  featuredSkillInstallCommand,
  featuredSkillSkillsShUrl,
  findFeaturedSkillById,
  findInstalledFeaturedSkill,
  formatSkillInstalls,
  matchesFeaturedSkill,
  matchesFeaturedSkillOrigin,
} from '../src/skillsFeatured.ts'

test('curated skills catalog invariants: exactly 100 verified All Time entries, unique ids/paths, and locales', () => {
  assert.equal(FEATURED_SKILLS.length, 100, 'catalog must contain exactly 100 curated skills')

  const categories = new Set<string>(FEATURED_SKILL_CATEGORIES)
  for (const category of FEATURED_SKILL_CATEGORIES) {
    const key = `skills.featured.category.${category}` as SafeMarketLocaleKey
    assert.ok(zh[key].trim() !== '', `missing zh copy for ${key}`)
    assert.ok(en[key].trim() !== '', `missing en copy for ${key}`)
  }

  const ids = new Set<string>()
  const skillIds = new Set<string>()
  const names = new Set<string>()
  const repoPaths = new Set<string>()
  let previousInstalls = Number.POSITIVE_INFINITY
  let officialCount = 0

  for (const item of FEATURED_SKILLS) {
    assert.match(
      featuredSkillIconUrl(item) ?? '',
      /^https:\/\/avatars\.githubusercontent\.com\/u\/\d+\?s=96&v=4$/,
      `missing numeric GitHub avatar URL for ${item.id}`,
    )
    assert.equal(ids.has(item.id), false, `duplicate id ${item.id}`)
    ids.add(item.id)
    assert.equal(item.id, `${item.source}/${item.skillId}`, `id mismatch for ${item.id}`)

    const skillIdKey = item.skillId.trim().toLowerCase()
    assert.equal(skillIds.has(skillIdKey), false, `duplicate skillId ${item.skillId}`)
    skillIds.add(skillIdKey)

    const nameKey = item.name.trim().toLowerCase()
    assert.equal(names.has(nameKey), false, `duplicate name ${item.name}`)
    names.add(nameKey)

    assert.match(item.source, REPOSITORY_SLUG_PATTERN, `invalid GitHub repo slug ${item.source}`)
    assert.ok(item.skillId.trim() !== '', `empty skillId on ${item.id}`)
    assert.ok(item.name.trim() !== '', `empty name on ${item.id}`)
    assert.ok(!item.path.startsWith('/') && !item.path.includes('..'), `unsafe subpath "${item.path}" on ${item.id}`)

    const repoPathKey = `${item.source.toLowerCase()}::${item.path.toLowerCase()}`
    assert.equal(repoPaths.has(repoPathKey), false, `duplicate repo+path ${repoPathKey}`)
    repoPaths.add(repoPathKey)

    assert.ok(categories.has(item.category), `unknown category ${item.category} on ${item.id}`)
    assert.ok(Number.isInteger(item.installs) && item.installs > 0, `invalid installs count on ${item.id}`)
    assert.ok(item.installs <= previousInstalls, `catalog should be ordered by installs desc at ${item.id}`)
    previousInstalls = item.installs
    if (item.official) officialCount += 1

    assert.ok(item.descriptionZh.trim() !== '', `empty descriptionZh on ${item.id}`)
    assert.ok(item.descriptionEn.trim() !== '', `empty descriptionEn on ${item.id}`)
  }

  assert.ok(officialCount >= 30, 'expected substantial official skill coverage')
})

test('featured skill URL, command, and installs formatting helpers', () => {
  const nested = findFeaturedSkillById('vercel-labs/skills/find-skills')
  assert.ok(nested)
  assert.equal(featuredSkillGithubUrl(nested), 'https://github.com/vercel-labs/skills/tree/HEAD/skills/find-skills')
  assert.equal(featuredSkillSkillsShUrl(nested), 'https://skills.sh/vercel-labs/skills/find-skills')
  assert.equal(featuredSkillInstallCommand(nested), 'npx skills add vercel-labs/skills --skill find-skills')

  const rootSkill = findFeaturedSkillById('design-doc-mermaid')
  assert.ok(rootSkill)
  assert.equal(rootSkill.path, '')
  assert.equal(featuredSkillGithubUrl(rootSkill), 'https://github.com/spillwavesolutions/design-doc-mermaid')

  assert.equal(formatSkillInstalls(4_495_339), '4.5M')
  assert.equal(formatSkillInstalls(1_000_000), '1M')
  assert.equal(formatSkillInstalls(924_915), '925K')
  assert.equal(formatSkillInstalls(86_575), '86.6K')
  assert.equal(formatSkillInstalls(500), '500')
  assert.equal(formatSkillInstalls(0), '')
})

test('matchesFeaturedSkill filters by category, official badge, and bilingual search terms', () => {
  const larkDoc = findFeaturedSkillById('lark-doc')
  assert.ok(larkDoc)
  assert.equal(matchesFeaturedSkill(larkDoc, '飞书 云文档', 'integrations-sharing', 'all'), true)
  assert.equal(matchesFeaturedSkill(larkDoc, 'lark', 'integrations-sharing', 'official'), false)
  assert.equal(matchesFeaturedSkill(larkDoc, '飞书', 'ui-experience', 'all'), false)

  const reactSkill = findFeaturedSkillById('vercel-react-best-practices')
  assert.ok(reactSkill)
  assert.equal(reactSkill.official, true)
  assert.equal(matchesFeaturedSkill(reactSkill, 'vercel nextjs', 'ui-experience', 'official'), true)
  assert.equal(matchesFeaturedSkill(reactSkill, 'nonexistent-xyz', 'all', 'all'), false)
  assert.equal(matchesFeaturedSkillOrigin(reactSkill, 'all'), true)
  assert.equal(matchesFeaturedSkillOrigin(reactSkill, 'official'), true)
  assert.equal(matchesFeaturedSkillOrigin(larkDoc, 'official'), false)
})

test('findInstalledFeaturedSkill requires verified featuredId provenance and ignores same-name custom skills', () => {
  const installed = [
    { name: 'frontend-design', source: 'user-dsh', sourceDirectory: '~/.dsh/skills', featuredId: 'anthropics/skills/frontend-design' },
    { name: 'Lark-Doc', source: 'project-agents', sourceDirectory: '.agents/skills', featuredId: 'Larksuite/CLI/Lark-Doc' },
    // A manually copied local skill sharing a generic curated name without provenance must NOT match.
    { name: 'code-review', source: 'user-dsh', sourceDirectory: '~/.dsh/skills' },
  ]
  const frontend = findFeaturedSkillById('anthropics/skills/frontend-design')!
  const larkDoc = findFeaturedSkillById('larksuite/cli/lark-doc')!
  const codeReview = findFeaturedSkillById('mattpocock/skills/code-review')!
  const pdf = findFeaturedSkillById('anthropics/skills/pdf')!

  assert.equal(findInstalledFeaturedSkill(frontend, installed)?.name, 'frontend-design')
  assert.equal(findInstalledFeaturedSkill(larkDoc, installed)?.name, 'Lark-Doc')
  assert.equal(findInstalledFeaturedSkill(codeReview, installed), null)
  assert.equal(findInstalledFeaturedSkill(pdf, installed), null)
})

test('featuredForSkill resolves curated catalog entries strictly from verified featuredId', () => {
  assert.equal(featuredForSkill({ featuredId: 'anthropics/skills/frontend-design' })?.id, 'anthropics/skills/frontend-design')
  assert.equal(featuredForSkill({ featuredId: '  Larksuite/CLI/Lark-Doc  ' })?.id, 'larksuite/cli/lark-doc')
  // Bare skill names or unknown ids never resolve to curated metadata.
  assert.equal(featuredForSkill({ featuredId: undefined }), undefined)
  assert.equal(featuredForSkill({ featuredId: 'frontend-design' }), undefined)
  assert.equal(featuredForSkill({ featuredId: 'my-custom-local-skill' }), undefined)
  assert.equal(featuredForSkill({ featuredId: '   ' }), undefined)
})
