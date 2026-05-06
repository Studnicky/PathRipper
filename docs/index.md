---
layout: doc
title: Ripperoni
---

<div style="text-align:center;padding:2rem 0 1rem">
  <img src="/ripperoni.png" alt="Ripperoni" style="max-width:120px;margin:0 auto 1rem" />
  <h1 style="font-size:2.5rem;font-weight:700;margin:0.5rem 0">Ripperoni</h1>
  <p style="font-size:1.2rem;color:var(--vp-c-text-2);max-width:600px;margin:0 auto 1.5rem">Web ingestion engine — slices wikis, sites, and URL lists into JSON records, one page at a time. Point it at a wiki, a site, or a list of URLs and it hands you the meat.</p>
  <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;margin-bottom:2rem">
    <a href="/Ripperoni/getting-started" class="VPButton medium brand" style="text-decoration:none;padding:0.5rem 1.25rem;border-radius:4px;background:var(--vp-button-brand-bg);color:var(--vp-button-brand-text);font-weight:500">Get started</a>
    <a href="/Ripperoni/walk-through" class="VPButton medium brand" style="text-decoration:none;padding:0.5rem 1.25rem;border-radius:4px;background:var(--vp-button-brand-bg);color:var(--vp-button-brand-text);font-weight:500">Walk-through</a>
    <a href="/Ripperoni/architecture" class="VPButton medium alt" style="text-decoration:none;padding:0.5rem 1.25rem;border-radius:4px;background:var(--vp-button-alt-bg);color:var(--vp-button-alt-text);font-weight:500">Architecture</a>
    <a href="https://github.com/Studnicky/Ripperoni" class="VPButton medium alt" style="text-decoration:none;padding:0.5rem 1.25rem;border-radius:4px;background:var(--vp-button-alt-bg);color:var(--vp-button-alt-text);font-weight:500">GitHub</a>
  </div>
</div>

Point it at a domain. Hand it a plugin. It fetches pages, runs your plugin against each one, and drops structured JSON records on disk.

- **Typed pipeline.** Middleware task queue with `async (next, state) => void` signature. Add, compose, and reorder tasks without touching anything else.
- **HTML scraper.** Native fetch + cheerio. No JSDOM, no headless browser. Returns a `CheerioAPI` handle so you work with familiar selectors.
- **MediaWiki scraper.** Native fetch against the MediaWiki JSON API. Three modes — single category, categories array, or full-wiki enumeration. Batch wikitext fetch, redirect resolution, `wtf_wikipedia` infobox extraction.
- **Link crawler.** Recursively crawls pages matching domain/target/delimiter regexes. Deduplicates, sorts naturally, respects rate limit.
- **Retry + backoff.** Exponential backoff with decorrelated jitter. Respects `Retry-After` headers. Classifies errors as `NETWORK / THROTTLED / TIMEOUT / TRANSIENT / PERMANENT`.

## Quick install

```bash
git clone https://github.com/Studnicky/Ripperoni.git
cd Ripperoni && npm install && npm run build
```

## Where to look next

- [Walk-through](./walk-through) — end-to-end example with a real URL, config, plugin, and output record
- [Getting started](./getting-started) — install and first run
- [Architecture](./architecture) — pipeline phases, package boundaries, extension points
