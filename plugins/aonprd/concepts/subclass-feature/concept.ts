// Subclass-feature concept — DAG nodes and concept declaration.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';
import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { ConceptDecl } from '../../taxonomy.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import { setConceptOutput } from '../_helpers.js';
import { extractSubclassFeatureBase, extractSubclassFeatureFields, extractSubclassFeatureSpells, extractSubclassFeatureFeatures } from './base.js';
import { extractSubclassFeatureMeta, finalizeSubclassFeature } from './finalize.js';
import type { SubclassFeatureOutput } from './types.js';

export type SubclassFeatureBaseOutput = 'success' | 'error';

export const subclassFeatureBaseNode: NodeInterface<ScrapeState, SubclassFeatureBaseOutput, RipperServices> = {
  name:    'extract:subclass-feature-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SubclassFeatureBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractSubclassFeatureBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type SubclassFeatureFieldsOutput = 'success' | 'error';

export const subclassFeatureFieldsNode: NodeInterface<ScrapeState, SubclassFeatureFieldsOutput, RipperServices> = {
  name:    'extract:subclass-feature-fields',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SubclassFeatureFieldsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const slice = extractSubclassFeatureFields(c);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type SubclassFeatureSpellsOutput = 'success' | 'error';

export const subclassFeatureSpellsNode: NodeInterface<ScrapeState, SubclassFeatureSpellsOutput, RipperServices> = {
  name:    'extract:subclass-feature-spells',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SubclassFeatureSpellsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const slice = extractSubclassFeatureSpells(c);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type SubclassFeatureFeaturesOutput = 'success' | 'error';

export const subclassFeatureFeaturesNode: NodeInterface<ScrapeState, SubclassFeatureFeaturesOutput, RipperServices> = {
  name:    'extract:subclass-feature-features',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SubclassFeatureFeaturesOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const slice = extractSubclassFeatureFeatures(c);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeSubclassFeatureOutput = 'success';

export const finalizeSubclassFeatureNode: NodeInterface<ScrapeState, FinalizeSubclassFeatureOutput, RipperServices> = {
  name:    'finalize:subclass-feature',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeSubclassFeatureOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };

    const meta     = { __subclass_feature_meta_marked: true as const };
    const acc = (state.output ?? {}) as unknown as SubclassFeatureOutput;
    const assembled = finalizeSubclassFeature(c, acc, acc, acc, acc, meta, $, target);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

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
