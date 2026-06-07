import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import {
  deleteProfile,
  getProfile,
  listProfiles,
  sanitizeProfileName,
  saveProfile,
} from "./profiles.js";

// Unique-name helper so tests never collide with each other or with real
// profiles in the shared ~/.luckycli/agents directory.
const uniqueName = () =>
  `test-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe("agent profiles store", () => {
  const created: string[] = [];

  afterEach(() => {
    for (const name of created.splice(0)) {
      try {
        deleteProfile(name);
      } catch {
        /* best-effort cleanup */
      }
    }
  });

  it("saves and reads back a profile", () => {
    const name = uniqueName();
    created.push(name);
    const saved = saveProfile({
      name,
      description: "test role",
      provider: "claude",
      model: "claude-opus-4-8",
    });
    expect(saved.name).toBe(name);

    const read = getProfile(name);
    expect(read?.provider).toBe("claude");
    expect(read?.model).toBe("claude-opus-4-8");
  });

  it("rejects an unknown provider", () => {
    expect(() =>
      saveProfile({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provider: "not-a-provider" as any,
        name: uniqueName(),
        description: "x",
        model: "m",
      }),
    ).toThrow();
  });

  it("overwrites on re-save and lists by name", () => {
    const name = uniqueName();
    created.push(name);
    saveProfile({ name, description: "v1", provider: "claude", model: "claude-opus-4-8" });
    saveProfile({ name, description: "v2", provider: "gemini", model: "gemini-2.5-pro" });

    const read = getProfile(name);
    expect(read?.description).toBe("v2");
    expect(read?.provider).toBe("gemini");

    expect(listProfiles().some((p) => p.name === name)).toBe(true);
  });

  it("deletes a profile", () => {
    const name = uniqueName();
    saveProfile({ name, description: "x", provider: "claude", model: "claude-opus-4-8" });
    expect(deleteProfile(name)).toBe(true);
    expect(getProfile(name)).toBeNull();
    expect(deleteProfile(name)).toBe(false);
  });

  it("sanitizes names into safe path components", () => {
    expect(sanitizeProfileName("front end/v2")).toBe("front-end-v2");
  });

  it("ignores a corrupt profile file", () => {
    const name = uniqueName();
    created.push(name);
    saveProfile({ name, description: "x", provider: "claude", model: "claude-opus-4-8" });
    // Corrupt the file on disk; getProfile must return null, not throw.
    const path = `${process.env.HOME}/.luckycli/agents/${sanitizeProfileName(name)}.json`;
    rmSync(path);
    expect(getProfile(name)).toBeNull();
  });
});
