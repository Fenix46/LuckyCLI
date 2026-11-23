import { describe, expect, it } from "vitest";
import { expandEnvString, expandMcpServerConfig, expandMcpServers } from "./expand.js";
import type { McpServerConfig } from "./types.js";

const env = {
  TOKEN: "s3cret",
  EMPTY: "",
  PORT: "8080",
} as NodeJS.ProcessEnv;

describe("expandEnvString", () => {
  it("leaves strings without placeholders untouched", () => {
    expect(expandEnvString("npx -y server", env)).toBe("npx -y server");
    expect(expandEnvString("$TOKEN", env)).toBe("$TOKEN");
  });

  it("expands ${VAR}", () => {
    expect(expandEnvString("Bearer ${TOKEN}", env)).toBe("Bearer s3cret");
  });

  it("uses the default when the variable is unset", () => {
    expect(expandEnvString("http://127.0.0.1:${MISSING:-27182}/mcp", env)).toBe(
      "http://127.0.0.1:27182/mcp",
    );
  });

  it("prefers the variable over the default", () => {
    expect(expandEnvString("${PORT:-3000}", env)).toBe("8080");
  });

  it("expands an unset variable without a default to an empty string", () => {
    expect(expandEnvString("x${MISSING}y", env)).toBe("xy");
    expect(expandEnvString("${MISSING:-}", env)).toBe("");
  });

  it("keeps an empty value when the variable is set but empty", () => {
    expect(expandEnvString("${EMPTY:-fallback}", env)).toBe("");
  });

  it("ignores names that are not valid variable identifiers", () => {
    expect(expandEnvString("${1BAD}", env)).toBe("${1BAD}");
  });
});

describe("expandMcpServerConfig", () => {
  it("expands local commands, args and environment", () => {
    const config: McpServerConfig = {
      type: "local",
      command: ["docker", "run", "-e", "TFE_TOKEN=${TOKEN}", "server:${TAG:-latest}"],
      environment: { HOME: "${HOME_VAR:-/tmp}" },
      timeout: 5000,
    };
    expect(expandMcpServerConfig(config, env)).toEqual({
      type: "local",
      command: ["docker", "run", "-e", "TFE_TOKEN=s3cret", "server:latest"],
      environment: { HOME: "/tmp" },
      timeout: 5000,
    });
  });

  it("expands remote URLs and headers", () => {
    const config: McpServerConfig = {
      type: "remote",
      url: "https://example.com/${PATH_PART:-mcp}",
      headers: { Authorization: "Bearer ${TOKEN}" },
    };
    expect(expandMcpServerConfig(config, env)).toEqual({
      type: "remote",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer s3cret" },
    });
  });

  it("expands every server in a map", () => {
    const servers: Record<string, McpServerConfig> = {
      a: { type: "local", command: ["echo", "${TOKEN}"] },
      b: { type: "remote", url: "https://example.com/${MISSING:-x}" },
    };
    expect(expandMcpServers(servers, env)).toEqual({
      a: { type: "local", command: ["echo", "s3cret"] },
      b: { type: "remote", url: "https://example.com/x" },
    });
  });
});
