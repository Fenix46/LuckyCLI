import { describe, expect, it } from "vitest";
import { parseMessageIntoBlocks } from "./parse.js";

describe("parseMessageIntoBlocks", () => {
  it("splits a fenced code block into a code block with its language", () => {
    const blocks = parseMessageIntoBlocks("before\n```ts\nconst x = 1;\n```\nafter");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "code", "paragraph"]);
    const code = blocks[1];
    expect(code?.type).toBe("code");
    expect(code?.language).toBe("ts");
    expect(code?.codeLines).toEqual(["const x = 1;"]);
  });

  it("defaults the language to 'code' when the fence has none", () => {
    const blocks = parseMessageIntoBlocks("```\nplain\n```");
    expect(blocks[0]?.language).toBe("code");
  });

  it("recognizes headers and captures their level", () => {
    const blocks = parseMessageIntoBlocks("## Title");
    expect(blocks[0]).toMatchObject({ type: "header", text: "Title", level: 2 });
  });

  it("recognizes ordered and unordered list items", () => {
    const blocks = parseMessageIntoBlocks("- one\n2) two");
    expect(blocks.map((b) => b.type)).toEqual(["list", "list"]);
  });

  it("keeps an unterminated code block as a code block", () => {
    const blocks = parseMessageIntoBlocks("```js\nstill open");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "code", language: "js", codeLines: ["still open"] });
  });

  it("emits empty paragraphs for blank lines", () => {
    const blocks = parseMessageIntoBlocks("a\n\nb");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(blocks[1]?.text).toBe("");
  });
});
