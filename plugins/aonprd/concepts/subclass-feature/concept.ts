// Subclass-feature concept — DAG nodes and concept declaration.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';
import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../../taxonomy.js';
import type { CommonExtraction } from '../../common.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import { extractSubclassFeatureBase, extractSubclassFeatureFields, extractSubclassFeatureSpells, extractSubclassFeatureFeatures } from './base.js';
import { finalizeSubclassFeature } from './finalize.js';
import type { SubclassFeatureOutput } from './types.js';

export type SubclassFeatureBaseOutput = 'success' | 'error';

class SubclassFeatureBaseNodeImpl extends ScalarNode<ScrapeState, SubclassFeatureBaseOutput> {
  public readonly name    = 'extract:subclass-feature-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SubclassFeatureBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractSubclassFeatureBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}
export const subclassFeatureBaseNode = new SubclassFeatureBaseNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type SubclassFeatureFieldsOutput = 'success' | 'error';

class SubclassFeatureFieldsNodeImpl extends ScalarNode<ScrapeState, SubclassFeatureFieldsOutput> {
  public readonly name    = 'extract:subclass-feature-fields';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SubclassFeatureFieldsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const slice = extractSubclassFeatureFields(common);

    state.output = { ...state.output, ...slice };

    return NodeOutputBuilder.of('success');
  }
}
export const subclassFeatureFieldsNode = new SubclassFeatureFieldsNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type SubclassFeatureSpellsOutput = 'success' | 'error';

class SubclassFeatureSpellsNodeImpl extends ScalarNode<ScrapeState, SubclassFeatureSpellsOutput> {
  public readonly name    = 'extract:subclass-feature-spells';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SubclassFeatureSpellsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const slice = extractSubclassFeatureSpells(common);

    state.output = { ...state.output, ...slice };

    return NodeOutputBuilder.of('success');
  }
}
export const subclassFeatureSpellsNode = new SubclassFeatureSpellsNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type SubclassFeatureFeaturesOutput = 'success' | 'error';

class SubclassFeatureFeaturesNodeImpl extends ScalarNode<ScrapeState, SubclassFeatureFeaturesOutput> {
  public readonly name    = 'extract:subclass-feature-features';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SubclassFeatureFeaturesOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const slice = extractSubclassFeatureFeatures(common);

    state.output = { ...state.output, ...slice };

    return NodeOutputBuilder.of('success');
  }
}
export const subclassFeatureFeaturesNode = new SubclassFeatureFeaturesNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeSubclassFeatureOutput = 'success';

class FinalizeSubclassFeatureNodeImpl extends ScalarNode<ScrapeState, FinalizeSubclassFeatureOutput> {
  public readonly name    = 'finalize:subclass-feature';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeSubclassFeatureOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');

    const meta     = { __subclass_feature_meta_marked: true as const };
    const acc = (state.output ?? {}) as unknown as SubclassFeatureOutput;
    const assembled = finalizeSubclassFeature(common, acc, acc, acc, acc, meta, root, target);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}
export const finalizeSubclassFeatureNode = new FinalizeSubclassFeatureNodeImpl();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

/**
 * Subclass-feature concept declaration for the AONPRD taxonomy.
 *
 * 34 URL kinds collapse to one shared extractor, discriminated at runtime by
 * the `subclass_family` + `parent_class` fields set by extractSubclassFeatureBase.
 *
 * Imported by `plugins/aonprd/taxonomy/aonprd.ts`.
 */
export const subclassFeatureConcept: ConceptDecl<SubclassFeatureOutput> = {
  id:       'subclass-feature',
  parent:   'entity',
  urlPaths: [
    'bloodlines',
    'mysteries',
    'patrons',
    'lessons',
    'apparitions',
    'causes',
    'eidolons',
    'researchfields',
    'hybridstudies',
    'methodologies',
    'muses',
    'ways',
    'huntersedge',
    'implements',
    'consciousminds',
    'subconsciousminds',
    'rackets',
    'druidicorders',
    'instincts',
    'styles',
    'arcaneschools',
    'arcanethesis',
    'mythicdestinies',
    'ikons',
    'epithets',
    'deviantfeats',
    'heritages',
    'elements',
    'followers',
    'practices',
    'hellknightorders',
    'doctrines',
    'tenets',
    'innovations',
  ],
  capabilities: [
    subclassFeatureBaseNode,
    subclassFeatureFieldsNode,
    subclassFeatureSpellsNode,
    subclassFeatureFeaturesNode,
    finalizeSubclassFeatureNode,
  ],
};
