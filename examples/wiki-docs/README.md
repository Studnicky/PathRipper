# wiki-docs example

Demonstrates extracting structured component metadata from MediaWiki pages that use the `{{RipperoniComponent}}` infobox template.

## What it demonstrates

- Writing a `wiki-docs:parse` plugin that operates on wikitext state
- Using `wtf_wikipedia` template parsing inside a pipeline task
- The fixture server in `tests/e2e/fixtures/wiki/` provides a self-contained MediaWiki API mock — no external network required

## Running the e2e test

The e2e test uses the local fixture server (no external network):

```
npm run test:e2e -- --test-name-pattern='wiki-docs'
```

## Template format

Pages should use the `{{RipperoniComponent}}` infobox:

```wikitext
{{RipperoniComponent
|name=Pipeline
|kind=Core
|since=2.0.0
|description=Typed async middleware chain. Tasks receive (next, state) and advance via next().
|source=src/pipeline/Pipeline.ts
}}
```

## Output shape

```json
{
  "_type": "ripperoni_component",
  "name": "Pipeline",
  "kind": "Core",
  "since": "2.0.0",
  "description": "Typed async middleware chain. Tasks receive (next, state) and advance via next().",
  "source": "src/pipeline/Pipeline.ts"
}
```
