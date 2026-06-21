/**
 * generate-dag.mjs — DAG bundle + RunState pair generator.
 *
 * Builds .dag.jsonld + .state.json pairs for every committed target config.
 * Run with: node --import tsx scripts/generate-dag.mjs
 *
 * No framework dependencies — pure build-time script using the same DAG
 * builder functions the runtime uses, ensuring generated bundles are
 * structurally identical to what `runDag` would build at startup.
 */

import { buildHtmlPageFlow, htmlPageFlowName } from '../src/flows/htmlPageFlow.js';
import { buildWikiPageFlow, wikiPageFlowName }  from '../src/flows/wikiPageFlow.js';
import {
  buildHtmlScrapePhaseDag,
  buildHtmlRetryPhaseDag,
  buildHtmlCrawlPhaseDag,
  buildHtmlScrapeDag,
  buildHtmlScrapeDagCrawl,
} from '../src/flows/htmlScrapeDag.js';
import {
  buildWikiScrapePhaseDag,
  buildWikiRetryPhaseDag,
  buildWikiScrapeDag,
} from '../src/flows/wikiScrapeDag.js';
import { aonprdParseDAG }  from '../plugins/aonprd/parse.dag.js';
import { docsParseFlow }   from '../examples/docs-scraper/plugin.js';
import { wikiDocsParseFlow } from '../examples/wiki-docs/plugin.js';
import { DAGDocument }     from '@studnicky/dagonizer';
import { RunStateSchema }  from '../src/schemas/internal/RunStateSchema.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath }   from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── DagBundle ─────────────────────────────────────────────────────────────────

/**
 * Builds typed DAG bundles (arrays of DAGType) for each target variant.
 *
 * Each method returns a `{ dags, state }` pair ready for BundleWriter.write.
 */
class DagBundle {
  /**
   * HTML target, no crawl (pipeline does NOT contain `crawl:list-targets`).
   *
   * Bundle order: perPage → scrapePhase → retryPhase → pluginDag → outerDag
   * The outer DAG is the root (nothing references it).
   */
  static forHtml(targetId, pipeline, pluginDag, pluginDagName, state) {
    const pluginNames = new Set([pluginDagName]);
    const perPageDag  = buildHtmlPageFlow(pipeline, targetId, pluginNames);
    const perPageName = htmlPageFlowName(targetId);

    const scrapePhaseDag = buildHtmlScrapePhaseDag(perPageName);
    const retryPhaseDag  = buildHtmlRetryPhaseDag(perPageName);
    const outerDag       = buildHtmlScrapeDag();

    return {
      dags:  [perPageDag, scrapePhaseDag, retryPhaseDag, pluginDag, outerDag],
      state,
    };
  }

  /**
   * HTML target, WITH crawl (pipeline contains `crawl:list-targets`).
   *
   * Bundle order: perPage → crawlPhase → scrapePhase → retryPhase → pluginDag → outerDagCrawl
   */
  static forHtmlCrawl(targetId, pipeline, pluginDag, pluginDagName, state) {
    const pluginNames = new Set([pluginDagName]);
    const perPageDag  = buildHtmlPageFlow(pipeline, targetId, pluginNames);
    const perPageName = htmlPageFlowName(targetId);

    const crawlPhaseDag  = buildHtmlCrawlPhaseDag();
    const scrapePhaseDag = buildHtmlScrapePhaseDag(perPageName);
    const retryPhaseDag  = buildHtmlRetryPhaseDag(perPageName);
    const outerDag       = buildHtmlScrapeDagCrawl();

    return {
      dags:  [perPageDag, crawlPhaseDag, scrapePhaseDag, retryPhaseDag, pluginDag, outerDag],
      state,
    };
  }

  /**
   * Wiki target (MediaWiki Action API scrape).
   *
   * Bundle order: perPage → scrapePhase → retryPhase → pluginDag → outerDag
   */
  static forWiki(targetId, pipeline, pluginDag, pluginDagName, state) {
    const pluginNames = new Set([pluginDagName]);
    const perPageDag  = buildWikiPageFlow(pipeline, targetId, pluginNames);
    const perPageName = wikiPageFlowName(targetId);

    const scrapePhaseDag = buildWikiScrapePhaseDag(perPageName);
    const retryPhaseDag  = buildWikiRetryPhaseDag(perPageName);
    const outerDag       = buildWikiScrapeDag();

    return {
      dags:  [perPageDag, scrapePhaseDag, retryPhaseDag, pluginDag, outerDag],
      state,
    };
  }

  /**
   * HTML target where the plugin DAG name is not pre-built (unknown plugin).
   *
   * The per-page flow treats the unknown name as an embedded DAG reference;
   * no plugin DAG object is included in the bundle.
   */
  static forHtmlUnknownPlugin(targetId, pipeline, pluginDagName, state) {
    const pluginNames = new Set([pluginDagName]);
    const perPageDag  = buildHtmlPageFlow(pipeline, targetId, pluginNames);
    const perPageName = htmlPageFlowName(targetId);

    const scrapePhaseDag = buildHtmlScrapePhaseDag(perPageName);
    const retryPhaseDag  = buildHtmlRetryPhaseDag(perPageName);
    const outerDag       = buildHtmlScrapeDag();

    return {
      dags:  [perPageDag, scrapePhaseDag, retryPhaseDag, outerDag],
      state,
    };
  }
}

// ── BundleValidator ───────────────────────────────────────────────────────────

/**
 * Validates a bundle before writing to disk.
 *
 * Checks:
 *   1. State passes RunStateSchema.
 *   2. Exactly one root DAG (name not referenced by any other element).
 *
 * The `DAGType.nodes` array holds JSON-LD node placement objects.
 * Node `@type` values: `EmbeddedDAGNode` has a `dag` field (the referenced DAG name);
 * `ScatterNode` has a `body.dag` field when the scatter dispatches a sub-DAG.
 *
 * Throws on any violation so generation fails fast with a clear message.
 */
class BundleValidator {
  static validate(name, bundle) {
    const stateErrors = RunStateSchema.validate(bundle.state);
    if (stateErrors !== null) {
      throw new Error(`[${name}] RunState validation failed:\n  ${stateErrors}`);
    }

    const allNames   = new Set(bundle.dags.map((d) => d.name));
    const referenced = new Set();

    for (const dag of bundle.dags) {
      for (const node of dag.nodes) {
        if (node['@type'] === 'EmbeddedDAGNode') {
          const ref = node.dag;
          if (typeof ref === 'string' && allNames.has(ref)) {
            referenced.add(ref);
          }
        } else if (node['@type'] === 'ScatterNode') {
          const bodyDag = node.body?.dag;
          if (typeof bodyDag === 'string' && allNames.has(bodyDag)) {
            referenced.add(bodyDag);
          }
        }
      }
    }

    const roots = bundle.dags.filter((d) => !referenced.has(d.name));

    if (roots.length !== 1) {
      const rootNames = roots.map((d) => d.name).join(', ');
      throw new Error(
        `[${name}] Expected exactly 1 root DAG, found ${roots.length}: [${rootNames}]. ` +
        `Referenced: [${[...referenced].join(', ')}]`,
      );
    }

    console.log(`  root: ${roots[0].name} | dags: ${bundle.dags.map((d) => d.name).join(', ')}`);
  }
}

// ── BundleWriter ──────────────────────────────────────────────────────────────

/**
 * Serializes a validated bundle to disk as a .dag.jsonld + .state.json pair.
 *
 * The .dag.jsonld file is a JSON array where each element is a DAGDocument
 * serialized to a JSON object (via DAGDocument.serialize → JSON.parse).
 */
class BundleWriter {
  static async write(outDir, name, bundle) {
    await mkdir(outDir, { recursive: true });

    const dagObjects = bundle.dags.map((dag) =>
      JSON.parse(DAGDocument.serialize(dag)),
    );

    const dagPath   = resolve(outDir, `${name}.dag.jsonld`);
    const statePath = resolve(outDir, `${name}.state.json`);

    await writeFile(dagPath,   JSON.stringify(dagObjects, null, 2), 'utf8');
    await writeFile(statePath, JSON.stringify(bundle.state, null, 2), 'utf8');

    console.log(`  wrote: ${dagPath.replace(ROOT + '/', '')}`);
    console.log(`  wrote: ${statePath.replace(ROOT + '/', '')}`);
  }
}

// ── Generator ─────────────────────────────────────────────────────────────────

/**
 * Top-level generator: builds and writes all 5 DAG bundle pairs.
 */
class Generator {
  static async run() {
    console.log('generate-dag: building DAG bundles...\n');

    // 1. examples/docs-scraper — html, no-crawl, plugin `docs:parse`
    {
      const targetId    = 'ripperoni-docs';
      const pipeline    = ['docs:parse'];
      const pluginName  = docsParseFlow.name; // 'docs:parse'
      const state       = {
        output:       { basePath: './examples/docs-scraper/output' },
        baseUrl:      'https://studnicky.github.io/PathRipper',
        rateLimitMs:  500,
      };

      console.log(`[1/5] examples/docs-scraper / target: ${targetId}`);
      const bundle = DagBundle.forHtml(targetId, pipeline, docsParseFlow, pluginName, state);
      BundleValidator.validate(targetId, bundle);
      await BundleWriter.write(resolve(ROOT, 'examples/docs-scraper'), targetId, bundle);
      console.log();
    }

    // 2. examples/wiki-docs — wiki, plugin `wiki-docs:parse`
    {
      const targetId    = 'ripperoni-wiki';
      const pipeline    = ['wiki-docs:parse'];
      const pluginName  = wikiDocsParseFlow.name; // 'wiki-docs:parse'
      const state       = {
        output:      { basePath: './examples/wiki-docs/output' },
        apiUrl:      'http://localhost:9876/w/api.php',
        rateLimitMs: 50,
      };

      console.log(`[2/5] examples/wiki-docs / target: ${targetId}`);
      const bundle = DagBundle.forWiki(targetId, pipeline, wikiDocsParseFlow, pluginName, state);
      BundleValidator.validate(targetId, bundle);
      await BundleWriter.write(resolve(ROOT, 'examples/wiki-docs'), targetId, bundle);
      console.log();
    }

    // 3. tests/e2e/fixtures/aonprd-crawler — html-crawl, plugin `aonprd:parse`
    {
      const targetId   = 'aonprd';
      const pipeline   = ['crawl:list-targets', 'html:fetch', 'aonprd:parse', 'json:write'];
      const pluginName = aonprdParseDAG.name; // 'aonprd:parse'
      const state      = {
        output:           { basePath: './output', format: 'json', pretty: true },
        baseUrl:          'https://2e.aonprd.com',
        rateLimitMs:      1000,
        jitterMs:         250,
        maxRetries:       3,
        retryBaseDelayMs: 500,
        retryMaxDelayMs:  30000,
        headers:          { 'User-Agent': 'ripperoni-e2e/2.0 (+https://github.com/Studnicky/ripper)' },
        crawler: {
          startUrls: [
            'https://2e.aonprd.com/Actions.aspx',
            'https://2e.aonprd.com/Activities.aspx',
            'https://2e.aonprd.com/Ancestries.aspx',
            'https://2e.aonprd.com/AnimalCompanions.aspx',
            'https://2e.aonprd.com/Archetypes.aspx',
            'https://2e.aonprd.com/ArcaneSchools.aspx',
            'https://2e.aonprd.com/ArcaneThesis.aspx',
            'https://2e.aonprd.com/Armor.aspx',
            'https://2e.aonprd.com/Backgrounds.aspx',
            'https://2e.aonprd.com/Bloodlines.aspx',
            'https://2e.aonprd.com/Causes.aspx',
            'https://2e.aonprd.com/Classes.aspx',
            'https://2e.aonprd.com/ClassKits.aspx',
            'https://2e.aonprd.com/Conditions.aspx',
            'https://2e.aonprd.com/Deities.aspx',
            'https://2e.aonprd.com/Doctrines.aspx',
            'https://2e.aonprd.com/Domains.aspx',
            'https://2e.aonprd.com/DruidicOrders.aspx',
            'https://2e.aonprd.com/Equipment.aspx',
            'https://2e.aonprd.com/Familiars.aspx',
            'https://2e.aonprd.com/Feats.aspx',
            'https://2e.aonprd.com/Hazards.aspx',
            'https://2e.aonprd.com/HuntersEdge.aspx',
            'https://2e.aonprd.com/Instincts.aspx',
            'https://2e.aonprd.com/Languages.aspx',
            'https://2e.aonprd.com/Monsters.aspx',
            'https://2e.aonprd.com/MonsterAbilities.aspx',
            'https://2e.aonprd.com/MonsterFamilies.aspx',
            'https://2e.aonprd.com/Muses.aspx',
            'https://2e.aonprd.com/Rackets.aspx',
            'https://2e.aonprd.com/ResearchFields.aspx',
            'https://2e.aonprd.com/Rules.aspx',
            'https://2e.aonprd.com/Setting.aspx',
            'https://2e.aonprd.com/Shields.aspx',
            'https://2e.aonprd.com/Skills.aspx',
            'https://2e.aonprd.com/Spells.aspx',
            'https://2e.aonprd.com/Rituals.aspx',
            'https://2e.aonprd.com/Tenets.aspx',
            'https://2e.aonprd.com/Traits.aspx',
            'https://2e.aonprd.com/Weapons.aspx',
            'https://2e.aonprd.com/WeaponGroups.aspx',
          ],
          domain:      '2e\\.aonprd\\.com',
          target:      '\\?ID=',
          delimiter:   '\\.aspx',
          rateLimitMs: 1000,
          jitterMs:    250,
          maxPages:    5000,
        },
      };

      console.log(`[3/5] tests/e2e/fixtures/aonprd-crawler / target: ${targetId}`);
      const bundle = DagBundle.forHtmlCrawl(targetId, pipeline, aonprdParseDAG, pluginName, state);
      BundleValidator.validate(targetId, bundle);
      await BundleWriter.write(resolve(ROOT, 'tests/e2e/fixtures'), 'aonprd-crawler', bundle);
      console.log();
    }

    // 4. ripperoni.config.example.json — html, no-crawl, unknown plugin
    {
      const targetId   = 'your-html-target';
      const pipeline   = ['html:fetch', 'your-html-target:parse', 'json:write'];
      const pluginName = 'your-html-target:parse';
      const state      = {
        output:           { basePath: './output', format: 'json', pretty: true },
        baseUrl:          'https://example.com',
        rateLimitMs:      500,
        maxRetries:       3,
        retryBaseDelayMs: 500,
        retryMaxDelayMs:  30000,
        headers:          { 'User-Agent': 'MyApp/1.0' },
        cache:            { dir: './output/.cache/your-html-target', mode: 'read-write' },
      };

      console.log(`[4/5] ripperoni.config.example.json / target: ${targetId}`);
      const bundle = DagBundle.forHtmlUnknownPlugin(targetId, pipeline, pluginName, state);
      BundleValidator.validate(targetId, bundle);
      await BundleWriter.write(ROOT, 'ripperoni.example', bundle);
      console.log();
    }

    // 5. aonprd.config.json — html-crawl, plugin `aonprd:parse`
    {
      const targetId   = 'aonprd';
      const pipeline   = ['crawl:list-targets', 'html:fetch', 'aonprd:parse', 'json:write'];
      const pluginName = aonprdParseDAG.name; // 'aonprd:parse'
      const state      = {
        output:           { basePath: './output', format: 'json', pretty: true },
        baseUrl:          'https://2e.aonprd.com',
        rateLimitMs:      1000,
        jitterMs:         250,
        maxRetries:       3,
        retryBaseDelayMs: 500,
        retryMaxDelayMs:  30000,
        headers:          { 'User-Agent': 'ripperoni-e2e/2.0 (+https://github.com/Studnicky/ripper)' },
        cache:            { dir: '/tmp/ripper-full/.cache', mode: 'read-write' },
        crawler: {
          startUrls: [
            'https://2e.aonprd.com/Actions.aspx',
            'https://2e.aonprd.com/Activities.aspx',
            'https://2e.aonprd.com/Ancestries.aspx',
            'https://2e.aonprd.com/AnimalCompanions.aspx',
            'https://2e.aonprd.com/Archetypes.aspx',
            'https://2e.aonprd.com/ArcaneSchools.aspx',
            'https://2e.aonprd.com/ArcaneThesis.aspx',
            'https://2e.aonprd.com/Armor.aspx',
            'https://2e.aonprd.com/Backgrounds.aspx',
            'https://2e.aonprd.com/Bloodlines.aspx',
            'https://2e.aonprd.com/Causes.aspx',
            'https://2e.aonprd.com/Classes.aspx',
            'https://2e.aonprd.com/ClassKits.aspx',
            'https://2e.aonprd.com/Conditions.aspx',
            'https://2e.aonprd.com/Deities.aspx',
            'https://2e.aonprd.com/Doctrines.aspx',
            'https://2e.aonprd.com/Domains.aspx',
            'https://2e.aonprd.com/DruidicOrders.aspx',
            'https://2e.aonprd.com/Equipment.aspx',
            'https://2e.aonprd.com/Familiars.aspx',
            'https://2e.aonprd.com/Feats.aspx',
            'https://2e.aonprd.com/Hazards.aspx',
            'https://2e.aonprd.com/HuntersEdge.aspx',
            'https://2e.aonprd.com/Instincts.aspx',
            'https://2e.aonprd.com/Languages.aspx',
            'https://2e.aonprd.com/Monsters.aspx',
            'https://2e.aonprd.com/MonsterAbilities.aspx',
            'https://2e.aonprd.com/MonsterFamilies.aspx',
            'https://2e.aonprd.com/Muses.aspx',
            'https://2e.aonprd.com/Rackets.aspx',
            'https://2e.aonprd.com/ResearchFields.aspx',
            'https://2e.aonprd.com/Rules.aspx',
            'https://2e.aonprd.com/Setting.aspx',
            'https://2e.aonprd.com/Shields.aspx',
            'https://2e.aonprd.com/Skills.aspx',
            'https://2e.aonprd.com/Spells.aspx',
            'https://2e.aonprd.com/Rituals.aspx',
            'https://2e.aonprd.com/Tenets.aspx',
            'https://2e.aonprd.com/Traits.aspx',
            'https://2e.aonprd.com/Weapons.aspx',
            'https://2e.aonprd.com/WeaponGroups.aspx',
          ],
          domain:    '2e\\.aonprd\\.com',
          target:    '\\?ID=',
          delimiter: '\\.aspx',
          rateLimitMs: 1000,
          jitterMs:    250,
        },
      };

      console.log(`[5/5] aonprd.config.json / target: ${targetId}`);
      const bundle = DagBundle.forHtmlCrawl(targetId, pipeline, aonprdParseDAG, pluginName, state);
      BundleValidator.validate(targetId, bundle);
      await BundleWriter.write(ROOT, 'aonprd', bundle);
      console.log();
    }

    console.log('generate-dag: done.');
  }
}

await Generator.run();
