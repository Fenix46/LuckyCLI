/**
 * Ambient module declarations for packages the vendored Ink fork imports that
 * ship without (or with mismatched) TypeScript types.
 */

// React Compiler runtime: `c` exists at runtime (the memo-cache helper the
// React Compiler emits as `_c`), but React's published types don't declare the
// subpath. The vendored components are compiler output, so they all import it.
declare module "react/compiler-runtime" {
  export function c(size: number): unknown[];
}

// The fork detects the Bun runtime via the global `Bun` (stringWidth, wrapAnsi,
// semver use Bun.stringWidth when available). Lucky runs on Node; declare the
// global so the references typecheck (they're guarded by `typeof Bun`).
declare const Bun:
  | {
      stringWidth: (
        s: string,
        opts?: { countAnsiEscapeCodes?: boolean; ambiguousIsNarrow?: boolean },
      ) => number;
      semver: {
        order: (a: string, b: string) => -1 | 0 | 1;
        satisfies: (version: string, range: string) => boolean;
      };
      wrapAnsi: (input: string, columns: number, options?: unknown) => string;
      [key: string]: unknown;
    }
  | undefined;

// bidi-js ships JS without bundled types.
declare module "bidi-js" {
  const bidiFactory: () => {
    getEmbeddingLevels: (
      text: string,
      baseDirection?: string,
    ) => { levels: Uint8Array; paragraphs: unknown[] };
    getReorderSegments: (...args: unknown[]) => unknown;
    [key: string]: unknown;
  };
  export default bidiFactory;
}
