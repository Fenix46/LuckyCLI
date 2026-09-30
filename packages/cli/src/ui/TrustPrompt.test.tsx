import React from "react";
import { describe, expect, it } from "vitest";
import { renderToScreen, scanPositions } from "../vendor/ink/render-to-screen.js";
import { TrustPrompt } from "./TrustPrompt.js";

describe("TrustPrompt", () => {
  it("offers trust and the graph as one choice, recommended first", () => {
    const { screen } = renderToScreen(<TrustPrompt cwd="/work/app" onDone={() => {}} />, 110);
    expect(scanPositions(screen, "❯ Trust this folder and build the knowledge graph (recommended)")).toHaveLength(1);
    expect(scanPositions(screen, "Trust this folder, skip the graph")).toHaveLength(1);
    expect(scanPositions(screen, "Don't trust this folder")).toHaveLength(1);
  });
});
