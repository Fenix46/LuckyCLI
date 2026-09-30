import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CLI entry point", () => {
  // tsc hoists the automatic `react/jsx-runtime` import to the top of a file
  // that uses JSX, ahead of env.js — loading React in dev mode before NODE_ENV
  // is set, next to the production reconciler, and the TUI renders nothing.
  it("contains no JSX, so env.js runs before React loads", () => {
    const source = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
    const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/<[A-Z][A-Za-z.]*[\s/>]/);
    expect(code.indexOf('import "./env.js"')).toBeLessThan(code.indexOf('from "react"'));
  });
});
