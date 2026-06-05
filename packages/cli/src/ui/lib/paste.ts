// Large-paste handling for the prompt input.
//
// When you paste a big block of text the terminal delivers it as a single
// input chunk. Inserting it verbatim floods the prompt (and forces Ink to
// repaint the whole screen). Instead we stash the content in a map keyed by an
// auto-incrementing id and drop a compact placeholder — `[Pasted text #1 +42
// lines]` — into the input. The real content is spliced back in at submit time
// by `expandPastedRefs`. Contents live in memory only (per session); they are
// gone once the prompt is sent or cleared.

/** A chunk of pasted text held out of the visible input. */
export interface PastedContent {
  id: number;
  content: string;
}

/** Map of placeholder id -> stashed paste content. */
export type PastedContents = Record<number, PastedContent>;

// A paste becomes a placeholder when it is longer than this many characters...
export const PASTE_CHAR_THRESHOLD = 1000;
// ...or spans more than this many newlines. Matches Claude Code's "keep the
// input a couple of lines tall" behaviour so multi-line snippets collapse too.
export const PASTE_LINE_THRESHOLD = 2;

/** Count the newlines in a string (a paste with N newlines is "+N lines"). */
export function countLines(text: string): number {
  const matches = text.match(/\r\n|\r|\n/g);
  return matches ? matches.length : 0;
}

/** Render the placeholder shown in the input for a stashed paste. */
export function formatPastedRef(id: number, numLines: number): string {
  if (numLines === 0) return `[Pasted text #${id}]`;
  return `[Pasted text #${id} +${numLines} lines]`;
}

/** Whether a freshly pasted chunk is big enough to stash behind a placeholder. */
export function shouldStashPaste(text: string): boolean {
  return text.length > PASTE_CHAR_THRESHOLD || countLines(text) > PASTE_LINE_THRESHOLD;
}

/** Next free id given the contents already stashed. */
export function nextPasteId(contents: PastedContents): number {
  const ids = Object.keys(contents).map(Number);
  return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

const REF_PATTERN = /\[Pasted text #(\d+)(?: \+\d+ lines)?\]/g;

/**
 * Replace every `[Pasted text #N ...]` placeholder in `input` with its stashed
 * content. Splices from the end so earlier match offsets stay valid, and so a
 * placeholder-looking string *inside* pasted content is never re-expanded.
 */
export function expandPastedRefs(input: string, contents: PastedContents): string {
  const matches = [...input.matchAll(REF_PATTERN)];
  let expanded = input;
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i]!;
    const id = Number(match[1]);
    const stashed = contents[id];
    if (!stashed) continue;
    const index = match.index ?? 0;
    expanded = expanded.slice(0, index) + stashed.content + expanded.slice(index + match[0].length);
  }
  return expanded;
}

/** Drop stashed entries whose placeholder no longer appears in the input. */
export function pruneOrphanedPastes(input: string, contents: PastedContents): PastedContents {
  const present = new Set([...input.matchAll(REF_PATTERN)].map((m) => Number(m[1])));
  const next: PastedContents = {};
  for (const [id, content] of Object.entries(contents)) {
    if (present.has(Number(id))) next[Number(id)] = content;
  }
  return next;
}
