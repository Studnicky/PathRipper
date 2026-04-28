import wtf from 'wtf_wikipedia';

export type WikitextSectionType = Record<string, string | string[] | number | boolean | null>;

export interface ParsedPageInterface {
  readonly title: string;
  readonly infobox: WikitextSectionType;
  readonly sections: ReadonlyArray<{ readonly title: string; readonly text: string }>;
  readonly categories: readonly string[];
}

type WtfSectionType = ReturnType<ReturnType<typeof wtf>['sections']> extends ReadonlyArray<infer S> ? S : ReturnType<ReturnType<typeof wtf>['sections']>;

export class WikitextParser {
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
    const sections = sectionArray.map((s: WtfSectionType) => ({
      title: (s as { title: () => string }).title(),
      text:  (s as { wikitext: () => string }).wikitext(),
    }));

    const categories = doc.categories() as string[];

    return { title, infobox, sections, categories };
  }

  static infoboxField(parsed: ParsedPageInterface, field: string): string | null {
    const val = parsed.infobox[field];
    return val !== undefined && val !== null ? String(val) : null;
  }

  static infoboxNumber(parsed: ParsedPageInterface, field: string): number | null {
    const val = WikitextParser.infoboxField(parsed, field);
    if (val === null) return null;
    const n = parseFloat(val);
    return Number.isFinite(n) ? n : null;
  }
}
