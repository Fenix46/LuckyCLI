import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadProjectConfig } from "./project.js";
import { resolveConfig } from "./config.js";

describe("project configuration", () => {
  it("loads validated project settings and lets flags override them", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lucky-project-config-"));
    try {
      await mkdir(join(cwd, ".lucky"));
      await writeFile(join(cwd, ".lucky/config.json"), JSON.stringify({
        provider: "ollama", model: "project-model", graph: { exclude: ["vendor"] },
        skills: ["code-review"], permissions: { exec: "deny" },
      }));
      const project = loadProjectConfig(cwd);
      expect(project).toMatchObject({ provider: "ollama", model: "project-model", graphExclusions: ["vendor"], skills: ["code-review"], permissions: { exec: "deny" } });
      const global = { provider: "ollama" as const, model: "global-model", credentials: { ollama: { type: "ollama" as const, baseUrl: "http://localhost" } } };
      expect(resolveConfig({}, global, {}, cwd).model).toBe("project-model");
      expect(resolveConfig({ model: "flag-model" }, global, {}, cwd).model).toBe("flag-model");
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });

  it("rejects unknown keys, invalid paths, and malformed MCP entries", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lucky-project-config-invalid-"));
    try {
      await mkdir(join(cwd, ".lucky"));
      await writeFile(join(cwd, ".lucky/config.json"), JSON.stringify({ unknown: true }));
      expect(() => loadProjectConfig(cwd)).toThrow();
      await writeFile(join(cwd, ".lucky/config.json"), JSON.stringify({ graph: { exclude: ["../outside"] } }));
      expect(() => loadProjectConfig(cwd)).toThrow("escapes root");
      await writeFile(join(cwd, ".lucky/config.json"), JSON.stringify({ mcp: { bad: { type: "remote" } } }));
      expect(() => loadProjectConfig(cwd)).toThrow("invalid MCP");
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });

  it("keeps setup working when the project file is absent", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lucky-project-config-empty-"));
    try { expect(loadProjectConfig(cwd)).toEqual({}); } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});
