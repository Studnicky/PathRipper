import { Dagonizer } from '@noocodex/dagonizer';
import type { ExecutionResultInterface, NodeStateInterface } from '@noocodex/dagonizer';

import { Logger } from '../modules/logger/logger.js';
import type { RipperServices } from '../services/RipperServices.js';

const log = Logger.forComponent('Dispatcher');

export interface RipperDagonizerOptionsInterface {
  readonly services: RipperServices;
  /** @deprecated Wave-2 will remove this field. Observer layer eliminated. */
  readonly observer?: unknown;
}

/**
 * `Dagonizer` subclass that logs the five lifecycle hooks directly via a
 * component-scoped `Logger`. No observer interface, no injected callback.
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
    _result: ExecutionResultInterface<TState>,
  ): void {
    log.info('flow-end', `DAG '${dagName}' ended: ${state.lifecycle.kind}`);
  }

  protected override onNodeStart(nodeName: string, _state: TState): void {
    log.debug('node-start', `Node '${nodeName}' started`);
  }

  protected override onNodeEnd(
    nodeName: string,
    output:   string | undefined,
    _state:   TState,
  ): void {
    log.debug('node-end', `Node '${nodeName}' returned: ${output ?? '<skipped>'}`);
  }

  protected override onError(nodeName: string, error: Error, _state: TState): void {
    log.error('node-error', `Node '${nodeName}' threw: ${error.message}`, { stack: error.stack });
  }
}
