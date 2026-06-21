import wtf from 'wtf_wikipedia';

import type { WikitextSectionType, ParsedPageType, WtfSectionType } from '../types/Scrapers.js';
import type { InfoboxFieldResult, InfoboxNumberResult } from '../types/Results.js';

export type { ParsedPageType };

/**
 * Parses raw wikitext into structured infobox, section, and category data.
 *
 * @remarks
 * Uses `wtf_wikipedia` under the hood. All methods are static.
 *
 * @example
 * ```ts
 * const parsed = WikitextParser.parse('Tarrasque', rawWikitext);
 * const cr = WikitextParser.infoboxNumber(parsed, 'cr');
 * ```
 * @category Scrapers
 * @since 2.0.0
 * @group Scrapers
 * @see ParsedPageType
 */
export class WikitextParser {
  /**
   * Parses a raw wikitext string into a structured `ParsedPageType`.
   *
   * @param title - Article title used as-is in the returned object.
   * @param wikitext - Raw wikitext content to parse.
   * @returns Parsed page with infobox fields, sections, and categories.
   */
  static parse(title: string, wikitext: string): ParsedPageType {
    const doc = wtf(wikitext);

    const infobox: WikitextSectionType = {};
    for (const box of doc.infoboxes()) {
      for (const [key, val] of Object.entries(box.json())) {
        infobox[key] = typeof val === 'object' && val !== null && 'text' in val
          ? String((val as { text: unknown }).text)
          : String(val);
      }
    }

    const rawSections = doc.sections();
    const sectionArray = Array.isArray(rawSections) ? rawSections : (rawSections !== null ? [rawSections] : []);
    const sections = sectionArray.map((section: WtfSectionType): { title: string; text: string } => ({
      title: (section as { title: () => string }).title(),
      text:  (section as { wikitext: () => string }).wikitext(),
    }));

    const categories = doc.categories() as string[];

    return { title, infobox, sections, categories };
  }

  /**
   * Retrieves an infobox field value as a string.
   *
   * @param parsed - Previously parsed page.
   * @param field - Infobox field key to look up.
   * @returns String value if the field exists, otherwise `null`.
   */
  static infoboxField(parsed: ParsedPageType, field: string): InfoboxFieldResult {
    const val = parsed.infobox[field];
    return val !== undefined && val !== null ? String(val) : null;
  }

  /**
   * Retrieves an infobox field value as a finite number.
   *
   * @param parsed - Previously parsed page.
   * @param field - Infobox field key to look up.
   * @returns Parsed finite number if the field exists and is numeric, otherwise `null`.
   */
  static infoboxNumber(parsed: ParsedPageType, field: string): InfoboxNumberResult {
    const val = WikitextParser.infoboxField(parsed, field);
    if (val === null) return null;
    const num = parseFloat(val);
    return Number.isFinite(num) ? num : null;
  }
}
