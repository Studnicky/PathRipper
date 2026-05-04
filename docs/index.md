---
layout: home
title: Ripperoni
hero:
  name: Ripperoni
  text: Web ingestion engine — slices wikis, sites, and URL lists into JSON records, one page at a time.
  tagline: Point it at a wiki, a site, or a list of URLs. It slices through everything, one page at a time, and hands you the meat. The domain-specific bits are your problem — write a plugin, register it, and Ripperoni will run it against every page it finds.
  image:
    src: /ripperoni.png
    alt: Ripperoni
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Architecture
      link: /architecture
    - theme: alt
      text: GitHub
      link: https://github.com/Studnicky/PathRipper
features:
  - title: Typed Pipeline
    details: Middleware task queue with async (next, state) => void signature. Add, compose, and reorder tasks without touching anything else. State is your generic — the pipeline doesn't impose a shape.
  - title: HTML Scraper
    details: Native fetch + cheerio. No JSDOM, no headless browser unless you need one. Returns a CheerioAPI handle so you work with familiar selectors. Configurable per-target base URL and headers.
  - title: MediaWiki Scraper
    details: Native fetch against the MediaWiki JSON API. Three modes — single category, categories array, or full-wiki enumeration via allpages. Batch wikitext fetch, redirect resolution, wtf_wikipedia infobox extraction.
  - title: Link Crawler
    details: Modernized LinkLister from PathRipper. Provide domain, target, and delimiter regexes; it recursively crawls pages, deduplicates, and returns all matching links sorted naturally. Respects rate limit.
  - title: Retry + Backoff
    details: Exponential backoff with ±10% decorrelated jitter. Respects Retry-After headers. Configurable max attempts, base delay, multiplier, and ceiling.
  - title: Error Classification
    details: Classifies errors as NETWORK / THROTTLED / TIMEOUT / TRANSIENT / PERMANENT / VALIDATION / RESOURCE. Only retryable categories trigger a retry.
---
