<p align="center"><a href="https://studnicky.github.io/Ripperoni/"><img src="https://raw.githubusercontent.com/Studnicky/Ripperoni/master/docs/public/og-image.png" alt="Ripperoni: web ingestion engine that slices wikis, sites, and URL lists into JSON records" width="1200" /></a></p>

# @studnicky/ripperoni

> Web ingestion engine: point it at a wiki, a site, or a URL list and it slices everything into typed JSON records, one page at a time — each run a native dagonizer DAG.

[![CI](https://github.com/Studnicky/Ripperoni/actions/workflows/ci.yml/badge.svg)](https://github.com/Studnicky/Ripperoni/actions/workflows/ci.yml)
[![docs](https://img.shields.io/badge/docs-studnicky.github.io-c8284a)](https://studnicky.github.io/Ripperoni/)
[![node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](package.json)
[![version](https://img.shields.io/badge/version-3.2.0-c8284a)](CHANGELOG.md)

## Documentation

The full documentation is published at **https://studnicky.github.io/Ripperoni/**.

- [Getting Started](https://studnicky.github.io/Ripperoni/getting-started): scaffold → state → run
- [Walk-through](https://studnicky.github.io/Ripperoni/walk-through): a complete AONPRD scrape end to end
- [Authoring a DAG](https://studnicky.github.io/Ripperoni/usage/pipeline): `DAGBuilder`, placement types, builtin nodes
- [Configuration](https://studnicky.github.io/Ripperoni/usage/configuration): the `state.json` run document
- [Plugins](https://studnicky.github.io/Ripperoni/usage/plugins): declare DAGs as documents + register nodes
- [Crawler](https://studnicky.github.io/Ripperoni/usage/crawler): the native embedded `crawl:discover` DAG
- [Architecture](https://studnicky.github.io/Ripperoni/architecture): the runner, services, and scrapers
- [DAG Diagrams](https://studnicky.github.io/Ripperoni/diagrams): the live orchestration / crawl / page DAGs

## How it works

A scrape is two authored documents — a single orchestration `<name>.dag.jsonld` and a `<name>.state.json` — run by one command. The orchestration imports plugin DAGs as embedded-dag / scatter; plugins ship their DAGs as JSON-LD documents and register their node instances. Built on [`@studnicky/dagonizer`](https://github.com/Studnicky/Dagonizer); output feeds [Squashage](https://github.com/Studnicky/Squashage), which graph-squashes the JSON into deterministic RDF.

## Requirements

Node.js >= 24 (matches `engines.node` in `package.json`).

## Install

Published to GitHub Packages under the `@studnicky` scope:

```bash
echo '@studnicky:registry=https://npm.pkg.github.com' >> .npmrc
npm install @studnicky/ripperoni
```

## Quick start

```bash
# write a starter orchestration + state pair
ripperoni scaffold mysite

# edit mysite.dag.jsonld + mysite.state.json, then run it
ripperoni run mysite.dag.jsonld --state mysite.state.json
```

## License

MIT. See [LICENSE](./LICENSE).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) and the [GitHub releases](https://github.com/Studnicky/Ripperoni/releases).
