import wtf from 'wtf_wikipedia';
import { TaskRegistry } from '../../dist/registry/TaskRegistry.js';
import type { PipelineStateInterface } from '../../dist/registry/PipelineState.js';
import type { TaskFnInterface } from '../../dist/pipeline/Pipeline.js';

// ─── Template name fragments ──────────────────────────────────────────────────

const TEMPLATE_POKEMON        = 'pokémon infobox';
const TEMPLATE_POKEMON2       = 'pokemon infobox';
const TEMPLATE_MOVE           = 'moveinfobox';
const TEMPLATE_ITEM_HEAD      = 'iteminfobox/head';
const TEMPLATE_MASTERS        = 'mastersinfobox';
const TEMPLATE_TCG_POKEMON    = 'pokémoncardInfobox';
const TEMPLATE_TCG_TRAINER    = 'TCGTrainerCardInfobox';
const TEMPLATE_TCG_EXPANSION  = 'TCGExpansionInfobox';

// ─── Output shapes ────────────────────────────────────────────────────────────

type PageType = 'pokemon' | 'move' | 'item' | 'masters' | 'tcg_pokemon_card' | 'tcg_trainer_card' | 'tcg_set' | 'unknown';

interface BaseOutput {
  _type: PageType;
  title: string;
  categories: string[];
}

interface PokemonOutput extends BaseOutput {
  _type: 'pokemon';
  ndex:       number | null;
  name:       string | null;
  jname:      string | null;
  types:      string[];
  category:   string | null;
  height_m:   number | null;
  weight_kg:  number | null;
  abilities:  string[];
  egg_groups: string[];
  egg_cycles: number | null;
  color:      string | null;
  catch_rate: number | null;
  generation: string | null;
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
}

interface ItemOutput extends BaseOutput {
  _type: 'item';
  name:       string | null;
  jname:      string | null;
  generation: string | null;
}

interface MastersOutput extends BaseOutput {
  _type: 'masters';
  name:    string | null;
  jname:   string | null;
  jtrans:  string | null;
  type:    string | null;
  num:     string | null;
  desc:    string | null;
  enva:    string | null;
  java:    string | null;
  image:   string | null;
  caption: string | null;
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
}

interface TcgTrainerCardOutput extends BaseOutput {
  _type: 'tcg_trainer_card';
  name: string | null;
  jname: string | null;
  card_class: string | null;
  expansions: TcgExpansionEntry[];
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
}

interface UnknownOutput extends BaseOutput {
  _type: 'unknown';
}

type BulbapediaOutput =
  | PokemonOutput
  | MoveOutput
  | ItemOutput
  | MastersOutput
  | TcgPokemonCardOutput
  | TcgTrainerCardOutput
  | TcgSetOutput
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
  const s = String(val);
  const tt = /\{\{tt\|([^|}\n]+)\|[^}]*\}\}/gi;
  return s.replace(tt, '$1').trim() || null;
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
      const n = Number(val.number);
      return Number.isFinite(n) ? n : null;
    }
    if ('text' in val) {
      const n = parseFloat(String(val.text ?? ''));
      return Number.isFinite(n) ? n : null;
    }
  }
  const n = parseFloat(String(val));
  return Number.isFinite(n) ? n : null;
}

/** Extract non-null text values from a list of infobox fields. */
function infoboxTextList(vals: WtfField[]): string[] {
  return vals.map(infoboxText).filter((v): v is string => v !== null);
}

/** Extract a plain string from a template json field. */
function templateStr(data: Record<string, unknown>, key: string): string | null {
  return clean(data[key]);
}

/** Extract a number from a template json field. */
function templateNum(data: Record<string, unknown>, key: string): number | null {
  const s = templateStr(data, key);
  if (s === null) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// ─── Template (non-infobox) finder ───────────────────────────────────────────

type TemplateData = Record<string, unknown>;

function findTemplate(
  doc: ReturnType<typeof wtf>,
  predicate: (name: string) => boolean,
): TemplateData | null {
  const templates = doc.templates();
  const match = templates.find((t) => {
    const name = String((t.json() as Record<string, unknown>)['template'] ?? '').toLowerCase();
    return predicate(name);
  });
  return match !== undefined ? (match.json() as TemplateData) : null;
}

// ─── Per-type extractors ──────────────────────────────────────────────────────

function extractPokemon(
  title: string,
  box: ReturnType<ReturnType<typeof wtf>['infoboxes']>[number],
  categories: string[],
): PokemonOutput {
  const json = box.json() as Record<string, WtfField>;
  return {
    _type:      'pokemon',
    title,
    ndex:       infoboxNum(json['ndex']),
    name:       infoboxText(json['name']),
    jname:      infoboxText(json['jname']),
    types:      infoboxTextList([json['type1'], json['type2']]),
    category:   infoboxText(json['category']),
    height_m:   infoboxNum(json['height-m']),
    weight_kg:  infoboxNum(json['weight-kg']),
    abilities:  infoboxTextList([json['ability1'], json['ability2'], json['abilityd']]),
    egg_groups: infoboxTextList([json['egggroup1'], json['egggroup2']]),
    egg_cycles: infoboxNum(json['eggcycles']),
    color:      infoboxText(json['color']),
    catch_rate: infoboxNum(json['catchrate']),
    generation: infoboxText(json['generation']),
    categories,
  };
}

function extractMove(title: string, data: TemplateData, categories: string[]): MoveOutput {
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
    categories,
  };
}

function extractItem(title: string, data: TemplateData, categories: string[]): ItemOutput {
  return {
    _type:      'item',
    title,
    name:       templateStr(data, 'name'),
    jname:      templateStr(data, 'jname'),
    generation: templateStr(data, 'gen'),
    categories,
  };
}

function extractMasters(title: string, data: TemplateData, categories: string[]): MastersOutput {
  return {
    _type:   'masters',
    title,
    name:    templateStr(data, 'name'),
    jname:   templateStr(data, 'jname'),
    jtrans:  templateStr(data, 'jtrans'),
    type:    templateStr(data, 'type'),
    num:     templateStr(data, 'num'),
    desc:    templateStr(data, 'desc'),
    enva:    templateStr(data, 'enva'),
    java:    templateStr(data, 'java'),
    image:   templateStr(data, 'image'),
    caption: templateStr(data, 'caption'),
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
    let i = startIdx;
    let endIdx = -1;
    while (i < wikitext.length - 1) {
      if (wikitext[i] === '{' && wikitext[i + 1] === '{') { depth++; i += 2; continue; }
      if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
        depth--;
        if (depth === 0) { endIdx = i + 2; break; }
        i += 2;
        continue;
      }
      i++;
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
  let i = valueStart;
  while (i < body.length) {
    const ch = body[i];
    const next = body[i + 1];
    if (ch === '{' && next === '{') { depth++; i += 2; continue; }
    if (ch === '}' && next === '}') {
      if (depth === 0) break;
      depth--;
      i += 2;
      continue;
    }
    if (depth === 0 && (ch === '|' || ch === '\n')) break;
    i++;
  }
  const raw = body.slice(valueStart, i).trim();
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
  let i = startIdx;
  let end = -1;
  while (i < wikitext.length - 1) {
    if (wikitext[i] === '{' && wikitext[i + 1] === '{') { depth++; i += 2; continue; }
    if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
      depth--;
      if (depth === 0) { end = i + 2; break; }
      i += 2;
      continue;
    }
    i++;
  }
  const block = end === -1 ? wikitext.slice(startIdx) : wikitext.slice(startIdx, end);
  // Parse top-level |key=value lines (skip nested {{ }} blocks).
  const result: Record<string, string> = {};
  const kvRe = /\|\s*([a-zA-Z0-9_]+)\s*=\s*([^|{}\n]*(?:\{\{[^}]*\}\}[^|{}\n]*)*)/g;
  let m: RegExpExecArray | null;
  while ((m = kvRe.exec(block)) !== null) {
    const k = (m[1] ?? '').trim();
    const v = (m[2] ?? '').trim();
    if (k !== '' && v !== '') result[k] = v;
  }
  return result;
}

// ─── TCG extractors ───────────────────────────────────────────────────────────

export function extractTcgPokemonCard(
  title: string,
  wikitext: string,
  categories: string[],
): TcgPokemonCardOutput {
  const kv = parseMainInfoboxKv(wikitext, TEMPLATE_TCG_POKEMON) ?? {};
  const hpRaw = kv['hp'] !== undefined ? parseInt(kv['hp'], 10) : null;
  const retreatRaw = kv['retreatcost'] !== undefined ? parseInt(kv['retreatcost'], 10) : null;
  return {
    _type:        'tcg_pokemon_card',
    title,
    name:         kv['cardname'] !== undefined ? extractTcgRef(kv['cardname']) : null,
    jname:        kv['jname'] !== undefined ? extractTcgRef(kv['jname']) : null,
    species:      kv['species'] !== undefined ? extractTcgRef(kv['species']) : null,
    stage:        kv['evostage'] !== undefined ? extractTcgRef(kv['evostage']) : null,
    card_type:    kv['type'] !== undefined ? extractTcgRef(kv['type']) : null,
    hp:           hpRaw !== null && Number.isFinite(hpRaw) ? hpRaw : null,
    weakness:     kv['weakness'] !== undefined ? extractTcgRef(kv['weakness']) : null,
    resistance:   kv['resistance'] !== undefined ? extractTcgRef(kv['resistance']) : null,
    retreat_cost: retreatRaw !== null && Number.isFinite(retreatRaw) ? retreatRaw : null,
    expansions:   extractExpansions(wikitext, TEMPLATE_TCG_POKEMON),
    categories,
  };
}

export function extractTcgTrainerCard(
  title: string,
  wikitext: string,
  categories: string[],
): TcgTrainerCardOutput {
  const kv = parseMainInfoboxKv(wikitext, TEMPLATE_TCG_TRAINER) ?? {};
  return {
    _type:      'tcg_trainer_card',
    title,
    name:       kv['cardname'] !== undefined ? extractTcgRef(kv['cardname']) : null,
    jname:      kv['jname'] !== undefined ? extractTcgRef(kv['jname']) : null,
    card_class: kv['class'] !== undefined ? extractTcgRef(kv['class']) : null,
    expansions: extractExpansions(wikitext, TEMPLATE_TCG_TRAINER),
    categories,
  };
}

export function extractTcgSet(
  title: string,
  wikitext: string,
  categories: string[],
): TcgSetOutput {
  const kv = parseMainInfoboxKv(wikitext, TEMPLATE_TCG_EXPANSION) ?? {};
  const enCards  = kv['encards']  !== undefined ? parseInt(kv['encards'], 10)  : null;
  const enSetNum = kv['ensetnum'] !== undefined ? parseInt(kv['ensetnum'], 10) : null;
  const jaCards  = kv['jacards']  !== undefined ? parseInt(kv['jacards'], 10)  : null;
  return {
    _type:            'tcg_set',
    title,
    name:             kv['setname']    !== undefined ? extractTcgRef(kv['setname'])    : null,
    ja_name:          kv['jasetname']  !== undefined ? extractTcgRef(kv['jasetname'])  : null,
    translated_name:  kv['transsetname'] !== undefined ? extractTcgRef(kv['transsetname']) : null,
    en_card_count:    enCards  !== null && Number.isFinite(enCards)  ? enCards  : null,
    en_set_number:    enSetNum !== null && Number.isFinite(enSetNum) ? enSetNum : null,
    en_release:       kv['enrelease'] !== undefined ? kv['enrelease'].trim() : null,
    ja_card_count:    jaCards  !== null && Number.isFinite(jaCards)  ? jaCards  : null,
    ja_release:       kv['jarelease'] !== undefined ? kv['jarelease'].trim() : null,
    categories,
  };
}

// ─── Task ─────────────────────────────────────────────────────────────────────

const task: TaskFnInterface<PipelineStateInterface> = async (next, state) => {
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
    const output: BulbapediaOutput = extractPokemon(title, pokemonBox, categories);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  // Move, Item, and Masters infoboxes are generic templates in wtf_wikipedia.
  const moveData = findTemplate(doc, (n) => n.includes(TEMPLATE_MOVE));
  if (moveData !== null) {
    const output: BulbapediaOutput = extractMove(title, moveData, categories);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  const itemData = findTemplate(doc, (n) => n.includes(TEMPLATE_ITEM_HEAD));
  if (itemData !== null) {
    const output: BulbapediaOutput = extractItem(title, itemData, categories);
    state.output = output as unknown as Record<string, unknown>;
    await next();
    return;
  }

  const mastersData = findTemplate(doc, (n) => n.includes(TEMPLATE_MASTERS));
  if (mastersData !== null) {
    const output: BulbapediaOutput = extractMasters(title, mastersData, categories);
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

  // Unknown page type — emit a minimal record with categories.
  const output: BulbapediaOutput = { _type: 'unknown', title, categories };
  state.output = output as unknown as Record<string, unknown>;
  await next();
};

TaskRegistry.register('bulbapedia:parse', task);
