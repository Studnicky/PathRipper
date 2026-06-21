/**
 * MermaidExplorer — client-only enhancer for rendered Mermaid diagrams.
 *
 * Adds, to every `.mermaid` SVG in the docs body:
 *   - a D-pad (zoom in/out, pan up/down/left/right, centre, fit) overlaid
 *     bottom-right,
 *   - in-place wheel-zoom + drag-pan,
 *   - an "expand" control that opens a fullscreen explore modal with the same
 *     controls; in the modal the expand slot becomes the close (esc) control.
 *
 * Every diagram renders at its own computed FIT size by default: `#fit` measures
 * the diagram's natural bounds against its viewport and scales so the whole DAG
 * is visible. Mermaid output is SVG, so pan/zoom is a CSS transform on the SVG
 * rather than cytoscape calls. Idempotent (dataset flag) and re-runs as VitePress
 * swaps pages, since the mermaid plugin injects SVGs asynchronously.
 *
 * @module theme/mermaidExplorer
 */

import { onMounted, onBeforeUnmount } from 'vue';

type VecType    = { x: number; y: number };
type CornerType = { glyph: string; title: string; onClick: () => void };

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const PAN_STEP  = 60;
const FIT_MARGIN = 0.94;

/** One enhanced diagram: owns its pan/zoom transform + the D-pad it renders. */
class DagDiagram {
  readonly #stage:  HTMLElement;
  readonly #target: HTMLElement;
  #scale  = 1;
  #offset: VecType = { x: 0, y: 0 };
  #drag:   VecType | null = null;

  private constructor(stage: HTMLElement, target: HTMLElement) {
    this.#stage  = stage;
    this.#target = target;
  }

  /** Enhance a mermaid frame in place: wrap, add a D-pad, wire wheel + drag, fit. */
  static enhance(frame: HTMLElement): void {
    if (frame.dataset.dagExplorer === '1') return;
    const svg = frame.querySelector('svg');
    if (svg === null) return;
    frame.dataset.dagExplorer = '1';
    frame.classList.add('dag-diagram');

    const stage = document.createElement('div');
    stage.className = 'dag-diagram-stage';
    frame.insertBefore(stage, svg);
    stage.appendChild(svg);
    (svg as unknown as HTMLElement).style.transformOrigin = '0 0';

    const diagram = new DagDiagram(stage, svg as unknown as HTMLElement);
    frame.appendChild(diagram.#buildDpad({ glyph: '⛶', title: 'Expand', onClick: () => diagram.#openModal() }));
    diagram.#wireStage(stage);
    diagram.#fit();
  }

  // ── transform ────────────────────────────────────────────────────────────────
  #apply(): void {
    this.#target.style.transform =
      `translate(${this.#offset.x}px, ${this.#offset.y}px) scale(${this.#scale})`;
  }

  #zoomBy(factor: number): void {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.#scale * factor));
    const rect = this.#stage.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    this.#offset.x = cx - (cx - this.#offset.x) * (next / this.#scale);
    this.#offset.y = cy - (cy - this.#offset.y) * (next / this.#scale);
    this.#scale = next;
    this.#apply();
  }

  #panBy(dx: number, dy: number): void {
    this.#offset.x += dx;
    this.#offset.y += dy;
    this.#apply();
  }

  /** Re-centre the content within the stage at the current scale (layout-agnostic). */
  #center(): void {
    const stageRect = this.#stage.getBoundingClientRect();
    const box = this.#target.getBoundingClientRect();
    this.#offset.x += (stageRect.width  - box.width)  / 2 - (box.left - stageRect.left);
    this.#offset.y += (stageRect.height - box.height) / 2 - (box.top  - stageRect.top);
    this.#apply();
  }

  /**
   * Scale so the whole diagram fits inside its stage, then centre. Measures the
   * natural (scale-1) bounds against the stage viewport — wide/tall diagrams
   * shrink to fit, small ones stay near natural size (never upscaled past 1).
   */
  #fit(): void {
    this.#scale = 1;
    this.#offset = { x: 0, y: 0 };
    this.#apply();
    const stageRect = this.#stage.getBoundingClientRect();
    const natural   = this.#target.getBoundingClientRect();
    const cw = natural.width  || 1;
    const ch = natural.height || 1;
    this.#scale = Math.max(
      MIN_SCALE,
      Math.min((stageRect.width * FIT_MARGIN) / cw, (stageRect.height * FIT_MARGIN) / ch, 1),
    );
    this.#apply();
    this.#center();
  }

  // ── controls ───────────────────────────────────────────────────────────────
  #button(glyph: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dag-dpad-btn';
    b.textContent = glyph;
    b.title = title;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  /**
   * 3×3 D-pad. The centre-bottom-left slot (`corner`) is the expand control in
   * place and the close (esc) control in the fullscreen modal.
   */
  #buildDpad(corner: CornerType): HTMLElement {
    const pad = document.createElement('div');
    pad.className = 'dag-dpad';
    const cornerBtn = this.#button(corner.glyph, corner.title, corner.onClick);
    cornerBtn.classList.add('dag-dpad-corner');
    pad.append(
      this.#button('＋', 'Zoom in',   () => this.#zoomBy(1.25)),
      this.#button('▲',  'Pan up',    () => this.#panBy(0, PAN_STEP)),
      this.#button('－', 'Zoom out',  () => this.#zoomBy(0.8)),
      this.#button('◀',  'Pan left',  () => this.#panBy(PAN_STEP, 0)),
      this.#button('⊙',  'Centre',    () => this.#center()),
      this.#button('▶',  'Pan right', () => this.#panBy(-PAN_STEP, 0)),
      cornerBtn,
      this.#button('▼',  'Pan down',  () => this.#panBy(0, -PAN_STEP)),
      this.#button('⤢',  'Fit',       () => this.#fit()),
    );
    return pad;
  }

  #wireStage(stage: HTMLElement): void {
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.#zoomBy(Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    stage.addEventListener('pointerdown', (e) => {
      this.#drag = { x: e.clientX, y: e.clientY };
      stage.classList.add('is-dragging');
      (e.target as Element).setPointerCapture?.(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      if (this.#drag === null) return;
      this.#panBy(e.clientX - this.#drag.x, e.clientY - this.#drag.y);
      this.#drag = { x: e.clientX, y: e.clientY };
    });
    const drop = (): void => { this.#drag = null; stage.classList.remove('is-dragging'); };
    stage.addEventListener('pointerup', drop);
    stage.addEventListener('pointerleave', drop);
  }

  // ── fullscreen explore modal ─────────────────────────────────────────────────
  #openModal(): void {
    const overlay = document.createElement('div');
    overlay.className = 'dag-modal';
    const stage = document.createElement('div');
    stage.className = 'dag-modal-stage dag-diagram-stage';
    const clone = this.#target.cloneNode(true) as HTMLElement;
    clone.removeAttribute('width');
    clone.removeAttribute('height');
    clone.style.transformOrigin = '0 0';
    clone.style.transform = '';
    stage.appendChild(clone);

    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') destroy(); };
    const destroy = (): void => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    };

    const modal = new DagDiagram(stage, clone);
    // In fullscreen the expand slot becomes the close (esc) control.
    const pad = modal.#buildDpad({ glyph: '✕', title: 'Close (esc)', onClick: destroy });
    pad.querySelector('.dag-dpad-corner')?.classList.add('dag-dpad-close');
    const hint = document.createElement('div');
    hint.className = 'dag-modal-hint';
    hint.textContent = 'drag to pan · scroll to zoom · esc to close';

    overlay.append(stage, pad, hint);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    modal.#wireStage(stage);
    requestAnimationFrame(() => modal.#fit());

    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target === hint) destroy(); });
  }
}

/** Static lifecycle wiring used by the VitePress theme. */
export class MermaidExplorer {
  static #enhanceAll(): void {
    document
      .querySelectorAll<HTMLElement>('.vp-doc div.mermaid, .vp-doc .ripperoni-mermaid')
      .forEach((frame) => DagDiagram.enhance(frame));
  }

  /** Call inside the theme's `setup()`; wires mount + a MutationObserver. */
  static install(): void {
    let observer:   MutationObserver | undefined;
    let pollTicks = 0;
    let poll:       ReturnType<typeof setInterval> | undefined;

    onMounted(() => {
      MermaidExplorer.#enhanceAll();
      observer = new MutationObserver(() => MermaidExplorer.#enhanceAll());
      observer.observe(document.body, { childList: true, subtree: true });
      // mermaid injects SVGs in a flush callback the observer can miss; poll briefly.
      poll = setInterval(() => {
        MermaidExplorer.#enhanceAll();
        if (++pollTicks > 24 && poll !== undefined) { clearInterval(poll); poll = undefined; }
      }, 250);
    });

    onBeforeUnmount(() => {
      observer?.disconnect();
      if (poll !== undefined) clearInterval(poll);
    });
  }
}
