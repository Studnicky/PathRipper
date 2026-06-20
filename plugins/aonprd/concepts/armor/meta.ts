// Extract armor meta slice (hardness, hp_bt, description).

import type { CommonExtraction } from '../../common.js';
import { getField, asInt } from '../../common.js';
import type { ArmorMetaSlice } from './types.js';
import { dashToNull, buildDescription } from './helpers.js';

/** Extract armor meta slice. */
export function extractArmorMeta(common: CommonExtraction): ArmorMetaSlice {
  const description = buildDescription(common.body_html);
  return {
    hardness:         asInt(dashToNull(getField(common, 'Hardness'))),
    hp_bt:            asInt(dashToNull(getField(common, 'HP (BT)', 'HP'))),
    description_html: description.html,
    description_text: description.text,
  };
}
