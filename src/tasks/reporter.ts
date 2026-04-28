// Modernized from PathRipper/src/tasks/reporter.js
// Error-boundary task — wraps remaining pipeline, writes report on failure.

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { NextFnType } from '../pipeline/Pipeline.js';
import { Logger } from '../modules/logger/Logger.js';

const log = Logger.forComponent('reporter');

export interface ReporterStateInterface {
  readonly reportPath?: string | undefined;
  error?: { message: string; stack: string[] } | undefined;
}

export async function reporter<TState extends ReporterStateInterface>(
  next: NextFnType,
  state: TState,
): Promise<void> {
  try {
    await next();
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    log.error('reporter', e.message);
    state.error = {
      message: e.message,
      stack:   (e.stack ?? '').split('\n'),
    };
  }

  if (state.reportPath !== undefined) {
    const path = resolve(state.reportPath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(state, null, 2));
    log.info('reporter', `Report written to ${path}`);
  }
}
