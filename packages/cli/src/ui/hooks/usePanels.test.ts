import { describe, expect, it } from "vitest";
import { PROVIDER_CATALOG, type AgentProfile, type ProviderId } from "@luckycli/core";
import { toggleTab } from "./useMcpPanel.js";
import {
  clampIndex,
  cycleModel,
  cycleProvider,
  draftError,
  modelsFor,
} from "./useAgentsPanel.js";
import type { AgentDraft } from "../components/AgentsPanel.js";

const providers = Object.keys(PROVIDER_CATALOG) as ProviderId[];
const first = providers[0]!;

function draft(overrides: Partial<AgentDraft> = {}): AgentDraft {
  return {
    original: null,
    name: "reviewer",
    description: "reviews code",
    provider: first,
    model: modelsFor(first)[0] ?? PROVIDER_CATALOG[first].defaultModel,
    ...overrides,
  };
}

describe("toggleTab", () => {
  it("flips between installed and search", () => {
    expect(toggleTab("installed")).toBe("search");
    expect(toggleTab("search")).toBe("installed");
  });
});

describe("cycleProvider", () => {
  it("moves to the next provider and resets the model to its first", () => {
    const next = cycleProvider(draft(), 1);
    expect(next.provider).toBe(providers[1 % providers.length]);
    expect(next.model).toBe(modelsFor(next.provider)[0] ?? next.model);
  });

  it("wraps around in both directions", () => {
    const back = cycleProvider(draft(), -1);
    expect(back.provider).toBe(providers[providers.length - 1]);
    let d = draft();
    for (let i = 0; i < providers.length; i++) d = cycleProvider(d, 1);
    expect(d.provider).toBe(first);
  });
});

describe("cycleModel", () => {
  it("cycles within the provider's catalog and wraps", () => {
    const models = modelsFor(first);
    if (models.length < 2) return; // catalog too small to cycle meaningfully
    const next = cycleModel(draft(), 1);
    expect(next.model).toBe(models[1]);
    const wrapped = cycleModel(draft({ model: models[models.length - 1]! }), 1);
    expect(wrapped.model).toBe(models[0]);
  });

  it("keeps the draft unchanged when the provider has no models", () => {
    const d = draft({ provider: "nope" as ProviderId, model: "custom" });
    expect(cycleModel(d, 1)).toBe(d);
  });
});

describe("draftError", () => {
  const profiles = [{ name: "reviewer" }, { name: "tester" }] as AgentProfile[];

  it("requires a non-blank name", () => {
    expect(draftError(draft({ name: "  " }), profiles)).toBe("Name is required.");
  });

  it("rejects a name colliding with a different profile", () => {
    expect(draftError(draft({ name: "tester", original: "reviewer" }), profiles)).toContain(
      "already exists",
    );
  });

  it("allows saving under the profile's own name (edit in place)", () => {
    expect(draftError(draft({ name: "reviewer", original: "reviewer" }), profiles)).toBeNull();
  });

  it("allows a fresh unique name", () => {
    expect(draftError(draft({ name: "planner" }), profiles)).toBeNull();
  });
});

describe("clampIndex", () => {
  it("clamps the selection after deleting the last row", () => {
    expect(clampIndex(2, 2)).toBe(1);
  });

  it("keeps in-range selections and floors at zero", () => {
    expect(clampIndex(1, 3)).toBe(1);
    expect(clampIndex(0, 0)).toBe(0);
  });
});
