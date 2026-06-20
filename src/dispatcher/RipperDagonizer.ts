import { Dagonizer } from '@studnicky/dagonizer';
import type { ExecutionResultType, NodeStateInterface } from '@studnicky/dagonizer';

import { Logger } from '../modules/logger/logger.js';
import type { RipperServices } from '../services/RipperServices.js';

const log = Logger.forComponent('Dispatcher');

export interface RipperDagonizerOptionsInterface {
  readonly services: RipperServices;
}

/**
 * `Dagonizer` subclass that logs the lifecycle hooks directly via a
 * component-scoped `Logger`. No observer interface, no injected callback.
 *
 * Contract dead-writes raise a hard `DAGError` at `registerDAG`/`derive` time;
 * there is no non-fatal warning hook, so no contract-warning surface lives here.
 *
 * @category Dispatcher
 * @since 4.0.0
 */
export class RipperDagonizer<TState extends NodeStateInterface>
  extends Dagonizer<TState, RipperServices> {

  constructor(options: RipperDagonizerOptionsInterface) {
    super({ services: options.services });
  }

  protected override onFlowStart(dagName: string, _state: TState): void {
    log.info('flow-start', `DAG '${dagName}' started`);
  }

  protected override onFlowEnd(
    dagName: string,
    state:   TState,
    _result: ExecutionResultType<TState>,
  ): void {
    log.info('flow-end', `DAG '${dagName}' ended: ${state.lifecycle.variant}`);
  }

  protected override onNodeStart(nodeName: string, _state: TState): void {
    log.debug('node-start', `Node '${nodeName}' started`);
  }

  protected override onNodeEnd(
    nodeName: string,
    output:   string | null,
    _state:   TState,
  ): void {
    log.debug('node-end', `Node '${nodeName}' returned: ${output ?? '<skipped>'}`);
  }

  protected override onError(nodeName: string, error: Error, _state: TState): void {
    log.error('node-error', `Node '${nodeName}' threw: ${error.message}`, { stack: error.stack });
  }
}
