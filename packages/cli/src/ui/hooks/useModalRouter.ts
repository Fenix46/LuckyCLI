import { useInput, type Key } from "../../vendor/ink-compat.js";

export interface ModalHandler {
  /** Modal is currently visible/owning the keyboard. */
  active: boolean;
  /**
   * Handle a key; return true when consumed (stops the walk). Modals that
   * swallow every key while open (approval, panels) always return true;
   * pickers that share keys with ChatInput (model/theme/slash menu) return
   * false for keys they don't handle so typing still reaches the input.
   */
  onInput(input: string, key: Key): boolean;
}

/** Walk the handlers in order; pure, exported for tests. True = consumed. */
export function routeInput(handlers: ModalHandler[], input: string, key: Key): boolean {
  for (const handler of handlers) {
    if (!handler.active) continue;
    if (handler.onInput(input, key)) return true;
  }
  return false;
}

export interface ModalRouterOptions {
  /** Runs before any handler (global Shift+Tab); true = consumed. */
  pre?(input: string, key: Key, anyModalActive: boolean): boolean;
  /** Runs when no active handler consumed the key (esc/ctrl+c fallthrough). */
  fallthrough?(input: string, key: Key): void;
}

/**
 * One useInput for all of App's modals. The handlers array literal at the
 * call site IS the precedence chain, readable top to bottom. Handlers close
 * over App state, so the array is rebuilt every render — useInput always
 * sees the current one.
 */
export function useModalRouter(
  handlers: ModalHandler[],
  options: ModalRouterOptions = {},
): { anyModalActive: boolean } {
  const anyModalActive = handlers.some((handler) => handler.active);
  useInput((input, key) => {
    if (options.pre?.(input, key, anyModalActive)) return;
    if (routeInput(handlers, input, key)) return;
    options.fallthrough?.(input, key);
  });
  return { anyModalActive };
}
