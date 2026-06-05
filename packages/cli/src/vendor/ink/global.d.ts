/**
 * JSX intrinsic element declarations for the vendored Ink fork.
 *
 * The forked reconciler emits custom host elements (`ink-box`, `ink-text`, …)
 * instead of DOM tags. Claude Code's build generated this declaration file; it
 * was not present in the leaked source, so it is reconstructed here from the
 * elements the components actually emit (see components/*.tsx and dom.ts
 * `ElementNames`). Props are intentionally permissive — the reconciler reads
 * them dynamically — while the handful of statically-referenced props (style,
 * ref, event handlers, link href, raw-ansi geometry) are typed for editor help.
 */
import type { Ref } from "react";
import type { DOMElement } from "./dom.js";
import type { Styles } from "./styles.js";
import type { ClickEvent } from "./events/click-event.js";
import type { FocusEvent } from "./events/focus-event.js";
import type { KeyboardEvent } from "./events/keyboard-event.js";

type InkCommonProps = {
  ref?: Ref<DOMElement>;
  children?: React.ReactNode;
  tabIndex?: number;
  autoFocus?: boolean;
  onClick?: (event: ClickEvent) => void;
  onFocus?: (event: FocusEvent) => void;
  onFocusCapture?: (event: FocusEvent) => void;
  onBlur?: (event: FocusEvent) => void;
  onBlurCapture?: (event: FocusEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  onKeyDownCapture?: (event: KeyboardEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  style?: Styles;
};

type InkTextProps = InkCommonProps & {
  // Inner styling spans applied by Text (color/bg/bold/etc.).
  textStyles?: unknown;
};

type InkLinkProps = InkCommonProps & {
  href?: string;
};

type InkRawAnsiProps = InkCommonProps & {
  rawText?: string;
  rawWidth?: number;
  rawHeight?: number;
};

type InkProgressProps = InkCommonProps & Record<string, unknown>;

// React 19 moved the JSX namespace under `React.JSX` (the automatic runtime
// resolves intrinsic elements there, not the legacy global `JSX`). Augment both
// the module's React.JSX and the global JSX so the custom host elements resolve
// regardless of how a consumer's tsconfig is set up.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "ink-root": InkCommonProps;
      "ink-box": InkCommonProps;
      "ink-text": InkTextProps;
      "ink-virtual-text": InkTextProps;
      "ink-link": InkLinkProps;
      "ink-raw-ansi": InkRawAnsiProps;
      "ink-progress": InkProgressProps;
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "ink-root": InkCommonProps;
      "ink-box": InkCommonProps;
      "ink-text": InkTextProps;
      "ink-virtual-text": InkTextProps;
      "ink-link": InkLinkProps;
      "ink-raw-ansi": InkRawAnsiProps;
      "ink-progress": InkProgressProps;
    }
  }
}

export {};
