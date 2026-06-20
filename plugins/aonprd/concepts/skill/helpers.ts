// Skill concept — parsing helpers.
import type { CheerioAPI } from 'cheerio';
import type { Element, AnyNode } from 'domhandler';
import { htmlToText } from '../../common.js';
import type { ActionCost } from '../../common.js';
import type { SkillProficiencyRank, SkillAction, SkillProficiencyTier } from './types.js';
import { ACTION_LABEL_TO_COST, KEY_ABILITY_RE, PROFICIENCY_RANKS, PROFICIENCY_RANK_SET } from './types.js';

// ─── Title parsing ────────────────────────────────────────────────────────────

/** Strip the `(Key Ability)` suffix from a skill name and return both pieces. */
export function splitKeyAbility(rawName: string): { name: string; key_ability: string | null } {
  const match = KEY_ABILITY_RE.exec(rawName);
  if (match === null) return { name: rawName.trim(), key_ability: null };
  const ability = (match[1] ?? '').trim().toLowerCase();
  const name = rawName.slice(0, match.index).trim();
  return { name, key_ability: ability === '' ? null : ability };
}

// ─── Action cost glyph ────────────────────────────────────────────────────────

/** Parse the action-cost glyph from a `<span class="action">[label]</span>` block. */
export function parseActionGlyph(html: string): ActionCost | null {
  const match = /<span\s+class=['"]action['"][^>]*>\s*\[([a-z-]+)\]/i.exec(html);
  return match === null ? null : ACTION_LABEL_TO_COST.get(match[1]!.toLowerCase()) ?? null;
}

// ─── Skill description prose ──────────────────────────────────────────────────

/**
 * Extract the lead description paragraph from the content span.
 *
 * AON renders the skill description as the prose immediately after the
 * `<b>Source</b>` line and before the first structural break inside the span
 * (`<details>` collapsible, `<h1 class="title">` group header for an Untrained
 * / Trained / Expert / Master / Legendary action listing, or
 * `<h3 class="title">Related Feats</h3>`).
 *
 * Skill pages do not carry a top-level `<hr/>` separator, so we cannot rely on
 * `c.body_html` (which is cut at the first `<hr/>` it finds — typically the one
 * inside the first action's body). Walking the span directly gives us the
 * correct boundary.
 */
export function extractDescription(span: unknown): { html: string; text: string } {
  const spanHtml = (span as { html(): string | null }).html() ?? '';
  // Cut tail: stop at first <details>, <h1 class="title">, <h2 class="title">,
  // or <h3 class="title"> following the Source line.
  const tailRe = /<details\b|<h1\b[^>]*class="[^"]*title[^"]*"|<h2\b[^>]*class="[^"]*title[^"]*"|<h3\b[^>]*class="[^"]*title[^"]*"/i;

  // Cut head: skip past the page-title <h1 class="title"> and the <b>Source</b>
  // line so we don't include them in the description prose. Locate the closing
  // <br/> of the Source line and start the description from there.
  const headRe = /<b>\s*Source\s*<\/b>[\s\S]*?<br\s*\/?>/i;
  const head = headRe.exec(spanHtml);
  const afterSource = head !== null ? spanHtml.slice(head.index + head[0].length) : spanHtml;

  const tail = tailRe.exec(afterSource);
  const html = (tail === null ? afterSource : afterSource.slice(0, tail.index)).trim();
  return { html, text: htmlToText(html) };
}

// ─── Action heading discovery ─────────────────────────────────────────────────

interface ActionHeadingMatch {
  name:        string;
  action_id:   number | null;
  action_cost: ActionCost | null;
  proficiency: SkillProficiencyRank | 'untrained' | null;
}

/**
 * Detect the proficiency tier from an `<h1 class="title">` group heading.
 *
 * AON uses heading text like "Acrobatics Untrained Actions" / "Acrobatics
 * Trained Actions" / "Acrobatics Expert Actions" etc. We match the rank token
 * case-insensitively against {@link PROFICIENCY_RANKS}.
 */
export function classifyTierHeading(text: string): SkillProficiencyRank | 'untrained' | null {
  const lower = text.toLowerCase();
  for (const rank of PROFICIENCY_RANKS) {
    // Match as a standalone word so "Trained" doesn't match "Untrained".
    const regex = new RegExp(`\\b${rank}\\b`, 'i');
    if (regex.test(lower)) return rank;
  }
  return null;
}

// ─── Bold-label parsing ───────────────────────────────────────────────────────

/**
 * Return the text following `<b>Label</b>` up to the next `<b>` label, `<hr>`,
 * `<h1>/<h2>/<h3>`, `<br><br>` paragraph break, or end of input.
 */
export function pullLabel(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `<b>\\s*${escaped}\\s*<\\/b>([\\s\\S]*?)(?=<b>|<hr|<h[1-6]|<br\\s*\\/?\\s*>\\s*<br|$)`,
    'i',
  );
  const match = regex.exec(html);
  if (match === null) return null;
  const text = htmlToText(match[1] ?? '').trim();
  return text === '' ? null : text;
}

/** Strip every `<b>Label</b> Value` segment matching a known boundary label. */
export function stripLabeledFields(html: string, labels: ReadonlyArray<string>): string {
  let out = html;
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `<b>\\s*${escaped}\\s*<\\/b>([\\s\\S]*?)(?=<b>|<hr|<h[1-6]|<br\\s*\\/?\\s*>\\s*<br|$)`,
      'gi',
    );
    out = out.replace(regex, '');
  }
  return out;
}

// ─── Action body parsing (cheerio-DOM-walk) ───────────────────────────────────

/**
 * Walk the content span and produce one {@link SkillAction} per `<h2 class="title">`
 * heading. The action body spans the sibling nodes between the heading and the
 * next equal-or-higher-level heading (h1/h2). Inside the body we separate:
 *
 *   - Header block (before `<hr/>`):  trait pills + bold-labeled metadata.
 *   - Body block (after `<hr/>`):     prose + outcome lines.
 */
export function parseActions(root: CheerioAPI, span: unknown): SkillAction[] {
  const out: SkillAction[] = [];
  let currentTier: SkillProficiencyRank | 'untrained' | null = null;

  // Walk every h1.title (group/tier) and h2.title (action) in source order.
  (span as { find(sel: string): { each(fn: (i: number, el: AnyNode) => void): void } }).find('h1.title, h2.title').each((_index: number, element: AnyNode) => {
    const tag = (element as Element).tagName.toLowerCase();
    const $heading = root(element);

    if (tag === 'h1') {
      currentTier = classifyTierHeading($heading.text());
      return;
    }

    // h2.title — an action heading.
    const heading = parseActionHeading(root, element as Element);
    if (heading === null) return;

    const actionHtml = collectFollowingHtmlUntilHeading(root, element as Element);
    const action = buildSkillAction(heading, actionHtml, currentTier);
    out.push(action);
  });

  return out;
}

/**
 * Parse an `<h2 class="title">` skill-action heading. Pulls the action name,
 * the optional `Actions.aspx?ID=N` link, and the action-cost glyph.
 */
export function parseActionHeading(root: CheerioAPI, h2Elem: Element): ActionHeadingMatch | null {
  const $h2Elem = root(h2Elem);
  const clone = $h2Elem.clone();

  // Action cost glyph lives inside `<span class="action">[xxx]</span>`.
  const actionSpan = clone.find('span.action').first();
  const actionHtml = actionSpan.length > 0 ? root.html(actionSpan as unknown as AnyNode) ?? '' : '';
  const action_cost = actionHtml === '' ? null : parseActionGlyph(actionHtml);
  actionSpan.remove();

  // Optional anchor → Actions.aspx?ID=N
  const anchor = clone.find('a').first();
  let action_id: number | null = null;
  if (anchor.length > 0) {
    const href = anchor.attr('href') ?? '';
    const idMatch = /[?&]ID=(\d+)/i.exec(href);
    if (idMatch !== null) action_id = parseInt(idMatch[1]!, 10);
  }

  const name = clone.text().replace(/\s+/g, ' ').trim();
  if (name === '') return null;
  return { name, action_id, action_cost, proficiency: null };
}

/**
 * Walk siblings after `<h2>` until the next `<h1>`/`<h2>` (or end of span) and
 * return the joined HTML. `<h3>` headings stay in the action body — AON uses
 * `<h3 class="title">Sample X Tasks</h3>` inside the action block for tier
 * task descriptions.
 */
export function collectFollowingHtmlUntilHeading(root: CheerioAPI, h2Elem: Element): string {
  const fragments: string[] = [];
  let cur: AnyNode | null = h2Elem.next as AnyNode | null;
  while (cur !== null) {
    if (cur.type === 'tag') {
      const tagName = (cur as Element).tagName.toLowerCase();
      if (tagName === 'h1' || tagName === 'h2') break;
    }
    fragments.push(root.html(cur as AnyNode) ?? '');
    cur = (cur as { next: AnyNode | null }).next;
  }
  return fragments.join('');
}

/**
 * Walk the trait pills emitted between the `<h2>` heading and the first `<b>`
 * label or `<br/>` separator. AON renders each as
 * `<span class="trait"><a href="/Traits.aspx?ID=N">Move</a></span>`.
 */
export function extractActionTraits(html: string): string[] {
  // Cut at the first <b> label or <br> that precedes a <b> (header-of-source line).
  const cut = /<b>/i.exec(html);
  const lead = cut === null ? html : html.slice(0, cut.index);
  const out: string[] = [];
  const regex = /<span\s+class=['"]trait['"][^>]*>([\s\S]*?)<\/span>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(lead)) !== null) {
    const text = htmlToText(match[1] ?? '').trim();
    if (text !== '' && !out.includes(text)) out.push(text);
  }
  return out;
}

/**
 * Split an action body into header (before `<hr/>`) and body (after `<hr/>`).
 * Some actions have no `<hr/>` — in that case the entire HTML is treated as the
 * body and the header section is empty.
 */
export function splitActionOnHr(html: string): { head: string; body: string } {
  const match = /<hr\s*\/?>/i.exec(html);
  if (match === null) return { head: '', body: html };
  return { head: html.slice(0, match.index), body: html.slice(match.index + match[0].length) };
}

/** Build a {@link SkillAction} from a parsed heading + raw action HTML. */
export function buildSkillAction(
  heading:      ActionHeadingMatch,
  actionHtml:   string,
  currentTier:  SkillProficiencyRank | 'untrained' | null,
): SkillAction {
  const traits = extractActionTraits(actionHtml);
  const { head, body } = splitActionOnHr(actionHtml);

  const headerSource = pullLabel(head, 'Source');
  const requirements = pullLabel(head, 'Requirements');
  const trigger      = pullLabel(head, 'Trigger');
  const frequency    = pullLabel(head, 'Frequency');
  const cost         = pullLabel(head, 'Cost');

  const critical_success = pullLabel(body, 'Critical Success');
  const success          = pullLabel(body, 'Success');
  const failure          = pullLabel(body, 'Failure');
  const critical_failure = pullLabel(body, 'Critical Failure');

  // Strip outcome labels + their values from the body so description prose
  // doesn't double-count outcomes.
  const descriptionHtml = stripLabeledFields(
    body,
    ['Critical Success', 'Success', 'Failure', 'Critical Failure'],
  ).trim();

  return {
    name:             heading.name,
    action_cost:      heading.action_cost,
    traits,
    proficiency:      currentTier,
    source:           headerSource,
    requirements,
    trigger,
    frequency,
    cost,
    critical_success,
    success,
    failure,
    critical_failure,
    description_html: descriptionHtml,
    description_text: htmlToText(descriptionHtml),
    action_id:        heading.action_id,
  };
}

// ─── Proficiency tier tables (Sample X Tasks) ─────────────────────────────────

/**
 * Walk every `<h3 class="title">Sample … Tasks</h3>` block and harvest the
 * inline `<b>Trained</b> task` / `<b>Expert</b> task` / … entries that follow.
 * Each entry becomes one {@link SkillProficiencyTier} record annotated with the
 * heading's action name (when discernible).
 */
export function parseProficiencyTiers(root: CheerioAPI, span: unknown): SkillProficiencyTier[] {
  const out: SkillProficiencyTier[] = [];

  (span as { find(sel: string): { each(fn: (i: number, el: AnyNode) => void): void } }).find('h3.title').each((_index: number, element: AnyNode) => {
    const $h3 = root(element);
    const heading = $h3.text().trim();
    if (!/sample\b.*\btasks?\s*$/i.test(heading)) return;

    // Action name is the substring between "Sample " and " Tasks".
    const nameMatch = /Sample\s+(.+?)\s+Tasks?\s*$/i.exec(heading);
    const action = nameMatch !== null ? (nameMatch[1] ?? '').trim() : null;

    // Walk siblings until the next heading and harvest <b>Rank</b> entries.
    const fragments: string[] = [];
    let cur: AnyNode | null = (element as Element).next as AnyNode | null;
    while (cur !== null) {
      if (cur.type === 'tag') {
        const tagName = (cur as Element).tagName.toLowerCase();
        if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3') break;
      }
      fragments.push(root.html(cur as AnyNode) ?? '');
      cur = (cur as { next: AnyNode | null }).next;
    }
    const blockHtml = fragments.join('');

    const regex = /<b>\s*([A-Za-z]+)\s*<\/b>\s*([\s\S]*?)(?=<b>|<br\s*\/?\s*>\s*<br|<h[1-6]|$)/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(blockHtml)) !== null) {
      const rankRaw = (match[1] ?? '').toLowerCase();
      if (!PROFICIENCY_RANK_SET.has(rankRaw)) continue;
      const description = htmlToText(match[2] ?? '').trim();
      if (description === '') continue;
      out.push({
        rank: rankRaw as SkillProficiencyRank | 'untrained',
        description,
        action,
      });
    }
  });

  return out;
}
