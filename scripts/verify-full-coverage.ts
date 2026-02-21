#!/usr/bin/env tsx
/**
 * Exhaustive verification for Latvian Law MCP ingestion.
 *
 * Verifies, for every seed document:
 * 1) Source coverage: all structured provision anchors are represented in seed JSON.
 * 2) Content fidelity: every seed provision exactly matches freshly parsed source text.
 * 3) DB fidelity: every DB provision exactly matches seed JSON content.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { fetchWithRateLimit } from './lib/fetcher.js';
import { parseLatvianHtml, type ParsedAct, type ActIndexEntry } from './lib/parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dirname, '..', 'data', 'seed');
const SOURCE_DIR = join(__dirname, '..', 'data', 'source');
const DB_PATH = join(__dirname, '..', 'data', 'database.db');

function normalizeSection(sectionRaw: string): string {
  return sectionRaw
    .replace(/_/g, '.')
    .replace(/[^0-9A-Za-z.]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\./, '')
    .replace(/\.$/, '');
}

function extractRawArticleSections(html: string): string[] {
  const sections: string[] = [];
  const seen = new Set<string>();
  const startTagRegex = /<div[^>]*class=['"][^'"]*TV213[^'"]*['"][^>]*data-pfx=['"](?:p|pn)['"][^>]*>/gi;

  let match: RegExpExecArray | null;
  while ((match = startTagRegex.exec(html)) !== null) {
    const tag = match[0];
    const prefix = tag.match(/data-pfx=['"]([^'"]+)['"]/i)?.[1] ?? 'p';
    const window = html.slice(match.index, Math.min(html.length, match.index + 700));
    const sectionRaw = prefix === 'pn'
      ? (window.match(/<a\s+name=['"]pn([^'"]+)['"]/i)?.[1] ?? window.match(/data-num=['"]([^'"]+)['"]/i)?.[1])
      : (window.match(/<a\s+name=['"]p([^'"]+)['"]/i)?.[1] ?? window.match(/data-num=['"]([^'"]+)['"]/i)?.[1]);
    if (!sectionRaw) continue;

    const section = prefix === 'pn'
      ? `pn${normalizeSection(sectionRaw)}`
      : normalizeSection(sectionRaw);

    if (!section || seen.has(section)) continue;
    seen.add(section);
    sections.push(section);
  }

  return sections;
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function dedupeBySectionLongest<T extends { section: string; content: string; title?: string }>(provisions: T[]): T[] {
  const bySection = new Map<string, T>();
  for (const provision of provisions) {
    const key = String(provision.section);
    const existing = bySection.get(key);
    if (!existing || normalizeWhitespace(provision.content).length > normalizeWhitespace(existing.content).length) {
      bySection.set(key, provision);
    }
  }
  return Array.from(bySection.values());
}

function toMapBySection(provisions: { section: string; content: string; title?: string }[]): Map<string, { content: string; title?: string }> {
  const map = new Map<string, { content: string; title?: string }>();
  for (const p of provisions) {
    map.set(String(p.section), { content: p.content, title: p.title });
  }
  return map;
}

function diffSets(name: string, expected: Set<string>, actual: Set<string>): { ok: boolean; message?: string } {
  const missing = [...expected].filter(x => !actual.has(x));
  const extra = [...actual].filter(x => !expected.has(x));
  if (missing.length === 0 && extra.length === 0) return { ok: true };

  const missingPreview = missing.slice(0, 10).join(', ');
  const extraPreview = extra.slice(0, 10).join(', ');
  return {
    ok: false,
    message: `${name}: missing=${missing.length}${missing.length ? ` [${missingPreview}]` : ''}; extra=${extra.length}${extra.length ? ` [${extraPreview}]` : ''}`,
  };
}

function actFromSeed(seed: ParsedAct, seedFile: string): ActIndexEntry | null {
  const urlMatch = (seed.url ?? '').match(/\/ta\/id\/(\d+)(?:-([^\/#?]+))?/);
  if (!urlMatch) return null;

  const likumiId = Number.parseInt(urlMatch[1], 10);
  if (!Number.isFinite(likumiId)) return null;

  return {
    id: seed.id,
    seedFile: seedFile.replace(/\.json$/, ''),
    likumiId,
    slug: (urlMatch[2] ?? 'untitled').trim() || 'untitled',
    shortName: seed.short_name ?? `TA-${likumiId}`,
  };
}

function buildSourceUrl(act: ActIndexEntry): string {
  return act.slug === 'untitled'
    ? `https://likumi.lv/ta/id/${act.likumiId}`
    : `https://likumi.lv/ta/id/${act.likumiId}-${act.slug}`;
}

async function main(): Promise<void> {
  console.log('Latvian Law MCP — Full Coverage Verification');
  console.log('============================================\n');

  const db = new Database(DB_PATH, { readonly: true });
  let failures = 0;
  let totalProvisions = 0;

  const seedFiles = readdirSync(SEED_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('.') && !f.startsWith('_'))
    .sort();

  for (const seedFile of seedFiles) {
    const seedPath = join(SEED_DIR, seedFile);
    const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as ParsedAct;
    const act = actFromSeed(seed, seedFile);

    if (!act) {
      console.log(`FAIL ${seed.id}: invalid source URL in seed (${seed.url ?? 'missing'})`);
      failures++;
      continue;
    }

    const cachedSourcePath = join(SOURCE_DIR, `${act.seedFile}.lv.html`);
    let sourceHtml: string;

    if (existsSync(cachedSourcePath)) {
      sourceHtml = readFileSync(cachedSourcePath, 'utf8');
    } else {
      const source = await fetchWithRateLimit(buildSourceUrl(act));
      if (source.status !== 200) {
        console.log(`FAIL ${act.id}: source HTTP ${source.status}`);
        failures++;
        continue;
      }
      sourceHtml = source.body;
    }

    const parsedFresh = parseLatvianHtml(sourceHtml, act);
    const freshNormalized = dedupeBySectionLongest(parsedFresh.provisions.map(p => ({ section: String(p.section), content: p.content, title: p.title })));
    const seedNormalized = dedupeBySectionLongest(seed.provisions.map(p => ({ section: String(p.section), content: p.content, title: p.title })));

    const rawSet = new Set(extractRawArticleSections(sourceHtml));
    const seedSet = new Set(seedNormalized.map(p => String(p.section)));
    const freshSet = new Set(freshNormalized.map(p => String(p.section)));

    const sourceCoverage = rawSet.size > 0
      ? diffSets(`${act.id} source->seed`, rawSet, seedSet)
      : diffSets(`${act.id} source(no-anchors)->seed`, freshSet, seedSet);

    const parserCoverage = diffSets(`${act.id} parser->seed`, freshSet, seedSet);

    let actFailed = false;
    if (!sourceCoverage.ok) {
      console.log(`FAIL ${sourceCoverage.message}`);
      failures++;
      actFailed = true;
    }
    if (!parserCoverage.ok) {
      console.log(`FAIL ${parserCoverage.message}`);
      failures++;
      actFailed = true;
    }

    const freshMap = toMapBySection(freshNormalized);
    const seedMap = toMapBySection(seedNormalized);

    for (const section of seedSet) {
      const fresh = freshMap.get(section);
      const fromSeed = seedMap.get(section);
      if (!fresh || !fromSeed) continue;

      if (fresh.content !== fromSeed.content) {
        console.log(`FAIL ${act.id} section ${section}: seed content != fresh source parse`);
        failures++;
        actFailed = true;
        break;
      }
    }

    const dbRowsRaw = db.prepare(
      'SELECT section, content FROM legal_provisions WHERE document_id = ? ORDER BY id'
    ).all(act.id) as { section: string; content: string }[];
    const dbRows = dedupeBySectionLongest(dbRowsRaw.map(r => ({ section: String(r.section), content: r.content })));

    const dbSet = new Set(dbRows.map(r => String(r.section)));
    const dbCoverage = diffSets(`${act.id} seed->db`, seedSet, dbSet);
    if (!dbCoverage.ok) {
      console.log(`FAIL ${dbCoverage.message}`);
      failures++;
      actFailed = true;
    }

    const dbMap = new Map<string, string>();
    for (const row of dbRows) dbMap.set(String(row.section), row.content);

    for (const section of seedSet) {
      const seedProv = seedMap.get(section);
      const dbContent = dbMap.get(section);
      if (!seedProv || dbContent === undefined) continue;

      if (seedProv.content !== dbContent) {
        console.log(`FAIL ${act.id} section ${section}: db content != seed content`);
        failures++;
        actFailed = true;
        break;
      }
    }

    totalProvisions += seedNormalized.length;

    if (!actFailed) {
      const docHash = sha256(seedNormalized.map(p => `${p.section}\n${p.content}`).join('\n\n'));
      console.log(`OK   ${act.id}: provisions=${seedNormalized.length} aggregate_sha256=${docHash}`);
    }
  }

  db.close();

  console.log(`\nChecked provisions: ${totalProvisions}`);

  if (failures > 0) {
    console.log(`Verification failed with ${failures} issue(s).`);
    process.exit(1);
  }

  console.log('Verification passed: source, seed, and DB are fully consistent for all ingested acts.');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
