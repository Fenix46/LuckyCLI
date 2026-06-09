/**
 * Pure cursor/word primitives for the prompt's readline-style shortcuts.
 * Word boundaries follow the common shell behavior: a word is a run of
 * non-whitespace; jumps skip any whitespace between the cursor and the word.
 */

/** Offset of the start of the word left of `offset` (Alt+←, Ctrl+W target). */
export function wordLeft(text: string, offset: number): number {
  let i = Math.max(0, Math.min(offset, text.length));
  while (i > 0 && isSpace(text[i - 1]!)) i--;
  while (i > 0 && !isSpace(text[i - 1]!)) i--;
  return i;
}

/** Offset just past the end of the word right of `offset` (Alt+→). */
export function wordRight(text: string, offset: number): number {
  let i = Math.max(0, Math.min(offset, text.length));
  while (i < text.length && isSpace(text[i]!)) i++;
  while (i < text.length && !isSpace(text[i]!)) i++;
  return i;
}

/** Delete the word left of the cursor (Ctrl+W). */
export function deleteWordLeft(
  text: string,
  offset: number,
): { text: string; offset: number } {
  const start = wordLeft(text, offset);
  return { text: text.slice(0, start) + text.slice(offset), offset: start };
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n";
}
