/**
 * Session-scoped automatic skill activation.
 *
 * Glue between the pure {@link matchSkills} matcher and the CLI turn loop: holds
 * the per-session **active set** (skills already injected this session, so they
 * are not re-injected), reads the skill graph fresh on every turn (so a skill
 * installed mid-session is immediately live), and produces the text to append to
 * the user turn. The active set is cleared on compaction, since the injected
 * block may have been summarized away.
 *
 * Kept in core (not the React hook) so it is unit-testable and the UI layer only
 * has to call two methods: {@link augment} before `agent.send`, and
 * {@link onCompacted} when a compaction event arrives.
 */
import { skillsRootDir, tryLoadSkillGraph } from "./graph.js";
import { matchSkills, renderSkillInjection } from "./matcher.js";

export class SkillActivator {
  private readonly active = new Set<string>();
  private readonly root: string;

  constructor(root = skillsRootDir()) {
    this.root = root;
  }

  /** Skills injected so far this session (normalized ids). */
  activeSkills(): string[] {
    return [...this.active];
  }

  /**
   * Given the raw user message, return it with any activated skills' `<skill>`
   * blocks appended (at the transcript tail, so the cached prefix is untouched).
   * Returns the message unchanged when no skill is installed or nothing matches.
   */
  async augment(message: string): Promise<string> {
    const graph = await tryLoadSkillGraph(this.root);
    if (!graph) return message;

    const activations = matchSkills(message, graph, this.active);
    if (activations.length === 0) return message;

    const blocks: string[] = [];
    for (const activation of activations) {
      const block = await renderSkillInjection(activation, this.root);
      if (block) {
        blocks.push(block);
        this.active.add(activation.id);
      }
    }
    if (blocks.length === 0) return message;
    return `${message}\n\n${blocks.join("\n\n")}`;
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
