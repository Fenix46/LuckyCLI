import { describe, expect, it } from "vitest";
import { splitStreaming, streamBoundary } from "./streaming.js";

describe("splitStreaming", () => {
  it("keeps a single growing block fully unstable", () => {
    const { stable, unstable } = splitStreaming("the model is still writing this");
    expect(stable).toBe("");
    expect(unstable).toBe("the model is still writing this");
  });

  it("commits a finished paragraph once a blank line follows it", () => {
    const { stable, unstable } = splitStreaming("first paragraph\n\nsecond para");
    expect(stable).toBe("first paragraph\n\n");
    expect(unstable).toBe("second para");
  });

  it("does not commit an unterminated code fence", () => {
    const { stable, unstable } = splitStreaming("intro\n\n```ts\nconst x = 1;");
    expect(stable).toBe("intro\n\n");
    expect(unstable).toBe("```ts\nconst x = 1;");
  });

  it("commits a code fence once it closes", () => {
    const { stable, unstable } = splitStreaming("```ts\nconst x = 1;\n```\nnext");
    expect(stable).toBe("```ts\nconst x = 1;\n```\n");
    expect(unstable).toBe("next");
  });

  it("never returns a boundary below the committed lower bound", () => {
    const text = "first\n\nsecond\n\nthird in progress";
    // pretend everything up to and including the second blank line is committed
    const committed = "first\n\nsecond\n\n".length;
    const { stable, unstable } = splitStreaming(text, committed);
    expect(stable.length).toBeGreaterThanOrEqual(committed);
    expect(unstable).toBe("third in progress");
  });
});

describe("streamBoundary", () => {
  it("returns 0 when no block has finished", () => {
    expect(streamBoundary("still going")).toBe(0);
  });

  it("honors the lower bound", () => {
    expect(streamBoundary("abc", 2)).toBe(2);
  });
});
