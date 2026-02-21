/**
 * Tests for Latvian Law MCP tools.
 * Runs against the built database to verify seed data and tool functions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', '..', 'data', 'database.db');

let db: InstanceType<typeof Database>;

beforeAll(() => {
  db = new Database(DB_PATH, { readonly: true });
  db.pragma('foreign_keys = ON');
});

afterAll(() => {
  if (db) db.close();
});

describe('database integrity', () => {
  it('should have 10 legal documents', () => {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM legal_documents').get() as { cnt: number };
    expect(row.cnt).toBe(10);
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

describe('Personal Data Processing Law', () => {
  it('should find Personal Data Processing Law', () => {
    const row = db.prepare(
      "SELECT id FROM legal_documents WHERE id = 'lv-personal-data-processing-law'"
    ).get() as { id: string } | undefined;
    expect(row).toBeDefined();
  });

  it('should have Art. 2 referencing Regulation (EU) 2016/679', () => {
    const row = db.prepare(
      "SELECT content FROM legal_provisions WHERE document_id = 'lv-personal-data-processing-law' AND provision_ref = 'Art. 2'"
    ).get() as { content: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.content).toContain('Regulation (EU) 2016/679');
  });

  it('should have GDPR EU reference', () => {
    const row = db.prepare(
      "SELECT eu_document_id FROM eu_references WHERE document_id = 'lv-personal-data-processing-law' AND eu_document_id LIKE '%2016/679%'"
    ).get() as { eu_document_id: string } | undefined;
    expect(row).toBeDefined();
  });
});

describe('IT Security Law', () => {
  it('should find IT Security Law', () => {
    const row = db.prepare(
      "SELECT id FROM legal_documents WHERE id = 'lv-it-security-law'"
    ).get() as { id: string } | undefined;
    expect(row).toBeDefined();
  });

  it('should have Art. 3 with definitions', () => {
    const row = db.prepare(
      "SELECT content FROM legal_provisions WHERE document_id = 'lv-it-security-law' AND provision_ref = 'Art. 3'"
    ).get() as { content: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.content).toContain('Information technology security');
  });
});

describe('FTS5 search', () => {
  it('should find provisions matching "personal data"', () => {
    const rows = db.prepare(
      "SELECT COUNT(*) as cnt FROM provisions_fts WHERE provisions_fts MATCH '\"personal data\"'"
    ).get() as { cnt: number };
    expect(rows.cnt).toBeGreaterThan(0);
  });

  it('should find provisions matching "cybersecurity" or "information technology security"', () => {
    const rows = db.prepare(
      "SELECT COUNT(*) as cnt FROM provisions_fts WHERE provisions_fts MATCH 'cybersecurity OR \"information technology security\"'"
    ).get() as { cnt: number };
    expect(rows.cnt).toBeGreaterThan(0);
  });
});

describe('negative cases', () => {
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
