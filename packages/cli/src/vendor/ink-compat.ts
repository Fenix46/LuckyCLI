/**
 * Compatibility barrel that re-exports the vendored Ink fork under the same
 * names Lucky's UI imported from the `ink` npm package. Migrating the UI to the
 * fork is then a one-line import swap per file (`from "ink"` →
 * `from ".../vendor/ink-compat.js"`) instead of touching every <Box>/<Text>.
 *
 * The whole rendered tree must use a single reconciler; this barrel is the
 * single source for it. Anything the fork names differently (terminal size,
 * animation) is adapted here so call sites stay unchanged.
 */
import { useContext } from "react";
import VendorBox from "./ink/components/Box.js";
import VendorText from "./ink/components/Text.js";
import {
  TerminalSizeContext,
  type TerminalSize,
} from "./ink/components/TerminalSizeContext.js";

export { default as Box } from "./ink/components/Box.js";
export { default as Text } from "./ink/components/Text.js";
export { default as useInput } from "./ink/hooks/use-input.js";
export { default as useApp } from "./ink/hooks/use-app.js";
export { default as useStdin } from "./ink/hooks/use-stdin.js";
export { default as measureElement } from "./ink/measure-element.js";
export { stringWidth } from "./ink/stringWidth.js";
export type { DOMElement } from "./ink/dom.js";
export type { Key } from "./ink/events/input-event.js";

// Prop types, so call sites that referenced ink's BoxProps/TextProps still type.
export type BoxProps = React.ComponentProps<typeof VendorBox>;
export type TextProps = React.ComponentProps<typeof VendorText>;

/**
 * `useWindowSize` shim. Stock Ink exposes terminal dimensions via a hook; the
 * fork provides them through TerminalSizeContext (populated by the fork's App).
 * Falls back to process.stdout when rendered outside the provider (e.g. tests).
 */
export function useWindowSize(): TerminalSize {
  const ctx = useContext(TerminalSizeContext);
  if (ctx) return ctx;
  return {
    columns: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  };
}
