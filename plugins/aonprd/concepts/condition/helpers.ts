import type { CommonExtraction } from '../../common.js';
import { htmlToText } from '../../common.js';
import type { ConditionStage } from './types.js';

/** Detect inline `<b>Stage N</b>` markers in a condition body. */
export function parseConditionStages(html: string): ConditionStage[] {
  const re = /<b>\s*Stage\s*(\d+)\s*<\/b>\s*([\s\S]*?)(?=<b>\s*Stage\s*\d+\s*<\/b>|<hr|$)/gi;
  const out: ConditionStage[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const stage = parseInt(m[1] ?? '0', 10);
    const body = htmlToText(m[2] ?? '');
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
export function extractConditionStagesHelper(c: CommonExtraction) {
  const stages = parseConditionStages(c.body_html);
  const related_conditions = c.links
    .filter((l) => l.kind === 'Conditions')
    .map((l) => ({ name: l.text, condition_id: l.id }));
  return { stages, related_conditions };
}
