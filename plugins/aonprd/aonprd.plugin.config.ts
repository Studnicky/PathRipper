/**
 * AONPRD plugin configuration — classifier and ontology settings extracted
 * from the run config. Zero framework imports; this is pure data.
 */

import type { DiscriminatorClassifierConfigInterface } from '../../src/nodes/record/classifiers/DiscriminatorClassifierNode.js';
import type { UrlPatternConfigInterface }              from '../../src/nodes/record/classifiers/UrlPatternClassifierNode.js';
import type { RawStructuralRuleInterface }             from '../../src/nodes/record/classifiers/StructuralClassifierNode.js';
import type { ClassifyConflictConfigInterface }        from '../../src/nodes/record/classifyConflict.js';

export interface AonprdOntologySchemaEntryInterface {
  readonly schemaPath: string;
}

export interface AonprdOntologyConfigInterface {
  readonly engine:    'json-tology';
  readonly baseIRI:   string;
  readonly schemas:   ReadonlyArray<AonprdOntologySchemaEntryInterface>;
}

export interface AonprdPluginConfigInterface {
  readonly discriminator: DiscriminatorClassifierConfigInterface;
  readonly conflict:      ClassifyConflictConfigInterface;
  readonly urlPattern:    UrlPatternConfigInterface;
  readonly structural:    ReadonlyArray<RawStructuralRuleInterface>;
  readonly ontology:      AonprdOntologyConfigInterface;
}

export const aonprdPluginConfig: AonprdPluginConfigInterface = {
  discriminator: {
    from:     '/_type',
    sanitize: 'pascalCase' as const,
    priority: 80,
  },

  conflict: {
    onConflict: 'pickPriority' as const,
    evidence:   true,
  },

  urlPattern: {
    patterns: [
      { className: 'Feat',          match: '/Feats\\.aspx',           priority: 35 },
      { className: 'Spell',         match: '/Spells\\.aspx',          priority: 35 },
      { className: 'Monster',       match: '/Monsters\\.aspx',        priority: 35 },
      { className: 'MonsterFamily', match: '/MonsterFamilies\\.aspx', priority: 35 },
      { className: 'Action',        match: '/Actions\\.aspx',         priority: 35 },
      { className: 'Weapon',        match: '/Weapons\\.aspx',         priority: 35 },
      { className: 'Armor',         match: '/Armor\\.aspx',           priority: 35 },
      { className: 'Equipment',     match: '/Equipment\\.aspx',       priority: 35 },
      { className: 'Ancestry',      match: '/Ancestries\\.aspx',      priority: 35 },
      { className: 'Class',         match: '/Classes\\.aspx',         priority: 35 },
      { className: 'Background',    match: '/Backgrounds\\.aspx',     priority: 35 },
      { className: 'Condition',     match: '/Conditions\\.aspx',      priority: 35 },
      { className: 'Trait',         match: '/Traits\\.aspx',          priority: 35 },
      { className: 'Hazard',        match: '/Hazards\\.aspx',         priority: 35 },
    ],
  },

  structural: [
    { className: 'Feat',          priority: 20, predicate: { path: '/_type', equals: 'feat' },          reasons: ['_type=feat'] },
    { className: 'Spell',         priority: 20, predicate: { path: '/_type', equals: 'spell' },         reasons: ['_type=spell'] },
    { className: 'Monster',       priority: 20, predicate: { path: '/_type', equals: 'monster' },       reasons: ['_type=monster'] },
    { className: 'Action',        priority: 20, predicate: { path: '/_type', equals: 'action' },        reasons: ['_type=action'] },
    { className: 'Weapon',        priority: 20, predicate: { path: '/_type', equals: 'weapon' },        reasons: ['_type=weapon'] },
    { className: 'Armor',         priority: 20, predicate: { path: '/_type', equals: 'armor' },         reasons: ['_type=armor'] },
    { className: 'Equipment',     priority: 20, predicate: { path: '/_type', equals: 'equipment' },     reasons: ['_type=equipment'] },
    { className: 'Ancestry',      priority: 20, predicate: { path: '/_type', equals: 'ancestry' },      reasons: ['_type=ancestry'] },
    { className: 'Class',         priority: 20, predicate: { path: '/_type', equals: 'class' },         reasons: ['_type=class'] },
    { className: 'Background',    priority: 20, predicate: { path: '/_type', equals: 'background' },    reasons: ['_type=background'] },
    { className: 'Condition',     priority: 20, predicate: { path: '/_type', equals: 'condition' },     reasons: ['_type=condition'] },
    { className: 'Trait',         priority: 20, predicate: { path: '/_type', equals: 'trait' },         reasons: ['_type=trait'] },
    { className: 'Hazard',        priority: 20, predicate: { path: '/_type', equals: 'hazard' },        reasons: ['_type=hazard'] },
    { className: 'Generic',       priority: 10, predicate: { path: '/_type', equals: 'generic' },       reasons: ['_type=generic'] },
  ],

  ontology: {
    engine:  'json-tology' as const,
    baseIRI: 'https://2e.aonprd.com/',
    schemas: [
      { schemaPath: './schemas/Action.schema.json' },
      { schemaPath: './schemas/Ancestry.schema.json' },
      { schemaPath: './schemas/Armor.schema.json' },
      { schemaPath: './schemas/Background.schema.json' },
      { schemaPath: './schemas/Class.schema.json' },
      { schemaPath: './schemas/Condition.schema.json' },
      { schemaPath: './schemas/Equipment.schema.json' },
      { schemaPath: './schemas/Feat.schema.json' },
      { schemaPath: './schemas/Generic.schema.json' },
      { schemaPath: './schemas/Hazard.schema.json' },
      { schemaPath: './schemas/Monster.schema.json' },
      { schemaPath: './schemas/MonsterFamily.schema.json' },
      { schemaPath: './schemas/Shield.schema.json' },
      { schemaPath: './schemas/Spell.schema.json' },
      { schemaPath: './schemas/Trait.schema.json' },
      { schemaPath: './schemas/Rule.schema.json' },
      { schemaPath: './schemas/Unknown.schema.json' },
      { schemaPath: './schemas/Weapon.schema.json' },
    ],
  },
} as const;
