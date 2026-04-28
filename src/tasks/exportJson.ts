// Modernized from PathRipper/src/utils/exportContent.js + tasks/writeRawHTML.js

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { NextFnType } from '../pipeline/Pipeline.js';
import { Logger } from '../modules/logger/Logger.js';

const log = Logger.forComponent('exportJson');

export interface ExportStateInterface {
  readonly outputPath: string;
  readonly data: unknown;
}

export async function exportJson<TState extends ExportStateInterface>(
  next: NextFnType,
  state: TState,
): Promise<void> {
  const path = resolve(state.outputPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state.data, null, 2));
  log.info('exportJson', path);
  await next();
}
