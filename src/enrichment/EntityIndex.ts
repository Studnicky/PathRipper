/**
 * EntityIndex — lightweight canonical-entity lookup built from a pre-scan of
 * the input directory before the main scatter begins.
 *
 * Maps href-tail keys (e.g. `"Ancestries.aspx?ID=65"`) to canonical entity IRIs
 * (e.g. `"https://squashage.dev/instance/aonprd/Ancestries.aspx?ID=65"`) using
 * the same {@link SubjectIriPolicy} the main projection uses, guaranteeing
 * pre-scan IRI ≡ projected subject IRI.
 *
 * All entries are canonical entities within the dataset — off-dataset hrefs do
 * not appear in the index, ensuring resolved edges never point to absent nodes.
 */

import { readFile, readdir } from 'node:fs/promises';
import { extname, join }     from 'node:path';

import type { SubjectIriPolicy } from '../induction/SubjectIriPolicy.js';

export class EntityIndex {
  readonly #index: ReadonlyMap<string, string>;

  private constructor(index: Map<string, string>) {
    this.#index = index;
  }

  /**
   * Resolve a relative href to its canonical entity IRI.
   *
   * Leading `/` is stripped before lookup so `Ancestries.aspx?ID=65` and
   * `/Ancestries.aspx?ID=65` both resolve correctly.
   *
   * Returns `undefined` for hrefs that do not correspond to an entity in the
   * dataset (off-dataset links are left as-is by the reconciler).
   */
  resolve(href: string): string | undefined {
    const key = href.startsWith('/') ? href.slice(1) : href;
    return this.#index.get(key);
  }

  /** Number of canonical entities indexed. */
  get size(): number {
    return this.#index.size;
  }

  /**
   * Build an EntityIndex by scanning all input files under `inputDir`.
   *
   * Only records whose canonical IRI starts with `canonicalBase` are indexed
   * (hash-fallback IRIs are excluded).
   *
   * @param inputDir     - Root input directory (same as `targetConfig.input.basePath`).
   * @param format       - Input file format ('json' or 'jsonl').
   * @param policy       - Same SubjectIriPolicy instance the main run uses.
   * @param canonicalBase - IRI prefix for canonical entities (must end with `/`).
   */
  static async build(
    inputDir:      string,
    format:        'json' | 'jsonl',
    policy:        SubjectIriPolicy,
    canonicalBase: string,
  ): Promise<EntityIndex> {
    const index = new Map<string, string>();
    await EntityIndex.#scanDirectory(inputDir, format, policy, canonicalBase, index);
    return new EntityIndex(index);
  }

  static async #scanDirectory(
    dir:           string,
    format:        'json' | 'jsonl',
    policy:        SubjectIriPolicy,
    canonicalBase: string,
    index:         Map<string, string>,
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await EntityIndex.#scanDirectory(full, format, policy, canonicalBase, index);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (ext === '.json' && format === 'json') {
          await EntityIndex.#indexJsonFile(full, policy, canonicalBase, index);
        } else if (ext === '.jsonl' && format === 'jsonl') {
          await EntityIndex.#indexJsonlFile(full, policy, canonicalBase, index);
        }
      }
    }
  }

  static async #indexJsonFile(
    path:          string,
    policy:        SubjectIriPolicy,
    canonicalBase: string,
    index:         Map<string, string>,
  ): Promise<void> {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      return;
    }
    EntityIndex.#indexText(text, path, 0, policy, canonicalBase, index);
  }

  static async #indexJsonlFile(
    path:          string,
    policy:        SubjectIriPolicy,
    canonicalBase: string,
    index:         Map<string, string>,
  ): Promise<void> {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      return;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined && line.trim().length > 0) {
        EntityIndex.#indexText(line, path, i, policy, canonicalBase, index);
      }
    }
  }

  static #indexText(
    text:          string,
    path:          string,
    line:          number,
    policy:        SubjectIriPolicy,
    canonicalBase: string,
    index:         Map<string, string>,
  ): void {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    const canonicalIri = policy.resolve(record, path, line);
    if (!canonicalIri.startsWith(canonicalBase)) return;
    const tail = canonicalIri.slice(canonicalBase.length);
    // SubjectIriPolicy hash-fallback IRIs always have the form `record/<8hexchars>`.
    // Skip them — hash-derived identifiers are not stable entity keys.
    if (tail.length === 0 || /^record\/[0-9a-f]{8}$/.test(tail)) return;
    index.set(tail, canonicalIri);
  }
}
