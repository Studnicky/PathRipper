// TODO: replaced by F3
export interface OutputConfigInterface {
  kind: 'file';
  path: string;
  format?: string;
  mode?: 'dataset' | 'stream';
  prefixes?: Record<string, string>;
  baseIRI?: string;
  graph?: string;
  canonicalize?: boolean;
  validate?: { shapes: string };
  dryRun?: boolean;
}
