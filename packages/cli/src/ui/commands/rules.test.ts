import { describe, expect, it } from "vitest";
import type { StoredConfig } from "@luckycli/core";
import type { Item } from "../lib/items.js";
import { rulesCommands } from "./rules.js";
import type { CommandContext } from "./types.js";

function harness(initial: StoredConfig = {}, env: NodeJS.ProcessEnv = {}) {
  let cfg: StoredConfig = initial;
  const emitted: Item[] = [];
  const command = rulesCommands({
    loadConfig: () => structuredClone(cfg),
    saveConfig: (next) => {
      cfg = next;
    },
    env,
  })[0]!;
  const ctx = { emit: (...items: Item[]) => emitted.push(...items) } as unknown as CommandContext;
  return { run: (args: string) => command.run(args, ctx), emitted, config: () => cfg };
}

describe("/rules", () => {
  it("saves, moves and removes patterns", () => {
    const h = harness();
    h.run("deny git push --force*");
    expect(h.config().commandRules).toEqual({ deny: ["git push --force*"] });
    h.run("allow git push --force*");
    expect(h.config().commandRules).toEqual({ allow: ["git push --force*"] });
    h.run("remove git push --force*");
    expect(h.config().commandRules).toBeUndefined();
    expect(h.emitted.map((i) => (i.kind === "command" ? i.title : i.kind))).toEqual([
      "Rule saved",
      "Rule saved",
      "Rule removed",
    ]);
  });

  it("lists stored and environment rules and flags a bad env value", () => {
    const listed = harness({ commandRules: { ask: ["npm install"] } }, { LUCKY_COMMAND_RULES: "deny=npm publish" });
    listed.run("");
    const rows = listed.emitted[0]!.kind === "command" ? listed.emitted[0]!.rows : [];
    expect(rows).toEqual(
      expect.arrayContaining([
        { label: "ask", value: "npm install" },
        { label: "deny", value: "npm publish  (LUCKY_COMMAND_RULES)" },
      ]),
    );
    const bad = harness({}, { LUCKY_COMMAND_RULES: "nope=x" });
    bad.run("");
    const badRows = bad.emitted[0]!.kind === "command" ? bad.emitted[0]!.rows : [];
    expect(badRows.some((r) => r.label === "warning")).toBe(true);
  });

  it("reports usage errors", () => {
    const h = harness();
    h.run("maybe x");
    h.run("remove not-there");
    expect(h.emitted.map((i) => i.kind)).toEqual(["error", "error"]);
  });
});
