import { NodeStateBase } from '@noocodex/dagonizer';
import type { JsonObject } from '@noocodex/dagonizer/entities';

import type { CategoryMemberInterface } from '../types/MediaWikiScraper.js';

/**
 * State flowing through the `wikiResolveMembersDAG` member-resolution phase.
 *
 * @remarks
 * Carries the wiki target identifier, raw target config, optional category
 * override, and the resume-failures flag into whichever branch node is
 * selected by `wiki:choose-mode`. The branch node writes `members` on exit;
 * the orchestrator reads `members` to seed the page fan-out.
 *
 * @category State
 * @since 3.0.0
 */
export class MemberResolutionState extends NodeStateBase {
  /** Wiki target identifier (mediawiki config key). */
  target: string = '';

  /** Raw per-target config block from `ripperoni.json`. */
  config: Record<string, unknown> = {};

  /**
   * When `true`, the resume-failures branch node reads titles from
   * `failures.json` instead of querying the MediaWiki API.
   */
  resumeFailures: boolean = false;

  /**
   * Optional single category name supplied via CLI `--category` flag.
   * When set, the single-category branch is selected regardless of config.
   */
  category: string | undefined = undefined;

  /**
   * Output: populated by whichever branch node executes.
   * Empty array until a branch node writes to it.
   */
  members: CategoryMemberInterface[] = [];

  public override clone(): MemberResolutionState {
    const cloned = new MemberResolutionState();
    for (const [key, value] of Object.entries(this.metadata)) {
      cloned.setMetadata(key, value);
    }
    cloned.target         = this.target;
    cloned.config         = { ...this.config };
    cloned.resumeFailures = this.resumeFailures;
    cloned.category       = this.category;
    cloned.members        = [...this.members];
    return cloned;
  }

  protected override snapshotData(): JsonObject {
    return {
      target:         this.target,
      config:         this.config as JsonObject,
      resumeFailures: this.resumeFailures,
      category:       this.category ?? null,
      members:        this.members as unknown as JsonObject,
    };
  }

  protected override restoreData(snap: JsonObject): void {
    if (typeof snap['target'] === 'string') this.target = snap['target'];
    const cfg = snap['config'];
    if (cfg !== null && typeof cfg === 'object' && !Array.isArray(cfg)) {
      this.config = cfg as Record<string, unknown>;
    }
    if (typeof snap['resumeFailures'] === 'boolean') this.resumeFailures = snap['resumeFailures'];
    this.category = typeof snap['category'] === 'string' ? snap['category'] : undefined;
    const mem = snap['members'];
    if (Array.isArray(mem)) this.members = mem as CategoryMemberInterface[];
  }
}
