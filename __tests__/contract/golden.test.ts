/**
 * Golden contract tests for Latvian Law MCP.
 * Skipped automatically when database.db is not present (e.g. CI without data).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '../../data/database.db');
const dbAvailable = existsSync(DB_PATH) && (() => {
  try {
    const _db = new Database(DB_PATH, { readonly: true });
    const _row = _db.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='legal_documents'").get() as { cnt: number } | undefined;
    _db.close();
    return (_row?.cnt ?? 0) > 0;
  } catch { return false; }
})();

let db: InstanceType<typeof Database>;

describe.skipIf(!dbAvailable)('Latvian Law MCP — Golden Contract Tests', () => {
  beforeAll(() => {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma('journal_mode = DELETE');
  });

  // ── Database integrity ──────────────────────────────────────────────

  describe('Database integrity', () => {
    it('should have legal documents (2 249 expected)', () => {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM legal_documents').get() as { cnt: number };
      expect(row.cnt).toBeGreaterThanOrEqual(2000);
    });

    it('should have provisions (57 679 expected)', () => {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM legal_provisions').get() as { cnt: number };
      expect(row.cnt).toBeGreaterThanOrEqual(50000);
    });

    it('should have FTS index rows', () => {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM provisions_fts').get() as { cnt: number };
      expect(row.cnt).toBeGreaterThan(0);
    });

    it('should have definitions (5 190 expected)', () => {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM definitions').get() as { cnt: number };
      expect(row.cnt).toBeGreaterThanOrEqual(5000);
    });

    it('should have EU documents (952 expected)', () => {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM eu_documents').get() as { cnt: number };
      expect(row.cnt).toBeGreaterThanOrEqual(900);
    });

    it('should have EU cross-references (2 689 expected)', () => {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM eu_references').get() as { cnt: number };
      expect(row.cnt).toBeGreaterThanOrEqual(2500);
    });
  });

  // ── Article retrieval ───────────────────────────────────────────────

  describe('Article retrieval', () => {
    it('should retrieve Art. 1 of the Electronic Communications Law', () => {
      const row = db.prepare(
        "SELECT document_id, section, provision_ref, content FROM legal_provisions WHERE document_id = 'lv-electronic-communications-law' AND section = '1'"
      ).get() as { document_id: string; section: string; provision_ref: string; content: string };
      expect(row).toBeDefined();
      expect(row.document_id).toBe('lv-electronic-communications-law');
      expect(row.provision_ref).toBe('Art. 1');
      expect(row.content).toContain('abonentlīnija');
    });

    it('should retrieve Art. 1 of the Personal Data Processing Law', () => {
      const row = db.prepare(
        "SELECT document_id, section, content FROM legal_provisions WHERE document_id = 'lv-personal-data-processing-law' AND section = '1'"
      ).get() as { document_id: string; section: string; content: string };
      expect(row).toBeDefined();
      expect(row.document_id).toBe('lv-personal-data-processing-law');
      expect(row.content).toContain('regulas');
    });

    it('should retrieve provisions of the Commercial Secret Protection Law', () => {
      const rows = db.prepare(
        "SELECT section, content FROM legal_provisions WHERE document_id = 'lv-commercial-secret-protection-law' ORDER BY CAST(section AS INTEGER)"
      ).all() as { section: string; content: string }[];
      expect(rows.length).toBeGreaterThanOrEqual(3);
      expect(rows[0].content).toContain('komercnoslēpuma');
    });
  });

  // ── Full-text search ────────────────────────────────────────────────

  describe('Full-text search', () => {
    it('should find provisions matching "aizsardzib*" (protection)', () => {
      const rows = db.prepare(
        "SELECT rowid, content, title FROM provisions_fts WHERE provisions_fts MATCH 'aizsardzib*' LIMIT 10"
      ).all() as { rowid: number; content: string; title: string }[];
      expect(rows.length).toBeGreaterThan(0);
    });

    it('should find provisions matching "datu" (data)', () => {
      const rows = db.prepare(
        "SELECT rowid, content FROM provisions_fts WHERE provisions_fts MATCH 'datu' LIMIT 10"
      ).all() as { rowid: number; content: string }[];
      expect(rows.length).toBeGreaterThan(0);
    });

    it('should find provisions matching "elektronisk*" (electronic)', () => {
      const rows = db.prepare(
        "SELECT rowid, content FROM provisions_fts WHERE provisions_fts MATCH 'elektronisk*' LIMIT 10"
      ).all() as { rowid: number; content: string }[];
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  // ── EU cross-references ─────────────────────────────────────────────

  describe('EU cross-references', () => {
    it('should link Criminal Law to EU directives', () => {
      const rows = db.prepare(
        "SELECT eu_document_id, reference_type FROM eu_references WHERE document_id = 'lv-criminal-law-cybercrime'"
      ).all() as { eu_document_id: string; reference_type: string }[];
      expect(rows.length).toBeGreaterThan(0);
      const euDocIds = rows.map(r => r.eu_document_id);
      expect(euDocIds).toContain('directive:2017/541');
    });

    it('should have EU document metadata for referenced directives', () => {
      const row = db.prepare(
        "SELECT id, title FROM eu_documents WHERE id = 'directive:2017/541'"
      ).get() as { id: string; title: string };
      expect(row).toBeDefined();
      expect(row.id).toBe('directive:2017/541');
    });

    it('should have valid reference_type values', () => {
      const rows = db.prepare(
        'SELECT DISTINCT reference_type FROM eu_references'
      ).all() as { reference_type: string }[];
      const validTypes = [
        'implements', 'supplements', 'applies', 'references',
        'complies_with', 'derogates_from', 'amended_by', 'repealed_by', 'cites_article',
      ];
      for (const row of rows) {
        expect(validTypes).toContain(row.reference_type);
      }
    });
  });

  // ── Definitions ─────────────────────────────────────────────────────

  describe('Definitions', () => {
    it('should have the definition for "abonentlīnija"', () => {
      const row = db.prepare(
        "SELECT term, definition, document_id FROM definitions WHERE term = 'abonentlīnija'"
      ).get() as { term: string; definition: string; document_id: string };
      expect(row).toBeDefined();
      expect(row.document_id).toBe('lv-electronic-communications-law');
      expect(row.definition).toContain('fiziska līnija');
    });

    it('should have definitions FTS index', () => {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM definitions_fts').get() as { cnt: number };
      expect(row.cnt).toBeGreaterThan(0);
    });
  });

  // ── Key laws present ────────────────────────────────────────────────

  describe('Key laws present', () => {
    const keyLaws = [
      'lv-commercial-secret-protection-law',
      'lv-criminal-law-cybercrime',
      'lv-electronic-communications-law',
      'lv-electronic-documents-law',
      'lv-freedom-of-information-law',
      'lv-personal-data-processing-law',
    ];

    for (const lawId of keyLaws) {
      it(`should contain ${lawId}`, () => {
        const row = db.prepare(
          'SELECT id, title FROM legal_documents WHERE id = ?'
        ).get(lawId) as { id: string; title: string } | undefined;
        expect(row).toBeDefined();
        expect(row!.id).toBe(lawId);
        expect(row!.title.length).toBeGreaterThan(0);
      });
    }
  });

  // ── list_sources metadata ───────────────────────────────────────────

  describe('list_sources metadata', () => {
    it('should have db_metadata table entries', () => {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM db_metadata').get() as { cnt: number };
      expect(row.cnt).toBeGreaterThan(0);
    });

    it('should have jurisdiction = LV', () => {
      const row = db.prepare(
        "SELECT value FROM db_metadata WHERE key = 'jurisdiction'"
      ).get() as { value: string };
      expect(row).toBeDefined();
      expect(row.value).toBe('LV');
    });

    it('should have tier = free', () => {
      const row = db.prepare(
        "SELECT value FROM db_metadata WHERE key = 'tier'"
      ).get() as { value: string };
      expect(row).toBeDefined();
      expect(row.value).toBe('free');
    });

    it('should have schema_version = 2', () => {
      const row = db.prepare(
        "SELECT value FROM db_metadata WHERE key = 'schema_version'"
      ).get() as { value: string };
      expect(row).toBeDefined();
      expect(row.value).toBe('2');
    });
  });

  // ── Negative tests ──────────────────────────────────────────────────

  describe('Negative tests', () => {
    it('should return no results for fictional document', () => {
      const row = db.prepare(
        "SELECT COUNT(*) as cnt FROM legal_provisions WHERE document_id = 'fictional-law-2099'"
      ).get() as { cnt: number };
      expect(row.cnt).toBe(0);
    });

    it('should return no results for fictional definition', () => {
      const row = db.prepare(
        "SELECT COUNT(*) as cnt FROM definitions WHERE term = 'xyzzy-nonexistent-term'"
      ).get() as { cnt: number };
      expect(row.cnt).toBe(0);
    });

    it('should return no results for nonsense FTS query', () => {
      const rows = db.prepare(
        "SELECT rowid FROM provisions_fts WHERE provisions_fts MATCH 'xyzzyplughnotaword' LIMIT 1"
      ).all();
      expect(rows.length).toBe(0);
    });

    it('should return no EU references for fictional document', () => {
      const row = db.prepare(
        "SELECT COUNT(*) as cnt FROM eu_references WHERE document_id = 'fictional-law-2099'"
      ).get() as { cnt: number };
      expect(row.cnt).toBe(0);
    });
  });
});
