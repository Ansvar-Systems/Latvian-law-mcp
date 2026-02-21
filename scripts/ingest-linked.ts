#!/usr/bin/env tsx
/**
 * Expand corpus by ingesting laws directly linked from already fetched sources.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fetchWithRateLimit } from './lib/fetcher.js';
import { KEY_LATVIAN_ACTS, parseLatvianHtml, buildEnglishUrl, type ActIndexEntry, type ParsedAct } from './lib/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = path.resolve(__dirname, '../data/source');
const SEED_DIR = path.resolve(__dirname, '../data/seed');

interface LinkEntry {
  likumiId: number;
  slug: string;
  refs: number;
}

function parseArgs(): { limit: number | null; skipExisting: boolean } {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let skipExisting = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = Number.parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--no-skip-existing') {
      skipExisting = false;
    }
  }

  return { limit, skipExisting };
}

function sanitizeSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'untitled';
}

function discoverLinkedActs(): LinkEntry[] {
  const baseLikumiIds = new Set(KEY_LATVIAN_ACTS.map(a => a.likumiId));
  const map = new Map<number, { slug: string; refs: number }>();

  const files = fs.readdirSync(SOURCE_DIR).filter(f => f.endsWith('.lv.html'));
  for (const file of files) {
    const html = fs.readFileSync(path.join(SOURCE_DIR, file), 'utf8');
    const re = /href=['"]\/ta\/id\/(\d+)(?:-([^'"#?]+))?/g;
    let match: RegExpExecArray | null;

    while ((match = re.exec(html)) !== null) {
      const likumiId = Number.parseInt(match[1], 10);
      if (!Number.isFinite(likumiId) || baseLikumiIds.has(likumiId)) continue;

      const slug = sanitizeSlug((match[2] ?? '').trim());
      const existing = map.get(likumiId);
      if (existing) {
        existing.refs++;
        if (existing.slug === 'untitled' && slug !== 'untitled') existing.slug = slug;
      } else {
        map.set(likumiId, { slug, refs: 1 });
      }
    }
  }

  return [...map.entries()]
    .map(([likumiId, value]) => ({ likumiId, slug: value.slug, refs: value.refs }))
    .sort((a, b) => b.refs - a.refs || a.likumiId - b.likumiId);
}

function toActConfig(entry: LinkEntry): ActIndexEntry {
  const id = `lv-law-${entry.likumiId}`;
  const seedFile = `linked-${entry.likumiId}-${entry.slug}`.slice(0, 120);
  return {
    id,
    seedFile,
    likumiId: entry.likumiId,
    slug: entry.slug,
    shortName: `TA-${entry.likumiId}`,
  };
}

function buildLvUrl(act: ActIndexEntry, forceBare = false): string {
  if (forceBare || !act.slug || act.slug === 'untitled') {
    return `https://likumi.lv/ta/id/${act.likumiId}`;
  }
  return `https://likumi.lv/ta/id/${act.likumiId}-${act.slug}`;
}

async function fetchLvHtml(act: ActIndexEntry): Promise<string> {
  const first = await fetchWithRateLimit(buildLvUrl(act));
  if (first.status === 200) return first.body;

  if (act.slug !== 'untitled') {
    const fallback = await fetchWithRateLimit(buildLvUrl(act, true));
    if (fallback.status === 200) return fallback.body;
  }

  throw new Error(`LV fetch failed HTTP ${first.status}`);
}

async function main(): Promise<void> {
  const { limit, skipExisting } = parseArgs();

  fs.mkdirSync(SOURCE_DIR, { recursive: true });
  fs.mkdirSync(SEED_DIR, { recursive: true });

  const discovered = discoverLinkedActs();
  const candidates = limit ? discovered.slice(0, limit) : discovered;

  console.log('Latvian Law MCP -- Linked Act Expansion');
  console.log('========================================\n');
  console.log(`  discovered linked acts: ${discovered.length}`);
  console.log(`  selected for ingest:    ${candidates.length}`);
  console.log(`  skip existing seeds:    ${skipExisting ? 'yes' : 'no'}\n`);

  let ingested = 0;
  let skippedExisting = 0;
  let skippedEmpty = 0;
  let failed = 0;
  let totalProvisions = 0;

  const failures: { id: string; reason: string }[] = [];

  for (const entry of candidates) {
    const act = toActConfig(entry);
    const lvCache = path.join(SOURCE_DIR, `${act.seedFile}.lv.html`);
    const enCache = path.join(SOURCE_DIR, `${act.seedFile}.en.html`);
    const seedPath = path.join(SEED_DIR, `${act.seedFile}.json`);

    if (skipExisting && fs.existsSync(seedPath)) {
      skippedExisting++;
      continue;
    }

    try {
      process.stdout.write(`  [${entry.likumiId}] fetch LV...`);
      const lvHtml = await fetchLvHtml(act);
      fs.writeFileSync(lvCache, lvHtml);
      console.log(` OK (${(lvHtml.length / 1024).toFixed(0)} KB)`);

      let enHtml: string | undefined;
      try {
        process.stdout.write(`  [${entry.likumiId}] fetch EN...`);
        const en = await fetchWithRateLimit(buildEnglishUrl(act));
        if (en.status === 200) {
          enHtml = en.body;
          fs.writeFileSync(enCache, enHtml);
          console.log(` OK (${(enHtml.length / 1024).toFixed(0)} KB)`);
        } else {
          console.log(` HTTP ${en.status} (skip)`);
        }
      } catch {
        console.log(' ERROR (skip)');
      }

      const parsed = parseLatvianHtml(lvHtml, act, enHtml);
      if (parsed.provisions.length === 0) {
        skippedEmpty++;
        continue;
      }

      const output: ParsedAct = {
        ...parsed,
        short_name: parsed.short_name || `TA-${entry.likumiId}`,
      };

      fs.writeFileSync(seedPath, JSON.stringify(output, null, 2));
      ingested++;
      totalProvisions += output.provisions.length;
      console.log(`    -> ${act.id}: ${output.provisions.length} provisions`);
    } catch (error) {
      failed++;
      const msg = error instanceof Error ? error.message : String(error);
      failures.push({ id: String(entry.likumiId), reason: msg });
      console.log(`  [${entry.likumiId}] ERROR ${msg}`);
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    discovered: discovered.length,
    selected: candidates.length,
    ingested,
    skipped_existing: skippedExisting,
    skipped_empty: skippedEmpty,
    failed,
    total_provisions: totalProvisions,
    failures,
  };

  fs.writeFileSync(path.join(SEED_DIR, '_linked-report.json'), JSON.stringify(report, null, 2));

  console.log('\nExpansion report');
  console.log('----------------');
  console.log(`  ingested:        ${ingested}`);
  console.log(`  skipped existing:${skippedExisting}`);
  console.log(`  skipped empty:   ${skippedEmpty}`);
  console.log(`  failed:          ${failed}`);
  console.log(`  provisions added:${totalProvisions}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
