#!/usr/bin/env tsx
/**
 * Verify selected provisions against official likumi.lv sources.
 *
 * Compares database content to freshly fetched and parsed source content
 * character-by-character and prints SHA-256 hashes.
 */

import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchWithRateLimit } from './lib/fetcher.js';
import { KEY_LATVIAN_ACTS, parseLatvianHtml } from './lib/parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'database.db');

interface VerificationTarget {
  id: string;
  documentId: string;
  section: string;
  upstreamUrl: string;
  description: string;
}

const TARGETS: VerificationTarget[] = [
  {
    id: 'lv-hash-001',
    documentId: 'lv-personal-data-processing-law',
    section: '1',
    upstreamUrl: 'https://likumi.lv/ta/id/300099-fizisko-personu-datu-apstrades-likums#p1',
    description: 'Fizisko personu datu apstrādes likums, 1. pants',
  },
  {
    id: 'lv-hash-002',
    documentId: 'lv-it-security-law',
    section: '1',
    upstreamUrl: 'https://likumi.lv/ta/id/353390-nacionalas-kiberdrosibas-likums#p1',
    description: 'Nacionālās kiberdrošības likums, 1. pants',
  },
  {
    id: 'lv-hash-003',
    documentId: 'lv-criminal-law-cybercrime',
    section: '241',
    upstreamUrl: 'https://likumi.lv/ta/id/88966-kriminallikums#p241',
    description: 'Krimināllikums, 241. pants',
  },
];

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function main(): Promise<void> {
  const db = new Database(DB_PATH, { readonly: true });
  let failures = 0;

  console.log('Latvian Law MCP — Provision Verification');
  console.log('=========================================\n');

  for (const target of TARGETS) {
    const row = db.prepare(
      'SELECT content FROM legal_provisions WHERE document_id = ? AND section = ?'
    ).get(target.documentId, target.section) as { content: string } | undefined;

    if (!row) {
      console.log(`FAIL ${target.id}: Missing DB provision ${target.documentId} section ${target.section}`);
      failures++;
      continue;
    }

    const act = KEY_LATVIAN_ACTS.find(a => a.id === target.documentId);
    if (!act) {
      console.log(`FAIL ${target.id}: Unknown act config for ${target.documentId}`);
      failures++;
      continue;
    }

    const sourceUrl = target.upstreamUrl.split('#')[0];
    const fetched = await fetchWithRateLimit(sourceUrl);
    if (fetched.status !== 200) {
      console.log(`FAIL ${target.id}: Upstream HTTP ${fetched.status}`);
      failures++;
      continue;
    }

    const parsed = parseLatvianHtml(fetched.body, act);
    const sourceProvision = parsed.provisions.find(p => p.section === target.section);

    if (!sourceProvision) {
      console.log(`FAIL ${target.id}: Section ${target.section} not found in upstream parse`);
      failures++;
      continue;
    }

    const dbContent = row.content;
    const sourceContent = sourceProvision.content;

    if (dbContent !== sourceContent) {
      let diffAt = -1;
      const max = Math.min(dbContent.length, sourceContent.length);
      for (let i = 0; i < max; i++) {
        if (dbContent[i] !== sourceContent[i]) {
          diffAt = i;
          break;
        }
      }
      if (diffAt === -1 && dbContent.length !== sourceContent.length) {
        diffAt = max;
      }

      console.log(`FAIL ${target.id}: Character mismatch at index ${diffAt}`);
      failures++;
      continue;
    }

    const hash = sha256(dbContent);
    console.log(`OK   ${target.id}: ${target.description}`);
    console.log(`     section=${target.section} sha256=${hash}`);
  }

  db.close();

  if (failures > 0) {
    console.log(`\nVerification failed: ${failures} mismatches`);
    process.exit(1);
  }

  console.log('\nVerification passed: all selected provisions match upstream character-by-character.');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
