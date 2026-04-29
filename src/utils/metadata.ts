/**
 * Response metadata utilities for Latvian Law MCP.
 *
 * Per Law MCP Golden Standard §4.9b, every tool response must include a
 * `_meta` object with `disclaimer`, `data_age`, `source_url`, and `copyright`.
 *
 * For backwards compatibility, the response also includes `_metadata` with the
 * same payload — older direct clients read `_metadata`. The canonical key going
 * forward is `_meta` (watchdog primary path; gateway envelope contract).
 */

import type Database from '@ansvar/mcp-sqlite';

const PORTAL_URL = 'https://likumi.lv';
const COPYRIGHT_STRING = 'Public domain (Latvian law). Source: Likumi.lv — Latvijas Vēstnesis (Official Gazette of Latvia).';
const DISCLAIMER_STRING =
  'Research tool only. Not legal advice. Verify against official sources at likumi.lv.';
const DATA_SOURCE_STRING =
  'Likumi.lv (likumi.lv) — Latvijas Vēstnesis (Official Gazette of Latvia)';

/**
 * Canonical `_meta` envelope per Law MCP Golden Standard §4.9b.
 */
export interface ResponseMeta {
  disclaimer: string;
  data_age: string;
  source_url: string;
  copyright: string;
  data_source?: string;
  jurisdiction?: string;
  note?: string;
  query_strategy?: string;
}

/**
 * Legacy `_metadata` payload — superset of canonical `_meta` for direct
 * clients that have not migrated. Same fields, plus original keys (`freshness`,
 * `data_source`) preserved so existing consumers keep working.
 */
export interface LegacyResponseMetadata {
  data_source: string;
  jurisdiction: string;
  disclaimer: string;
  data_age: string;
  source_url: string;
  copyright: string;
  freshness?: string;
  note?: string;
  query_strategy?: string;
}

/**
 * Error type per Law MCP Golden Standard §4.9b error responses table.
 *
 * - `NO_MATCH`     — search returned no results in the current database
 * - `NOT_INGESTED` — law exists in census but has not been ingested yet
 * - `INVALID_INPUT` — malformed or out-of-range parameters
 */
export type ErrorType = 'NO_MATCH' | 'NOT_INGESTED' | 'INVALID_INPUT';

export interface ToolResponse<T> {
  results: T;
  _meta: ResponseMeta;
  _metadata: LegacyResponseMetadata;
  _citation?: import('./citation.js').CitationMetadata;
  isError?: boolean;
  _error_type?: ErrorType;
}

function readBuiltAt(db: InstanceType<typeof Database>): string {
  try {
    const row = db.prepare(
      "SELECT value FROM db_metadata WHERE key = 'built_at'",
    ).get() as { value: string } | undefined;
    if (row?.value) return row.value;
  } catch {
    // db_metadata table missing — fall through
  }
  return '';
}

/**
 * Build the canonical `_meta` envelope per §4.9b.
 *
 * @param db          Open SQLite handle (read-only is fine).
 * @param overrides   Optional fields to merge in (e.g., `note`, `query_strategy`).
 */
export function generateMeta(
  db: InstanceType<typeof Database>,
  overrides?: Partial<ResponseMeta>,
): ResponseMeta {
  const builtAt = readBuiltAt(db);
  return {
    disclaimer: DISCLAIMER_STRING,
    data_age: builtAt,
    source_url: PORTAL_URL,
    copyright: COPYRIGHT_STRING,
    data_source: DATA_SOURCE_STRING,
    jurisdiction: 'LV',
    ...overrides,
  };
}

/**
 * Build the legacy `_metadata` envelope for backwards compatibility.
 *
 * Includes both canonical field names (`data_age`, `source_url`, `copyright`)
 * and the original key names (`freshness`, `data_source`) so existing direct
 * clients continue to work.
 */
export function generateLegacyMetadata(
  db: InstanceType<typeof Database>,
  overrides?: Partial<LegacyResponseMetadata>,
): LegacyResponseMetadata {
  const builtAt = readBuiltAt(db);
  return {
    data_source: DATA_SOURCE_STRING,
    jurisdiction: 'LV',
    disclaimer: DISCLAIMER_STRING,
    data_age: builtAt,
    source_url: PORTAL_URL,
    copyright: COPYRIGHT_STRING,
    freshness: builtAt,
    ...overrides,
  };
}

/**
 * Convenience: build both envelopes in one call.
 *
 * Use this in tool handlers to emit the canonical `_meta` and the legacy
 * `_metadata` simultaneously.
 *
 * @example
 *   return {
 *     results: rows,
 *     ...generateResponseEnvelope(db),
 *   };
 */
export function generateResponseEnvelope(
  db: InstanceType<typeof Database>,
  overrides?: Partial<ResponseMeta>,
): { _meta: ResponseMeta; _metadata: LegacyResponseMetadata } {
  return {
    _meta: generateMeta(db, overrides),
    _metadata: generateLegacyMetadata(db, overrides),
  };
}

// ---------------------------------------------------------------------------
// Backwards compat — keep existing call sites working until they migrate.
// ---------------------------------------------------------------------------

/**
 * @deprecated Use `generateResponseEnvelope()` instead, which returns both
 * `_meta` and `_metadata`. This shim returns only the legacy `_metadata`
 * payload so existing tool handlers don't break during migration.
 */
export const generateResponseMetadata = generateLegacyMetadata;

export type ResponseMetadata = LegacyResponseMetadata;
