---
layout: doc
title: Markdown output
---

# Markdown output

The `markdown:write` built-in node converts fetched HTML to GitHub-Flavored Markdown (GFM) and writes a `.md` file alongside the JSON output. Use it when downstream tooling (LLM context, static-site generators, documentation systems) works better with Markdown than raw HTML or structured JSON.

## Wiring it in

Add `markdown:write` as a step in your DAG after the fetch:

```json
{
  "@type": "DAG",
  "name":  "mysite:page",
  "entrypoint": "fetch",
  "nodes": [
    {
      "@type": "SingleNode",
      "name":  "fetch",
      "node":  "html:fetch",
      "outputs": { "success": "write-md", "cached": "write-md", "error": "mysite:failed" }
    },
    {
      "@type": "SingleNode",
      "name":  "write-md",
      "node":  "markdown:write",
      "outputs": { "success": "write-json", "skipped": "write-json" }
    },
    {
      "@type": "SingleNode",
      "name":  "write-json",
      "node":  "json:write",
      "outputs": { "success": "mysite:completed", "skipped": "mysite:completed" }
    }
  ]
}
```

`markdown:write` reads `state.page.html` and `state.page.url`. When `state.page.html` is absent or empty it exits on the `skipped` port without writing anything.

## Output path

Files land under `<outDir>/<taskName>/` using the same slug logic as `json:write` — the URL path is sanitised into a filename, with `.md` appended instead of `.json`. For a URL like `https://example.com/wiki/Goblin`, the output is:

```
output/
  mysite/
    wiki/Goblin.md
    wiki/Goblin.json
```

## MarkdownConverter

`markdown:write` delegates to the static `MarkdownConverter.convert(html, baseUrl?)` method. It uses Cheerio to walk the DOM and emit GFM-compatible Markdown:

| HTML element | Markdown output |
|---|---|
| `h1`–`h6` | `#` through `######` headings |
| `p` | paragraph with blank lines around it |
| `strong`, `b` | `**bold**` |
| `em`, `i` | `_italic_` |
| `code` (inline) | `` `code` `` |
| `pre > code` | fenced code block (`` ``` ``) with detected language class |
| `blockquote` | `>` prefix lines |
| `hr` | `---` |
| `ul` | `- ` list items |
| `ol` | `1. ` numbered list items |
| `a` | `[text](url)` — relative URLs resolved against `baseUrl` |
| `img` | `![alt](src)` — relative `src` resolved against `baseUrl` |
| `table` | GFM pipe table with `|---|` separator row |
| `div`, `section` | block container — children rendered inline |

Whitespace is normalised: consecutive spaces and newlines inside text nodes collapse to a single space. Block elements are separated by blank lines.

Use `MarkdownConverter` directly when you need the conversion without writing to disk:

```ts
import { MarkdownConverter } from 'ripperoni/MarkdownConverter';

const markdown = MarkdownConverter.convert(html, 'https://example.com');
```

## JSDOM interplay

When `useJsdom: true` is set, `html:fetch` runs the HTML through JSDOM before returning — `state.page.html` already contains the post-script DOM. `markdown:write` receives that processed HTML and converts it, so script-injected content is included in the Markdown output.

## Related

- [Scrapers](/usage/scrapers): `html:fetch`, JSDOM mode
- [Authoring a DAG](/usage/pipeline): placement types and built-in nodes
- [Configuration](/usage/configuration): `baseUrl`, `useJsdom`, `output.basePath`
