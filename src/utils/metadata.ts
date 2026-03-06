/**
 * Response metadata utilities for Latvian Law MCP.
 */

import type Database from '@ansvar/mcp-sqlite';

export interface ResponseMetadata {
  data_source: string;
  jurisdiction: string;
  disclaimer: string;
  freshness?: string;
  note?: string;
  query_strategy?: string;
}

export interface ToolResponse<T> {
  results: T;
  _metadata: ResponseMetadata;
}

export function generateResponseMetadata(
  db: InstanceType<typeof Database>,
): ResponseMetadata {
  let freshness: string | undefined;
  try {
    const row = db.prepare(
      "SELECT value FROM db_metadata WHERE key = 'built_at'"
    ).get() as { value: string } | undefined;
    if (row) freshness = row.value;
  } catch {
    // Ignore
  }

  return {
    data_source: 'Likumi.lv (likumi.lv) — Latvijas Vēstnesis (Official Gazette of Latvia)',
    jurisdiction: 'LV',
    disclaimer:
      'This data is sourced from the Likumi.lv under public domain. ' +
      'The authoritative versions are maintained by Latvijas Vēstnesis (Official Gazette of Latvia). ' +
      'Always verify with the official Likumi.lv portal (likumi.lv).',
    freshness,
  };
}
