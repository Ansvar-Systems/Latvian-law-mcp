/**
 * format_citation — Format a Latvian legal citation per standard conventions.
 *
 * Pattern 7: Database-backed citation formatting.
 * - Resolves law references through resolveDocumentId() for canonical titles
 * - shortenLawTitle() preserves distinguishing parentheticals but drops
 *   trailing years and chapter annotations
 */

import type Database from '@ansvar/mcp-sqlite';
import { resolveDocumentId } from '../utils/statute-id.js';

export interface FormatCitationInput {
  citation: string;
  format?: 'full' | 'short' | 'pinpoint';
}

export interface FormatCitationResult {
  original: string;
  formatted: string;
  format: string;
}

/**
 * Shorten a law title for the "short" citation format.
 * Removes trailing chapter annotations like "[Chapter 9:23]" and trailing
 * years like ", 2021" or " 2021", but preserves distinguishing parentheticals
 * like "(Codification and Reform)".
 */
function shortenLawTitle(title: string): string {
  // Remove trailing chapter annotations: "[Chapter 9:23]"
  let short = title.replace(/\s*\[Chapter\s+\d+[:\d]*\]\s*/gi, '').trim();
  // Remove trailing year with optional comma: ", 2021" or " 2021"
  short = short.replace(/,?\s+\d{4}\s*$/, '').trim();
  return short;
}

export async function formatCitationTool(
  db: InstanceType<typeof Database>,
  input: FormatCitationInput,
): Promise<FormatCitationResult> {
  const format = input.format ?? 'full';
  const trimmed = input.citation.trim();

  // Parse "Section N, <Act>" or "s N <Act>"
  const secFirst = trimmed.match(/^(?:Section|s|sec\.?)\s*(\d+[A-Za-z]*)\s*[,;]?\s+(.+)$/i);
  // Parse "<Act>, Section N" or "<Act> Section N"
  const secLast = trimmed.match(/^(.+?)[,;]?\s*(?:Section|s|sec\.?)\s*(\d+[A-Za-z]*)$/i);
  // Parse "Article N, <Act>"
  const artFirst = trimmed.match(/^(?:Article|Art\.?)\s*(\d+[A-Za-z]*)\s*[,;]?\s+(.+)$/i);
  const artLast = trimmed.match(/^(.+?)[,;]?\s*(?:Article|Art\.?)\s*(\d+[A-Za-z]*)$/i);

  const section = secFirst?.[1] ?? secLast?.[2] ?? artFirst?.[1] ?? artLast?.[2];
  let law = secFirst?.[2] ?? secLast?.[1] ?? artFirst?.[2] ?? artLast?.[1] ?? trimmed;
  const isArticle = !!(artFirst || artLast);

  const prefix = isArticle ? 'Article' : 'Section';

  // Resolve to canonical title from database
  const resolvedId = resolveDocumentId(db, law);
  if (resolvedId) {
    const doc = db.prepare('SELECT title FROM legal_documents WHERE id = ?').get(resolvedId) as
      | { title: string }
      | undefined;
    if (doc) law = doc.title;
  }

  let formatted: string;
  switch (format) {
    case 'short':
      formatted = section ? `s ${section}, ${shortenLawTitle(law)}` : law;
      break;
    case 'pinpoint':
      formatted = section ? `s ${section}` : law;
      break;
    case 'full':
    default:
      formatted = section ? `${prefix} ${section}, ${law}` : law;
      break;
  }

  return { original: input.citation, formatted, format };
}
