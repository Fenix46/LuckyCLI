/**
 * Session-scoped skill activation, on demand only.
 *
 * Skills are never auto-injected from the user's wording: keyword matching on
 * the turn proved too eager (a generic word like "review" hijacked unrelated
 * tasks). A skill reaches the model only when explicitly invoked — `/skill use
 * <name>` in the CLI, or the skill_load tool — at which point {@link activate}
 * loads its body and the caller sends it as a turn.
 *
 * This holds the per-session **active set** (skills loaded this session) so the
 * UI can show what's live and avoid re-loading; it is cleared on compaction,
 * since an injected block may have been summarized away. Kept in core so it is
 * unit-testable and the UI only calls {@link activate}, {@link markActive}, and
 * {@link onCompacted}.
 */
import { skillsRootDir, tryLoadSkillGraph } from "./graph.js";
import { normalizeSkillName } from "./skill-file.js";
import { renderSkillInjection, type SkillActivation } from "./matcher.js";
import type { SkillNode } from "./types.js";

export class SkillActivator {
  private readonly active = new Set<string>();
  private readonly root: string;

  constructor(root = skillsRootDir()) {
    this.root = root;
  }

  /** Skills loaded so far this session (normalized ids). */
  activeSkills(): string[] {
    return [...this.active];
  }

  /**
   * Load a named, installed+enabled skill and return its `<skill>` block ready
   * to send as a turn, marking it active. Returns null when the skill doesn't
   * exist, is disabled, or has no readable body — the caller surfaces the error.
   */
  async activate(name: string): Promise<string | null> {
    const graph = await tryLoadSkillGraph(this.root);
    if (!graph) return null;

    const id = normalizeSkillName(name);
    const node = graph.nodes.find(
      (n): n is SkillNode => n.kind === "skill" && n.id === id,
    );
    if (!node || !node.attrs || node.attrs.enabled === false) return null;

    const related = graph.edges
      .filter((e) => e.relation === "related_to" && e.source === id)
      .map((e) => e.target);
    const activation: SkillActivation = {
      id,
      name: node.label,
      description: node.attrs.description ?? "",
      bodyPath: node.attrs.bodyPath,
      matched: [],
      related,
    };
    const block = await renderSkillInjection(activation, this.root);
    if (!block) return null;
    this.active.add(id);
    return block;
  }

  /** Mark a skill active without injecting it (e.g. an explicit skill_load). */
  markActive(id: string): void {
    this.active.add(id);
  }

  /** Clear the active set; call when the context is compacted. */
  onCompacted(): void {
    this.active.clear();
  }
}
