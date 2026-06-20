// extract:deity-devotee-benefits slice — divine attribute, font, sanctification, skill, favored weapon, domains.

import type { CommonExtraction } from '../../common.js';
import {
  harvestLinkedBoldLabels,
  findSectionBody,
  parseLinkedList,
} from './helpers.js';
import type { DeityDevoteeBenefitsSlice } from './types.js';

export function extractDeityDevoteeBenefits(common: CommonExtraction): DeityDevoteeBenefitsSlice {
  const body = findSectionBody(common, 'Devotee Benefits');
  const map = harvestLinkedBoldLabels(body);
  return {
    divine_attribute:      map.get('divine attribute')      ?? null,
    divine_font:           map.get('divine font')           ?? null,
    divine_sanctification: map.get('divine sanctification') ?? null,
    divine_skill:          map.get('divine skill')          ?? null,
    favored_weapon:        map.get('favored weapon')        ?? null,
    domains:               parseLinkedList(map.get('domains') ?? null),
    alternate_domains:     parseLinkedList(map.get('alternate domains') ?? null),
  };
}
