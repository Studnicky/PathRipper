/**
 * AonprdReconciler — AON-specific identity reconciliation.
 *
 * Builds a two-map index from captured concept docs:
 *   - `nameIdToUrl`  — `name|id` → URL where that concept was captured.
 *   - `hrefToTexts`  — relative href → all link text strings that point to it.
 *
 * AON's broken cross-category links preserve the numeric `ID` (e.g. the catfolk
 * ancestry at `Ancestries.aspx?ID=77` is mislinked as `Classes.aspx?ID=77`).
 * A failure is resolved `capturedElsewhere` only when a captured concept matches
 * BOTH the originating link text (name) AND the id — so "catfolk" + id 77 lands
 * on the ancestry, never on a same-named "Catfolk" trait at a different id.
 * Otherwise `missing`.
 *
 * @module plugins/aonprd/AonprdReconciler
 * @since 3.3.0
 */

import type {
  ReconcilerInterface,
  CapturedConceptType,
  CapturedFailureType,
  ResolutionType,
} from '../../src/resilience/Reconciler.js';

// ── AonprdIndexType ────────────────────────────────────────────────────────────

type AonprdIndexType = {
  readonly nameIdToUrl: ReadonlyMap<string, string>;
  readonly hrefToTexts: ReadonlyMap<string, readonly string[]>;
};

// ── AonprdReconciler ───────────────────────────────────────────────────────────

export class AonprdReconciler implements ReconcilerInterface<AonprdIndexType> {
  public prepare(concepts: readonly CapturedConceptType[]): AonprdIndexType {
    const nameIdToUrl = new Map<string, string>();
    const hrefToTexts = new Map<string, string[]>();

    for (const concept of concepts) {
      // Build nameIdToUrl: `name|id` → url. The id is taken from the captured
      // url so it is comparable to a broken link's id (both are `?ID=n`).
      const name = concept.output['name'];
      const id   = AonprdReconciler.idOf(concept.url);
      if (typeof name === 'string' && id !== null) {
        nameIdToUrl.set(AonprdReconciler.nameIdKey(name, id), concept.url);
      }

      // Build hrefToTexts: relHref from each link in output.links → text[]
      // output.links entries shape: { href: string, text: string, kind: string, id: number|null }
      const links = concept.output['links'];
      if (Array.isArray(links)) {
        for (const entry of links as Array<Record<string, unknown>>) {
          if (typeof entry['href'] !== 'string' || typeof entry['text'] !== 'string') continue;
          const rel = AonprdReconciler.relHref(entry['href'] as string);
          const txt = AonprdReconciler.normalize(entry['text'] as string);
          if (txt !== '') {
            const existing = hrefToTexts.get(rel);
            if (existing !== undefined) {
              existing.push(txt);
            } else {
              hrefToTexts.set(rel, [txt]);
            }
          }
        }
      }
    }

    return { nameIdToUrl, hrefToTexts };
  }

  public resolveFailure(failure: CapturedFailureType, index: AonprdIndexType): ResolutionType {
    const id = AonprdReconciler.idOf(failure.url);
    if (id === null) return { status: 'missing' };
    const href  = AonprdReconciler.relHref(failure.url);
    const texts = index.hrefToTexts.get(href) ?? [];
    for (const text of texts) {
      // Require BOTH the link text (name) AND the preserved id to match — this
      // disambiguates a mislabeled cross-category link from a coincidental
      // same-name concept at a different id.
      const at = index.nameIdToUrl.get(AonprdReconciler.nameIdKey(text, id));
      if (at !== undefined) return { status: 'capturedElsewhere', at };
    }
    return { status: 'missing' };
  }

  /** Composite lookup key: normalized name + numeric id. */
  private static nameIdKey(name: string, id: number): string {
    return `${AonprdReconciler.normalize(name)}|${id.toString()}`;
  }

  /** Normalize a concept name for lookup: trim + lowercase. */
  private static normalize(name: string): string {
    return name.trim().toLowerCase();
  }

  /** Extract the numeric `?ID=n` from an AON url, or `null` when absent. */
  private static idOf(url: string): number | null {
    const match = /[?&]ID=(\d+)/i.exec(url);
    return match !== null ? Number.parseInt(match[1] as string, 10) : null;
  }

  /**
   * Strip origin and leading slash from a URL, leaving just the relative href.
   * "https://2e.aonprd.com/Classes.aspx?ID=77" → "Classes.aspx?ID=77"
   * "Classes.aspx?ID=77" → "Classes.aspx?ID=77"
   */
  private static relHref(url: string): string {
    const match = /^https?:\/\/[^/]+\/(.+)$/.exec(url);
    return match !== null ? (match[1] as string) : url.replace(/^\//, '');
  }
}

/** Singleton AON reconciler instance. */
export const aonprdReconciler = new AonprdReconciler();
