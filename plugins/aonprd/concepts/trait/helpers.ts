import type { CommonExtraction } from '../../common.js';

/** Infer trait category from inbound link kinds. */
export function inferTraitCategory(c: CommonExtraction): string | null {
  // AON includes the trait's filter category (e.g. weapon/spell/creature) only
  // implicitly via the listing page; we infer from inbound link kinds.
  const linkKinds = new Set(c.links.map((l) => l.kind));
  if (linkKinds.has('Spells'))      return 'spell';
  if (linkKinds.has('Weapons'))     return 'weapon';
  if (linkKinds.has('Monsters') || linkKinds.has('Creatures')) return 'creature';
  return null;
}
