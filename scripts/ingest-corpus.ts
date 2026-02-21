#!/usr/bin/env tsx
/**
 * Latvian corpus ingestion.
 *
 * Default mode ingests the full "laws" corpus from the official Likumi.lv
 * law-index endpoint (Saeima + veids=likumi, no amendments).
 *
 * Optional mode (`--include-non-laws`) switches source discovery to sitemap.xml.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fetchWithRateLimit } from './lib/fetcher.js';
import { parseLatvianHtml, KEY_LATVIAN_ACTS, type ActIndexEntry, type ParsedAct } from './lib/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = path.resolve(__dirname, '../data/source');
const SEED_DIR = path.resolve(__dirname, '../data/seed');
const REPORT_PATH = path.resolve(SEED_DIR, '_corpus-report.json');
const SITEMAP_CACHE = path.resolve(SOURCE_DIR, '_sitemap.xml');
const LAW_INDEX_ENDPOINT = 'https://likumi.lv/ajax/ties_akti_pec_veida.php';
const LAW_INDEX_ALPHA = 'AĀBCČDEĒFGĢHIĪJKĶLĻMNŅOPRSŠTUŪVZŽ';

interface Args {
  limit: number | null;
  offset: number;
  skipExisting: boolean;
  includeNonLaws: boolean;
  includeRepealed: boolean;
  refreshSitemap: boolean;
}

interface ActEntry {
  likumiId: number;
  slug: string;
}

interface ExistingSeedRef {
  seedFile: string;
  documentId: string;
}

interface LawIndexStats {
  rows: number;
  pieces: number;
  chunk_size: number;
}

interface LawIndexRow {
  doc_id: string;
  title: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let offset = 0;
  let skipExisting = true;
  let includeNonLaws = false;
  let includeRepealed = true;
  let refreshSitemap = false;

  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (value === '--limit' && args[i + 1]) {
      limit = Number.parseInt(args[i + 1], 10);
      i++;
      continue;
    }
    if (value === '--offset' && args[i + 1]) {
      offset = Number.parseInt(args[i + 1], 10);
      i++;
      continue;
    }
    if (value === '--no-skip-existing') {
      skipExisting = false;
      continue;
    }
    if (value === '--include-non-laws') {
      includeNonLaws = true;
      continue;
    }
    if (value === '--exclude-repealed') {
      includeRepealed = false;
      continue;
    }
    if (value === '--refresh-sitemap') {
      refreshSitemap = true;
      continue;
    }
  }

  return {
    limit: Number.isFinite(limit ?? NaN) ? limit : null,
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
    skipExisting,
    includeNonLaws,
    includeRepealed,
    refreshSitemap,
  };
}

function sanitizeSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'untitled';
}

function titleFromEnglishSlug(slug: string): string | undefined {
  if (!slug || slug === 'untitled') return undefined;
  const normalized = slug.replace(/[-_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!normalized) return undefined;

  return normalized
    .split(' ')
    .map(token => {
      if (/^(eu|ec|eec|gdpr|ai|ict|it|id)$/i.test(token)) return token.toUpperCase();
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(' ');
}

function extractLikumiIdFromUrl(url: string | undefined): number | null {
  if (!url) return null;
  const match = url.match(/\/ta\/id\/(\d+)/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function loadExistingSeedRefs(): Map<number, ExistingSeedRef> {
  const map = new Map<number, ExistingSeedRef>();
  if (!fs.existsSync(SEED_DIR)) return map;

  const seedFiles = fs.readdirSync(SEED_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('.') && !f.startsWith('_'));

  for (const seedFile of seedFiles) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(SEED_DIR, seedFile), 'utf8')) as ParsedAct;
      const likumiId = extractLikumiIdFromUrl(parsed.url);
      if (!likumiId) continue;
      map.set(likumiId, {
        seedFile: seedFile.replace(/\.json$/, ''),
        documentId: parsed.id,
      });
    } catch {
      // Skip malformed files; validation/build steps will report them.
    }
  }

  return map;
}

function buildLawIndexQuery(piece: number, includeRepealed: boolean): URLSearchParams {
  const now = new Date();
  const tstamp = `${now.getFullYear()}${now.getMonth()}${now.getDate()}`;
  const params = new URLSearchParams({
    piece: String(piece),
    mode: 'i',
    alpha: LAW_INDEX_ALPHA,
    izd_id: '138',
    veids_id: '84',
    spe: '1',
    vnspe: '1',
    ngr: '1',
    oby: 'pub_dat',
    odir: 'desc',
    tstamp,
  });

  if (includeRepealed) {
    params.set('spz', '1');
  }

  return params;
}

function extractEntryFromRow(row: LawIndexRow): ActEntry | null {
  const hrefMatch = row.title.match(/href=['"]\/ta\/id\/(\d+)(?:-([^'"]+))?/i);
  if (hrefMatch) {
    const likumiId = Number.parseInt(hrefMatch[1], 10);
    if (!Number.isFinite(likumiId)) return null;
    return {
      likumiId,
      slug: sanitizeSlug((hrefMatch[2] ?? '').trim()),
    };
  }

  const fallbackId = Number.parseInt(row.doc_id, 10);
  if (!Number.isFinite(fallbackId)) return null;
  return {
    likumiId: fallbackId,
    slug: 'untitled',
  };
}

async function fetchLawIndexEntries(includeRepealed: boolean): Promise<{ entries: ActEntry[]; stats: LawIndexStats }> {
  const statsParams = buildLawIndexQuery(0, includeRepealed);
  statsParams.set('qwstats', '1');

  const statsResponse = await fetchWithRateLimit(`${LAW_INDEX_ENDPOINT}?${statsParams.toString()}`);
  if (statsResponse.status !== 200) {
    throw new Error(`Law index stats request failed (HTTP ${statsResponse.status})`);
  }

  const stats = JSON.parse(statsResponse.body) as LawIndexStats;
  if (!Number.isFinite(stats.pieces) || stats.pieces <= 0) {
    throw new Error('Law index stats response is invalid');
  }

  const byId = new Map<number, string>();

  for (let piece = 0; piece < stats.pieces; piece++) {
    const params = buildLawIndexQuery(piece, includeRepealed);
    const response = await fetchWithRateLimit(`${LAW_INDEX_ENDPOINT}?${params.toString()}`);
    if (response.status !== 200) {
      throw new Error(`Law index piece ${piece} failed (HTTP ${response.status})`);
    }

    const rows = JSON.parse(response.body) as LawIndexRow[];
    for (const row of rows) {
      const entry = extractEntryFromRow(row);
      if (!entry) continue;

      const existing = byId.get(entry.likumiId);
      if (!existing || (existing === 'untitled' && entry.slug !== 'untitled')) {
        byId.set(entry.likumiId, entry.slug);
      }
    }
  }

  for (const keyAct of KEY_LATVIAN_ACTS) {
    if (!byId.has(keyAct.likumiId)) {
      byId.set(keyAct.likumiId, keyAct.slug);
    }
  }

  return {
    entries: Array.from(byId.entries())
      .map(([likumiId, slug]) => ({ likumiId, slug }))
      .sort((a, b) => a.likumiId - b.likumiId),
    stats,
  };
}

async function loadSitemapXml(refresh: boolean): Promise<string> {
  fs.mkdirSync(SOURCE_DIR, { recursive: true });

  if (!refresh && fs.existsSync(SITEMAP_CACHE)) {
    return fs.readFileSync(SITEMAP_CACHE, 'utf8');
  }

  const fetched = await fetchWithRateLimit('https://likumi.lv/sitemap.xml');
  if (fetched.status !== 200) {
    throw new Error(`Unable to fetch sitemap.xml (HTTP ${fetched.status})`);
  }

  fs.writeFileSync(SITEMAP_CACHE, fetched.body);
  return fetched.body;
}

function parseSitemapEntries(xml: string): ActEntry[] {
  const byId = new Map<number, string>();
  const re = /<loc>\s*https:\/\/likumi\.lv\/ta\/id\/(\d+)(?:-([^<\s]+))?\s*<\/loc>/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(xml)) !== null) {
    const likumiId = Number.parseInt(match[1], 10);
    if (!Number.isFinite(likumiId)) continue;

    const slug = sanitizeSlug((match[2] ?? '').trim());
    const existing = byId.get(likumiId);
    if (!existing || (existing === 'untitled' && slug !== 'untitled')) {
      byId.set(likumiId, slug);
    }
  }

  return Array.from(byId.entries())
    .map(([likumiId, slug]) => ({ likumiId, slug }))
    .sort((a, b) => a.likumiId - b.likumiId);
}

function buildLvUrl(likumiId: number, slug: string): string {
  if (!slug || slug === 'untitled') return `https://likumi.lv/ta/id/${likumiId}`;
  return `https://likumi.lv/ta/id/${likumiId}-${slug}`;
}

async function fetchLvHtml(entry: ActEntry): Promise<{ body: string; finalUrl: string }> {
  const primary = await fetchWithRateLimit(buildLvUrl(entry.likumiId, entry.slug));
  if (primary.status === 200) {
    return { body: primary.body, finalUrl: primary.url };
  }

  if (entry.slug !== 'untitled') {
    const fallback = await fetchWithRateLimit(buildLvUrl(entry.likumiId, 'untitled'));
    if (fallback.status === 200) {
      return { body: fallback.body, finalUrl: fallback.url };
    }
  }

  throw new Error(`LV fetch failed (HTTP ${primary.status})`);
}

function resolveCanonicalSlug(url: string, fallbackSlug: string): string {
  const slug = url.match(/\/ta\/id\/\d+-([^\/?#]+)/)?.[1];
  return sanitizeSlug(slug ?? fallbackSlug);
}

function extractEnglishTitleHint(lvHtml: string): string | undefined {
  const href = lvHtml.match(/rel-text=['"]English['"]\s*href=['"]([^'"]+)['"]/i)?.[1];
  if (!href || !href.includes('/ta/en/en/id/')) return undefined;

  const slug = href.match(/\/ta\/en\/en\/id\/\d+-([^\/?#]+)/i)?.[1];
  if (!slug) return undefined;
  return titleFromEnglishSlug(sanitizeSlug(slug));
}

function toActConfig(entry: ActEntry): ActIndexEntry {
  const key = KEY_LATVIAN_ACTS.find(act => act.likumiId === entry.likumiId);
  if (key) return key;

  return {
    id: `lv-law-${entry.likumiId}`,
    seedFile: `law-${entry.likumiId}-${entry.slug}`.slice(0, 120),
    likumiId: entry.likumiId,
    slug: entry.slug,
    shortName: `TA-${entry.likumiId}`,
  };
}

async function main(): Promise<void> {
  const { limit, offset, skipExisting, includeNonLaws, includeRepealed, refreshSitemap } = parseArgs();

  fs.mkdirSync(SOURCE_DIR, { recursive: true });
  fs.mkdirSync(SEED_DIR, { recursive: true });

  console.log('Latvian Law MCP -- Corpus Ingestion');
  console.log('===================================\n');
  console.log('  Request throttle:  1200ms between requests');
  console.log(`  Include non-laws:  ${includeNonLaws ? 'yes' : 'no'}`);
  console.log(`  Include repealed:  ${includeRepealed ? 'yes' : 'no'}`);
  console.log(`  Skip existing:     ${skipExisting ? 'yes' : 'no'}`);
  if (offset > 0) console.log(`  Offset:            ${offset}`);
  if (limit !== null) console.log(`  Limit:             ${limit}`);
  console.log('');

  let discoveredCount = 0;
  let allEntries: ActEntry[] = [];
  let sourceLabel = '';

  if (includeNonLaws) {
    sourceLabel = 'https://likumi.lv/sitemap.xml';
    const xml = await loadSitemapXml(refreshSitemap);
    allEntries = parseSitemapEntries(xml);
    discoveredCount = allEntries.length;
  } else {
    sourceLabel = `${LAW_INDEX_ENDPOINT} (Saeima/likumi, ngr=1)`;
    const lawIndex = await fetchLawIndexEntries(includeRepealed);
    allEntries = lawIndex.entries;
    discoveredCount = lawIndex.stats.rows;
  }

  const selected = allEntries.slice(offset, limit !== null ? offset + limit : undefined);
  const existing = loadExistingSeedRefs();

  console.log(`  Source:                  ${sourceLabel}`);
  console.log(`  Source-reported rows:    ${discoveredCount}`);
  console.log(`  Candidate corpus acts:   ${allEntries.length}`);
  console.log(`  Selected this run:       ${selected.length}`);
  console.log(`  Existing seeded acts:    ${existing.size}\n`);

  let ingested = 0;
  let skippedExisting = 0;
  let failed = 0;
  let withEnglishTitle = 0;
  let totalProvisions = 0;
  let totalDefinitions = 0;

  const failures: Array<{ likumiId: number; reason: string }> = [];

  for (let idx = 0; idx < selected.length; idx++) {
    const entry = selected[idx];
    if (skipExisting && existing.has(entry.likumiId)) {
      skippedExisting++;
      continue;
    }

    const act = toActConfig(entry);
    const seedPath = path.join(SEED_DIR, `${act.seedFile}.json`);
    const sourceLvPath = path.join(SOURCE_DIR, `${act.seedFile}.lv.html`);

    if (skipExisting && fs.existsSync(seedPath)) {
      skippedExisting++;
      continue;
    }

    try {
      process.stdout.write(`  [${idx + 1}/${selected.length}] ${entry.likumiId} fetch LV...`);
      const lv = await fetchLvHtml(entry);
      fs.writeFileSync(sourceLvPath, lv.body);
      console.log(` OK (${(lv.body.length / 1024).toFixed(0)} KB)`);

      const canonicalSlug = resolveCanonicalSlug(lv.finalUrl, entry.slug);
      if (canonicalSlug && canonicalSlug !== act.slug) {
        act.slug = canonicalSlug;
      }

      const parsed = parseLatvianHtml(lv.body, act);
      const titleEnHint = extractEnglishTitleHint(lv.body);
      if (!parsed.title_en && titleEnHint) parsed.title_en = titleEnHint;

      if (parsed.title_en) withEnglishTitle++;
      totalProvisions += parsed.provisions.length;
      totalDefinitions += parsed.definitions.length;

      fs.writeFileSync(seedPath, JSON.stringify(parsed, null, 2));
      existing.set(entry.likumiId, { seedFile: act.seedFile, documentId: parsed.id });
      ingested++;

      console.log(
        `      -> ${parsed.id}: provisions=${parsed.provisions.length}, definitions=${parsed.definitions.length}`
      );
    } catch (error) {
      failed++;
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ likumiId: entry.likumiId, reason });
      console.log(`  [${idx + 1}/${selected.length}] ${entry.likumiId} ERROR ${reason}`);
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    source: sourceLabel,
    source_reported_rows: discoveredCount,
    corpus_candidates: allEntries.length,
    selected: selected.length,
    ingested,
    skipped_existing: skippedExisting,
    failed,
    with_english_title: withEnglishTitle,
    total_provisions: totalProvisions,
    total_definitions: totalDefinitions,
    failures,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log('\nCorpus ingestion report');
  console.log('-----------------------');
  console.log(`  ingested:            ${ingested}`);
  console.log(`  skipped existing:    ${skippedExisting}`);
  console.log(`  failed:              ${failed}`);
  console.log(`  docs with title_en:  ${withEnglishTitle}`);
  console.log(`  provisions added:    ${totalProvisions}`);
  console.log(`  definitions added:   ${totalDefinitions}`);
  console.log(`  report:              ${REPORT_PATH}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
