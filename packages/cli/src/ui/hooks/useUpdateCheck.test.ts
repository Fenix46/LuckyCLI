import { describe, expect, it } from "vitest";
import type { UpdateInfo } from "../../update.js";
import type { Item } from "../lib/items.js";
import { runUpdateCheckFlow, type UpdateCheckDeps } from "./useUpdateCheck.js";

function available(version = "9.9.9"): UpdateInfo {
  return {
    currentVersion: "0.0.1",
    latestVersion: version,
    updateAvailable: true,
    checkedAt: Date.now(),
    source: "network",
  };
}

function makeDeps(overrides: Partial<UpdateCheckDeps>): {
  deps: UpdateCheckDeps;
  emitted: Item[];
} {
  const emitted: Item[] = [];
  const deps: UpdateCheckDeps = {
    policy: "notify",
    emit: (item) => emitted.push(item),
    isCancelled: () => false,
    check: async () => available(),
    apply: async () => ({ applied: true }),
    canSelfUpdate: () => true,
    ...overrides,
  };
  return { deps, emitted };
}

function titles(emitted: Item[]): string[] {
  return emitted.map((i) => (i.kind === "command" ? i.title : i.kind));
}

describe("runUpdateCheckFlow", () => {
  it("does nothing when the policy is off (never even checks)", async () => {
    let checked = false;
    const { deps, emitted } = makeDeps({
      policy: "off",
      check: async () => {
        checked = true;
        return available();
      },
    });
    await runUpdateCheckFlow(deps);
    expect(checked).toBe(false);
    expect(emitted).toHaveLength(0);
  });

  it("stays silent when no update is available", async () => {
    const { deps, emitted } = makeDeps({
      check: async () => ({ ...available(), updateAvailable: false }),
    });
    await runUpdateCheckFlow(deps);
    expect(emitted).toHaveLength(0);
  });

  it("swallows a failing check (background is best-effort)", async () => {
    const { deps, emitted } = makeDeps({
      check: async () => {
        throw new Error("network down");
      },
    });
    await expect(runUpdateCheckFlow(deps)).resolves.toBeUndefined();
    expect(emitted).toHaveLength(0);
  });

  it("notify policy emits the banner only", async () => {
    const { deps, emitted } = makeDeps({ policy: "notify" });
    await runUpdateCheckFlow(deps);
    expect(titles(emitted)).toEqual(["Update Available"]);
  });

  it("auto policy narrates download and install", async () => {
    const { deps, emitted } = makeDeps({ policy: "auto" });
    await runUpdateCheckFlow(deps);
    expect(titles(emitted)).toEqual(["Update", "Update installed"]);
  });

  it("auto policy falls back to the banner when apply fails", async () => {
    const { deps, emitted } = makeDeps({
      policy: "auto",
      apply: async () => {
        throw new Error("verify failed");
      },
    });
    await runUpdateCheckFlow(deps);
    expect(titles(emitted)).toEqual(["Update", "Update Available"]);
  });

  it("auto policy falls back to the banner when self-update isn't possible", async () => {
    const { deps, emitted } = makeDeps({ policy: "auto", canSelfUpdate: () => false });
    await runUpdateCheckFlow(deps);
    expect(titles(emitted)).toEqual(["Update Available"]);
  });

  it("auto policy falls back to the banner when apply reports not-applied", async () => {
    const { deps, emitted } = makeDeps({
      policy: "auto",
      apply: async () => ({ applied: false }),
    });
    await runUpdateCheckFlow(deps);
    expect(titles(emitted)).toEqual(["Update", "Update Available"]);
  });

  it("suppresses late emissions after cancellation", async () => {
    let cancelled = false;
    const { deps, emitted } = makeDeps({
      isCancelled: () => cancelled,
      check: async () => {
        cancelled = true; // unmounted while the request was in flight
        return available();
      },
    });
    await runUpdateCheckFlow(deps);
    expect(emitted).toHaveLength(0);
  });
});
