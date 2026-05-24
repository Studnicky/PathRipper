//
// Byte-equivalent to Wave 5 ArmorOutput shape.
// URL paths: ['armor', 'shields'] — both Armor.aspx and Shields.aspx pages
// use the same structure and ArmorOutput shape.

export type {
  WeaponOutput,
  ArmorOutput,
  EquipmentVariant,
  Activation,
  EquipmentOutput,
  WeaponBaseSlice,
  WeaponMechanicsSlice,
  WeaponMetaSlice,
  ArmorBaseSlice,
  ArmorMechanicsSlice,
  ArmorMetaSlice,
  EquipmentBaseSlice,
  EquipmentMechanicsSlice,
  EquipmentMetaSlice,
} from './types.js';

export {
  isDash,
  dashToNull,
  parsePrice,
  parseBulk,
  parseDamage,
  parseRange,
  parseTraitGlossary,
  buildDescription,
  readGroupAnchor,
  parseActivation,
  parseFavoredWeapon,
  parseCriticalSpec,
  parseSpecificMagicWeapons,
} from './helpers.js';

export { extractArmorBase } from './base.js';
export { extractArmorMechanics } from './mechanics.js';
export { extractArmorMeta } from './meta.js';
export { finalizeArmor, extractArmor } from './finalize.js';
export { armorConcept, armorBaseNode, armorMechanicsNode, finalizeArmorNode } from './concept.js';
