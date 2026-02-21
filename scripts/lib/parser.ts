/**
 * Parser for Latvian legislation pages on likumi.lv.
 *
 * Parses structured LV HTML into seed JSON documents used by build-db.ts.
 */

export interface ActIndexEntry {
  /** Internal MCP document id */
  id: string;
  /** Seed filename (without extension) */
  seedFile: string;
  /** Likumi.lv numeric document id */
  likumiId: number;
  /** Likumi.lv slug for canonical URL */
  slug: string;
  /** Internal short name used by tools */
  shortName: string;
  /** Optional explicit section allow-list (for targeted extracts) */
  allowedSections?: string[];
}

export interface ParsedProvision {
  provision_ref: string;
  chapter?: string;
  section: string;
  title: string;
  content: string;
}

export interface ParsedDefinition {
  term: string;
  definition: string;
  source_provision?: string;
}

export interface ParsedAct {
  id: string;
  type: 'statute';
  title: string;
  title_en?: string;
  short_name: string;
  status: 'in_force' | 'amended' | 'repealed' | 'not_yet_in_force';
  issued_date?: string;
  in_force_date?: string;
  url: string;
  description?: string;
  provisions: ParsedProvision[];
  definitions: ParsedDefinition[];
}

interface ChapterMarker {
  pos: number;
  text: string;
}

interface ParsedMetadata {
  title: string;
  status: 'in_force' | 'amended' | 'repealed' | 'not_yet_in_force';
  issuedDate?: string;
  inForceDate?: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '-',
  mdash: '—',
  shy: '',
  laquo: '«',
  raquo: '»',
  bdquo: '"',
  ldquo: '"',
  rdquo: '"',
  rsquo: "'",
  lsquo: "'",
};

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, entity: string) => {
      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        const codePoint = Number.parseInt(entity.slice(2), 16);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
      }
      if (entity.startsWith('#')) {
        const codePoint = Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
      }
      return NAMED_ENTITIES[entity] ?? _;
    })
    .replace(/\u00a0/g, ' ');
}

function htmlToText(fragment: string): string {
  const withBreaks = fragment
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<!--([\s\S]*?)-->/g, ' ');

  const withoutTags = withBreaks.replace(/<[^>]+>/g, ' ');
  const decoded = decodeHtmlEntities(withoutTags);

  return decoded
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeInlineText(fragment: string): string {
  return htmlToText(fragment).replace(/\s+/g, ' ').trim();
}

function toIsoDate(ddmmyyyy: string): string | undefined {
  const m = ddmmyyyy.match(/^(\d{2})\.(\d{2})\.(\d{4})\.?$/);
  if (!m) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function normalizeSection(sectionRaw: string): string {
  return sectionRaw
    .replace(/_/g, '.')
    .replace(/[^0-9A-Za-z.]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\./, '')
    .replace(/\.$/, '');
}

function normalizeLawTitle(rawTitle: string): string {
  return rawTitle
    .replace(/^Zaudējis\s+spēku\s*-\s*/i, '')
    .replace(/^No longer in force\s*-\s*/i, '')
    .trim();
}

function extractTitle(html: string): string {
  const tv207 = html.match(/<div[^>]*class=['"]TV207[^'"]*['"][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (tv207) return normalizeLawTitle(normalizeInlineText(tv207));

  const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1];
  if (titleTag) return normalizeLawTitle(normalizeInlineText(titleTag));

  return 'Nezināms tiesību akts';
}

function extractDate(html: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*:<\\/font>[\\s\\S]{0,160}?([0-9]{2}\\.[0-9]{2}\\.[0-9]{4}\\.?)`, 'i');
    const found = html.match(re)?.[1];
    if (found) {
      const iso = toIsoDate(found.trim());
      if (iso) return iso;
    }
  }
  return undefined;
}

function extractStatus(html: string, rawTitle: string): 'in_force' | 'amended' | 'repealed' | 'not_yet_in_force' {
  const lowerTitle = rawTitle.toLowerCase();
  const statusIconClass = html.match(/class=['"][^'"]*ico-status\s+([^'"]+)['"]/i)?.[1]?.toLowerCase() ?? '';
  const statusBadgeText = html.match(
    /<div[^>]*class=['"][^'"]*ico-status[^'"]*['"][^>]*>[\\s\\S]{0,400}?<div[^>]*class=['"][^'"]*container[^'"]*['"][^>]*>([^<]+)<\/div>/i
  )?.[1]?.toLowerCase().trim() ?? '';

  if (lowerTitle.includes('zaudējis spēku')) {
    return 'repealed';
  }
  if (statusIconClass.includes('ico-speka') || statusBadgeText.includes('spēkā esošs') || statusBadgeText.includes('in force')) {
    return 'in_force';
  }
  if (
    statusIconClass.includes('nespeka') ||
    statusIconClass.includes('navspeka') ||
    statusBadgeText.includes('zaudējis spēku') ||
    statusBadgeText.includes('no longer in force')
  ) {
    return 'repealed';
  }
  if (statusBadgeText.includes('vēl nav spēkā') || statusBadgeText.includes('not yet in force')) {
    return 'not_yet_in_force';
  }

  return 'in_force';
}

function extractEnglishTitle(enHtml: string | undefined, lvTitle: string): string | undefined {
  if (!enHtml || !/Translation\s+©/i.test(enHtml)) {
    return undefined;
  }

  const h3 = enHtml.match(/<H3[^>]*>([\s\S]*?)<\/H3>/i)?.[1];
  if (!h3) return undefined;

  const parsed = normalizeInlineText(h3);
  if (!parsed) return undefined;
  if (parsed.toLowerCase() === lvTitle.toLowerCase()) return undefined;
  return parsed;
}

function parseMetadata(html: string): ParsedMetadata {
  const title = extractTitle(html);
  return {
    title,
    status: extractStatus(html, title),
    issuedDate: extractDate(html, ['Pieņemts', 'Adoption']),
    inForceDate: extractDate(html, ['Stājas spēkā', 'Entry into force']),
  };
}

function extractChapterMarkers(html: string): ChapterMarker[] {
  const chapters: ChapterMarker[] = [];
  const re = /<div[^>]*class=['"]TV212[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const text = normalizeInlineText(match[1]);
    if (!text) continue;
    chapters.push({ pos: match.index, text });
  }

  return chapters;
}

function findCurrentChapter(chapters: ChapterMarker[], pos: number): string | undefined {
  let current: string | undefined;
  for (const chapter of chapters) {
    if (chapter.pos >= pos) break;
    current = chapter.text;
  }
  return current;
}

interface ArticleStart {
  pos: number;
  tag: string;
  prefix: string;
}

interface ExtractedArticle {
  start: ArticleStart;
  html: string;
}

function extractArticleBlocks(html: string): ExtractedArticle[] {
  const starts: ArticleStart[] = [];
  const boundaries = new Set<number>();

  const re = /<div[^>]*class=['"][^'"]*TV21(?:2|3|5)[^'"]*['"][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const tag = match[0];
    const pos = match.index;
    if (/TV212/i.test(tag) || /TV215/i.test(tag)) {
      boundaries.add(pos);
      continue;
    }

    if (/TV213/i.test(tag)) {
      const prefix = tag.match(/data-pfx=['"]([^'"]+)['"]/i)?.[1] ?? '';
      if (prefix === 'p' || prefix === 'pn') {
        starts.push({ pos, tag, prefix });
        boundaries.add(pos);
      } else if (prefix) {
        boundaries.add(pos);
      }
    }
  }

  boundaries.add(html.length);
  const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);

  const blocks: ExtractedArticle[] = [];
  for (const start of starts) {
    const end = sortedBoundaries.find(b => b > start.pos) ?? html.length;
    const block = html.slice(start.pos, end);
    blocks.push({ start, html: block });
  }

  return blocks;
}

function deriveSection(startTag: string, articleHtml: string): string | undefined {
  const prefix = startTag.match(/data-pfx=['"]([^'"]+)['"]/i)?.[1] ?? 'p';

  if (prefix === 'pn') {
    const fromAnchor = articleHtml.match(/<a\s+name=['"]pn([^'"]+)['"]/i)?.[1];
    if (fromAnchor) return `pn${normalizeSection(fromAnchor)}`;

    const fromDataNum = startTag.match(/data-num=['"]([^'"]+)['"]/i)?.[1];
    if (fromDataNum) return `pn${normalizeSection(fromDataNum)}`;

    return undefined;
  }

  const fromAnchor = articleHtml.match(/<a\s+name=['"]p([^'"]+)['"]/i)?.[1];
  if (fromAnchor) return normalizeSection(fromAnchor);

  const fromDataNum = startTag.match(/data-num=['"]([^'"]+)['"]/i)?.[1];
  if (fromDataNum) return normalizeSection(fromDataNum);

  return undefined;
}

function deriveTitle(articleHtml: string, section: string): string {
  const headingHtml = articleHtml.match(/<p[^>]*class=['"][^'"]*TVP[^'"]*['"][^>]*>([\s\S]*?)<\/p>/i)?.[1];
  if (!headingHtml) return `Art. ${section}`;

  const headingText = normalizeInlineText(headingHtml);
  if (!headingText) return `Art. ${section}`;

  const stripped = headingText
    .replace(/^\s*\d+(?:\.\d+)*(?:\s*[A-Za-z])?\s*\.?\s*pants\.?\s*/iu, '')
    .trim();

  return stripped || headingText;
}

function deriveContent(articleHtml: string): string {
  const paragraphs: string[] = [];
  const fallbackNotes: string[] = [];
  const headingTexts: string[] = [];
  const pRe = /<p([^>]*)>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;

  while ((match = pRe.exec(articleHtml)) !== null) {
    const attrs = match[1];
    const className = (attrs.match(/class=['"]([^'"]*)['"]/i)?.[1] ?? '').toLowerCase();
    const text = htmlToText(match[2]);
    if (!text) continue;

    if (className.includes('tvp')) {
      headingTexts.push(text);
      continue;
    }

    if (className.includes('labojumu_pamats')) {
      // Keep amendment-note text as a fallback for sections that were repealed.
      fallbackNotes.push(text);
      continue;
    }

    paragraphs.push(text);
  }

  if (paragraphs.length > 0) {
    return paragraphs.join('\n').trim();
  }
  if (fallbackNotes.length > 0) {
    return fallbackNotes.join('\n').trim();
  }
  if (headingTexts.length > 0) {
    return headingTexts.join('\n').trim();
  }
  return '';
}

function extractDefinitions(provisions: ParsedProvision[]): ParsedDefinition[] {
  const definitions: ParsedDefinition[] = [];
  const seen = new Set<string>();

  for (const provision of provisions) {
    const titleLower = provision.title.toLowerCase();
    const content = provision.content;

    if (!/termin|definīc|lietotie termini/.test(titleLower) && !/termin|definīc/.test(content.toLowerCase())) {
      continue;
    }

    const numbered = /(?:^|\n)\s*\d+\)\s*([^;\n:]{2,160}?)\s*[—-]\s*([^;\n]{5,1000})/g;
    let match: RegExpExecArray | null;

    while ((match = numbered.exec(content)) !== null) {
      const term = match[1].trim().replace(/[;,.]+$/g, '');
      const definition = match[2].trim().replace(/[;]+$/g, '');
      if (!term || !definition) continue;

      const key = `${term.toLowerCase()}::${definition.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      definitions.push({
        term,
        definition,
        source_provision: provision.provision_ref,
      });
    }

    const quoted = /(?:^|\n)\s*[«"“„]([^"»”]+)["»”]\s*[—-]\s*([^;\n]{5,1000})/g;
    while ((match = quoted.exec(content)) !== null) {
      const term = match[1].trim().replace(/[;,.]+$/g, '');
      const definition = match[2].trim().replace(/[;]+$/g, '');
      if (!term || !definition) continue;

      const key = `${term.toLowerCase()}::${definition.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      definitions.push({
        term,
        definition,
        source_provision: provision.provision_ref,
      });
    }
  }

  return definitions;
}

function buildUrl(act: ActIndexEntry): string {
  return `https://likumi.lv/ta/id/${act.likumiId}-${act.slug}`;
}

export function buildEnglishUrl(act: ActIndexEntry): string {
  return `https://likumi.lv/ta/en/en/id/${act.likumiId}`;
}

export function parseLatvianHtml(html: string, act: ActIndexEntry, enHtml?: string): ParsedAct {
  const metadata = parseMetadata(html);
  const chapters = extractChapterMarkers(html);
  const blocks = extractArticleBlocks(html);
  const provisions: ParsedProvision[] = [];

  for (const block of blocks) {
    const section = deriveSection(block.start.tag, block.html);
    if (!section) continue;

    if (act.allowedSections && !act.allowedSections.includes(section)) {
      continue;
    }

    const content = deriveContent(block.html);
    if (!content) continue;

    const chapter = findCurrentChapter(chapters, block.start.pos);
    const title = deriveTitle(block.html, section);
    const provisionRef = section.startsWith('pn')
      ? `PN ${section.slice(2)}`
      : `Art. ${section}`;

    provisions.push({
      provision_ref: provisionRef,
      chapter,
      section,
      title,
      content,
    });
  }

  const titleEn = extractEnglishTitle(enHtml, metadata.title);
  const definitions = extractDefinitions(provisions);

  return {
    id: act.id,
    type: 'statute',
    title: metadata.title,
    title_en: titleEn,
    short_name: act.shortName,
    status: metadata.status,
    issued_date: metadata.issuedDate,
    in_force_date: metadata.inForceDate,
    url: buildUrl(act),
    description: 'Official consolidated text from Likumi.lv (Latvijas Vēstnesis).',
    provisions,
    definitions,
  };
}

export const KEY_LATVIAN_ACTS: ActIndexEntry[] = [
  {
    id: 'lv-personal-data-processing-law',
    seedFile: 'personal-data-processing-law',
    likumiId: 300099,
    slug: 'fizisko-personu-datu-apstrades-likums',
    shortName: 'FPDAL',
  },
  {
    id: 'lv-it-security-law',
    seedFile: 'it-security-law',
    likumiId: 353390,
    slug: 'nacionalas-kiberdrosibas-likums',
    shortName: 'NKL',
  },
  {
    id: 'lv-electronic-communications-law',
    seedFile: 'electronic-communications-law',
    likumiId: 334345,
    slug: 'elektronisko-sakaru-likums',
    shortName: 'ESL',
  },
  {
    id: 'lv-electronic-documents-law',
    seedFile: 'electronic-documents-law',
    likumiId: 68521,
    slug: 'elektronisko-dokumentu-likums',
    shortName: 'EDL',
  },
  {
    id: 'lv-trust-services-eid-law',
    seedFile: 'trust-services-eid-law',
    likumiId: 278001,
    slug: 'fizisko-personu-elektroniskas-identifikacijas-likums',
    shortName: 'EID',
  },
  {
    id: 'lv-information-society-services-law',
    seedFile: 'information-society-services-law',
    likumiId: 96619,
    slug: 'informacijas-sabiedribas-pakalpojumu-likums',
    shortName: 'ISPL',
  },
  {
    id: 'lv-freedom-of-information-law',
    seedFile: 'freedom-of-information-law',
    likumiId: 50601,
    slug: 'informacijas-atklatibas-likums',
    shortName: 'IAL',
  },
  {
    id: 'lv-commercial-secret-protection-law',
    seedFile: 'commercial-secret-protection-law',
    likumiId: 305532,
    slug: 'komercnoslepuma-aizsardzibas-likums',
    shortName: 'KNAL',
  },
  {
    id: 'lv-national-security-law',
    seedFile: 'national-security-law',
    likumiId: 14011,
    slug: 'nacionalas-drosibas-likums',
    shortName: 'NDL',
  },
  {
    id: 'lv-criminal-law-cybercrime',
    seedFile: 'criminal-law-cybercrime',
    likumiId: 88966,
    slug: 'kriminallikums',
    shortName: 'KL-XVII',
  },
];
