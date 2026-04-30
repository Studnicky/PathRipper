# docs-scraper example

Demonstrates extracting structured data from HTML documentation pages that use `section[data-component]` markup.

## What it demonstrates

- Writing a `docs:parse` plugin that operates on HTML state
- Using cheerio selectors inside a pipeline task
- Extracting `data-component` attributes and `p.summary` text for deterministic output
- The docs site at `https://studnicky.github.io/PathRipper/` is both the live documentation AND the HTML fixture for the e2e test

## Running the e2e test

The e2e test for this example scrapes the live docs site:

```
RIPPER_E2E=1 npm run test:e2e -- --test-name-pattern='docs-html'
```

## Output shape

Each section produces:

```json
{
  "_type": "docs_section",
  "component": "pipeline",
  "title": "Pipeline pattern",
  "description": "Typed async middleware chain where every task receives (next, state) and advances the queue by calling next().",
  "url": "https://studnicky.github.io/PathRipper/architecture.html"
}
```
