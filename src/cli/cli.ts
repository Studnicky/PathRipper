import { Command } from 'commander';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as { version: string };

const DEFAULT_CONFIG_PATH = './squashage.config.json';

const program = new Command();

program
  .name('squashage')
  .description('Graph reconstitution pipeline — classify, project, and serialize Ripperoni JSON records to RDF.')
  .version(pkg.version);

program
  .command('build')
  .description('Run the full graph reconstitution pipeline for a target')
  .requiredOption('--target <name>', 'Target name from config')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .option('--out <path>', 'Output file path override')
  .option('--format <fmt>', 'Output format override (turtle|trig|ntriples|nquads|jsonld)')
  .option('--dry-run', 'Compute report without writing output file')
  .action((_opts: { target: string; config: string; out?: string; format?: string; dryRun?: boolean }): void => {
    throw new Error('not implemented in v0.x — coming with `build`');
  });

program
  .command('classify')
  .description('Run the classification cascade on a target without projecting')
  .requiredOption('--target <name>', 'Target name from config')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .action((_opts: { target: string; config: string }): void => {
    throw new Error('not implemented in v0.x — coming with `build`');
  });

program
  .command('inspect')
  .description('Inspect a single Ripperoni JSON record through the classification cascade')
  .requiredOption('--file <path>', 'Path to a JSON record to inspect')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .action((_opts: { file: string; config: string }): void => {
    throw new Error('not implemented in v0.x — coming with `build`');
  });

program
  .command('scrape')
  .description('[REMOVED] Scrape subcommand is no longer available in squashage')
  .allowUnknownOption(true)
  .action((): void => {
    throw new Error('not implemented in v0.x — coming with `build`');
  });

program
  .command('crawl')
  .description('[REMOVED] Crawl subcommand is no longer available in squashage')
  .allowUnknownOption(true)
  .action((): void => {
    throw new Error('not implemented in v0.x — coming with `build`');
  });

program.parseAsync(process.argv).catch((err: unknown): never => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
