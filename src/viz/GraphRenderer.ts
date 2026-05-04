/**
 * @fileoverview `GraphRenderer` — converts a `VizPayloadInterface` to a
 * standalone, offline-capable HTML document with an embedded cytoscape graph.
 *
 * @remarks
 * The rendered HTML is entirely self-contained: the cytoscape bundle is inlined,
 * no CDN or network access is required at display time. Open the file in any
 * modern browser to see the graph.
 *
 * @module viz/GraphRenderer
 * @category Viz
 * @since 0.2.0
 */

import { CYTOSCAPE_JS_BUNDLE } from './vendor/cytoscapeBundle.js';
import type { VizPayloadInterface } from './JsonLdGraph.js';

// ---------------------------------------------------------------------------
// Render options
// ---------------------------------------------------------------------------

/**
 * Optional overrides for `GraphRenderer.render`.
 *
 * @category Viz
 * @since 0.2.0
 * @group Types
 */
export interface RenderOptionsInterface {
  /** HTML page title. Defaults to `'Squashage Graph'`. */
  readonly title?: string | undefined;
}

// ---------------------------------------------------------------------------
// GraphRenderer
// ---------------------------------------------------------------------------

/**
 * Static-only renderer that converts a `VizPayloadInterface` to a standalone
 * HTML document string.
 *
 * @remarks
 * All methods are static; the class cannot be instantiated.
 *
 * @example
 * ```ts
 * const html = GraphRenderer.render(payload, { title: 'aonprd' });
 * await writeFile('out.html', html);
 * ```
 *
 * @category Viz
 * @since 0.2.0
 * @group Core
 */
export class GraphRenderer {
  private constructor() { /* static-only */ }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Renders a `VizPayloadInterface` as a standalone HTML document string.
   *
   * @param payload - Graph payload produced by `JsonLdGraph.fromCompactedJsonLd`.
   * @param options - Optional rendering overrides.
   * @returns A UTF-8 HTML string ready to write to disk.
   */
  static render(payload: VizPayloadInterface, options?: RenderOptionsInterface): string {
    const title       = options?.title ?? 'Squashage Graph';
    const payloadJson = JSON.stringify(payload);

    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      `<meta charset="UTF-8">`,
      `<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
      `<title>${GraphRenderer.#esc(title)}</title>`,
      '<style>',
      GraphRenderer.#css(),
      '</style>',
      '</head>',
      '<body>',
      `<header class="sq-header"><h1>${GraphRenderer.#esc(title)}</h1></header>`,
      '<div class="sq-layout">',
      '  <div id="cy"></div>',
      '  <aside class="sq-sidebar">',
      '    <section class="sq-section" id="sq-details">',
      '      <h2>Details</h2>',
      '      <div id="sq-details-body"><p class="sq-hint">Click a node or edge</p></div>',
      '    </section>',
      '    <section class="sq-section" id="sq-legend">',
      '      <h2>Graphs</h2>',
      '      <div id="sq-legend-body"></div>',
      '    </section>',
      '    <section class="sq-section" id="sq-nodes">',
      '      <h2>Nodes</h2>',
      '      <div id="sq-nodes-body"></div>',
      '    </section>',
      '  </aside>',
      '</div>',
      // 1. Vendored cytoscape bundle.
      '<script>',
      CYTOSCAPE_JS_BUNDLE,
      '</script>',
      // 2. Payload data.
      '<script>',
      `const PAYLOAD = ${payloadJson};`,
      '</script>',
      // 3. Init script.
      '<script>',
      GraphRenderer.#initScript(),
      '</script>',
      '</body>',
      '</html>',
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // Private: CSS
  // ---------------------------------------------------------------------------

  /** Returns the embedded stylesheet. */
  static #css(): string {
    return `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; font-family: system-ui, sans-serif; font-size: 14px; background: #1a1a2e; color: #e0e0f0; }
.sq-header { padding: 8px 16px; background: #16213e; border-bottom: 1px solid #0f3460; display: flex; align-items: center; }
.sq-header h1 { font-size: 16px; font-weight: 600; color: #e94560; }
.sq-layout { display: flex; height: calc(100vh - 41px); }
#cy { flex: 1 1 auto; background: #0d0d1a; }
.sq-sidebar { width: 280px; flex: 0 0 280px; overflow-y: auto; background: #16213e; border-left: 1px solid #0f3460; display: flex; flex-direction: column; gap: 0; }
.sq-section { border-bottom: 1px solid #0f3460; padding: 10px; }
.sq-section h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #a0a0c0; margin-bottom: 8px; }
.sq-hint { color: #606080; font-size: 12px; }
#sq-details-body { font-size: 12px; word-break: break-all; }
.sq-detail-id { color: #e94560; font-weight: 600; margin-bottom: 4px; }
.sq-detail-class { color: #a0d0ff; margin-bottom: 6px; }
.sq-detail-prop { margin-bottom: 3px; }
.sq-detail-prop-key { color: #80c0e0; }
.sq-detail-prop-val { color: #c0e0c0; }
.sq-legend-swatch { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 12px; word-break: break-all; }
.sq-swatch { display: inline-block; width: 12px; height: 12px; border-radius: 50%; flex: 0 0 12px; }
.sq-node-item { font-size: 12px; cursor: pointer; padding: 2px 4px; border-radius: 3px; margin-bottom: 2px; word-break: break-all; }
.sq-node-item:hover { background: #0f3460; }
.sq-class-group { margin-bottom: 8px; }
.sq-class-label { font-size: 11px; color: #808090; margin-bottom: 3px; text-transform: uppercase; }
`;
  }

  // ---------------------------------------------------------------------------
  // Private: init script (hand-written JavaScript)
  // ---------------------------------------------------------------------------

  /** Returns the graph initialization script. */
  static #initScript(): string {
    return `
(function () {
  // ---- Palette: deterministic HSL hue from string hash ----
  function hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) >>> 0; }
    return h % 360;
  }
  function nodeColor(classIri) {
    if (!classIri) return 'hsl(220,30%,50%)';
    const hue = hashHue(classIri);
    return 'hsl(' + hue + ',55%,55%)';
  }
  function edgeColor(graphIri) {
    if (!graphIri) return '#4060a0';
    const hue = hashHue(graphIri);
    return 'hsl(' + hue + ',40%,55%)';
  }

  // ---- Build cytoscape elements from PAYLOAD ----
  const elements = [];
  PAYLOAD.nodes.forEach(function (n) {
    elements.push({
      group: 'nodes',
      data: {
        id: n.id,
        label: n.label,
        classIri: n.classIri || '',
        classLabel: n.classLabel || '',
        graphIri: n.graphIri || '',
        color: nodeColor(n.classIri),
        properties: n.properties
      }
    });
  });
  PAYLOAD.edges.forEach(function (e) {
    elements.push({
      group: 'edges',
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        graphIri: e.graphIri || '',
        color: edgeColor(e.graphIri)
      }
    });
  });

  // ---- Initialise cytoscape ----
  var cy = cytoscape({
    container: document.getElementById('cy'),
    elements: elements,
    style: [
      {
        selector: 'node',
        style: {
          'background-color': 'data(color)',
          'label': 'data(label)',
          'color': '#e0e0f0',
          'font-size': '10px',
          'text-valign': 'center',
          'text-halign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': '80px',
          'width': '60px',
          'height': '60px',
          'border-width': 2,
          'border-color': '#0f3460'
        }
      },
      {
        selector: 'node:selected',
        style: {
          'border-color': '#e94560',
          'border-width': 3
        }
      },
      {
        selector: 'edge',
        style: {
          'line-color': 'data(color)',
          'target-arrow-color': 'data(color)',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'label': 'data(label)',
          'font-size': '8px',
          'color': '#a0a0c0',
          'text-rotation': 'autorotate',
          'width': 1.5
        }
      },
      {
        selector: 'edge:selected',
        style: {
          'line-color': '#e94560',
          'target-arrow-color': '#e94560',
          'width': 2.5
        }
      }
    ],
    layout: { name: 'cose', idealEdgeLength: 120, nodeRepulsion: 450000, animate: false }
  });

  // ---- Sidebar: legend ----
  var legendBody = document.getElementById('sq-legend-body');
  if (PAYLOAD.graphs.length === 0) {
    legendBody.innerHTML = '<p class="sq-hint">No named graphs</p>';
  } else {
    PAYLOAD.graphs.forEach(function (g) {
      var div = document.createElement('div');
      div.className = 'sq-legend-swatch';
      var swatch = document.createElement('span');
      swatch.className = 'sq-swatch';
      swatch.style.background = edgeColor(g.id);
      var label = document.createElement('span');
      label.textContent = g.label;
      div.appendChild(swatch);
      div.appendChild(label);
      legendBody.appendChild(div);
    });
  }

  // ---- Sidebar: node list grouped by class ----
  var nodesBody = document.getElementById('sq-nodes-body');
  var byClass = {};
  PAYLOAD.nodes.forEach(function (n) {
    var cl = n.classLabel || '(untyped)';
    if (!byClass[cl]) byClass[cl] = [];
    byClass[cl].push(n);
  });
  Object.keys(byClass).sort().forEach(function (cl) {
    var group = document.createElement('div');
    group.className = 'sq-class-group';
    var header = document.createElement('div');
    header.className = 'sq-class-label';
    header.textContent = cl;
    group.appendChild(header);
    byClass[cl].forEach(function (n) {
      var item = document.createElement('div');
      item.className = 'sq-node-item';
      item.style.borderLeft = '3px solid ' + nodeColor(n.classIri);
      item.style.paddingLeft = '6px';
      item.textContent = n.label;
      item.addEventListener('click', function () {
        var cyNode = cy.getElementById(n.id);
        if (cyNode.length) {
          cy.fit(cyNode, 80);
          cy.elements().unselect();
          cyNode.select();
          showNodeDetails(n);
        }
      });
      group.appendChild(item);
    });
    nodesBody.appendChild(group);
  });

  // ---- Details panel ----
  var detailsBody = document.getElementById('sq-details-body');

  function showNodeDetails(n) {
    var html = '';
    html += '<div class="sq-detail-id">' + esc(n.label) + '</div>';
    if (n.classLabel) {
      html += '<div class="sq-detail-class">Class: ' + esc(n.classLabel) + '</div>';
    }
    if (n.graphIri) {
      html += '<div class="sq-detail-prop"><span class="sq-detail-prop-key">Graph: </span><span class="sq-detail-prop-val">' + esc(n.graphIri) + '</span></div>';
    }
    var props = n.properties;
    var keys = Object.keys(props).sort();
    if (keys.length > 0) {
      html += '<hr style="border-color:#0f3460;margin:6px 0">';
      keys.forEach(function (k) {
        props[k].forEach(function (v) {
          html += '<div class="sq-detail-prop"><span class="sq-detail-prop-key">' + esc(k) + ': </span><span class="sq-detail-prop-val">' + esc(String(v)) + '</span></div>';
        });
      });
    }
    detailsBody.innerHTML = html;
  }

  function showEdgeDetails(e) {
    var html = '';
    html += '<div class="sq-detail-id">' + esc(e.data('label')) + '</div>';
    html += '<div class="sq-detail-prop"><span class="sq-detail-prop-key">From: </span><span class="sq-detail-prop-val">' + esc(e.data('source')) + '</span></div>';
    html += '<div class="sq-detail-prop"><span class="sq-detail-prop-key">To: </span><span class="sq-detail-prop-val">' + esc(e.data('target')) + '</span></div>';
    if (e.data('graphIri')) {
      html += '<div class="sq-detail-prop"><span class="sq-detail-prop-key">Graph: </span><span class="sq-detail-prop-val">' + esc(e.data('graphIri')) + '</span></div>';
    }
    detailsBody.innerHTML = html;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- Event: click node ----
  cy.on('tap', 'node', function (evt) {
    var node = evt.target;
    var nodeData = PAYLOAD.nodes.find(function (n) { return n.id === node.id(); });
    if (nodeData) showNodeDetails(nodeData);
  });

  // ---- Event: click edge ----
  cy.on('tap', 'edge', function (evt) {
    showEdgeDetails(evt.target);
  });

  // ---- Event: click background ----
  cy.on('tap', function (evt) {
    if (evt.target === cy) {
      detailsBody.innerHTML = '<p class="sq-hint">Click a node or edge</p>';
    }
  });
})();
`;
  }

  // ---------------------------------------------------------------------------
  // Private: HTML escape
  // ---------------------------------------------------------------------------

  /**
   * Escapes a string for safe insertion into HTML text content.
   *
   * @param s - Raw string.
   * @returns HTML-escaped string.
   */
  static #esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
