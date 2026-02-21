#!/usr/bin/env tsx
/**
 * Drift detection for Latvian Law MCP.
 *
 * Verifies provision-level SHA-256 hashes against freshly fetched likumi.lv text.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { fetchWithRateLimit } from './lib/fetcher.js';
import { KEY_LATVIAN_ACTS, parseLatvianHtml } from './lib/parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hashesPath = join(__dirname, '../fixtures/golden-hashes.json');

interface GoldenHash {
  id: string;
  description: string;
  upstream_url: string;
  expected_sha256: string;
  expected_snippet: string;
}

interface HashFixture {
  version: string;
  provisions: GoldenHash[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeSectionFromAnchor(anchor: string): string {
  return anchor
    .replace(/^p/i, '')
    .replace(/_/g, '.')
    .replace(/[^0-9A-Za-z.]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\./, '')
    .replace(/\.$/, '');
}

async function main(): Promise<void> {
  console.log('Latvian Law MCP — Drift Detection');
  console.log('=====================================\n');

  const fixture: HashFixture = JSON.parse(readFileSync(hashesPath, 'utf-8'));
  console.log(`Checking ${fixture.provisions.length} provision hashes...\n`);

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const hash of fixture.provisions) {
    if (hash.expected_sha256 === 'COMPUTE_ON_FIRST_INGEST') {
      console.log(`  SKIP ${hash.id}: missing baseline hash`);
      skipped++;
      continue;
    }

    try {
      const url = new URL(hash.upstream_url);
      const anchor = url.hash.replace(/^#/, '');
      if (!anchor) {
        console.log(`  FAIL ${hash.id}: upstream URL missing #anchor`);
        failed++;
        continue;
      }

      const section = normalizeSectionFromAnchor(anchor);
      const likumiId = Number.parseInt(url.pathname.match(/\/id\/(\d+)/)?.[1] ?? '', 10);
      if (!Number.isFinite(likumiId)) {
        console.log(`  FAIL ${hash.id}: could not resolve likumi id from URL`);
        failed++;
        continue;
      }

      const act = KEY_LATVIAN_ACTS.find(a => a.likumiId === likumiId);
      if (!act) {
        console.log(`  FAIL ${hash.id}: no act mapping for likumi id ${likumiId}`);
        failed++;
        continue;
      }

      url.hash = '';
      const fetched = await fetchWithRateLimit(url.toString());
      if (fetched.status !== 200) {
        console.log(`  FAIL ${hash.id}: HTTP ${fetched.status}`);
        failed++;
        continue;
      }

      const parsed = parseLatvianHtml(fetched.body, act);
      const provision = parsed.provisions.find(p => p.section === section);
      if (!provision) {
        console.log(`  FAIL ${hash.id}: section ${section} not found`);
        failed++;
        continue;
      }

      const actualHash = sha256(provision.content);
      const snippetOk = !hash.expected_snippet || provision.content.toLowerCase().includes(hash.expected_snippet.toLowerCase());

      if (actualHash !== hash.expected_sha256) {
        console.log(`  DRIFT ${hash.id}: hash mismatch`);
        console.log(`        expected ${hash.expected_sha256}`);
        console.log(`        actual   ${actualHash}`);
        failed++;
        continue;
      }

      if (!snippetOk) {
        console.log(`  DRIFT ${hash.id}: expected snippet not found`);
        failed++;
        continue;
      }

      console.log(`  OK   ${hash.id}: hash verified`);
      passed++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`  ERROR ${hash.id}: ${msg}`);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);

  if (failed > 0) {
    console.log('\nDrift detected. Re-ingestion may be required.');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
