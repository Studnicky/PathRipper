/**
 * @fileoverview `GraphRenderer` — converts a `VizPayloadInterface` to a
 * standalone, offline-capable HTML document with an embedded cytoscape graph.
 *
 * @remarks
 * The rendered HTML is entirely self-contained: the cytoscape bundle and the
 * cytoscape-fcose layout plugin bundle are inlined, no CDN or network access
 * is required at display time. Open the file in any modern browser to see the
 * graph.
 *
 * For large payloads (>1 named graph AND >200 total nodes), the renderer uses
 * a streaming progressive approach: graphs are loaded one at a time using the
 * fcose layout, scoped to only the newly added nodes (existing nodes are
 * position-locked). For small payloads the legacy single-shot cose path is used.
 *
 * @module viz/GraphRenderer
 * @category Viz
 * @since 0.2.0
 */

import { CYTOSCAPE_JS_BUNDLE }    from './vendor/cytoscapeBundle.js';
import { CYTOSCAPE_FCOSE_BUNDLE } from './vendor/cytoscapeFcoseBundle.js';
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

// Threshold for streaming mode: requires >1 graph AND >200 nodes total.
const STREAMING_GRAPH_MIN = 2;
const STREAMING_NODE_MIN  = 200;

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
    const useStreaming = (
      payload.graphs.length >= STREAMING_GRAPH_MIN &&
      payload.nodes.length  >  STREAMING_NODE_MIN
    );

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
      // Loading overlay (only shown during streaming passes).
      '  <div id="sq-loading-overlay" class="sq-loading-overlay sq-hidden">',
      '    <div class="sq-spinner"></div>',
      '    <div id="sq-loading-msg" class="sq-loading-msg">Loading…</div>',
      '  </div>',
      '  <aside class="sq-sidebar">',
      '    <section class="sq-section" id="sq-details">',
      '      <h2>Details</h2>',
      '      <div id="sq-details-body"><p class="sq-hint">Click a node or edge</p></div>',
      '    </section>',
      ...(useStreaming ? [
        '    <section class="sq-section" id="sq-streaming">',
        '      <h2>Streaming</h2>',
        '      <div id="sq-streaming-controls">',
        '        <button id="sq-pause-btn" class="sq-btn">Pause</button>',
        '      </div>',
        '      <div id="sq-streaming-queue"></div>',
        '    </section>',
      ] : []),
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
      // 2. Vendored cytoscape-fcose bundle (self-registers on global cytoscape).
      '<script>',
      CYTOSCAPE_FCOSE_BUNDLE,
      '</script>',
      // 3. Payload data.
      '<script>',
      `const PAYLOAD = ${payloadJson};`,
      '</script>',
      // 4. Init script.
      '<script>',
      useStreaming ? GraphRenderer.#streamingInitScript() : GraphRenderer.#initScript(),
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
.sq-layout { display: flex; height: calc(100vh - 41px); position: relative; }
#cy { flex: 1 1 auto; background: #0d0d1a; }
.sq-sidebar { width: 280px; flex: 0 0 280px; overflow-y: auto; background: #16213e; border-left: 1px solid #0f3460; display: flex; flex-direction: column; gap: 0; }
.sq-section { border-bottom: 1px solid #0f3460; padding: 10px; }
.sq-section h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #a0a0c0; margin-bottom: 8px; }
.sq-hint { color: #606080; font-size: 12px; }
#sq-details-body { font-size: 12px; word-break: break-all; }
.sq-detail-id { color: #e94560; font-weight: 600; margin-bottom: 4px; }
.sq-detail-iri { font-family: monospace; font-size: 10px; color: #808090; margin-bottom: 6px; word-break: break-all; }
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
/* Loading overlay */
.sq-loading-overlay { position: absolute; inset: 0; background: rgba(13,13,26,0.8); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 100; pointer-events: none; }
.sq-loading-overlay.sq-hidden { display: none; }
.sq-spinner { width: 40px; height: 40px; border: 4px solid #0f3460; border-top-color: #e94560; border-radius: 50%; animation: sq-spin 0.8s linear infinite; margin-bottom: 16px; }
@keyframes sq-spin { to { transform: rotate(360deg); } }
.sq-loading-msg { color: #e0e0f0; font-size: 13px; text-align: center; max-width: 240px; }
/* Streaming queue */
#sq-streaming-controls { margin-bottom: 8px; }
.sq-btn { background: #0f3460; color: #e0e0f0; border: 1px solid #1a5090; border-radius: 4px; padding: 4px 12px; font-size: 12px; cursor: pointer; }
.sq-btn:hover { background: #1a5090; }
.sq-queue-item { font-size: 11px; padding: 3px 4px; border-radius: 3px; margin-bottom: 2px; display: flex; gap: 6px; align-items: baseline; }
.sq-queue-item.sq-queue-done { color: #60a060; }
.sq-queue-item.sq-queue-active { color: #e0c040; font-weight: 600; }
.sq-queue-item.sq-queue-pending { color: #606080; }
.sq-queue-status { font-size: 10px; flex: 0 0 auto; }
`;
  }

  // ---------------------------------------------------------------------------
  // Private: streaming init script
  // ---------------------------------------------------------------------------

  /** Returns the streaming graph initialization script (fcose, progressive). */
  static #streamingInitScript(): string {
    return `
(function () {
  // ---- Palette: deterministic HSL hue from string hash ----
  function hashHue(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) >>> 0; }
    return h % 360;
  }
  function nodeColor(classIri) {
    if (!classIri) return 'hsl(220,30%,50%)';
    return 'hsl(' + (hashHue(classIri)) + ',55%,55%)';
  }
  function edgeColor(graphIri) {
    if (!graphIri) return '#4060a0';
    return 'hsl(' + (hashHue(graphIri)) + ',40%,55%)';
  }

  // ---- HTML escape ----
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- Build per-graph node/edge index from PAYLOAD ----
  // For each graph IRI: collect the set of node IDs that are explicitly in
  // that graph (node.graphIri === graphIri) and the edges in that graph.
  var graphNodeMap = {};     // graphIri -> Set of node IDs explicitly attributed
  var graphEdgeMap = {};     // graphIri -> array of edge data objects
  var allNodeData  = {};     // id -> node data object

  PAYLOAD.graphs.forEach(function (g) {
    graphNodeMap[g.id] = new Set();
    graphEdgeMap[g.id] = [];
  });

  PAYLOAD.nodes.forEach(function (n) {
    allNodeData[n.id] = n;
    if (n.graphIri && graphNodeMap[n.graphIri]) {
      graphNodeMap[n.graphIri].add(n.id);
    }
  });

  PAYLOAD.edges.forEach(function (e) {
    if (e.graphIri && graphEdgeMap[e.graphIri]) {
      graphEdgeMap[e.graphIri].push(e);
      // Nodes referenced by an edge in this graph that aren't explicitly attributed
      // are considered implicit members — they are added when the graph loads.
      // (They will either already be in the canvas or get added fresh here.)
    }
  });

  // ---- Build streaming queue ----
  // character graph (if present) goes first; rest sorted by ascending node count.
  var CHARACTER_IRIS_PATTERN = /[/#]character$/i;

  var ordered = PAYLOAD.graphs.slice().sort(function (a, b) {
    var aIsChar = CHARACTER_IRIS_PATTERN.test(a.id) || a.label.toLowerCase() === 'character';
    var bIsChar = CHARACTER_IRIS_PATTERN.test(b.id) || b.label.toLowerCase() === 'character';
    if (aIsChar && !bIsChar) return -1;
    if (bIsChar && !aIsChar) return  1;
    // Ascending node count.
    var ac = graphNodeMap[a.id] ? graphNodeMap[a.id].size : 0;
    var bc = graphNodeMap[b.id] ? graphNodeMap[b.id].size : 0;
    return ac - bc;
  });

  // ---- Streaming state ----
  var streaming = {
    paused:    false,
    index:     0,
    total:     ordered.length,
    loaded:    new Set(),   // set of graph IRIs fully loaded
    nodesSeen: new Set(),   // set of node IDs already added to canvas
  };

  // ---- Initialise cytoscape (empty canvas) ----
  var cy = cytoscape({
    container: document.getElementById('cy'),
    elements:  [],
    style: [
      {
        selector: 'node',
        style: {
          'background-color': 'data(color)',
          'label':            'data(label)',
          'color':            '#e0e0f0',
          'font-size':        '10px',
          'text-valign':      'center',
          'text-halign':      'center',
          'text-wrap':        'wrap',
          'text-max-width':   '80px',
          'width':            '60px',
          'height':           '60px',
          'border-width':     2,
          'border-color':     '#0f3460'
        }
      },
      {
        selector: 'node:selected',
        style: { 'border-color': '#e94560', 'border-width': 3 }
      },
      {
        selector: 'edge',
        style: {
          'line-color':          'data(color)',
          'target-arrow-color':  'data(color)',
          'target-arrow-shape':  'triangle',
          'curve-style':         'bezier',
          'label':               'data(label)',
          'font-size':           '8px',
          'color':               '#a0a0c0',
          'text-rotation':       'autorotate',
          'width':               1.5
        }
      },
      {
        selector: 'edge:selected',
        style: { 'line-color': '#e94560', 'target-arrow-color': '#e94560', 'width': 2.5 }
      }
    ],
  });

  // ---- Sidebar: legend ----
  var legendBody = document.getElementById('sq-legend-body');
  if (PAYLOAD.graphs.length === 0) {
    legendBody.innerHTML = '<p class="sq-hint">No named graphs</p>';
  } else {
    PAYLOAD.graphs.forEach(function (g) {
      var div    = document.createElement('div');
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

  // ---- Sidebar: node list grouped by class (populated progressively) ----
  // We pre-build the groups map and append as we go.
  var nodesBody = document.getElementById('sq-nodes-body');
  var classDivs = {};  // classLabel -> .sq-class-group div

  function addNodeToSidebar(n) {
    var cl   = n.classLabel || '(untyped)';
    var group = classDivs[cl];
    if (!group) {
      group = document.createElement('div');
      group.className = 'sq-class-group';
      var header = document.createElement('div');
      header.className = 'sq-class-label';
      header.textContent = cl;
      group.appendChild(header);
      classDivs[cl] = group;
      // Insert in sorted order by class label.
      var keys = Object.keys(classDivs).sort();
      var idx = keys.indexOf(cl);
      if (idx === keys.length - 1) {
        nodesBody.appendChild(group);
      } else {
        var nextGroup = classDivs[keys[idx + 1]];
        nodesBody.insertBefore(group, nextGroup || null);
      }
    }
    var item = document.createElement('div');
    item.className  = 'sq-node-item';
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
  }

  // ---- Details panel ----
  var detailsBody = document.getElementById('sq-details-body');

  function showNodeDetails(n) {
    var html = '';
    html += '<div class="sq-detail-id">' + esc(n.label) + '</div>';
    if (n.id !== n.label) {
      html += '<div class="sq-detail-iri">' + esc(n.id) + '</div>';
    }
    if (n.classLabel) {
      html += '<div class="sq-detail-class">Class: ' + esc(n.classLabel) + '</div>';
    }
    if (n.graphIri) {
      html += '<div class="sq-detail-prop"><span class="sq-detail-prop-key">Graph: </span><span class="sq-detail-prop-val">' + esc(n.graphIri) + '</span></div>';
    }
    var props = n.properties;
    var keys  = Object.keys(props).sort();
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

  // ---- Streaming queue UI ----
  var queueDiv   = document.getElementById('sq-streaming-queue');
  var pauseBtn   = document.getElementById('sq-pause-btn');
  var loadingDiv = document.getElementById('sq-loading-overlay');
  var loadingMsg = document.getElementById('sq-loading-msg');
  var queueItems = [];  // parallel to ordered[]

  ordered.forEach(function (g, i) {
    var nodeCount = graphNodeMap[g.id] ? graphNodeMap[g.id].size : 0;
    var item = document.createElement('div');
    item.className = 'sq-queue-item sq-queue-pending';
    item.innerHTML =
      '<span class="sq-queue-status">[ ]</span>' +
      '<span>' + esc(g.label) + ' (' + nodeCount + ' nodes)</span>';
    queueDiv.appendChild(item);
    queueItems.push(item);
  });

  function setQueueItemState(i, state) {
    var item = queueItems[i];
    if (!item) return;
    var g         = ordered[i];
    var nodeCount = graphNodeMap[g.id] ? graphNodeMap[g.id].size : 0;
    var icons     = { done: '[v]', active: '[>]', pending: '[ ]' };
    var classes   = { done: 'sq-queue-done', active: 'sq-queue-active', pending: 'sq-queue-pending' };
    item.className = 'sq-queue-item ' + classes[state];
    item.innerHTML =
      '<span class="sq-queue-status">' + icons[state] + '</span>' +
      '<span>' + esc(g.label) + ' (' + nodeCount + ' nodes)</span>';
  }

  pauseBtn.addEventListener('click', function () {
    streaming.paused = !streaming.paused;
    pauseBtn.textContent = streaming.paused ? 'Resume' : 'Pause';
    if (!streaming.paused && streaming.index < streaming.total) {
      loadNextGraph();
    }
  });

  // ---- Load next graph ----
  function loadNextGraph() {
    if (streaming.paused) return;
    if (streaming.index >= streaming.total) {
      // All done.
      loadingDiv.classList.add('sq-hidden');
      return;
    }

    var idx = streaming.index;
    var g   = ordered[idx];
    var nodeCount = graphNodeMap[g.id] ? graphNodeMap[g.id].size : 0;

    setQueueItemState(idx, 'active');
    loadingDiv.classList.remove('sq-hidden');
    loadingMsg.textContent =
      'Loading ' + (idx + 1) + ' of ' + streaming.total + ': ' +
      g.label + ' — ' + nodeCount + ' nodes';

    // Lock all existing nodes in place so they don't move during the new pass.
    cy.nodes().lock();

    // Build the new elements for this graph.
    var newElements = [];
    var newNodeIds  = new Set();

    // Add explicit nodes for this graph.
    var explicitNodes = graphNodeMap[g.id] ? Array.from(graphNodeMap[g.id]) : [];
    explicitNodes.forEach(function (nodeId) {
      if (!streaming.nodesSeen.has(nodeId)) {
        streaming.nodesSeen.add(nodeId);
        newNodeIds.add(nodeId);
        var n = allNodeData[nodeId];
        if (n) {
          newElements.push({
            group: 'nodes',
            data: {
              id:         n.id,
              label:      n.label,
              classIri:   n.classIri  || '',
              classLabel: n.classLabel || '',
              graphIri:   n.graphIri  || '',
              color:      nodeColor(n.classIri),
              properties: n.properties
            }
          });
          addNodeToSidebar(n);
        }
      }
    });

    // Add edges for this graph; also add implicit target nodes if not yet present.
    var graphEdges = graphEdgeMap[g.id] || [];
    graphEdges.forEach(function (e) {
      // Implicit source node (edge src not yet seen).
      if (!streaming.nodesSeen.has(e.source)) {
        streaming.nodesSeen.add(e.source);
        newNodeIds.add(e.source);
        var srcData = allNodeData[e.source];
        if (srcData) {
          newElements.push({
            group: 'nodes',
            data: {
              id:         srcData.id,
              label:      srcData.label,
              classIri:   srcData.classIri  || '',
              classLabel: srcData.classLabel || '',
              graphIri:   srcData.graphIri  || '',
              color:      nodeColor(srcData.classIri),
              properties: srcData.properties
            }
          });
          addNodeToSidebar(srcData);
        }
      }
      // Implicit target node.
      if (!streaming.nodesSeen.has(e.target)) {
        streaming.nodesSeen.add(e.target);
        newNodeIds.add(e.target);
        var tgtData = allNodeData[e.target];
        if (tgtData) {
          newElements.push({
            group: 'nodes',
            data: {
              id:         tgtData.id,
              label:      tgtData.label,
              classIri:   tgtData.classIri  || '',
              classLabel: tgtData.classLabel || '',
              graphIri:   tgtData.graphIri  || '',
              color:      nodeColor(tgtData.classIri),
              properties: tgtData.properties
            }
          });
          addNodeToSidebar(tgtData);
        }
      }
      // Add the edge itself (avoid duplicates).
      var edgeId = e.id;
      if (!cy.getElementById(edgeId).length) {
        newElements.push({
          group: 'edges',
          data: {
            id:       edgeId,
            source:   e.source,
            target:   e.target,
            label:    e.label,
            graphIri: e.graphIri || '',
            color:    edgeColor(e.graphIri)
          }
        });
      }
    });

    // Add all new elements to the canvas.
    cy.add(newElements);

    // Run fcose layout scoped ONLY to the new nodes.
    // Existing nodes are already locked.
    if (newNodeIds.size > 0) {
      var newNodeSelector = Array.from(newNodeIds).map(function (id) {
        return '#' + CSS.escape(id);
      }).join(', ');

      var layout = cy.$(newNodeSelector).layout({
        name:           'fcose',
        animate:        false,
        randomize:      true,
        quality:        'default',
        nodeSeparation: 75,
        idealEdgeLength: 50,
        numIter:        2500,
        // Don't let fcose move the locked existing nodes.
        fixedNodeConstraint: cy.nodes(':locked').map(function (n) {
          var pos = n.position();
          return { nodeId: n.id(), position: { x: pos.x, y: pos.y } };
        }),
      });

      layout.one('layoutstop', function () {
        // Unlock all nodes after the layout settles.
        cy.nodes().unlock();
        streaming.loaded.add(g.id);
        setQueueItemState(idx, 'done');
        streaming.index++;
        // Brief yield to keep the UI responsive, then start next pass.
        requestAnimationFrame(function () {
          loadNextGraph();
        });
      });

      layout.run();
    } else {
      // No new nodes — just advance.
      cy.nodes().unlock();
      streaming.loaded.add(g.id);
      setQueueItemState(idx, 'done');
      streaming.index++;
      requestAnimationFrame(function () {
        loadNextGraph();
      });
    }
  }

  // ---- Event: click node ----
  cy.on('tap', 'node', function (evt) {
    var node     = evt.target;
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

  // ---- Start streaming after first paint ----
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      loadNextGraph();
    });
  });
})();
`;
  }

  // ---------------------------------------------------------------------------
  // Private: single-shot init script (small payloads)
  // ---------------------------------------------------------------------------

  /** Returns the graph initialization script (single-shot cose, small payloads). */
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
    if (n.id !== n.label) {
      html += '<div class="sq-detail-iri">' + esc(n.id) + '</div>';
    }
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
