import type { CommonExtraction } from '../../common.js';
import { htmlToText } from '../../common.js';
import type { ConditionStage } from './types.js';

/** Detect inline `<b>Stage N</b>` markers in a condition body. */
export function parseConditionStages(html: string): ConditionStage[] {
  const regex = /<b>\s*Stage\s*(\d+)\s*<\/b>\s*([\s\S]*?)(?=<b>\s*Stage\s*\d+\s*<\/b>|<hr|$)/gi;
  const out: ConditionStage[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const stage = parseInt(match[1] ?? '0', 10);
    const body = htmlToText(match[2] ?? '');
    const durMatch = /\(([^)]+(?:day|round|hour|minute)[^)]*)\)/i.exec(body);
    out.push({
      stage,
      text:     body,
      duration: durMatch !== null ? durMatch[1]!.trim() : null,
    });
  }
  return out;
}

/** Extract stage progression + related-condition cross-references. */
export function extractConditionStagesHelper(common: CommonExtraction) {
  const stages = parseConditionStages(common.body_html);
  const related_conditions = common.links
    .filter((link) => link.kind === 'Conditions')
    .map((link) => ({ name: link.text, condition_id: link.id }));
  return { stages, related_conditions };
}
