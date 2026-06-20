// Minimal built-in HTTP server that serves pre-built MediaWiki API JSON
// for the ripperoni documentation fixture. Uses node:http only — no external deps.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseQs } from 'node:querystring';

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'data');

export interface WikiFixtureServerInterface {
  readonly port: number;
  readonly baseUrl: string;
  close(): Promise<void>;
}

async function readJson(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw) as unknown;
}

function titleToFilename(title: string): string {
  return title.toLowerCase().replace(/\s+/g, '') + '.json';
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = req.url ?? '/';
  const qstart = raw.indexOf('?');
  const queryStr = qstart >= 0 ? raw.slice(qstart + 1) : '';
  const params = parseQs(queryStr) as Record<string, string | string[]>;

  function param(key: string): string {
    const val = params[key];
    return Array.isArray(val) ? (val[0] ?? '') : (val ?? '');
  }

  const action = param('action');
  const list   = param('list');
  const prop   = param('prop');

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (action !== 'query') {
    res.writeHead(400);
    res.end(JSON.stringify({ error: { code: 'unknown_action', info: `Unknown action: ${action}` } }));
    return;
  }

  // action=query&list=categorymembers → return categorymembers.json
  if (list === 'categorymembers') {
    try {
      const data = await readJson(resolve(DATA_DIR, 'categorymembers.json'));
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'categorymembers fixture not found' }));
    }
    return;
  }

  // action=query&list=allpages → return allpages.json
  if (list === 'allpages') {
    try {
      const data = await readJson(resolve(DATA_DIR, 'allpages.json'));
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'allpages fixture not found' }));
    }
    return;
  }

  // action=query&prop=revisions&titles=... → look up each title, merge pages
  if (prop === 'revisions') {
    const rawTitles = param('titles');
    const titles = rawTitles.split('|').map((str: string): string => str.trim()).filter(Boolean);

    const merged: Record<string, unknown> = {};
    let nextPageid = 1;

    for (const title of titles) {
      const filename = titleToFilename(title);
      const filePath = resolve(DATA_DIR, 'pages', filename);
      try {
        const data = await readJson(filePath) as { query?: { pages?: Record<string, unknown> } };
        const pages = data.query?.pages ?? {};
        for (const [key, page] of Object.entries(pages)) {
          merged[key] = page;
        }
      } catch {
        // Title not found: return a missing page entry
        const missingId = (-nextPageid).toString();
        nextPageid++;
        merged[missingId] = { pageid: -nextPageid, ns: 0, title, missing: '' };
      }
    }

    res.writeHead(200);
    res.end(JSON.stringify({ query: { pages: merged } }));
    return;
  }

  res.writeHead(400);
  res.end(JSON.stringify({ error: { code: 'unknown_query', info: `Unknown list/prop combination` } }));
}

export async function startWikiFixtureServer(): Promise<WikiFixtureServerInterface> {
  return new Promise<WikiFixtureServerInterface>((resolveP, rejectP) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse): void => {
      handleRequest(req, res).catch((err: unknown): void => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(err) }));
      });
    });

    server.once('error', rejectP);

    // Bind to port 0 to let the OS assign a free port
    server.listen(0, '127.0.0.1', (): void => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        rejectP(new Error('Unexpected server address type'));
        return;
      }
      const port    = addr.port;
      const baseUrl = `http://127.0.0.1:${port.toString()}`;

      resolveP({
        port,
        baseUrl,
        close(): Promise<void> {
          return new Promise<void>((res2, rej2): void => {
            server.close((err: Error | undefined): void => {
              if (err !== undefined) rej2(err);
              else res2();
            });
          });
        },
      });
    });
  });
}
