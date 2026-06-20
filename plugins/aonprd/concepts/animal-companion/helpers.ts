// Animal-companion shared parsing utilities.
import type { HarvestedField } from '../../common.js';
import {
  htmlToText,
  splitTopLevel,
} from '../../common.js';
import type {
  AnimalCompanionVariant,
  AnimalCompanionRef,
  AnimalCompanionAbilities,
  AnimalCompanionStrike,
} from './types.js';

/** Read the `Type=` query parameter and map it to an AnimalCompanionVariant. */
export function detectVariant(url: string): AnimalCompanionVariant {
  const match = /[?&]Type=([A-Za-z]+)/i.exec(url);
  if (match === null) return 'base';
  const trimmed = match[1]!.toLowerCase();
  if (trimmed === 'unique')       return 'unique';
  if (trimmed === 'specialized')  return 'specialized';
  if (trimmed === 'advancement')  return 'advancement';
  return 'base';
}

/**
 * Find the first HarvestedField (case-insensitive) matching `label`, or null.
 *
 * Companion pages have all structured labels surfaced into `common.fields` by the
 * shared field harvester. Multi-occurrence labels (`Melee`, `Damage`) keep
 * their source order in the array.
 */
export function findField(fields: ReadonlyArray<HarvestedField>, label: string): HarvestedField | null {
  const target = label.toLowerCase();
  for (const field of fields) if (field.label.toLowerCase() === target) return field;
  return null;
}

/**
 * Capture every `<b>Label</b> Value` pair from a free-form fragment.
 *
 * Used for Unique-page uplift modifications where the page lacks `<hr/>` and
 * structured labels live in `body_html` rather than `field_map`/`fields`.
 */
export function harvestBoldEntries(html: string): Array<{ label: string; value_text: string; value_html: string }> {
  const out: Array<{ label: string; value_text: string; value_html: string }> = [];
  const regex = /<b>([\s\S]*?)<\/b>([\s\S]*?)(?=<b>|<h[1-6]\b|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const labelHtml = match[1] ?? '';
    const valueHtml = match[2] ?? '';
    const label = htmlToText(labelHtml).replace(/[:?]$/, '').trim();
    if (label === '') continue;
    out.push({
      label,
      value_text: htmlToText(valueHtml).replace(/^[\s;,:]+|[\s;,]+$/g, ''),
      value_html: valueHtml.trim(),
    });
  }
  return out;
}

const ACTION_GLYPH_RE = /\[([a-z-]+)\]/i;

const ACTION_LABEL_TO_COST: ReadonlyMap<string, 'one-action' | 'two-actions' | 'three-actions' | 'reaction' | 'free-action'> = new Map([
  ['one-action',     'one-action'],
  ['single-action',  'one-action'],
  ['two-actions',    'two-actions'],
  ['three-actions',  'three-actions'],
  ['reaction',       'reaction'],
  ['free-action',    'free-action'],
]);

export function readActionGlyph(text: string): 'one-action' | 'two-actions' | 'three-actions' | 'reaction' | 'free-action' | null {
  const match = ACTION_GLYPH_RE.exec(text);
  if (match === null) return null;
  return ACTION_LABEL_TO_COST.get(match[1]!.toLowerCase()) ?? null;
}

/**
 * Parse a single `<b>Melee</b>`/`<b>Ranged</b>` value HTML into a Strike. The
 * value looks like:
 *
 *   ` <span class='action'>[one-action]</span> beak (<a>finesse</a>),
 *     <b>Damage</b> 1d6 piercing`
 *
 * but the `<b>Damage</b>` portion is split off by `harvestBoldEntries` into the
 * next entry, so this function only sees the part before `<b>Damage</b>`.
 */
export function parseStrikeValue(kind: 'melee' | 'ranged', valueHtml: string, damageText: string | null): AnimalCompanionStrike {
  // Pull action glyph and traits.
  const action_cost = readActionGlyph(htmlToText(valueHtml));

  // Strip action span + bold tags + anchor wrappers to get name + traits cluster.
  const flat = htmlToText(valueHtml);

  // Name is the text before "(": e.g. "beak (finesse)" → "beak".
  // When no traits cluster, the whole thing is the name.
  const parenIdx = flat.indexOf('(');
  let name: string;
  let traits: string[] = [];
  if (parenIdx >= 0) {
    name = flat.slice(0, parenIdx).trim();
    const closeIdx = flat.lastIndexOf(')');
    if (closeIdx > parenIdx) {
      const traitStr = flat.slice(parenIdx + 1, closeIdx);
      traits = splitTopLevel(traitStr, ',').map((str) => str.trim()).filter((str) => str !== '');
    }
  } else {
    name = flat.trim();
  }
  // Strip leading "[…]" action-cost residue if htmlToText preserved it.
  name = name.replace(/^\s*\[[a-z-]+\]\s*/i, '').trim();

  return {
    kind,
    name,
    action_cost,
    traits,
    damage: damageText !== null && damageText !== '' ? damageText : null,
  };
}

/** Parse a `Str +2, Dex +3, …` ability modifier line into a stat block. */
export function parseAbilities(fields: ReadonlyArray<HarvestedField>): AnimalCompanionAbilities {
  const out: AnimalCompanionAbilities = { str: null, dex: null, con: null, int: null, wis: null, cha: null };
  const labels = ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'] as const;
  type AbilityKey = keyof AnimalCompanionAbilities;
  const setMap: Record<typeof labels[number], AbilityKey> = {
    Str: 'str', Dex: 'dex', Con: 'con', Int: 'int', Wis: 'wis', Cha: 'cha',
  };
  for (const lbl of labels) {
    const entry = findField(fields, lbl);
    if (entry === null) continue;
    // Ability values can carry trailing commas/segments; pull leading signed int.
    const match = /-?\d+/.exec(entry.value_text);
    if (match === null) continue;
    const num = parseInt(match[0], 10);
    if (!Number.isFinite(num)) continue;
    out[setMap[lbl]] = num;
  }
  return out;
}

/** Walk anchor links in a fragment to harvest the base companion reference (Unique pages). */
export function parseBaseCompanion(valueHtml: string | null): AnimalCompanionRef | null {
  if (valueHtml === null) return null;
  const match = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(valueHtml);
  if (match === null) {
    const text = htmlToText(valueHtml);
    return text === '' ? null : { name: text, companion_id: null, variant: null, href: '' };
  }
  const href = match[1] ?? '';
  const text = htmlToText(match[2] ?? '');
  const idMatch = /[?&]ID=(\d+)/i.exec(href);
  const companionId = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
  const typeMatch = /[?&]Type=([A-Za-z]+)/i.exec(href);
  let variant: AnimalCompanionVariant | null = null;
  if (typeMatch !== null) {
    const trimmed = typeMatch[1]!.toLowerCase();
    if (trimmed === 'unique')       variant = 'unique';
    else if (trimmed === 'specialized')  variant = 'specialized';
    else if (trimmed === 'advancement')  variant = 'advancement';
  }
  return { name: text, companion_id: companionId, variant, href };
}

/**
 * Trim trailing tokens that bleed into a label value from the following block.
 *
 * The shared field harvester captures everything from `<b>Label</b>` up to the
 * next `<b>` boundary or end-of-segment, so a value followed by a `<h3>`
 * sub-block (e.g. `<b>Advanced Maneuver</b> Pterosaur Swoop<h3>…</h3>`) picks
 * up the heading text. We rely on `value_html` to detect the cut.
 */
export function valueBeforeBlockBoundary(html: string): string {
  // Cut at the first `<h1>`/`<h2>`/`<h3>`/`<hr>` — these mark a sub-section
  // boundary the label value should not cross.
  const cut = /<(?:h[1-6]\b|hr\b)/i.exec(html);
  return cut !== null ? html.slice(0, cut.index) : html;
}
