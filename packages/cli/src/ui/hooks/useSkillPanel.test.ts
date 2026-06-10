import { describe, expect, it } from "vitest";
import { toggleTab } from "./useSkillPanel.js";

describe("toggleTab", () => {
  it("flips between installed and search", () => {
    expect(toggleTab("installed")).toBe("search");
    expect(toggleTab("search")).toBe("installed");
  });
});
