// Character-creation page extractors: ancestry, class, background.
// These pages are prose-heavy with `<h2 class="title">` / `<h3 class="title">`
// subsections. The shared foundation already captures every section and link;
// here we add light per-type structured projection on top.
import type { CheerioAPI } from 'cheerio';
import {
  type CommonExtraction,
  type CheerioNode,
  type LinkRef,
  type Rarity,
  type PfsLegality,
  type Section,
  getField,
  asInt,
  splitTopLevel,
  htmlToText,
} from './common.js';

// ─── Shared shape ─────────────────────────────────────────────────────────────

interface SourceShape {
  book:      string | null;
  page:      number | null;
  source_id: number | null;
}

interface BaseShape {
  url:             string;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  source:          SourceShape;
  sections:        Section[];
  raw_fields:      Record<string, string>;
  links:           LinkRef[];
  body_text:       string;
  body_html:       string;
}

function baseFrom(c: CommonExtraction): BaseShape {
  return {
    url:             c.url,
    name:            c.title.name,
    rarity:          c.traits.rarity,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits:          c.traits.traits,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sections:        c.sections,
    raw_fields:      { ...c.field_map },
    links:           c.links,
    body_text:       c.body_text,
    body_html:       c.body_html,
  };
}

// ─── Ancestry ─────────────────────────────────────────────────────────────────

export interface AncestryMechanics {
  hit_points:        number | null;
  size:              string | null;
  speed:             number | null;
  attribute_boosts:  string[];
  attribute_flaws:   string[];
  languages: {
    fixed:        string[];
    bonus_choice: string[];
    raw:          string | null;
  };
  vision:            string | null;
  granted:           string[];
}

export interface AncestryOutput extends BaseShape {
  _type:            'ancestry';
  mechanics:        AncestryMechanics;
  popular_edicts:   string | null;
  popular_anathema: string | null;
}

const SIZE_WORDS = new Set(['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan']);

function findVision(sections: Section[]): string | null {
  for (const s of sections) {
    const lc = s.heading.toLowerCase();
    if (lc.includes('darkvision') || lc.includes('low-light vision') || lc.includes('vision')) {
      return s.heading;
    }
  }
  return null;
}

function parseLanguages(value: string | null): { fixed: string[]; bonus_choice: string[]; raw: string | null } {
  if (value === null) return { fixed: [], bonus_choice: [], raw: null };
  // AON pattern: a comma-separated list of fixed languages, then trailing prose like
  // "and additional languages equal to your Intelligence modifier (if positive)".
  const parts = splitTopLevel(value, ',');
  const fixed: string[] = [];
  const bonus_choice: string[] = [];
  for (const p of parts) {
    if (/intelligence|bonus|additional|number you can speak|chose/i.test(p)) {
      bonus_choice.push(p.trim());
    } else if (p.trim() !== '') {
      fixed.push(p.trim());
    }
  }
  return { fixed, bonus_choice, raw: value };
}

function findInlineMarker(html: string, label: string): string | null {
  const re = new RegExp(`<b>\\s*${label}\\s*<\\/b>\\s*([\\s\\S]*?)(?=<b>|<h[1-6]|<hr|$)`, 'i');
  const m = re.exec(html);
  return m === null ? null : htmlToText(m[1] ?? '');
}

/** Project an ancestry record from the common extraction. */
export function extractAncestry(c: CommonExtraction, _$: CheerioAPI, _span: CheerioNode): AncestryOutput {
  void _$; void _span;
  const base = baseFrom(c);
  const sizeRaw = getField(c, 'Size');
  const sizeFromTraits = c.traits.size;
  const size = sizeFromTraits ?? (sizeRaw !== null && SIZE_WORDS.has(sizeRaw) ? sizeRaw : sizeRaw);

  const speedRaw = getField(c, 'Speed');
  const speed = asInt(speedRaw);

  const boostsRaw = getField(c, 'Attribute Boosts', 'Ability Boosts');
  const flawsRaw  = getField(c, 'Attribute Flaw', 'Attribute Flaws', 'Ability Flaws', 'Ability Flaw');
  const attribute_boosts = boostsRaw === null ? [] : splitTopLevel(boostsRaw, ',');
  const attribute_flaws  = flawsRaw  === null ? [] : splitTopLevel(flawsRaw, ',');

  const languages = parseLanguages(getField(c, 'Languages'));
  const vision = findVision(c.sections);
  const granted: string[] = [];
  for (const s of c.sections) {
    if (/^(Clan Dagger|Granted|Heritage)/i.test(s.heading)) granted.push(s.heading);
  }

  // Popular Edicts / Anathema are inline `<b>` markers inside Beliefs section.
  const beliefs = c.sections.find((s) => /Beliefs/i.test(s.heading));
  const beliefsHtml = beliefs?.body_html ?? c.body_html;
  const popular_edicts   = findInlineMarker(beliefsHtml, 'Popular Edicts');
  const popular_anathema = findInlineMarker(beliefsHtml, 'Popular Anathema');

  const mechanics: AncestryMechanics = {
    hit_points: asInt(getField(c, 'Hit Points')),
    size,
    speed,
    attribute_boosts,
    attribute_flaws,
    languages,
    vision,
    granted,
  };

  return { _type: 'ancestry', ...base, mechanics, popular_edicts, popular_anathema };
}

// ─── Class ────────────────────────────────────────────────────────────────────

export interface ClassOutput extends BaseShape {
  _type:                 'class';
  key_attribute:         string | null;
  hit_points_text:       string | null;
  hp_per_level:          number | null;
  initial_proficiencies: Record<string, string>;
  class_dc:              string | null;
  subclasses:            Array<{ name: string; description: string }>;
}

/** Project a class record (e.g. Alchemist, Fighter) from the common extraction. */
export function extractClass(c: CommonExtraction, _$: CheerioAPI, _span: CheerioNode): ClassOutput {
  void _$; void _span;
  const base = baseFrom(c);

  // AON glues these labels to their values with `:` rather than `<br/>`.
  const hpRaw = getField(c, 'Hit Points');
  const keyAttr = getField(c, 'Key Attribute', 'Key Ability');

  const hp_per_level = hpRaw !== null ? asInt(hpRaw) : null;

  // Initial Proficiencies show up as a section (`<h2 class="title">Initial Proficiencies</h2>`)
  // with inline `<b>Skill</b>` markers — capture them.
  const initialProf = c.sections.find((s) => /Initial Proficiencies/i.test(s.heading));
  const initial_proficiencies: Record<string, string> = {};
  if (initialProf !== undefined) {
    const re = /<b>\s*([^<]+?)\s*<\/b>\s*([\s\S]*?)(?=<b>|<h[1-6]|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(initialProf.body_html)) !== null) {
      const k = (m[1] ?? '').replace(/:$/, '').trim();
      const v = htmlToText(m[2] ?? '');
      if (k !== '' && v !== '' && !(k in initial_proficiencies)) {
        initial_proficiencies[k] = v;
      }
    }
  }

  // Subclasses are h3 sections at the top of the Class Features tree.
  const subclasses: Array<{ name: string; description: string }> = [];
  for (const s of c.sections) {
    if (s.level !== 3) continue;
    if (/Bomber|Chirurgeon|Mutagenist|Toxicologist|^[A-Z][a-z]+$/.test(s.heading)
        && /research field|methodology/i.test(s.body_text)) {
      subclasses.push({ name: s.heading, description: s.body_text });
    }
  }

  const class_dc = getField(c, 'Class DC');

  return {
    _type:                 'class',
    ...base,
    key_attribute:         keyAttr,
    hit_points_text:       hpRaw,
    hp_per_level,
    initial_proficiencies,
    class_dc,
    subclasses,
  };
}

// ─── Background ───────────────────────────────────────────────────────────────

export interface BackgroundOutput extends BaseShape {
  _type:                  'background';
  attribute_boost_choice: { fixed_options: string[]; free: boolean } | null;
  trained_skills:         Array<{ name: string; skill_id: number | null }>;
  lore_skills:            Array<{ name: string; skill_id: number | null }>;
  granted_feat:           { name: string; feat_id: number | null } | null;
  flavor_text:            string;
}

const ATTR_NAMES = ['Strength','Dexterity','Constitution','Intelligence','Wisdom','Charisma'];

/** Project a background record from the common extraction. */
export function extractBackground(c: CommonExtraction, _$: CheerioAPI, _span: CheerioNode): BackgroundOutput {
  void _$; void _span;
  const base = baseFrom(c);

  // Attribute boost: scan body_text for "must be to X or Y" pattern.
  let attribute_boost_choice: { fixed_options: string[]; free: boolean } | null = null;
  const boostMatch = /must be to ([A-Z][a-z]+)(?: or ([A-Z][a-z]+))?/.exec(c.body_text);
  if (boostMatch !== null) {
    const fixed = [boostMatch[1]!];
    if (boostMatch[2] !== undefined) fixed.push(boostMatch[2]);
    attribute_boost_choice = {
      fixed_options: fixed.filter((f) => ATTR_NAMES.includes(f)),
      free: /free attribute boost/i.test(c.body_text),
    };
  }

  // Trained skills + Lore: pull anchors from body_html.
  const trained_skills: Array<{ name: string; skill_id: number | null }> = [];
  const lore_skills:    Array<{ name: string; skill_id: number | null }> = [];
  for (const link of c.links) {
    if (link.kind === 'Skills') {
      const entry = { name: link.text, skill_id: link.id };
      if (/lore/i.test(link.text)) lore_skills.push(entry);
      else trained_skills.push(entry);
    }
  }

  // Granted feat: first Feats.aspx link.
  const featLink = c.links.find((l) => l.kind === 'Feats');
  const granted_feat = featLink === undefined
    ? null
    : { name: featLink.text, feat_id: featLink.id };

  // Flavor text is everything before "Choose two attribute boosts".
  const flavorIdx = c.body_text.search(/Choose (?:two|an) attribute/i);
  const flavor_text = flavorIdx === -1 ? c.body_text : c.body_text.slice(0, flavorIdx).trim();

  return {
    _type:                  'background',
    ...base,
    attribute_boost_choice,
    trained_skills,
    lore_skills,
    granted_feat,
    flavor_text,
  };
}
