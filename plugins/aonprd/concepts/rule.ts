//
// Rule pages (Rules.aspx) differ structurally from entity pages: content lives
// in `<div class="rule">` rather than `<span>`. Because of this, `extractCommon`
// returns null and `loadAndCommonNode` stashes ONLY `aonprdCheerio` — neither
// `aonprdCommon` nor `aonprdTarget` are present. All capability nodes in this
// concept must therefore declare `hardRequired: ['aonprdCheerio']` and build a
// `RuleContext` from the cheerio handle directly via `buildRuleContext($)`.
//
// Per-slice:
//   extract:rule-base        — name, rule_id, sources, body text/html
//   extract:rule-subsections — child_rules (h2.title sub-topic links) + sections
//   finalize:rule            — pure assembler over state.output + ctx (no re-runs)
//
// `buildRuleContext` is DOM-based (cheerio traversal, no regex for
// structural walking). The context is memoized on
// `state.metadata['aonprdRuleContext']` so the three rule nodes share one
// build. Numeric ID parsing from text uses targeted regex on small attribute
// strings only.
//
// No `raw_fields` strip: rule pages have no `<b>Label</b>` field map.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { OperationContractFragmentType } from '@studnicky/dagonizer/contracts';
import { load, type CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../taxonomy.js';
import { setConceptOutput } from './_helpers.js';
import {
  CAPABILITY_OUTPUTS,
  type LinkRef,
  type Section,
  type SourceRef,
  type CheerioNode,
  harvestLinks,
  harvestSections,
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
} from '../common.js';

// ─── Output type ──────────────────────────────────────────────────────────────

/** A child rule section (h2.title sub-topic) nested inside a rule page. */
export interface RuleSection {
  heading:   string;
  href:      string | null;
  rule_id:   number | null;
}

export interface RuleOutput {
  url:             string;
  rule_id:       number | null;
  /** Rule title extracted from the `<h1 class="title">` inside `<div class="rule">`. */
  name:            string;
  source:          { book: string | null; page: number | null; source_id: number | null };
  sources:         SourceRef[];
  body_text:       string;
  body_html:       string;
  /** Child rules listed as `<h2 class="title"><a …>Sub-Rule</a></h2>` blocks. */
  child_rules:     RuleSection[];
  sections:        Section[];
  links:           LinkRef[];
  meta_description: string | null;
  meta_keywords:   string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-rule-base`. */
export interface RuleBaseSlice {
  url:       string;
  rule_id: number | null;
  name:      string;
  source:    RuleOutput['source'];
  sources:   SourceRef[];
  body_text: string;
  body_html: string;
}

/** Fields owned by `extract-rule-subsections`. */
export interface RuleSubsectionsSlice {
  child_rules: RuleSection[];
  sections:    Section[];
}

// ─── Cheerio context for the rule page ────────────────────────────────────────

/**
 * Resolved cheerio handles for a rule page. Computed once by `ruleBaseNode`
 * (or `extractRule` for direct-call paths) and reused across slice helpers.
 *
 * all members are derived through DOM traversal. The body HTML is
 * captured by removing the `<h1>` and `<div class="sources">` DOM nodes from a
 * cloned tree, then serialising — no regex slicing.
 */
export interface RuleContext {
  /** The `<div class="rule">` cheerio node. */
  ruleDiv: CheerioNode;
  /** Rule title text from `<h1 class="title">` inside `div.rule` (or empty). */
  name: string;
  /** Parsed Source refs from each `<div class="sources">` block under div.rule. */
  sources: SourceRef[];
  /** Body HTML after removing `<h1>` and the `<div class="sources">` blocks. */
  bodyHtml: string;
  /** Body text derived from `bodyHtml`. */
  bodyText: string;
  /** Child rule subsection records harvested via DOM traversal. */
  childRules: RuleSection[];
}

// ─── DOM helpers (cheerio traversal, no regex on structure) ───────────────────

/** Extract the entity id from a hrefs like `Sources.aspx?ID=42` or `Rules.aspx?ID=7`. */
function parseIdFromHref(href: string | undefined): number | null {
  if (href === undefined) return null;
  const match = /[?&]ID=(\d+)/i.exec(href);
  if (match === null) return null;
  const num = parseInt(match[1]!, 10);
  return Number.isFinite(num) ? num : null;
}

/** Parse `"Book Title pg. 42"` into a `{ book, page }` pair. Tolerant. */
function splitBookAndPage(label: string): { book: string | null; page: number | null } {
  const match = /^(.*?)\s+pg\.\s*(\d+)/i.exec(label);
  if (match === null) {
    const book = label.trim();
    return { book: book.length > 0 ? book : null, page: null };
  }
  const book = (match[1] ?? '').trim();
  const page = parseInt(match[2]!, 10);
  return {
    book: book.length > 0 ? book : null,
    page: Number.isFinite(page) ? page : null,
  };
}

/**
 * Walk every `<div class="sources">` block under `ruleDiv` and pull each
 * `<a href="/Sources.aspx?ID=N">Label</a>` into a SourceRef. Cheerio DOM
 * traversal — no regex on structure.
 */
function harvestRuleSources(root: CheerioAPI, ruleDiv: CheerioNode): SourceRef[] {
  const out: SourceRef[] = [];
  ruleDiv.find('div.sources').each((_index, element) => {
    const anchor = root(element).find('a[href*="Sources.aspx"]').first();
    if (anchor.length === 0) return;
    const href = anchor.attr('href');
    const label = htmlToText(anchor.text());
    const source_id = parseIdFromHref(href);
    const { book, page } = splitBookAndPage(label);
    out.push({ book, page, source_id, raw: label });
  });
  return out;
}

/**
 * Walk every `<h2 class="title">` inside `ruleDiv` and turn each into a child
 * RuleSection. Heading text is the anchor text when present, otherwise the
 * raw heading text. Cheerio DOM traversal — no regex on structure.
 */
function harvestChildRules(root: CheerioAPI, ruleDiv: CheerioNode): RuleSection[] {
  const out: RuleSection[] = [];
  ruleDiv.find('h2.title').each((_index, element) => {
    const h2El = root(element);
    const anchor = h2El.find('a').first();
    let heading: string;
    let href: string | null;
    let rule_id: number | null;
    if (anchor.length > 0) {
      heading = htmlToText(anchor.text());
      href    = anchor.attr('href') ?? null;
      rule_id = parseIdFromHref(href ?? undefined);
    } else {
      heading = htmlToText(h2El.text());
      href    = null;
      rule_id = null;
    }
    if (heading === '') return;
    out.push({ heading, href, rule_id });
  });
  return out;
}

/**
 * Compute the body HTML/text by cloning the `div.rule` subtree, removing the
 * `<h1>` and every `<div class="sources">` block, and serialising the rest.
 * Cheerio DOM traversal — no regex slicing.
 */
function extractRuleBody(_root: CheerioAPI, ruleDiv: CheerioNode): { bodyHtml: string; bodyText: string } {
  if (ruleDiv.length === 0) return { bodyHtml: '', bodyText: '' };
  const cloned = ruleDiv.clone();
  cloned.find('h1').remove();
  cloned.find('div.sources').remove();
  const bodyHtml = (cloned.html() ?? '').trim();
  return { bodyHtml, bodyText: htmlToText(bodyHtml) };
}

/** Extract the title text from the first `<h1 class="title">` under div.rule. */
function extractRuleTitleNode(ruleDiv: CheerioNode): string {
  if (ruleDiv.length === 0) return '';
  const h1El = ruleDiv.find('h1.title').first();
  if (h1El.length === 0) return '';
  const anchor = h1El.find('a').first();
  const text = anchor.length > 0 ? anchor.text() : h1El.text();
  return htmlToText(text).trim();
}

/**
 * Build a `RuleContext` from a loaded CheerioAPI handle via DOM traversal.
 * Single source of structural truth for the three rule nodes (memoized).
 */
export function buildRuleContext(root: CheerioAPI): RuleContext {
  const ruleDiv     = root('div.rule').first();
  const name        = extractRuleTitleNode(ruleDiv);
  const sources     = harvestRuleSources(root, ruleDiv);
  const { bodyHtml, bodyText } = extractRuleBody(root, ruleDiv);
  const childRules  = harvestChildRules(root, ruleDiv);
  return { ruleDiv, name, sources, bodyHtml, bodyText, childRules };
}

/**
 * Read the memoized `RuleContext` from state, or build and cache it.
 * Centralises the build/read pattern used by the three rule nodes.
 */
function getOrBuildRuleContext(state: ScrapeState, root: CheerioAPI): RuleContext {
  const cached = state.getMetadata<RuleContext>('aonprdRuleContext');
  if (cached !== undefined) return cached;
  const ctx = buildRuleContext(root);
  state.setMetadata('aonprdRuleContext', ctx);
  return ctx;
}

// ─── Slice helpers ────────────────────────────────────────────────────────────

/** Extract identity + sources + body text/html. */
export function extractRuleBase(ctx: RuleContext, url: string): RuleBaseSlice {
  const source = ctx.sources[0] ?? { book: null, page: null, source_id: null, raw: '' };
  return {
    url,
    rule_id: extractEntityId(url),
    name:      ctx.name,
    source:    { book: source.book, page: source.page, source_id: source.source_id },
    sources:   ctx.sources,
    body_text: ctx.bodyText,
    body_html: ctx.bodyHtml,
  };
}

/** Extract nested rule subsections (child links + harvested sections). */
export function extractRuleSubsections(root: CheerioAPI, ctx: RuleContext): RuleSubsectionsSlice {
  return {
    child_rules: ctx.childRules,
    sections:    harvestSections(root, ctx.ruleDiv),
  };
}

/**
 * Assemble the final RuleOutput from per-slice results.
 *
 * Rule pages don't have a `<b>Label</b>` field map (the source lives in a
 * `<div class="sources">` block instead), so there is no `raw_fields` to strip.
 * Finalization attaches the body-level link harvest and the page-level meta tags.
 */
export function finalizeRule(
  root:         CheerioAPI,
  ctx:          RuleContext,
  base:         RuleBaseSlice,
  subsections:  RuleSubsectionsSlice,
): RuleOutput {
  return {
    ...base,
    ...subsections,
    links:            harvestLinks(ctx.bodyHtml),
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies RuleOutput;
}

// ─── Extractor entry points ───────────────────────────────────────────────────

/**
 * Parse a Rules.aspx page HTML directly (bypassing extractCommon which requires
 * a `<span>` wrapper). The `$` Cheerio instance is loaded from the full page.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through the
 * decomposed rule extraction nodes.
 */
export function extractRule(root: CheerioAPI, url: string): RuleOutput {
  const ctx         = buildRuleContext(root);
  const base        = extractRuleBase(ctx, url);
  const subsections = extractRuleSubsections(root, ctx);
  return finalizeRule(root, ctx, base, subsections);
}

/**
 * Load a full Rules.aspx page HTML and return a typed RuleOutput.
 * This is the direct-call API used by `parseAonHtml` and unit tests.
 */
export function parseRuleHtml(html: string, url: string): RuleOutput {
  const root = load(html);
  return extractRule(root, url);
}

// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:rule-base
// Builds the memoized RuleContext (DOM traversal) and writes the base slice.
// Reads aonprdCheerio only — no aonprdCommon (rule pages bypass extractCommon).

export type RuleBaseOutput = 'success' | 'error';

class RuleBaseNode extends ScalarNode<ScrapeState, RuleBaseOutput> {
  public readonly name    = 'extract:rule-base';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCheerio'] as const,
    // `aonprdRuleContext` is memoized on `state.metadata` for the
    // companion rule nodes to pick up via `getOrBuildRuleContext`, but their
    // declared `hardRequired` is `['aonprdCheerio']` — they re-derive the
    // context if the memo is absent. Omit from declared produces so the
    // `ContractRegistryValidator` registration check stays at "zero
    // warnings"; the runtime memo still happens.
    produces:     [] as const,
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<RuleBaseOutput>> {
    const root = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (root === undefined) return NodeOutputBuilder.of('error');

    const ctx  = getOrBuildRuleContext(state, root);
    const base = extractRuleBase(ctx, state.page.url);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const ruleBaseNode = new RuleBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:rule-subsections
// Reads the memoized RuleContext from state and writes child_rules + sections.

export type RuleSubsectionsOutput = 'success' | 'error';

class RuleSubsectionsNode extends ScalarNode<ScrapeState, RuleSubsectionsOutput> {
  public readonly name    = 'extract:rule-subsections';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCheerio'] as const,
    produces:     [] as const,
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<RuleSubsectionsOutput>> {
    const root = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (root === undefined) return NodeOutputBuilder.of('error');

    const ctx         = getOrBuildRuleContext(state, root);
    const subsections = extractRuleSubsections(root, ctx);

    state.output = { ...state.output, ...subsections };

    return NodeOutputBuilder.of('success');
  }
}

export const ruleSubsectionsNode = new RuleSubsectionsNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:rule
// Pure assembler. Reads the memoized RuleContext + accumulated state.output
// (already populated by ruleBaseNode + ruleSubsectionsNode) and attaches the
// body-level link harvest + page meta tags. No slice re-runs.

export type FinalizeRuleOutput = 'success';

class FinalizeRuleConceptNode extends ScalarNode<ScrapeState, FinalizeRuleOutput> {
  public readonly name    = 'finalize:rule';
  public readonly outputs = ['success'] as const;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCheerio'] as const,
    produces:     [] as const,
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeRuleOutput>> {
    const root = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (root === undefined) return NodeOutputBuilder.of('success');

    const ctx = getOrBuildRuleContext(state, root);

    const prior = (state.output ?? {}) as Partial<RuleOutput>;
    const assembled: RuleOutput = {
      url:              prior.url ?? state.page.url,
      rule_id:        prior.rule_id ?? extractEntityId(state.page.url),
      name:             prior.name ?? ctx.name,
      source:           prior.source ?? {
        book:      ctx.sources[0]?.book ?? null,
        page:      ctx.sources[0]?.page ?? null,
        source_id: ctx.sources[0]?.source_id ?? null,
      },
      sources:          prior.sources ?? ctx.sources,
      body_text:        prior.body_text ?? ctx.bodyText,
      body_html:        prior.body_html ?? ctx.bodyHtml,
      child_rules:      prior.child_rules ?? ctx.childRules,
      sections:         prior.sections ?? harvestSections(root, ctx.ruleDiv),
      links:            harvestLinks(ctx.bodyHtml),
      meta_description: extractMetaDescription(root),
      meta_keywords:    extractMetaKeywords(root),
    };

    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeRuleConceptNode = new FinalizeRuleConceptNode();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

/**
 * Rule concept declaration for the AONPRD taxonomy.
 * Imported by `plugins/aonprd/taxonomy/aonprd.ts`.
 *
 * All three nodes declare `hardRequired: ['aonprdCheerio']` — the `aonprdCommon`
 * and `aonprdTarget` keys are absent for rule pages because `loadAndCommonNode`
 * short-circuits when `detectPageType` returns `'rule'`.
 */
export const ruleConcept: ConceptDecl<RuleOutput> = {
  id:       'rule',
  parent:   'thing',
  urlPaths: ['rules'],
  capabilities: [
    ruleBaseNode,
    ruleSubsectionsNode,
    finalizeRuleConceptNode,
  ],
};
