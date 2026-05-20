// Plugin DAG: aonprd:parse
// Decomposes the monolithic aonprd parse node into a branching sub-flow:
//   load-and-common → detect-type → branch (15 page types) → extract-<type> → terminate
// The DAG name 'aonprd:parse' matches the pipeline-config entry so existing
// user configs work without modification — the orchestrator resolves it via
// the global DAG registry instead of the node registry.
import { DAGDeriver } from '@noocodex/dagonizer/derive';
import type { DAG }   from '@noocodex/dagonizer';

/**
 * Builds the `aonprd:parse` plugin DAG.
 *
 * Shape:
 *   aonprd:load-and-common → aonprd:detect-type → {
 *     spell       → aonprd:extract-spell      → flow:terminate
 *     monster     → aonprd:extract-monster    → flow:terminate
 *     ...
 *     unknown     → aonprd:make-unknown       → flow:terminate
 *   }
 *   aonprd:load-and-common(error) → aonprd:make-unknown → flow:terminate
 *   aonprd:extract-*(error)       → aonprd:make-unknown → flow:terminate
 *
 * The DAG name 'aonprd:parse' is the pipeline-config step name — unchanged from
 * the pre-decomposition single-node version.
 *
 * @category Plugin DAGs
 * @since 3.0.0
 */
export const aonprdParseDAG: DAG = DAGDeriver.derive({
  name:       'aonprd:parse',
  version:    '1.0',
  entrypoint: 'aonprd:load-and-common',
  contracts: [
    { name: 'aonprd:load-and-common',     hardRequired: [],           produces: ['commonData'], outputs: ['success', 'error'] },
    { name: 'aonprd:detect-type',         hardRequired: ['commonData'], produces: ['pageType'], outputs: ['spell', 'monster', 'feat', 'weapon', 'armor', 'equipment', 'action', 'ancestry', 'class', 'background', 'condition', 'trait', 'hazard', 'generic', 'unknown'] },
    { name: 'aonprd:extract-spell',       hardRequired: [],           produces: [],             outputs: ['success', 'error'] },
    { name: 'aonprd:extract-monster',     hardRequired: [],           produces: [],             outputs: ['success', 'error'] },
    { name: 'aonprd:extract-feat',        hardRequired: [],           produces: [],             outputs: ['success', 'error'] },
    { name: 'aonprd:extract-weapon',      hardRequired: [],           produces: [],             outputs: ['success', 'error'] },
    { name: 'aonprd:extract-armor',       hardRequired: [],           produces: [],             outputs: ['success', 'error'] },
    { name: 'aonprd:extract-equipment',   hardRequired: [],           produces: [],             outputs: ['success', 'error'] },
    { name: 'aonprd:extract-action',      hardRequired: [],           produces: [],             outputs: ['success', 'error'] },
    { name: 'aonprd:extract-ancestry',    hardRequired: [],           produces: [],             outputs: ['success', 'error'] },
    { name: 'aonprd:extract-class',       hardRequired: [],           produces: [],             outputs: ['success', 'error'] },
    { name: 'aonprd:extract-background',  hardRequired: [],           produces: [],             outputs: ['success', 'error'] },
    { name: 'aonprd:extract-condition',   hardRequired: [],           produces: [],             outputs: ['success', 'error'] },
    { name: 'aonprd:extract-trait',       hardRequired: [],           produces: [],             outputs: ['success', 'error'] },
    { name: 'aonprd:extract-hazard',      hardRequired: [],           produces: [],             outputs: ['success', 'error'] },
    { name: 'aonprd:extract-generic',     hardRequired: [],           produces: [],             outputs: ['success', 'error'] },
    { name: 'aonprd:make-unknown',        hardRequired: [],           produces: [],             outputs: ['success'] },
    { name: 'flow:terminate',             hardRequired: [],           produces: [],             outputs: ['success'] },
  ],
  annotations: {
    terminals: {
      'aonprd:load-and-common': [
        { outcome: 'error', target: 'aonprd:make-unknown' },
      ],
      'aonprd:detect-type': [
        { outcome: 'spell',      target: 'aonprd:extract-spell'      },
        { outcome: 'monster',    target: 'aonprd:extract-monster'    },
        { outcome: 'feat',       target: 'aonprd:extract-feat'       },
        { outcome: 'weapon',     target: 'aonprd:extract-weapon'     },
        { outcome: 'armor',      target: 'aonprd:extract-armor'      },
        { outcome: 'equipment',  target: 'aonprd:extract-equipment'  },
        { outcome: 'action',     target: 'aonprd:extract-action'     },
        { outcome: 'ancestry',   target: 'aonprd:extract-ancestry'   },
        { outcome: 'class',      target: 'aonprd:extract-class'      },
        { outcome: 'background', target: 'aonprd:extract-background' },
        { outcome: 'condition',  target: 'aonprd:extract-condition'  },
        { outcome: 'trait',      target: 'aonprd:extract-trait'      },
        { outcome: 'hazard',     target: 'aonprd:extract-hazard'     },
        { outcome: 'generic',    target: 'aonprd:extract-generic'    },
        { outcome: 'unknown',    target: 'aonprd:make-unknown'       },
      ],
      'aonprd:extract-spell':      [{ outcome: 'success', target: 'flow:terminate' }, { outcome: 'error', target: 'aonprd:make-unknown' }],
      'aonprd:extract-monster':    [{ outcome: 'success', target: 'flow:terminate' }, { outcome: 'error', target: 'aonprd:make-unknown' }],
      'aonprd:extract-feat':       [{ outcome: 'success', target: 'flow:terminate' }, { outcome: 'error', target: 'aonprd:make-unknown' }],
      'aonprd:extract-weapon':     [{ outcome: 'success', target: 'flow:terminate' }, { outcome: 'error', target: 'aonprd:make-unknown' }],
      'aonprd:extract-armor':      [{ outcome: 'success', target: 'flow:terminate' }, { outcome: 'error', target: 'aonprd:make-unknown' }],
      'aonprd:extract-equipment':  [{ outcome: 'success', target: 'flow:terminate' }, { outcome: 'error', target: 'aonprd:make-unknown' }],
      'aonprd:extract-action':     [{ outcome: 'success', target: 'flow:terminate' }, { outcome: 'error', target: 'aonprd:make-unknown' }],
      'aonprd:extract-ancestry':   [{ outcome: 'success', target: 'flow:terminate' }, { outcome: 'error', target: 'aonprd:make-unknown' }],
      'aonprd:extract-class':      [{ outcome: 'success', target: 'flow:terminate' }, { outcome: 'error', target: 'aonprd:make-unknown' }],
      'aonprd:extract-background': [{ outcome: 'success', target: 'flow:terminate' }, { outcome: 'error', target: 'aonprd:make-unknown' }],
      'aonprd:extract-condition':  [{ outcome: 'success', target: 'flow:terminate' }, { outcome: 'error', target: 'aonprd:make-unknown' }],
      'aonprd:extract-trait':      [{ outcome: 'success', target: 'flow:terminate' }, { outcome: 'error', target: 'aonprd:make-unknown' }],
      'aonprd:extract-hazard':     [{ outcome: 'success', target: 'flow:terminate' }, { outcome: 'error', target: 'aonprd:make-unknown' }],
      'aonprd:extract-generic':    [{ outcome: 'success', target: 'flow:terminate' }, { outcome: 'error', target: 'aonprd:make-unknown' }],
      'aonprd:make-unknown':       [{ outcome: 'success', target: 'flow:terminate' }],
      'flow:terminate':            [{ outcome: 'success', target: null             }],
    },
  },
});
