import wtf from 'wtf_wikipedia';
import { TaskRegistry } from '../../dist/registry/TaskRegistry.js';
import type { PipelineStateInterface } from '../../dist/registry/PipelineState.js';
import type { TaskFnInterface } from '../../dist/pipeline/Pipeline.js';

// ─── Template name fragments ──────────────────────────────────────────────────

const TEMPLATE_POKEMON   = 'pokémon infobox';
const TEMPLATE_POKEMON2  = 'pokemon infobox';
const TEMPLATE_MOVE      = 'moveinfobox';
const TEMPLATE_ITEM_HEAD = 'iteminfobox/head';
const TEMPLATE_MASTERS   = 'mastersinfobox';

// ─── Output shapes ────────────────────────────────────────────────────────────

type PageType = 'pokemon' | 'move' | 'item' | 'masters' | 'unknown';

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

interface UnknownOutput extends BaseOutput {
  _type: 'unknown';
}

type BulbapediaOutput =
  | PokemonOutput
  | MoveOutput
  | ItemOutput
  | MastersOutput
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

  // Unknown page type — emit a minimal record with categories.
  const output: BulbapediaOutput = { _type: 'unknown', title, categories };
  state.output = output as unknown as Record<string, unknown>;
  await next();
};

TaskRegistry.register('bulbapedia:parse', task);
