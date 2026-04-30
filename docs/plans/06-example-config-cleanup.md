# Lane 06 — Example Config + Repo Cleanup

**Status:** Ready
**Effort:** ~20 min
**Deps:** None (Lane 07 sets the neutrality rule this lane follows)

---

## Tasks

### 1. Add `ripperoni.config.example.json`

Create at repo root. **Target-neutral only** — placeholders, no real services.

```json
{
  "output": {
    "basePath": "./output",
    "format": "json",
    "pretty": true
  },
  "mediawiki": {
    "<your-wiki-target>": {
      "apiUrl":     "https://wiki.example/w/api.php",
      "userAgent":  "MyApp/1.0 (you@example.com)",
      "rateLimitMs": 1000,
      "categories": {
        "<alias>": "Example Category Name"
      }
    }
  },
  "targets": {
    "<your-html-target>": {
      "kind":        "html",
      "baseUrl":     "https://example.com",
      "rateLimitMs": 500,
      "headers": {
        "User-Agent": "MyApp/1.0"
      },
      "outputSchema": "./schemas/<your-target>.schema.json",
      "extraction": {
        "selectors": {
          "title": "h1",
          "body":  "article"
        }
      },
      "mapping": {
        "id":   "{{ url | hash }}",
        "name": "{{ title | trim }}",
        "text": "{{ body | text }}"
      }
    }
  },
  "crawlers": {
    "<your-crawler-target>": {
      "startUrl":  "https://example.com/index",
      "domain":    "example\\.com",
      "target":    "\\?id=",
      "delimiter": "category",
      "rateLimitMs": 100
    }
  }
}
```

### 2. Remove any Jekyll `_config.yml` left in `docs/`

```bash
rm -f docs/_config.yml
```
(Already absent in current tree — verify and skip if so.)

### 3. README + docs reference the example file

Add one line to README config section:

> Copy `ripperoni.config.example.json` to `ripperoni.config.json` and edit. The
> unprefixed file is gitignored — it holds your real targets.

### 4. `.gitignore` must exclude `ripperoni.config.json`

Lane 09 owns `.gitignore`; this lane just confirms the entry is requested.

## Acceptance criteria

- [ ] `ripperoni.config.example.json` exists at repo root and is valid JSON
- [ ] All four config sections present: output, mediawiki, targets, crawlers
- [ ] Zero real target names (`grep -i 'bulbapedia\|aonprd\|serebii\|piazo\|pathfinder\|pok[ée]mon'` returns nothing)
- [ ] `docs/_config.yml` not present
- [ ] README references the example file
