import wtf from 'wtf_wikipedia';

import type { WikitextSectionType, ParsedPageInterface } from '../types/Scrapers.js';

export type { ParsedPageInterface };

type WtfSectionType = ReturnType<ReturnType<typeof wtf>['sections']> extends ReadonlyArray<infer S> ? S : ReturnType<ReturnType<typeof wtf>['sections']>;

/** Parses raw wikitext into structured infobox, section, and category data. */
export class WikitextParser {
  /**
   * Parses a raw wikitext string into a structured `ParsedPageInterface`.
   *
   * @param title - Article title used as-is in the returned object.
   * @param wikitext - Raw wikitext content to parse.
   * @returns Parsed page with infobox fields, sections, and categories.
   */
  static parse(title: string, wikitext: string): ParsedPageInterface {
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
    const sections = sectionArray.map((s: WtfSectionType): { title: string; text: string } => ({
      title: (s as { title: () => string }).title(),
      text:  (s as { wikitext: () => string }).wikitext(),
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
  static infoboxField(parsed: ParsedPageInterface, field: string): string | null {
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
  static infoboxNumber(parsed: ParsedPageInterface, field: string): number | null {
    const val = WikitextParser.infoboxField(parsed, field);
    if (val === null) return null;
    const n = parseFloat(val);
    return Number.isFinite(n) ? n : null;
  }
}
