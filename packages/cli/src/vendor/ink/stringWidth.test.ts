import { describe, expect, it } from "vitest";
import { stringWidth } from "./stringWidth.js";

describe("stringWidth", () => {
  it("counts text-presentation symbols as one column, like terminals do", () => {
    for (const symbol of ["✖", "⚠", "☘", "✓", "✕"]) expect(stringWidth(symbol)).toBe(1);
    expect(stringWidth("✖ Failed")).toBe(8);
  });

  it("keeps real emoji two columns wide", () => {
    for (const emoji of ["✅", "🍀", "✨", "❌", "⚠️", "👍🏽", "👨‍👩‍👧", "🇮🇹"]) expect(stringWidth(emoji)).toBe(2);
  });
});
