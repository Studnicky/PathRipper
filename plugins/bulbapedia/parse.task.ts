import wtf from 'wtf_wikipedia';
import { TaskRegistry } from '../../dist/registry/TaskRegistry.js';
import type { PipelineStateType } from '../../dist/registry/PipelineState.js';
import type { TaskFnInterface } from '../../dist/pipeline/Pipeline.js';

// ─── i18n: BCP-47 key mapping ─────────────────────────────────────────────────

/**
 * Maps Bulbapedia wiki keys to BCP-47 language tags.
 * Source of truth for the entire i18n pipeline (Track 4b).
 * Unknown keys are dropped with a one-time warning per run.
 */
const WIKI_KEY_TO_BCP47: Readonly<Record<string, string>> = {
  ja:       'ja',
  ja_trans: 'ja-Latn',
  ja_r:     'ja-Latn',
  ko:       'ko',
  de:       'de',
  fr:       'fr',
  it:       'it',
  es:       'es',
  pt_br:    'pt-BR',
  pt:       'pt',
  zh_cmn:   'zh-Hans',
  zh_yue:   'zh-Hant-HK',
  zh:       'zh-Hant',
  ru:       'ru',
  vi:       'vi',
  th:       'th',
};

/** Keys that are metadata, not names — silently skipped. */
const SKIP_KEYS = new Set([
  'color', 'bordercolor', 'type', 'type2',
  // Meaning/etymology fields (key ends with "meaning")
]);

/** Tracks unknown wiki keys that have already been warned about. */
const warnedUnknownKeys = new Set<string>();

/**
 * Strip wiki markup from a raw field value, keeping only the primary text.
 *
 * - `''romanization''` in italics → dropped (keep only what precedes first `''`)
 * - `{{tt|display|tooltip}}` → keep display text
 * - `<br>` and subsequent content → dropped (keep first variant only)
 * - `[[link|display]]` → keep display; `[[link]]` → keep link text
 * - HTML comments `<!-- ... -->` → dropped
 * - Remaining `{{...}}` → dropped
 */
function stripWikiMarkup(raw: string): string {
  // Keep only first <br> segment (first variant when multiple exist)
  let str = raw.split(/<br\s*\/?>/i)[0] ?? raw;
  // Drop HTML comments
  str = str.replace(/<!--[\s\S]*?-->/g, '');
  // Resolve {{tt|display|tooltip}} → display
  str = str.replace(/\{\{tt\|([^|}\n]+)\|[^}]*\}\}/gi, '$1');
  // Drop remaining {{ ... }} templates
  str = str.replace(/\{\{[^}]*\}\}/g, '');
  // Resolve [[target|display]] → display; [[target]] → target
  str = str.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  str = str.replace(/\[\[([^\]]+)\]\]/g, '$1');
  // Drop italic romanization: ''text'' — appears after native script
  // Take only the text before the first ''
  const italicIdx = str.indexOf("''");
  if (italicIdx !== -1) str = str.slice(0, italicIdx);
  // Drop parenthetical remarks
  str = str.replace(/\([^)]*\)/g, '');
  return str.trim();
}

/**
 * Extract the body of the first occurrence of any of the given template names
 * from `wikitext`, using depth-aware bracket scanning.
 * Returns the full `{{TemplateName...}}` block, or null if not found.
 */
function extractLangTemplateBlock(wikitext: string): string | null {
  const LANG_TEMPLATES = [
    'other names',
    'foreign names',
    'other languages',
    'langtable',
  ];

  const lower = wikitext.toLowerCase();

  for (const name of LANG_TEMPLATES) {
    const needle = '{{' + name;
    const startIdx = lower.indexOf(needle);
    if (startIdx === -1) continue;

    let depth = 0;
    let pos = startIdx;
    let endIdx = -1;

    while (pos < wikitext.length - 1) {
      if (wikitext[pos] === '{' && wikitext[pos + 1] === '{') {
        depth++;
        pos += 2;
        continue;
      }
      if (wikitext[pos] === '}' && wikitext[pos + 1] === '}') {
        depth--;
        if (depth === 0) {
          endIdx = pos + 2;
          break;
        }
        pos += 2;
        continue;
      }
      pos++;
    }

    return endIdx === -1
      ? wikitext.slice(startIdx)
      : wikitext.slice(startIdx, endIdx);
  }

  return null;
}

/**
 * Parse the `{{Other names}}` / `{{Foreign names}}` / `{{Other languages}}` /
 * `{{Langtable}}` template from wikitext and return a `Record<BCP-47, text>` map.
 *
 * Keys present in WIKI_KEY_TO_BCP47 are mapped; unknown keys are dropped with a
 * one-time stderr warning. Empty values are dropped silently.
 *
 * @param wikitext - Raw wikitext for the article.
 * @returns BCP-47-keyed name map, or empty object if no language template found.
 */
export function extractOtherNames(wikitext: string): Record<string, string> {
  const block = extractLangTemplateBlock(wikitext);
  if (block === null) return {};

  const result: Record<string, string> = {};

  // Match |key=value pairs at depth-0 (the outer template level).
  // We scan character by character to handle nested {{ }} correctly.
  let pos = 0;
  // Skip past the opening {{TemplateName until the first |
  while (pos < block.length && block[pos] !== '|') pos++;

  while (pos < block.length) {
    if (block[pos] !== '|') { pos++; continue; }
    pos++; // skip |

    // Skip whitespace/newlines before the key (e.g. `| key = value` format)
    while (pos < block.length && /[ \t\r\n]/.test(block[pos] ?? '')) pos++;

    // Read key: alphanumeric + underscore
    const keyStart = pos;
    while (pos < block.length && /[\w]/.test(block[pos] ?? '')) pos++;
    const key = block.slice(keyStart, pos).trim();
    if (key === '') continue;

    // Expect =
    while (pos < block.length && block[pos] === ' ') pos++;
    if (block[pos] !== '=') continue;
    pos++; // skip =

    // Read value until next top-level | or end of block }}, tracking depth
    const valueStart = pos;
    let depth = 0;
    while (pos < block.length - 1) {
      if (block[pos] === '{' && block[pos + 1] === '{') { depth++; pos += 2; continue; }
      if (block[pos] === '}' && block[pos + 1] === '}') {
        if (depth === 0) break; // end of outer template
        depth--;
        pos += 2;
        continue;
      }
      if (depth === 0 && block[pos] === '|') break; // next field
      pos++;
    }
    const rawValue = block.slice(valueStart, pos);

    // Skip metadata/structural keys
    if (SKIP_KEYS.has(key) || key.endsWith('meaning') || key.endsWith('trans') && key !== 'ja_trans') {
      continue;
    }

    const bcp47 = WIKI_KEY_TO_BCP47[key];
    if (bcp47 === undefined) {
      if (!warnedUnknownKeys.has(key)) {
        warnedUnknownKeys.add(key);
        process.stderr.write(`[bulbapedia:parse] Unknown language key "${key}" — dropped\n`);
      }
      continue;
    }

    const text = stripWikiMarkup(rawValue);
    if (text !== '') {
      result[bcp47] = text;
    }
  }

  return result;
}

// ─── Template name fragments ──────────────────────────────────────────────────

const TEMPLATE_POKEMON        = 'pokémon infobox';
const TEMPLATE_POKEMON2       = 'pokemon infobox';
const TEMPLATE_MOVE           = 'moveinfobox';
const TEMPLATE_ITEM_HEAD      = 'iteminfobox/head';
const TEMPLATE_MASTERS        = 'mastersinfobox';
const TEMPLATE_MASTERS_SKILL  = 'mastersskillinfobox';
const TEMPLATE_MASTERS_EVENT  = 'masterseventinfobox';
const TEMPLATE_TCG_POKEMON    = 'pokémoncardInfobox';
const TEMPLATE_TCG_TRAINER    = 'TCGTrainerCardInfobox';
const TEMPLATE_TCG_EXPANSION  = 'TCGExpansionInfobox';
const TEMPLATE_TCG_DECK       = 'DeckInfobox';
const TEMPLATE_TCG_PROMO      = 'TCGPromoInfobox';
const TEMPLATE_TOWN_INFOBOX   = 'Town infobox';
const TEMPLATE_LOCATION_INFOBOX = 'Infobox location';
const TEMPLATE_ROUTE_INFOBOX  = 'Route infobox';
const TEMPLATE_ANIME_LOCATION = 'AnimeLocationInfobox';
const TEMPLATE_CHARACTER      = 'Character Infobox';
const TEMPLATE_CHAR_INFOBOX   = 'CharInfobox';
const TEMPLATE_TRAINER_CLASS  = 'TrainerClassInfobox';
const TEMPLATE_UNITE_INFOBOX  = 'UniteInfobox';
const TEMPLATE_TCG_ENERGY     = 'TCGEnergyCardInfobox';
const TEMPLATE_GAME_INFOBOX   = 'Infobox game';

// ─── Output shapes ────────────────────────────────────────────────────────────

type PageType =
  | 'pokemon'
  | 'move'
  | 'item'
  | 'masters'
  | 'masters_skill'
  | 'masters_event'
  | 'tcg_pokemon_card'
  | 'tcg_trainer_card'
  | 'tcg_set'
  | 'tcg_deck'
  | 'tcg_promo'
  | 'unite_pokemon'
  | 'tcg_energy_card'
  | 'game'
  | 'location'
  | 'character'
  | 'trainer_class'
  | 'learnset_data'
  | 'card_list'
  | 'anime_history'
  | 'game_data'
  | 'unknown';

interface BaseOutput {
  _type: PageType;
  title: string;
  categories: string[];
}

interface PokemonOutput extends BaseOutput {
  _type: 'pokemon';
  ndex:        number | null;
  name:        string | null;
  jname:       string | null;
  types:       string[];
  category:    string | null;
  height_m:    number | null;
  weight_kg:   number | null;
  abilities:   string[];
  egg_groups:  string[];
  egg_cycles:  number | null;
  color:       string | null;
  catch_rate:  number | null;
  generation:  string | null;
  names_intl:  Record<string, string>;
}

interface MoveOutput extends BaseOutput {
  _type: 'move';
  move_number:     number | null;
  name:            string | null;
  jname:           string | null;
  type:            string | null;
  damage_category: string | null;
  base_pp:         number | null;
  power:           number | null;
  accuracy:        number | null;
  generation:      string | null;
  names_intl:      Record<string, string>;
}

interface ItemOutput extends BaseOutput {
  _type: 'item';
  name:       string | null;
  jname:      string | null;
  generation: string | null;
  names_intl: Record<string, string>;
}

interface MastersOutput extends BaseOutput {
  _type: 'masters';
  name:       string | null;
  jname:      string | null;
  jtrans:     string | null;
  type:       string | null;
  num:        string | null;
  desc:       string | null;
  enva:       string | null;
  java:       string | null;
  image:      string | null;
  caption:    string | null;
  names_intl: Record<string, string>;
}

interface TcgExpansionEntry {
  expansion: string | null;
  card_number: string | null;
  rarity: string | null;
}

interface TcgPokemonCardOutput extends BaseOutput {
  _type: 'tcg_pokemon_card';
  name: string | null;
  jname: string | null;
  species: string | null;
  stage: string | null;
  card_type: string | null;
  hp: number | null;
  weakness: string | null;
  resistance: string | null;
  retreat_cost: number | null;
  expansions: TcgExpansionEntry[];
  names_intl: Record<string, string>;
}

interface TcgTrainerCardOutput extends BaseOutput {
  _type: 'tcg_trainer_card';
  name: string | null;
  jname: string | null;
  card_class: string | null;
  expansions: TcgExpansionEntry[];
  names_intl: Record<string, string>;
}

interface TcgSetOutput extends BaseOutput {
  _type: 'tcg_set';
  name: string | null;
  ja_name: string | null;
  translated_name: string | null;
  en_card_count: number | null;
  en_set_number: number | null;
  en_release: string | null;
  ja_card_count: number | null;
  ja_release: string | null;
  names_intl: Record<string, string>;
}

interface MastersSkillOutput extends BaseOutput {
  _type: 'masters_skill';
  name: string | null;
  names_intl: Record<string, string>;
}

interface MastersEventOutput extends BaseOutput {
  _type: 'masters_event';
  name: string | null;
  names_intl: Record<string, string>;
}

interface TcgDeckOutput extends BaseOutput {
  _type: 'tcg_deck';
  name: string | null;
  names_intl: Record<string, string>;
}

interface TcgPromoOutput extends BaseOutput {
  _type: 'tcg_promo';
  name: string | null;
  names_intl: Record<string, string>;
}

interface LocationOutput extends BaseOutput {
  _type: 'location';
  name: string | null;
  ja_name: string | null;
  region: string | null;
  generation: string | null;
  location_type: string | null;
  names_intl: Record<string, string>;
}

interface CharacterOutput extends BaseOutput {
  _type: 'character';
  name: string | null;
  jname: string | null;
  names_intl: Record<string, string>;
}

interface TrainerClassOutput extends BaseOutput {
  _type: 'trainer_class';
  name: string | null;
  ja_name: string | null;
  names_intl: Record<string, string>;
}

interface UnitePokemonOutput extends BaseOutput {
  _type: 'unite_pokemon';
  pokemon: string | null;
  jname: string | null;
  role: string | null;
  range: string | null;
  damage: string | null;
  difficulty: string | null;
  names_intl: Record<string, string>;
}

interface TcgEnergyCardOutput extends BaseOutput {
  _type: 'tcg_energy_card';
  name: string | null;
  energy_type: string | null;
  names_intl: Record<string, string>;
}

interface GameOutput extends BaseOutput {
  _type: 'game';
  name: string | null;
  jname: string | null;
  platform: string | null;
  developer: string | null;
  publisher: string | null;
  release_ja: string | null;
  release_us: string | null;
  names_intl: Record<string, string>;
}

interface LearnsetDataOutput extends BaseOutput {
  _type: 'learnset_data';
  pokemon: string;
  generation: string | null;
}

interface CardListOutput extends BaseOutput {
  _type: 'card_list';
  subject: string;
}

interface AnimeHistoryOutput extends BaseOutput {
  _type: 'anime_history';
}

interface GameDataOutput extends BaseOutput {
  _type: 'game_data';
}

interface UnknownOutput extends BaseOutput {
  _type: 'unknown';
}

type BulbapediaOutput =
  | PokemonOutput
  | MoveOutput
  | ItemOutput
  | MastersOutput
  | MastersSkillOutput
  | MastersEventOutput
  | TcgPokemonCardOutput
  | TcgTrainerCardOutput
  | TcgSetOutput
  | TcgDeckOutput
  | TcgPromoOutput
  | UnitePokemonOutput
  | TcgEnergyCardOutput
  | GameOutput
  | LocationOutput
  | CharacterOutput
  | TrainerClassOutput
  | LearnsetDataOutput
  | CardListOutput
  | AnimeHistoryOutput
  | GameDataOutput
  | UnknownOutput;

// ─── Value extraction helpers ─────────────────────────────────────────────────

/** Wtf infobox json field: either {text, number?} or undefined. */
type WtfField = { text?: unknown; number?: unknown } | string | null | undefined;

/**
 * Strip {{tt|display|tooltip}} wrappers and trim.
 * Works on raw strings coming from template json (not infobox json).
 */
function clean(val: unknown): string | null {
  if (val === null || val === undefined || val === '') return null;
  const str = String(val);
  const ttRegex = /\{\{tt\|([^|}\n]+)\|[^}]*\}\}/gi;
  return str.replace(ttRegex, '$1').trim() || null;
}

/** Extract text from an infobox field (object with .text) or plain string. */
function infoboxText(val: WtfField): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object' && 'text' in val) return clean(val.text);
  return clean(val);
}

/** Extract number from an infobox field via .number or parseFloat of .text. */
function infoboxNum(val: WtfField): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') {
    if ('number' in val && val.number !== null && val.number !== undefined) {
      const num = Number(val.number);
      return Number.isFinite(num) ? num : null;
    }
    if ('text' in val) {
      const num = parseFloat(String(val.text ?? ''));
      return Number.isFinite(num) ? num : null;
    }
  }
  const num = parseFloat(String(val));
  return Number.isFinite(num) ? num : null;
}

/** Extract non-null text values from a list of infobox fields. */
function infoboxTextList(vals: WtfField[]): string[] {
  return vals.map(infoboxText).filter((value): value is string => value !== null);
}

/** Extract a plain string from a template json field. */
function templateStr(data: Record<string, unknown>, key: string): string | null {
  return clean(data[key]);
}

/** Extract a number from a template json field. */
function templateNum(data: Record<string, unknown>, key: string): number | null {
  const str = templateStr(data, key);
  if (str === null) return null;
  const num = parseFloat(str);
  return Number.isFinite(num) ? num : null;
}

// ─── Template (non-infobox) finder ───────────────────────────────────────────

type TemplateData = Record<string, unknown>;

function findTemplate(
  doc: ReturnType<typeof wtf>,
  predicate: (name: string) => boolean,
): TemplateData | null {
  const templates = doc.templates();
  const match = templates.find((tmpl) => {
    const name = String((tmpl.json() as Record<string, unknown>)['template'] ?? '').toLowerCase();
    return predicate(name);
  });
  return match !== undefined ? (match.json() as TemplateData) : null;
}

// ─── Per-type extractors ──────────────────────────────────────────────────────

function extractPokemon(
  title: string,
  box: ReturnType<ReturnType<typeof wtf>['infoboxes']>[number],
  categories: string[],
  wikitext: string,
): PokemonOutput {
  const json = box.json() as Record<string, WtfField>;
  return {
    _type:       'pokemon',
    title,
    ndex:        infoboxNum(json['ndex']),
    name:        infoboxText(json['name']),
    jname:       infoboxText(json['jname']),
    types:       infoboxTextList([json['type1'], json['type2']]),
    category:    infoboxText(json['category']),
    height_m:    infoboxNum(json['height-m']),
    weight_kg:   infoboxNum(json['weight-kg']),
    abilities:   infoboxTextList([json['ability1'], json['ability2'], json['abilityd']]),
    egg_groups:  infoboxTextList([json['egggroup1'], json['egggroup2']]),
    egg_cycles:  infoboxNum(json['eggcycles']),
    color:       infoboxText(json['color']),
    catch_rate:  infoboxNum(json['catchrate']),
    generation:  infoboxText(json['generation']),
    names_intl:  extractOtherNames(wikitext),
    categories,
  };
}

function extractMove(title: string, data: TemplateData, categories: string[], wikitext: string): MoveOutput {
  return {
    _type:           'move',
    title,
    move_number:     templateNum(data, 'n'),
    name:            templateStr(data, 'name'),
    jname:           templateStr(data, 'jname'),
    type:            templateStr(data, 'type'),
    damage_category: templateStr(data, 'damagecategory'),
    base_pp:         templateNum(data, 'basepp'),
    power:           templateNum(data, 'power'),
    accuracy:        templateNum(data, 'accuracy'),
    generation:      templateStr(data, 'gen'),
    names_intl:      extractOtherNames(wikitext),
    categories,
  };
}

function extractItem(title: string, data: TemplateData, categories: string[], wikitext: string): ItemOutput {
  return {
    _type:      'item',
    title,
    name:       templateStr(data, 'name'),
    jname:      templateStr(data, 'jname'),
    generation: templateStr(data, 'gen'),
    names_intl: extractOtherNames(wikitext),
    categories,
  };
}

function extractMasters(title: string, data: TemplateData, categories: string[], wikitext: string): MastersOutput {
  return {
    _type:      'masters',
    title,
    name:       templateStr(data, 'name'),
    jname:      templateStr(data, 'jname'),
    jtrans:     templateStr(data, 'jtrans'),
    type:       templateStr(data, 'type'),
    num:        templateStr(data, 'num'),
    desc:       templateStr(data, 'desc'),
    enva:       templateStr(data, 'enva'),
    java:       templateStr(data, 'java'),
    image:      templateStr(data, 'image'),
    caption:    templateStr(data, 'caption'),
    names_intl: extractOtherNames(wikitext),
    categories,
  };
}

function extractMastersSkill(title: string, data: TemplateData, categories: string[], wikitext: string): MastersSkillOutput {
  return {
    _type:      'masters_skill',
    title,
    name:       templateStr(data, 'name'),
    names_intl: extractOtherNames(wikitext),
    categories,
  };
}

function extractMastersEvent(title: string, data: TemplateData, categories: string[], wikitext: string): MastersEventOutput {
  return {
    _type:      'masters_event',
    title,
    name:       templateStr(data, 'name'),
    names_intl: extractOtherNames(wikitext),
    categories,
  };
}

// ─── TCG wikitext helpers ─────────────────────────────────────────────────────

/**
 * Check whether the raw wikitext contains a given template name (case-insensitive).
 * More reliable than wtf_wikipedia template normalisation for Bulbapedia templates.
 */
export function hasTmpl(wikitext: string, name: string): boolean {
  return wikitext.toLowerCase().includes('{{' + name.toLowerCase());
}

/**
 * Extract the inner text from `{{TCG|Set Name}}` or `{{TCGset|Set Name|...}}` style
 * wikilinks/templates, returning the first pipe-delimited argument.
 */
function extractTcgRef(val: string): string {
  // {{TCG|Base Set}} → "Base Set"
  // {{TCGset|Base Set|1}} → "Base Set"
  // [[Base Set (TCG)|Base Set]] → "Base Set"
  const tmpl = /\{\{[^|}\n]+\|([^|}\n]+)[^}]*\}\}/;
  const wikilink = /\[\[[^\]|]+\|([^\]]+)\]\]/;
  const wikiSimple = /\[\[([^\]]+)\]\]/;
  const tmplMatch = tmpl.exec(val);
  if (tmplMatch !== null) return tmplMatch[1]?.trim() ?? val;
  const wlMatch = wikilink.exec(val);
  if (wlMatch !== null) return wlMatch[1]?.trim() ?? val;
  const wsMatch = wikiSimple.exec(val);
  if (wsMatch !== null) return wsMatch[1]?.trim() ?? val;
  return val.trim();
}

/**
 * Parse all `{{<templateName>/Expansion ...}}` sub-blocks from wikitext.
 * Uses depth-aware bracket scanning to correctly handle nested `{{...}}` values.
 * Handles both PokémoncardInfobox/Expansion and TCGTrainerCardInfobox/Expansion.
 */
export function extractExpansions(wikitext: string, templateName: string): TcgExpansionEntry[] {
  const needle = '{{' + templateName + '/Expansion';
  const lower = wikitext.toLowerCase();
  const needleLower = needle.toLowerCase();
  const entries: TcgExpansionEntry[] = [];
  let searchFrom = 0;

  while (searchFrom < lower.length) {
    const startIdx = lower.indexOf(needleLower, searchFrom);
    if (startIdx === -1) break;

    // Walk forward with depth counting to find the matching }}.
    let depth = 0;
    let pos = startIdx;
    let endIdx = -1;
    while (pos < wikitext.length - 1) {
      if (wikitext[pos] === '{' && wikitext[pos + 1] === '{') { depth++; pos += 2; continue; }
      if (wikitext[pos] === '}' && wikitext[pos + 1] === '}') {
        depth--;
        if (depth === 0) { endIdx = pos + 2; break; }
        pos += 2;
        continue;
      }
      pos++;
    }
    const blockEnd = endIdx === -1 ? wikitext.length : endIdx;
    const body = wikitext.slice(startIdx + needle.length, blockEnd - 2);

    entries.push({
      expansion:   parseKv(body, 'expansion'),
      card_number: parseKv(body, 'cardno') ?? parseKv(body, 'jpcardno'),
      rarity:      parseKv(body, 'rarity') ?? parseKv(body, 'jprarity'),
    });
    searchFrom = blockEnd;
  }
  return entries;
}

/**
 * Parse a single `|key=value` pair out of a template body string.
 * Handles values that contain nested `{{...}}` templates (e.g. `{{TCG|Base Set}}`).
 * Returns null when the key is absent.
 */
function parseKv(body: string, key: string): string | null {
  // Match `| key = ` then consume the value up to the next `|` or `}` at depth 0.
  const startRe = new RegExp('\\|\\s*' + key + '\\s*=\\s*', 'i');
  const startMatch = startRe.exec(body);
  if (startMatch === null) return null;

  const valueStart = startMatch.index + startMatch[0].length;
  let depth = 0;
  let pos = valueStart;
  while (pos < body.length) {
    const char = body[pos];
    const next = body[pos + 1];
    if (char === '{' && next === '{') { depth++; pos += 2; continue; }
    if (char === '}' && next === '}') {
      if (depth === 0) break;
      depth--;
      pos += 2;
      continue;
    }
    if (depth === 0 && (char === '|' || char === '\n')) break;
    pos++;
  }
  const raw = body.slice(valueStart, pos).trim();
  if (raw === '') return null;
  return extractTcgRef(raw);
}

/**
 * Parse the fields of the main PokémoncardInfobox or TCGTrainerCardInfobox
 * from the wikitext body (the full `{{…}}` block).
 */
function parseMainInfoboxKv(wikitext: string, templateName: string): Record<string, string> | null {
  // Grab the full outer template block (non-greedy but enough to get top-level fields).
  // We look for the opening, then read lines until a balanced close.
  const lower = wikitext.toLowerCase();
  const startIdx = lower.indexOf('{{' + templateName.toLowerCase());
  if (startIdx === -1) return null;
  // Walk to find the matching closing }}
  let depth = 0;
  let pos = startIdx;
  let end = -1;
  while (pos < wikitext.length - 1) {
    if (wikitext[pos] === '{' && wikitext[pos + 1] === '{') { depth++; pos += 2; continue; }
    if (wikitext[pos] === '}' && wikitext[pos + 1] === '}') {
      depth--;
      if (depth === 0) { end = pos + 2; break; }
      pos += 2;
      continue;
    }
    pos++;
  }
  const block = end === -1 ? wikitext.slice(startIdx) : wikitext.slice(startIdx, end);
  // Parse top-level |key=value lines (skip nested {{ }} blocks).
  const result: Record<string, string> = {};
  const kvRe = /\|\s*([a-zA-Z0-9_]+)\s*=\s*([^|{}\n]*(?:\{\{[^}]*\}\}[^|{}\n]*)*)/g;
  let kvMatch: RegExpExecArray | null;
  while ((kvMatch = kvRe.exec(block)) !== null) {
    const key = (kvMatch[1] ?? '').trim();
    const value = (kvMatch[2] ?? '').trim();
    if (key !== '' && value !== '') result[key] = value;
  }
  return result;
}

// ─── TCG extractors ───────────────────────────────────────────────────────────

export function extractTcgPokemonCard(
  title: string,
  wikitext: string,
  categories: string[],
): TcgPokemonCardOutput {
  const infobox =parseMainInfoboxKv(wikitext, TEMPLATE_TCG_POKEMON) ?? {};
  const hpRaw = infobox['hp'] !== undefined ? parseInt(infobox['hp'], 10) : null;
  const retreatRaw = infobox['retreatcost'] !== undefined ? parseInt(infobox['retreatcost'], 10) : null;
  return {
    _type:        'tcg_pokemon_card',
    title,
    name:         infobox['cardname'] !== undefined ? extractTcgRef(infobox['cardname']) : null,
    jname:        infobox['jname']    !== undefined ? extractTcgRef(infobox['jname'])    : null,
    species:      infobox['species']  !== undefined ? extractTcgRef(infobox['species'])  : null,
    stage:        infobox['evostage'] !== undefined ? extractTcgRef(infobox['evostage']) : null,
    card_type:    infobox['type']     !== undefined ? extractTcgRef(infobox['type'])     : null,
    hp:           hpRaw !== null && Number.isFinite(hpRaw) ? hpRaw : null,
    weakness:     infobox['weakness']    !== undefined ? extractTcgRef(infobox['weakness'])    : null,
    resistance:   infobox['resistance']  !== undefined ? extractTcgRef(infobox['resistance'])  : null,
    retreat_cost: retreatRaw !== null && Number.isFinite(retreatRaw) ? retreatRaw : null,
    expansions:   extractExpansions(wikitext, TEMPLATE_TCG_POKEMON),
    names_intl:   extractOtherNames(wikitext),
    categories,
  };
}

export function extractTcgTrainerCard(
  title: string,
  wikitext: string,
  categories: string[],
): TcgTrainerCardOutput {
  const infobox =parseMainInfoboxKv(wikitext, TEMPLATE_TCG_TRAINER) ?? {};
  return {
    _type:      'tcg_trainer_card',
    title,
    name:       infobox['cardname'] !== undefined ? extractTcgRef(infobox['cardname']) : null,
    jname:      infobox['jname']    !== undefined ? extractTcgRef(infobox['jname'])    : null,
    card_class: infobox['class']    !== undefined ? extractTcgRef(infobox['class'])    : null,
    expansions: extractExpansions(wikitext, TEMPLATE_TCG_TRAINER),
    names_intl: extractOtherNames(wikitext),
    categories,
  };
}

export function extractTcgSet(
  title: string,
  wikitext: string,
  categories: string[],
): TcgSetOutput {
  const infobox =parseMainInfoboxKv(wikitext, TEMPLATE_TCG_EXPANSION) ?? {};
  const enCards  = infobox['encards']  !== undefined ? parseInt(infobox['encards'], 10)  : null;
  const enSetNum = infobox['ensetnum'] !== undefined ? parseInt(infobox['ensetnum'], 10) : null;
  const jaCards  = infobox['jacards']  !== undefined ? parseInt(infobox['jacards'], 10)  : null;
  return {
    _type:           'tcg_set',
    title,
    name:            infobox['setname']      !== undefined ? extractTcgRef(infobox['setname'])      : null,
    ja_name:         infobox['jasetname']    !== undefined ? extractTcgRef(infobox['jasetname'])    : null,
    translated_name: infobox['transsetname'] !== undefined ? extractTcgRef(infobox['transsetname']) : null,
    en_card_count:   enCards  !== null && Number.isFinite(enCards)  ? enCards  : null,
    en_set_number:   enSetNum !== null && Number.isFinite(enSetNum) ? enSetNum : null,
    en_release:      infobox['enrelease'] !== undefined ? infobox['enrelease'].trim() : null,
    ja_card_count:   jaCards  !== null && Number.isFinite(jaCards)  ? jaCards  : null,
    ja_release:      infobox['jarelease'] !== undefined ? infobox['jarelease'].trim() : null,
    names_intl:      extractOtherNames(wikitext),
    categories,
  };
}

export function extractTcgDeck(
  title: string,
  wikitext: string,
  categories: string[],
): TcgDeckOutput {
  const infobox =parseMainInfoboxKv(wikitext, TEMPLATE_TCG_DECK) ?? {};
  return {
    _type:      'tcg_deck',
    title,
    name:       infobox['name'] !== undefined ? extractTcgRef(infobox['name']) : null,
    names_intl: extractOtherNames(wikitext),
    categories,
  };
}

export function extractTcgPromo(
  title: string,
  wikitext: string,
  categories: string[],
): TcgPromoOutput {
  const infobox =parseMainInfoboxKv(wikitext, TEMPLATE_TCG_PROMO) ?? {};
  return {
    _type:      'tcg_promo',
    title,
    name:       infobox['name'] !== undefined ? extractTcgRef(infobox['name']) : null,
    names_intl: extractOtherNames(wikitext),
    categories,
  };
}

export function extractLocation(
  title: string,
  wikitext: string,
  categories: string[],
): LocationOutput {
  const infobox =parseMainInfoboxKv(wikitext, TEMPLATE_TOWN_INFOBOX)
    ?? parseMainInfoboxKv(wikitext, TEMPLATE_ROUTE_INFOBOX)
    ?? parseMainInfoboxKv(wikitext, TEMPLATE_LOCATION_INFOBOX)
    ?? parseMainInfoboxKv(wikitext, TEMPLATE_ANIME_LOCATION)
    ?? {};

  let locationType: string | null = null;
  if (hasTmpl(wikitext, TEMPLATE_TOWN_INFOBOX)) locationType = 'city';
  else if (hasTmpl(wikitext, TEMPLATE_ROUTE_INFOBOX)) locationType = 'route';
  else if (hasTmpl(wikitext, TEMPLATE_ANIME_LOCATION)) locationType = 'anime';
  else if (hasTmpl(wikitext, TEMPLATE_LOCATION_INFOBOX)) locationType = 'location';

  return {
    _type: 'location',
    title,
    name:          infobox['name']       !== undefined ? infobox['name'].trim()       : null,
    ja_name:       infobox['jpname']     !== undefined ? infobox['jpname'].trim()     : null,
    region:        infobox['region']     !== undefined ? infobox['region'].trim()     : null,
    generation:    infobox['generation'] !== undefined ? infobox['generation'].trim() : null,
    location_type: locationType,
    names_intl:    extractOtherNames(wikitext),
    categories,
  };
}

export function extractCharacter(
  title: string,
  wikitext: string,
  categories: string[],
): CharacterOutput {
  const infobox =parseMainInfoboxKv(wikitext, TEMPLATE_CHARACTER)
    ?? parseMainInfoboxKv(wikitext, TEMPLATE_CHAR_INFOBOX)
    ?? {};
  return {
    _type:      'character',
    title,
    name:       infobox['name']  !== undefined ? infobox['name'].trim()  : null,
    jname:      infobox['jname'] !== undefined ? infobox['jname'].trim() : null,
    names_intl: extractOtherNames(wikitext),
    categories,
  };
}

export function extractTrainerClass(
  title: string,
  wikitext: string,
  categories: string[],
): TrainerClassOutput {
  const infobox =parseMainInfoboxKv(wikitext, TEMPLATE_TRAINER_CLASS) ?? {};
  return {
    _type:      'trainer_class',
    title,
    name:       infobox['name']   !== undefined ? infobox['name'].trim()   : null,
    ja_name:    infobox['jpname'] !== undefined ? infobox['jpname'].trim() : null,
    names_intl: extractOtherNames(wikitext),
    categories,
  };
}

export function extractUnitePokemon(
  title: string,
  wikitext: string,
  categories: string[],
): UnitePokemonOutput {
  const infobox =parseMainInfoboxKv(wikitext, TEMPLATE_UNITE_INFOBOX) ?? {};
  return {
    _type:      'unite_pokemon',
    title,
    pokemon:    infobox['pokemon']    !== undefined ? infobox['pokemon'].trim()    : null,
    jname:      infobox['jname']      !== undefined ? infobox['jname'].trim()      : null,
    role:       infobox['role']       !== undefined ? infobox['role'].trim()       : null,
    range:      infobox['range']      !== undefined ? infobox['range'].trim()      : null,
    damage:     infobox['damage']     !== undefined ? infobox['damage'].trim()     : null,
    difficulty: infobox['difficulty'] !== undefined ? infobox['difficulty'].trim() : null,
    names_intl: extractOtherNames(wikitext),
    categories,
  };
}

export function extractTcgEnergyCard(
  title: string,
  wikitext: string,
  categories: string[],
): TcgEnergyCardOutput {
  const infobox =parseMainInfoboxKv(wikitext, TEMPLATE_TCG_ENERGY) ?? {};
  return {
    _type:       'tcg_energy_card',
    title,
    name:        infobox['cardname'] !== undefined ? extractTcgRef(infobox['cardname']) : null,
    energy_type: infobox['energy']   !== undefined ? extractTcgRef(infobox['energy'])   :
                 infobox['type']     !== undefined ? extractTcgRef(infobox['type'])     : null,
    names_intl:  extractOtherNames(wikitext),
    categories,
  };
}

export function extractGame(
  title: string,
  wikitext: string,
  categories: string[],
): GameOutput {
  const infobox =parseMainInfoboxKv(wikitext, TEMPLATE_GAME_INFOBOX) ?? {};
  return {
    _type:      'game',
    title,
    name:       infobox['name']            !== undefined ? infobox['name'].trim()            : null,
    jname:      infobox['jname']           !== undefined ? infobox['jname'].trim()           : null,
    platform:   infobox['platform']        !== undefined ? infobox['platform'].trim()        : null,
    developer:  infobox['developer']       !== undefined ? infobox['developer'].trim()       : null,
    publisher:  infobox['publisher']       !== undefined ? infobox['publisher'].trim()       : null,
    release_ja: infobox['release_date_ja'] !== undefined ? infobox['release_date_ja'].trim() :
                infobox['releaseja']       !== undefined ? infobox['releaseja'].trim()       : null,
    release_us: infobox['release_date_us'] !== undefined ? infobox['release_date_us'].trim() :
                infobox['releaseus']       !== undefined ? infobox['releaseus'].trim()       : null,
    names_intl: extractOtherNames(wikitext),
    categories,
  };
}

/** Extract the generation roman numeral from a learnset subpage title. */
function parseLearnsetGeneration(title: string): string | null {
  const match = /\/Generation ([IVX]+) learnset$/.exec(title);
  return match?.[1] ?? null;
}

// ─── Task ─────────────────────────────────────────────────────────────────────

const task: TaskFnInterface<PipelineStateType> = async (next, state) => {
  const { title, wikitext } = state.page;
  if (!wikitext) { await next(); return; }

  // Skip redirect pages — leave output null, let downstream handle.
  if (wikitext.trim().startsWith('#REDIRECT')) { await next(); return; }

  const doc = wtf(wikitext);
  const categories = doc.categories() as string[];

  // Pokémon Infobox is recognised by wtf_wikipedia as an infobox (not a template).
  // Detect it via the infobox .template() method.
  const infoboxes = doc.infoboxes();
  const pokemonBox = infoboxes.find((box) => {
    const name = box.template().toLowerCase();
    return name.includes(TEMPLATE_POKEMON) || name.includes(TEMPLATE_POKEMON2);
  });
  if (pokemonBox !== undefined) {
    const output: BulbapediaOutput = extractPokemon(title, pokemonBox, categories, wikitext);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  // Move, Item, and Masters infoboxes are generic templates in wtf_wikipedia.
  const moveData = findTemplate(doc, (name) => name.includes(TEMPLATE_MOVE));
  if (moveData !== null) {
    const output: BulbapediaOutput = extractMove(title, moveData, categories, wikitext);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  const itemData = findTemplate(doc, (name) => name.includes(TEMPLATE_ITEM_HEAD));
  if (itemData !== null) {
    const output: BulbapediaOutput = extractItem(title, itemData, categories, wikitext);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  const mastersData = findTemplate(doc, (name) => name.includes(TEMPLATE_MASTERS) && !name.includes('skill') && !name.includes('event'));
  if (mastersData !== null) {
    const output: BulbapediaOutput = extractMasters(title, mastersData, categories, wikitext);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  const mastersSkillData = findTemplate(doc, (name) => name.includes(TEMPLATE_MASTERS_SKILL));
  if (mastersSkillData !== null) {
    const output: BulbapediaOutput = extractMastersSkill(title, mastersSkillData, categories, wikitext);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  const mastersEventData = findTemplate(doc, (name) => name.includes(TEMPLATE_MASTERS_EVENT));
  if (mastersEventData !== null) {
    const output: BulbapediaOutput = extractMastersEvent(title, mastersEventData, categories, wikitext);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  // TCG Pokémon card — individual card pages.
  if (hasTmpl(wikitext, TEMPLATE_TCG_POKEMON)) {
    const output: BulbapediaOutput = extractTcgPokemonCard(title, wikitext, categories);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  // TCG Trainer/Supporter/Item/Stadium card pages.
  if (hasTmpl(wikitext, TEMPLATE_TCG_TRAINER)) {
    const output: BulbapediaOutput = extractTcgTrainerCard(title, wikitext, categories);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  // TCG set/expansion pages.
  if (hasTmpl(wikitext, TEMPLATE_TCG_EXPANSION)) {
    const output: BulbapediaOutput = extractTcgSet(title, wikitext, categories);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  // TCG deck pages.
  if (hasTmpl(wikitext, TEMPLATE_TCG_DECK)) {
    const output: BulbapediaOutput = extractTcgDeck(title, wikitext, categories);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  // TCG promo pages.
  if (hasTmpl(wikitext, TEMPLATE_TCG_PROMO)) {
    const output: BulbapediaOutput = extractTcgPromo(title, wikitext, categories);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  // Location pages (city/town/route/dungeon/anime location).
  if (
    hasTmpl(wikitext, TEMPLATE_TOWN_INFOBOX) ||
    hasTmpl(wikitext, TEMPLATE_ROUTE_INFOBOX) ||
    hasTmpl(wikitext, TEMPLATE_LOCATION_INFOBOX) ||
    hasTmpl(wikitext, TEMPLATE_ANIME_LOCATION)
  ) {
    const output: BulbapediaOutput = extractLocation(title, wikitext, categories);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  // Character pages.
  if (hasTmpl(wikitext, TEMPLATE_CHARACTER) || hasTmpl(wikitext, TEMPLATE_CHAR_INFOBOX)) {
    const output: BulbapediaOutput = extractCharacter(title, wikitext, categories);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  // Trainer class pages.
  if (hasTmpl(wikitext, TEMPLATE_TRAINER_CLASS)) {
    const output: BulbapediaOutput = extractTrainerClass(title, wikitext, categories);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  // Pokémon UNITE pages.
  if (hasTmpl(wikitext, TEMPLATE_UNITE_INFOBOX)) {
    const output: BulbapediaOutput = extractUnitePokemon(title, wikitext, categories);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  // TCG Energy card pages.
  if (hasTmpl(wikitext, TEMPLATE_TCG_ENERGY)) {
    const output: BulbapediaOutput = extractTcgEnergyCard(title, wikitext, categories);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  // Main game pages (Pokémon GO, Pokémon Sleep, etc.)
  if (hasTmpl(wikitext, TEMPLATE_GAME_INFOBOX)) {
    const output: BulbapediaOutput = extractGame(title, wikitext, categories);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  // Title-pattern based classification for subpages (no infobox required).
  if (/\/Generation [IVX]+ learnset$/.test(title)) {
    const pokemon = title.split('/')[0] ?? title;
    const generation = parseLearnsetGeneration(title);
    const output: BulbapediaOutput = { _type: 'learnset_data', title, pokemon, generation, categories };
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  if (/ cards$/.test(title)) {
    const subject = title.replace(/ cards$/, '');
    const output: BulbapediaOutput = { _type: 'card_list', title, subject, categories };
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  if (/\/\w+ anime history$/.test(title)) {
    const output: BulbapediaOutput = { _type: 'anime_history', title, categories };
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  if (/\/moves$/.test(title) || /\/base stats$/.test(title)) {
    const output: BulbapediaOutput = { _type: 'game_data', title, categories };
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  // Unknown page type — emit a minimal record with categories.
  const output: BulbapediaOutput = { _type: 'unknown', title, categories };
  state.output = output as unknown as Record<string, unknown>;
  await next();
};

TaskRegistry.register('bulbapedia:parse', task);
