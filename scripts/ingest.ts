#!/usr/bin/env tsx
/**
 * Latvian Law MCP -- Real Data Ingestion Pipeline
 *
 * Fetches official Latvian legislation from likumi.lv (Latvijas Vēstnesis)
 * and builds JSON seed files in data/seed/.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fetchWithRateLimit } from './lib/fetcher.js';
import {
  parseLatvianHtml,
  KEY_LATVIAN_ACTS,
  buildEnglishUrl,
  type ActIndexEntry,
  type ParsedAct,
} from './lib/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = path.resolve(__dirname, '../data/source');
const SEED_DIR = path.resolve(__dirname, '../data/seed');

function parseArgs(): { limit: number | null; skipFetch: boolean } {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let skipFetch = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = Number.parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--skip-fetch') {
      skipFetch = true;
    }
  }

  return { limit, skipFetch };
}

function buildLvUrl(act: ActIndexEntry): string {
  return `https://likumi.lv/ta/id/${act.likumiId}-${act.slug}`;
}

async function fetchLawHtml(
  act: ActIndexEntry,
  skipFetch: boolean,
): Promise<{ lvHtml: string; enHtml?: string }> {
  fs.mkdirSync(SOURCE_DIR, { recursive: true });

  const lvCacheFile = path.join(SOURCE_DIR, `${act.seedFile}.lv.html`);
  const enCacheFile = path.join(SOURCE_DIR, `${act.seedFile}.en.html`);

  let lvHtml: string;
  let enHtml: string | undefined;

  if (skipFetch && fs.existsSync(lvCacheFile)) {
    lvHtml = fs.readFileSync(lvCacheFile, 'utf-8');
  } else {
    const lvUrl = buildLvUrl(act);
    process.stdout.write(`  Fetching ${act.id} (LV)...`);
    const lv = await fetchWithRateLimit(lvUrl);

    if (lv.status !== 200) {
      console.log(` HTTP ${lv.status}`);
      throw new Error(`LV fetch failed with HTTP ${lv.status}`);
    }

    lvHtml = lv.body;
    fs.writeFileSync(lvCacheFile, lvHtml);
    console.log(` OK (${(lvHtml.length / 1024).toFixed(0)} KB)`);
  }

  if (skipFetch && fs.existsSync(enCacheFile)) {
    enHtml = fs.readFileSync(enCacheFile, 'utf-8');
  } else {
    const enUrl = buildEnglishUrl(act);
    process.stdout.write(`  Fetching ${act.id} (EN)...`);
    const en = await fetchWithRateLimit(enUrl);

    if (en.status === 200) {
      enHtml = en.body;
      fs.writeFileSync(enCacheFile, enHtml);
      console.log(` OK (${(enHtml.length / 1024).toFixed(0)} KB)`);
    } else {
      console.log(` HTTP ${en.status} (skipped)`);
    }
  }

  return { lvHtml, enHtml };
}

async function fetchAndParseActs(acts: ActIndexEntry[], skipFetch: boolean): Promise<void> {
  console.log(`\nProcessing ${acts.length} Latvian acts from likumi.lv...\n`);

  fs.mkdirSync(SOURCE_DIR, { recursive: true });
  fs.mkdirSync(SEED_DIR, { recursive: true });

  let processed = 0;
  let cached = 0;
  let failed = 0;
  let totalProvisions = 0;
  let totalDefinitions = 0;

  const results: { act: string; provisions: number; definitions: number; status: string }[] = [];

  for (const act of acts) {
    const seedFile = path.join(SEED_DIR, `${act.seedFile}.json`);

    if (skipFetch && fs.existsSync(seedFile)) {
      const existing = JSON.parse(fs.readFileSync(seedFile, 'utf-8')) as ParsedAct;
      const provCount = existing.provisions?.length ?? 0;
      const defCount = existing.definitions?.length ?? 0;
      totalProvisions += provCount;
      totalDefinitions += defCount;
      results.push({ act: act.id, provisions: provCount, definitions: defCount, status: 'cached' });
      cached++;
      processed++;
      continue;
    }

    try {
      const { lvHtml, enHtml } = await fetchLawHtml(act, skipFetch);

      if (!/class=['"][^'"]*TV213[^'"]*['"]/i.test(lvHtml)) {
        results.push({ act: act.id, provisions: 0, definitions: 0, status: 'NO_ARTICLE_BLOCKS' });
        failed++;
        processed++;
        continue;
      }

      const parsed = parseLatvianHtml(lvHtml, act, enHtml);

      if (parsed.provisions.length === 0) {
        results.push({ act: act.id, provisions: 0, definitions: 0, status: 'EMPTY_PARSE' });
        failed++;
        processed++;
        continue;
      }

      fs.writeFileSync(seedFile, JSON.stringify(parsed, null, 2));

      totalProvisions += parsed.provisions.length;
      totalDefinitions += parsed.definitions.length;
      results.push({
        act: act.id,
        provisions: parsed.provisions.length,
        definitions: parsed.definitions.length,
        status: 'OK',
      });

      console.log(`    -> ${act.id}: ${parsed.provisions.length} provisions, ${parsed.definitions.length} definitions`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`  ERROR ${act.id}: ${msg}`);
      results.push({ act: act.id, provisions: 0, definitions: 0, status: `ERROR: ${msg.substring(0, 80)}` });
      failed++;
    }

    processed++;
  }

  console.log(`\n${'='.repeat(78)}`);
  console.log('Ingestion Report');
  console.log('='.repeat(78));
  console.log(`\n  Source:       likumi.lv (Latvijas Vēstnesis)`);
  console.log(`  Processed:    ${processed}`);
  console.log(`  Cached:       ${cached}`);
  console.log(`  Failed:       ${failed}`);
  console.log(`  Provisions:   ${totalProvisions}`);
  console.log(`  Definitions:  ${totalDefinitions}`);
  console.log(`\n  Per-act breakdown:`);
  console.log(`  ${'Act'.padEnd(36)} ${'Provisions'.padStart(12)} ${'Definitions'.padStart(13)} ${'Status'.padStart(14)}`);
  console.log(`  ${'-'.repeat(36)} ${'-'.repeat(12)} ${'-'.repeat(13)} ${'-'.repeat(14)}`);

  for (const r of results) {
    console.log(
      `  ${r.act.padEnd(36)} ${String(r.provisions).padStart(12)} ${String(r.definitions).padStart(13)} ${r.status.padStart(14)}`
    );
  }

  console.log('');
}

async function main(): Promise<void> {
  const { limit, skipFetch } = parseArgs();

  console.log('Latvian Law MCP -- Real Data Ingestion');
  console.log('======================================\n');
  console.log('  Source: likumi.lv (Latvijas Vēstnesis)');
  console.log('  Throttle: 1200ms between requests');

  if (limit) console.log(`  --limit ${limit}`);
  if (skipFetch) console.log('  --skip-fetch');

  const acts = limit ? KEY_LATVIAN_ACTS.slice(0, limit) : KEY_LATVIAN_ACTS;
  await fetchAndParseActs(acts, skipFetch);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
