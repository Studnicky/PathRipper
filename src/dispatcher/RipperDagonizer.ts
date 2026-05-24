import { Dagonizer } from '@noocodex/dagonizer';
import type { ExecutionResultInterface, NodeStateInterface } from '@noocodex/dagonizer';

import { Logger } from '../modules/logger/logger.js';
import type { RipperServices } from '../services/RipperServices.js';

const log = Logger.forComponent('Dispatcher');

export interface RipperDagonizerOptionsInterface {
  readonly services: RipperServices;
  /** @deprecated Wave-2 will remove this field. Observer layer eliminated. */
  readonly observer?: unknown;
  /**
   * When `true` (default `false`), contract warnings surfaced during
   * `registerDAG` are also retained on the instance and exposed via
   * `contractWarnings()`. Tests use this to assert "no warnings" or to
   * inspect the warning text. Production callers normally rely on the
   * logger output and leave this off.
   */
  readonly collectContractWarnings?: boolean;
}

/**
 * `Dagonizer` subclass that logs the five lifecycle hooks directly via a
 * component-scoped `Logger`. No observer interface, no injected callback.
 *
 * Overrides `onContractWarning` to surface `ContractRegistryValidator`
 * dead-write warnings via the project logger. Optionally retains warnings on
 * the instance for test inspection via `collectContractWarnings: true`.
 *
 * @category Dispatcher
 * @since 4.0.0
 */
export class RipperDagonizer<TState extends NodeStateInterface>
  extends Dagonizer<TState, RipperServices> {

  readonly #collectContractWarnings: boolean;
  readonly #contractWarnings: string[] = [];

  constructor(options: RipperDagonizerOptionsInterface) {
    super({ services: options.services });
    this.#collectContractWarnings = options.collectContractWarnings ?? false;
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

  /**
   * Surface `ContractRegistryValidator` dead-write warnings.
   *
   * `Dagonizer.registerDAG` runs `ContractRegistryValidator.validate` for
   * every DAG derived from a node registry. Dangling reads throw
   * `DAGError`; dead writes are non-fatal and routed here. We log them
   * via the project logger and (optionally) retain them for test
   * inspection.
   */
  protected override onContractWarning(message: string): void {
    log.warn('contract-warning', message);
    if (this.#collectContractWarnings) {
      this.#contractWarnings.push(message);
    }
  }

  /**
   * Snapshot of contract warnings collected since construction. Returns an
   * empty array when `collectContractWarnings` was not enabled, regardless
   * of how many warnings were logged.
   */
  contractWarnings(): readonly string[] {
    return [...this.#contractWarnings];
  }
}
