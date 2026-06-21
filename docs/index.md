---
layout: doc
title: Ripperoni
---

<div style="text-align:center;padding:2rem 0 1rem">
  <img src="/ripperoni.png" alt="Ripperoni" style="max-width:120px;margin:0 auto 1rem" />
  <h1 style="font-size:2.5rem;font-weight:700;margin:0.5rem 0">Ripperoni</h1>
  <p style="font-size:1.2rem;color:var(--vp-c-text-2);max-width:600px;margin:0 auto 1.5rem">Web ingestion engine. Point it at a wiki, a site, or a URL list — it grinds raw pages into clean cuts of structured JSON, one prime cut per record.</p>
  <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;margin-bottom:2rem">
    <a href="/Ripperoni/getting-started" class="VPButton medium brand" style="text-decoration:none;padding:0.5rem 1.25rem;border-radius:4px;background:var(--vp-button-brand-bg);color:var(--vp-button-brand-text);font-weight:500">Get started</a>
    <a href="/Ripperoni/walk-through" class="VPButton medium brand" style="text-decoration:none;padding:0.5rem 1.25rem;border-radius:4px;background:var(--vp-button-brand-bg);color:var(--vp-button-brand-text);font-weight:500">Walk-through</a>
    <a href="/Ripperoni/architecture" class="VPButton medium alt" style="text-decoration:none;padding:0.5rem 1.25rem;border-radius:4px;background:var(--vp-button-alt-bg);color:var(--vp-button-alt-text);font-weight:500">Architecture</a>
    <a href="https://github.com/Studnicky/Ripperoni" class="VPButton medium alt" style="text-decoration:none;padding:0.5rem 1.25rem;border-radius:4px;background:var(--vp-button-alt-bg);color:var(--vp-button-alt-text);font-weight:500">GitHub</a>
  </div>
</div>

Feed it a domain, hand it a plugin (a module that extracts structured data from a page), and Ripperoni fetches pages, runs your plugin against each one, and writes clean JSON records to disk.

A run has three artifacts:

1. **Plugin** in `plugins/<namespace>/`: `ScalarNode` subclasses + `*.dag.jsonld` documents + `index.ts` that exports `register(dispatcher)`.
2. **Orchestration** `<name>.dag.jsonld`: one dagonizer DAG (JSON-LD) that wires the run — embedding the built-in `crawl:discover` DAG and scattering over collected URLs via the plugin's per-page DAG.
3. **State** `<name>.state.json`: run parameters (baseUrl, cache, output, headers, crawler block, rate limits, parallelism) validated at startup by `RunStateSchema`.

Run with: `ripperoni run <orchestration>.dag.jsonld --state <run>.state.json`

- **DAG execution.** Every scrape runs as a directed acyclic graph (DAG) — a structured execution plan where steps run in dependency order — powered by [@studnicky/dagonizer](https://github.com/Studnicky/Dagonizer). Placement types (`ScalarNode`, `ScatterNode`, `EmbeddedDAGNode`, `TerminalNode`) compose at the document level; add or rearrange stages without touching anything else.
- **HTML scraper.** Native fetch + cheerio. Returns a `CheerioAPI` handle; work with selectors you already know.
- **Link crawler.** The built-in `crawl:discover` DAG walks pages matching on domain/target/delimiter regexes — follows links all the way to the end of the casing. Deduplicates, sorts naturally, respects rate limits. Embed it in any orchestration via `EmbeddedDAGNode { dag: "crawl:discover" }`.
- **Retry + backoff.** Exponential backoff with decorrelated jitter. Respects `Retry-After` headers. Classifies errors as `NETWORK / THROTTLED / TIMEOUT / TRANSIENT / PERMANENT` and retries until the record lands clean.

## Quick install

```bash
git clone https://github.com/Studnicky/Ripperoni.git
cd Ripperoni && npm install && npm run build
```

## Next steps

- [Walk-through](./walk-through): end-to-end example with a real URL, orchestration, plugin, and output record
- [Getting started](./getting-started): install, scaffold, and first run
- [Architecture](./architecture): DAG topology, package boundaries, extension points
