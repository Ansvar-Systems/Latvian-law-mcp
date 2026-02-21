#!/usr/bin/env tsx
/**
 * Exhaustive verification for Latvian Law MCP ingestion.
 *
 * Verifies, for every configured act:
 * 1) Source coverage: all article anchors (#p...) are represented in seed JSON.
 * 2) Content fidelity: every seed provision exactly matches freshly parsed source text.
 * 3) DB fidelity: every DB provision exactly matches seed JSON content.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { fetchWithRateLimit } from './lib/fetcher.js';
import { KEY_LATVIAN_ACTS, parseLatvianHtml, type ParsedAct } from './lib/parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dirname, '..', 'data', 'seed');
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
  const startTagRegex = /<div[^>]*class=['"][^'"]*TV213[^'"]*['"][^>]*data-pfx=['"]p['"][^>]*>/gi;

  let match: RegExpExecArray | null;
  while ((match = startTagRegex.exec(html)) !== null) {
    const window = html.slice(match.index, Math.min(html.length, match.index + 600));
    const sectionRaw = window.match(/<a\s+name=['"]p([^'"]+)['"]/i)?.[1]
      ?? window.match(/data-num=['"]([^'"]+)['"]/i)?.[1]
      ?? null;
    if (!sectionRaw) continue;

    const section = normalizeSection(sectionRaw);
    if (!section || seen.has(section)) continue;
    seen.add(section);
    sections.push(section);
  }

  return sections;
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function toMapBySection(provisions: { section: string; content: string; title?: string }[]): Map<string, { content: string; title?: string }> {
  const map = new Map<string, { content: string; title?: string }>();
  for (const p of provisions) {
    map.set(p.section, { content: p.content, title: p.title });
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

async function main(): Promise<void> {
  console.log('Latvian Law MCP — Full Coverage Verification');
  console.log('============================================\n');

  const db = new Database(DB_PATH, { readonly: true });
  let failures = 0;
  let totalProvisions = 0;

  for (const act of KEY_LATVIAN_ACTS) {
    const sourceUrl = `https://likumi.lv/ta/id/${act.likumiId}-${act.slug}`;
    const source = await fetchWithRateLimit(sourceUrl);

    if (source.status !== 200) {
      console.log(`FAIL ${act.id}: source HTTP ${source.status}`);
      failures++;
      continue;
    }

    const parsedFresh = parseLatvianHtml(source.body, act);
    const rawSections = extractRawArticleSections(source.body);
    const rawSet = new Set(rawSections);

    const seedPath = join(SEED_DIR, `${act.seedFile}.json`);
    const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as ParsedAct;
    const seedSet = new Set(seed.provisions.map(p => p.section));

    const freshSet = new Set(parsedFresh.provisions.map(p => p.section));

    const sourceCoverage = diffSets(`${act.id} source->seed`, rawSet, seedSet);
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

    const freshMap = toMapBySection(parsedFresh.provisions.map(p => ({ section: p.section, content: p.content, title: p.title })));
    const seedMap = toMapBySection(seed.provisions.map(p => ({ section: p.section, content: p.content, title: p.title })));

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

    const dbRows = db.prepare(
      'SELECT section, content FROM legal_provisions WHERE document_id = ? ORDER BY id'
    ).all(act.id) as { section: string; content: string }[];

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

    totalProvisions += seed.provisions.length;

    if (!actFailed) {
      const docHash = sha256(seed.provisions.map(p => `${p.section}\n${p.content}`).join('\n\n'));
      console.log(`OK   ${act.id}: provisions=${seed.provisions.length} aggregate_sha256=${docHash}`);
    }
  }

  db.close();

  console.log(`\nChecked provisions: ${totalProvisions}`);

  if (failures > 0) {
    console.log(`Verification failed with ${failures} issue(s).`);
    process.exit(1);
  }

  console.log('Verification passed: source, seed, and DB are fully consistent for all configured acts.');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
