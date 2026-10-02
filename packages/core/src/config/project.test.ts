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
        provider: "ollama", model: "project-model", checks: ["npm test"], graph: { exclude: ["vendor"] },
        skills: ["code-review"], permissions: { exec: "deny" },
        costs: { "ollama/project-model": { inputPerMillion: 0, outputPerMillion: 0 } },
      }));
      const project = loadProjectConfig(cwd);
      expect(project).toMatchObject({ provider: "ollama", model: "project-model", graphExclusions: ["vendor"], skills: ["code-review"], tokenCosts: { "ollama/project-model": { inputPerMillion: 0 } }, permissions: { exec: "deny" } });
      const global = { provider: "ollama" as const, model: "global-model", credentials: { ollama: { type: "ollama" as const, baseUrl: "http://localhost" } } };
      expect(resolveConfig({}, global, {}, cwd).model).toBe("project-model");
      expect(resolveConfig({}, global, {}, cwd)).toMatchObject({ checks: ["npm test"], graphExclusions: ["vendor"], skills: ["code-review"], tokenCosts: { "ollama/project-model": { outputPerMillion: 0 } } });
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
      await writeFile(join(cwd, ".lucky/config.json"), JSON.stringify({ costs: { bad: { inputPerMillion: -1, outputPerMillion: 1 } } }));
      expect(() => loadProjectConfig(cwd)).toThrow();
      await writeFile(join(cwd, ".lucky/config.json"), JSON.stringify({ mcp: { bad: { type: "remote" } } }));
      expect(() => loadProjectConfig(cwd)).toThrow("invalid MCP");
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });

  it("applies a project's MCP servers and permissions only once the folder is trusted", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lucky-project-trust-"));
    try {
      await mkdir(join(cwd, ".lucky"));
      await writeFile(join(cwd, ".lucky/config.json"), JSON.stringify({
        permissions: { exec: "allow" },
        mcp: { notes: { type: "remote", url: "https://notes.example/mcp" } },
      }));
      await writeFile(join(cwd, ".mcp.json"), JSON.stringify({
        mcpServers: {
          files: { command: "npx", args: ["-y", "files-mcp"], env: { ROOT: "." } },
          docs: { type: "http", url: "https://docs.example/mcp", headers: { "X-Key": "k" } },
        },
      }));

      const untrusted = resolveConfig({}, {}, {}, cwd);
      expect(untrusted.mcp).toEqual({});
      expect(untrusted.permissions?.exec).not.toBe("allow");

      const trusted = resolveConfig({}, { projects: { [cwd]: { trusted: true, firstOpenedAt: "2026-10-02T00:00:00Z" } } }, {}, cwd);
      expect(trusted.permissions?.exec).toBe("allow");
      expect(trusted.mcp).toEqual({
        files: { type: "local", command: ["npx", "-y", "files-mcp"], environment: { ROOT: "." } },
        docs: { type: "remote", url: "https://docs.example/mcp", headers: { "X-Key": "k" } },
        notes: { type: "remote", url: "https://notes.example/mcp" },
      });
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });

  it("keeps setup working when the project file is absent", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lucky-project-config-empty-"));
    try { expect(loadProjectConfig(cwd)).toEqual({}); } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});
