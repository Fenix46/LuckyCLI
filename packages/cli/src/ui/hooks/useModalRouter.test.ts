import { describe, expect, it } from "vitest";
import { routeInput, type ModalHandler } from "./useModalRouter.js";
import type { Key } from "../../vendor/ink-compat.js";

const key = {} as Key;

function handler(active: boolean, consume: boolean, log: string[], name: string): ModalHandler {
  return {
    active,
    onInput() {
      log.push(name);
      return consume;
    },
  };
}

describe("routeInput", () => {
  it("skips inactive handlers entirely", () => {
    const log: string[] = [];
    const consumed = routeInput(
      [handler(false, true, log, "a"), handler(true, true, log, "b")],
      "x",
      key,
    );
    expect(consumed).toBe(true);
    expect(log).toEqual(["b"]);
  });

  it("stops at the first handler that consumes", () => {
    const log: string[] = [];
    routeInput(
      [handler(true, true, log, "first"), handler(true, true, log, "second")],
      "x",
      key,
    );
    expect(log).toEqual(["first"]);
  });

  it("falls through active handlers that do not consume", () => {
    const log: string[] = [];
    const consumed = routeInput(
      [handler(true, false, log, "picker"), handler(true, true, log, "menu")],
      "x",
      key,
    );
    expect(consumed).toBe(true);
    expect(log).toEqual(["picker", "menu"]);
  });

  it("reports unconsumed input so the caller can run the fallthrough", () => {
    const log: string[] = [];
    const consumed = routeInput([handler(true, false, log, "picker")], "x", key);
    expect(consumed).toBe(false);
  });

  it("handles an empty chain", () => {
    expect(routeInput([], "x", key)).toBe(false);
  });
});
