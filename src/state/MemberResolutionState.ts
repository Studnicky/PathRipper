import { NodeStateBase } from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';

import type { CategoryMemberType } from '../types/MediaWikiScraper.js';

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
  members: CategoryMemberType[] = [];

  public override clone(): this {
    const cloned = new MemberResolutionState();
    for (const [key, value] of Object.entries(this.metadata)) {
      cloned.setMetadata(key, value);
    }
    cloned.target         = this.target;
    cloned.config         = { ...this.config };
    cloned.resumeFailures = this.resumeFailures;
    cloned.category       = this.category;
    cloned.members        = [...this.members];
    return cloned as this;
  }

  protected override snapshotData(): JsonObjectType {
    return {
      target:         this.target,
      config:         this.config as JsonObjectType,
      resumeFailures: this.resumeFailures,
      category:       this.category ?? null,
      members:        this.members as unknown as JsonObjectType,
    };
  }

  protected override restoreData(snap: JsonObjectType): void {
    if (typeof snap['target'] === 'string') this.target = snap['target'];
    const cfg = snap['config'];
    if (cfg !== null && typeof cfg === 'object' && !Array.isArray(cfg)) {
      this.config = cfg as Record<string, unknown>;
    }
    if (typeof snap['resumeFailures'] === 'boolean') this.resumeFailures = snap['resumeFailures'];
    this.category = typeof snap['category'] === 'string' ? snap['category'] : undefined;
    const mem = snap['members'];
    if (Array.isArray(mem)) this.members = mem as unknown as CategoryMemberType[];
  }
}
