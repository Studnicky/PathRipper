import { Command } from 'commander';
import { readFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

import { runDagFromFiles }  from '../run/runDag.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as { version: string };

// ── Locate the project root (directory containing package.json) ───────────────
// Used by `scaffold` to resolve the committed example templates.
const PROJECT_ROOT = new URL('../../', import.meta.url).pathname;

// ── Commander program ─────────────────────────────────────────────────────────

const program = new Command();

program
  .name('ripperoni')
  .description('Configurable web scraper — HTML, MediaWiki, and link crawler.')
  .version(pkg.version);

program
  .command('run')
  .description('Execute a native DAG bundle — loads <dag>.dag.jsonld + a companion .state.json and dispatches the root DAG')
  .argument('<dag>', 'Path to the .dag.jsonld bundle file')
  .requiredOption('--state <path>', 'Path to the companion .state.json run-state file')
  .option('--out <dir>', 'Output directory override (default: ./output)')
  .action(async (dagArg: string, opts: { state: string; out?: string }): Promise<void> => {
    const dagPath   = resolve(dagArg);
    const statePath = resolve(opts.state);
    // Resolve configDir relative to the dag file's location so that
    // plugin module paths (e.g. ./plugins/MyNode.js) work from there —
    // mirroring how the legacy commands derive configDir from --config.
    const configDir = dirname(dagPath);
    const outDir    = opts.out ?? './output';

    try {
      await runDagFromFiles({ dagPath, statePath, outDir, configDir });
      process.exit(0);
    } catch (err: unknown) {
      process.stderr.write(String(err) + '\n');
      process.exit(1);
    }
  });

program
  .command('scaffold')
  .description('Write a starter <name>.dag.jsonld + <name>.state.json pair from the committed example templates')
  .argument('<name>', 'Base name for the generated pair (e.g. "mywiki" → mywiki.dag.jsonld + mywiki.state.json)')
  .action((nameArg: string): void => {
    const dagDest   = resolve(`${nameArg}.dag.jsonld`);
    const stateDest = resolve(`${nameArg}.state.json`);
    const dagSrc    = join(PROJECT_ROOT, 'ripperoni.example.dag.jsonld');
    const stateSrc  = join(PROJECT_ROOT, 'ripperoni.example.state.json');

    if (existsSync(dagDest)) {
      process.stderr.write(`scaffold: target already exists — ${dagDest}\n`);
      process.exit(1);
    }
    if (existsSync(stateDest)) {
      process.stderr.write(`scaffold: target already exists — ${stateDest}\n`);
      process.exit(1);
    }

    copyFileSync(dagSrc,   dagDest);
    copyFileSync(stateSrc, stateDest);

    process.stdout.write(`scaffold: wrote ${dagDest}\n`);
    process.stdout.write(`scaffold: wrote ${stateDest}\n`);
    process.stdout.write(`Edit the two files, then run: ripperoni run ${nameArg}.dag.jsonld --state ${nameArg}.state.json\n`);
    process.exit(0);
  });

program.parseAsync(process.argv).catch((err: unknown): never => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
