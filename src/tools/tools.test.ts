/**
 * Tests for Latvian Law MCP tools.
 * Runs against the built database to verify seed data and tool functions.
 *
 * Skipped automatically when data/database.db is absent (e.g. CI without build step).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', '..', 'data', 'database.db');

const DB_EXISTS = existsSync(DB_PATH) && (() => {
  try {
    const _db = new Database(DB_PATH, { readonly: true });
    const _row = _db.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='legal_documents'").get() as { cnt: number } | undefined;
    _db.close();
    return (_row?.cnt ?? 0) > 0;
  } catch { return false; }
})();

let db: InstanceType<typeof Database>;

beforeAll(() => {
  if (!DB_EXISTS) return;
  db = new Database(DB_PATH, { readonly: true });
  db.pragma('foreign_keys = ON');
});

afterAll(() => {
  if (db) db.close();
});

describe.skipIf(!DB_EXISTS)('database integrity', () => {
  it('should have at least the core 10 legal documents', () => {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM legal_documents').get() as { cnt: number };
    expect(row.cnt).toBeGreaterThanOrEqual(10);
  });

  it('should have at least 150 provisions', () => {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM legal_provisions').get() as { cnt: number };
    expect(row.cnt).toBeGreaterThanOrEqual(150);
  });

  it('should have definitions', () => {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM definitions').get() as { cnt: number };
    expect(row.cnt).toBeGreaterThan(0);
  });

  it('should have EU documents extracted', () => {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM eu_documents').get() as { cnt: number };
    expect(row.cnt).toBeGreaterThan(0);
  });

  it('should have EU references extracted', () => {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM eu_references').get() as { cnt: number };
    expect(row.cnt).toBeGreaterThan(0);
  });

  it('should have db_metadata with jurisdiction LV', () => {
    const row = db.prepare("SELECT value FROM db_metadata WHERE key = 'jurisdiction'").get() as { value: string };
    expect(row.value).toBe('LV');
  });

  it('should have journal_mode DELETE (WASM compatible)', () => {
    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(row.journal_mode).toBe('delete');
  });
});

describe.skipIf(!DB_EXISTS)('Personal Data Processing Law', () => {
  it('should find Personal Data Processing Law', () => {
    const row = db.prepare(
      "SELECT id FROM legal_documents WHERE id = 'lv-personal-data-processing-law'"
    ).get() as { id: string } | undefined;
    expect(row).toBeDefined();
  });

  it('should have Art. 1 referencing Regula (ES) 2016/679', () => {
    const row = db.prepare(
      "SELECT content FROM legal_provisions WHERE document_id = 'lv-personal-data-processing-law' AND provision_ref = 'Art. 1'"
    ).get() as { content: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.content).toContain('regulas (ES) 2016/679');
  });

  it('should have GDPR EU reference', () => {
    const row = db.prepare(
      "SELECT eu_document_id FROM eu_references WHERE document_id = 'lv-personal-data-processing-law' AND eu_document_id LIKE '%2016/679%'"
    ).get() as { eu_document_id: string } | undefined;
    expect(row).toBeDefined();
  });
});

describe.skipIf(!DB_EXISTS)('IT Security Law', () => {
  it('should find IT Security Law', () => {
    const row = db.prepare(
      "SELECT id FROM legal_documents WHERE id = 'lv-it-security-law'"
    ).get() as { id: string } | undefined;
    expect(row).toBeDefined();
  });

  it('should have Art. 1 with kiberdrošības termini', () => {
    const row = db.prepare(
      "SELECT content FROM legal_provisions WHERE document_id = 'lv-it-security-law' AND provision_ref = 'Art. 1'"
    ).get() as { content: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.content).toContain('kiberdrošība');
    expect(row!.content).toContain('kiberincidents');
  });
});

describe.skipIf(!DB_EXISTS)('FTS5 search', () => {
  it('should find provisions matching "personas datu"', () => {
    const rows = db.prepare(
      "SELECT COUNT(*) as cnt FROM provisions_fts WHERE provisions_fts MATCH '\"personas datu\"'"
    ).get() as { cnt: number };
    expect(rows.cnt).toBeGreaterThan(0);
  });

  it('should find provisions matching "kiberdrošība" or "informācijas sistēma"', () => {
    const rows = db.prepare(
      "SELECT COUNT(*) as cnt FROM provisions_fts WHERE provisions_fts MATCH 'kiberdrošība OR \"informācijas sistēma\"'"
    ).get() as { cnt: number };
    expect(rows.cnt).toBeGreaterThan(0);
  });
});

describe.skipIf(!DB_EXISTS)('negative cases', () => {
  it('should return no results for non-existent document', () => {
    const row = db.prepare(
      "SELECT id FROM legal_documents WHERE id = 'nonexistent-law-2099'"
    ).get();
    expect(row).toBeUndefined();
  });

  it('should return no results for non-existent provision', () => {
    const row = db.prepare(
      "SELECT content FROM legal_provisions WHERE document_id = 'lv-personal-data-processing-law' AND provision_ref = '999ZZZ'"
    ).get();
    expect(row).toBeUndefined();
  });
});
