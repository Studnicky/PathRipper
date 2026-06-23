/**
 * MarkdownConverter — converts raw HTML to clean Markdown for LLM ingestion.
 *
 * Uses cheerio to traverse the DOM and produce GFM-compatible Markdown.
 * All helpers are private static methods; the dispatch map keeps `renderTag`
 * complexity flat regardless of how many tag types are handled.
 *
 * @module markdown/MarkdownConverter
 * @since 3.3.0
 */

import { load } from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element, AnyNode } from 'domhandler';

// Positional — level = indexOf(tag) + 1; no numeric literals needed.
const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

// Set lookup for block containers avoids array .includes() structural clone.
const BLOCK_CONTAINER_TAGS = new Set([
  'div', 'section', 'article', 'main', 'aside',
  'footer', 'header', 'nav', 'form', 'fieldset',
]);

/**
 * Converts HTML strings to clean GFM Markdown suitable for LLM ingestion.
 *
 * @remarks
 * Uses Cheerio to walk the DOM tree and emit one Markdown string per element.
 * Relative URLs in `href` and `src` attributes are resolved against `baseUrl`
 * when supplied. Whitespace is normalised: consecutive blank lines collapse to
 * one; the result is trimmed.
 *
 * @example
 * ```ts
 * const md = MarkdownConverter.convert('<h1>Hello</h1><p>World</p>');
 * // '# Hello\n\nWorld'
 * ```
 *
 * @see {@link MarkdownWriteNode}
 * @group Markdown
 * @category Markdown
 * @since 3.3.0
 */
export class MarkdownConverter {
  private constructor() {}

  /**
   * Convert an HTML string to Markdown.
   *
   * @param html    - Raw HTML to convert.
   * @param baseUrl - Optional base URL for resolving relative hrefs and srcs.
   * @returns       Clean Markdown string.
   */
  static convert(html: string, baseUrl?: string): string {
    const doc = load(html);
    doc('script, style, meta, link, noscript, head').remove();
    const root = doc('body').length > 0 ? doc('body') : doc.root();
    const raw  = MarkdownConverter.renderChildren(doc, root as ReturnType<CheerioAPI>, baseUrl);
    return MarkdownConverter.normalizeWhitespace(raw);
  }

  // ── Dispatch map ──────────────────────────────────────────────────────────────

  // Inline type avoids a named type alias that the project requires to live in src/types/.
  private static readonly TAG_HANDLERS: ReadonlyMap<
    string,
    (doc: CheerioAPI, elem: ReturnType<CheerioAPI>, baseUrl: string | undefined) => string
  > = new Map([
    ['h1',         MarkdownConverter.renderHeading],
    ['h2',         MarkdownConverter.renderHeading],
    ['h3',         MarkdownConverter.renderHeading],
    ['h4',         MarkdownConverter.renderHeading],
    ['h5',         MarkdownConverter.renderHeading],
    ['h6',         MarkdownConverter.renderHeading],
    ['p',          MarkdownConverter.renderParagraph],
    ['pre',        MarkdownConverter.renderPre],
    ['blockquote', MarkdownConverter.renderBlockquote],
    ['ul',         MarkdownConverter.renderList],
    ['ol',         MarkdownConverter.renderList],
    ['li',         MarkdownConverter.renderListItem],
    ['table',      MarkdownConverter.renderTable],
    ['a',          MarkdownConverter.renderAnchor],
    ['strong',     MarkdownConverter.renderBold],
    ['b',          MarkdownConverter.renderBold],
    ['em',         MarkdownConverter.renderItalic],
    ['i',          MarkdownConverter.renderItalic],
    ['code',       MarkdownConverter.renderCode],
    ['img',        MarkdownConverter.renderImage],
  ]);

  // ── Core rendering ─────────────────────────────────────────────────────────────

  private static renderNode(doc: CheerioAPI, node: AnyNode, baseUrl: string | undefined): string {
    if (node.type === 'text') {
      return ((node as { data?: string }).data ?? '').replace(/\s+/g, ' ');
    }
    if (node.type !== 'tag') return '';
    return MarkdownConverter.renderTag(doc, node, baseUrl);
  }

  private static renderTag(doc: CheerioAPI, node: AnyNode, baseUrl: string | undefined): string {
    const tag = (node as Element).name.toLowerCase();
    if (tag === 'hr') return '\n\n---\n\n';
    const elem    = doc(node);
    const handler = MarkdownConverter.TAG_HANDLERS.get(tag);
    if (handler !== undefined) return handler(doc, elem, baseUrl);
    if (BLOCK_CONTAINER_TAGS.has(tag)) {
      const inner = MarkdownConverter.renderChildren(doc, elem, baseUrl);
      return inner.length > 0 ? `\n${inner}\n` : '';
    }
    return MarkdownConverter.renderChildren(doc, elem, baseUrl);
  }

  private static renderChildren(
    doc:     CheerioAPI,
    elem:    ReturnType<CheerioAPI>,
    baseUrl: string | undefined,
  ): string {
    const parts: string[] = [];
    for (const child of elem.contents().toArray()) {
      parts.push(MarkdownConverter.renderNode(doc, child, baseUrl));
    }
    return parts.join('');
  }

  // ── Block renderers ────────────────────────────────────────────────────────────

  // Derives heading level from the element's own tag name so it can match the
  // TagHandler signature (doc, elem, baseUrl) without a separate `level` param.
  private static renderHeading(
    doc:     CheerioAPI,
    elem:    ReturnType<CheerioAPI>,
    baseUrl: string | undefined,
  ): string {
    const node  = elem.get(0) as Element | undefined;
    const tag   = node?.name?.toLowerCase() ?? '';
    const level = MarkdownConverter.headingLevel(tag);
    if (level === 0) return '';
    const hashes = '#'.repeat(level);
    const text   = MarkdownConverter.renderChildren(doc, elem, baseUrl).trim();
    return `\n\n${hashes} ${text}\n\n`;
  }

  private static renderParagraph(
    doc:     CheerioAPI,
    elem:    ReturnType<CheerioAPI>,
    baseUrl: string | undefined,
  ): string {
    const text = MarkdownConverter.renderChildren(doc, elem, baseUrl).trim();
    return text.length > 0 ? `\n\n${text}\n\n` : '';
  }

  private static renderPre(
    _doc:     CheerioAPI,
    elem:     ReturnType<CheerioAPI>,
    _baseUrl: string | undefined,
  ): string {
    const code  = elem.find('code').first();
    const inner = code.length > 0 ? code.text() : elem.text();
    return `\n\n\`\`\`\n${inner}\n\`\`\`\n\n`;
  }

  private static renderBlockquote(
    doc:     CheerioAPI,
    elem:    ReturnType<CheerioAPI>,
    baseUrl: string | undefined,
  ): string {
    const inner = MarkdownConverter.renderChildren(doc, elem, baseUrl).trim();
    const lines = inner.split('\n').map((line: string): string => `> ${line}`).join('\n');
    return `\n\n${lines}\n\n`;
  }

  // Derives ordered flag from the element's own tag so ul and ol can share
  // one handler without a separate boolean parameter.
  private static renderList(
    doc:     CheerioAPI,
    elem:    ReturnType<CheerioAPI>,
    baseUrl: string | undefined,
  ): string {
    const node    = elem.get(0) as Element | undefined;
    const ordered = node?.name?.toLowerCase() === 'ol';
    const lines: string[] = [];
    let counter = 1;
    for (const listItem of elem.children('li').toArray()) {
      const text   = MarkdownConverter.renderChildren(doc, doc(listItem), baseUrl).trim();
      const prefix = ordered ? `${counter}. ` : '- ';
      lines.push(`${prefix}${text}`);
      counter++;
    }
    return lines.length > 0 ? `\n\n${lines.join('\n')}\n\n` : '';
  }

  private static renderListItem(
    doc:     CheerioAPI,
    elem:    ReturnType<CheerioAPI>,
    baseUrl: string | undefined,
  ): string {
    return MarkdownConverter.renderChildren(doc, elem, baseUrl).trim();
  }

  // ── Table rendering ────────────────────────────────────────────────────────────

  private static renderTable(
    doc:     CheerioAPI,
    elem:    ReturnType<CheerioAPI>,
    baseUrl: string | undefined,
  ): string {
    const headerRows = MarkdownConverter.collectHeaderRows(doc, elem, baseUrl);
    const bodyRows   = MarkdownConverter.collectBodyRows(doc, elem, baseUrl);
    const rows       = [...headerRows, ...bodyRows];
    if (rows.length === 0) return '';
    const colCount  = Math.max(...rows.map((row: string[]): number => row.length));
    const separator = `| ${Array<string>(colCount).fill('---').join(' | ')} |`;
    const lines     = [MarkdownConverter.formatTableRow(rows[0] ?? [], colCount), separator];
    for (let idx = 1; idx < rows.length; idx++) {
      lines.push(MarkdownConverter.formatTableRow(rows[idx] ?? [], colCount));
    }
    return `\n\n${lines.join('\n')}\n\n`;
  }

  private static collectHeaderRows(
    doc:     CheerioAPI,
    elem:    ReturnType<CheerioAPI>,
    baseUrl: string | undefined,
  ): string[][] {
    const rows: string[][] = [];
    for (const row of elem.find('thead tr').toArray()) {
      rows.push(MarkdownConverter.collectCells(doc, doc(row), baseUrl));
    }
    return rows;
  }

  private static collectBodyRows(
    doc:     CheerioAPI,
    elem:    ReturnType<CheerioAPI>,
    baseUrl: string | undefined,
  ): string[][] {
    const rows: string[][] = [];
    for (const row of elem.find('tbody tr, tr').toArray()) {
      if (doc(row).closest('thead').length > 0) continue;
      const cells = MarkdownConverter.collectCells(doc, doc(row), baseUrl);
      if (cells.length > 0) rows.push(cells);
    }
    return rows;
  }

  private static collectCells(
    doc:     CheerioAPI,
    row:     ReturnType<CheerioAPI>,
    baseUrl: string | undefined,
  ): string[] {
    const cells: string[] = [];
    for (const cell of row.find('th, td').toArray()) {
      cells.push(MarkdownConverter.renderChildren(doc, doc(cell), baseUrl).trim());
    }
    return cells;
  }

  private static formatTableRow(row: string[], colCount: number): string {
    const padded = [...row];
    while (padded.length < colCount) padded.push('');
    return `| ${padded.join(' | ')} |`;
  }

  // ── Inline renderers ───────────────────────────────────────────────────────────

  private static renderAnchor(
    doc:     CheerioAPI,
    elem:    ReturnType<CheerioAPI>,
    baseUrl: string | undefined,
  ): string {
    const text    = MarkdownConverter.renderChildren(doc, elem, baseUrl).trim();
    const rawHref = elem.attr('href') ?? '';
    const href    = MarkdownConverter.resolveUrl(rawHref, baseUrl);
    if (href.length > 0 && text.length > 0) return `[${text}](${href})`;
    return text;
  }

  private static renderBold(
    doc:     CheerioAPI,
    elem:    ReturnType<CheerioAPI>,
    baseUrl: string | undefined,
  ): string {
    const text = MarkdownConverter.renderChildren(doc, elem, baseUrl).trim();
    return text.length > 0 ? `**${text}**` : '';
  }

  private static renderItalic(
    doc:     CheerioAPI,
    elem:    ReturnType<CheerioAPI>,
    baseUrl: string | undefined,
  ): string {
    const text = MarkdownConverter.renderChildren(doc, elem, baseUrl).trim();
    return text.length > 0 ? `*${text}*` : '';
  }

  private static renderCode(
    _doc:     CheerioAPI,
    elem:     ReturnType<CheerioAPI>,
    _baseUrl: string | undefined,
  ): string {
    const text = elem.text();
    return text.length > 0 ? `\`${text}\`` : '';
  }

  private static renderImage(
    _doc:     CheerioAPI,
    elem:     ReturnType<CheerioAPI>,
    baseUrl:  string | undefined,
  ): string {
    const alt    = elem.attr('alt') ?? '';
    const rawSrc = elem.attr('src') ?? '';
    const src    = MarkdownConverter.resolveUrl(rawSrc, baseUrl);
    if (src.length === 0) return alt;
    // GFM image syntax requires a leading exclamation mark before the bracket.
    const imgMark = '!';
    return `${imgMark}[${alt}](${src})`;
  }

  // ── Utilities ──────────────────────────────────────────────────────────────────

  private static headingLevel(tag: string): number {
    const idx = (HEADING_TAGS as readonly string[]).indexOf(tag);
    return idx < 0 ? 0 : idx + 1;
  }

  private static resolveUrl(rawUrl: string, baseUrl: string | undefined): string {
    if (rawUrl.length === 0) return '';
    if (baseUrl === undefined || baseUrl.length === 0) return rawUrl;
    try {
      return new URL(rawUrl, baseUrl).href;
    } catch {
      return rawUrl;
    }
  }

  private static normalizeWhitespace(input: string): string {
    return input.replace(/\n\n\n+/g, '\n\n').trim();
  }
}
