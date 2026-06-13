// Image attachments for the prompt input.
//
// When the user drags an image file onto the terminal (or pastes its path),
// the terminal delivers the file path as text. We detect image-looking paths,
// stash the loaded image out of the visible input behind a compact `[Image #1]`
// placeholder, and expand the placeholders into canonical ImagePart content at
// submit time — mirroring how paste.ts handles large text.

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { ContentPart } from "@luckycli/core";

/** A loaded image held out of the visible input. */
export interface AttachedImage {
  id: number;
  /** base64-encoded image data (no data: prefix). */
  data: string;
  mimeType: string;
}

export type AttachedImages = Record<number, AttachedImage>;

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Whether a path's extension names a supported image type. */
export function imageMimeForPath(path: string): string | undefined {
  return EXT_TO_MIME[extname(path).toLowerCase()];
}

/**
 * Pull image file paths out of a freshly pasted/dropped chunk.
 *
 * Dragging from a file manager commonly yields a single path, sometimes
 * shell-escaped (`/My\ Pics/a.png`) or wrapped in quotes, and multiple files
 * arrive newline- or space-separated. We unescape and unquote, then keep only
 * the tokens whose extension is a supported image. Returns the image paths and
 * the leftover (non-image) text so the caller can keep typing.
 */
export function extractImagePaths(text: string): { images: string[]; rest: string } {
  const tokens = text
    .split(/\r\n|\r|\n/)
    .flatMap((line) => tokenize(line.trim()))
    .filter((t) => t.length > 0);

  const images: string[] = [];
  const leftover: string[] = [];
  for (const token of tokens) {
    const path = unquote(token).replace(/\\ /g, " ");
    if (imageMimeForPath(path)) images.push(path);
    else leftover.push(token);
  }
  return { images, rest: leftover.join(" ") };
}

// Split a line into tokens: a quoted run ("..."/'...') stays whole, otherwise
// split on spaces that are NOT backslash-escaped (so `/a\ b.png c.png` → two).
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  const re = /"[^"]*"|'[^']*'|(?:\\ |\S)+/g;
  for (const match of line.matchAll(re)) tokens.push(match[0]);
  return tokens;
}

function unquote(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

/** Render the placeholder shown in the input for an attached image. */
export function formatImageRef(id: number): string {
  return `[Image #${id}]`;
}

/** Next free id given the images already attached. */
export function nextImageId(images: AttachedImages): number {
  const ids = Object.keys(images).map(Number);
  return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

/**
 * Load an image file into an AttachedImage. Throws if the file can't be read or
 * isn't a supported image type, so the caller can surface the error instead of
 * silently dropping it.
 */
export function loadImage(path: string, id: number): AttachedImage {
  const mimeType = imageMimeForPath(path);
  if (!mimeType) throw new Error(`Unsupported image type: ${path}`);
  const data = readFileSync(path).toString("base64");
  return { id, data, mimeType };
}

const REF_PATTERN = /\[Image #(\d+)\]/g;

/**
 * Build the canonical ContentPart[] for a turn: the text (with image
 * placeholders removed) followed by an ImagePart per referenced attachment, in
 * placeholder order. Returns a plain string when there are no images, so a
 * text-only turn keeps the cheap string path.
 */
export function buildTurnContent(
  input: string,
  images: AttachedImages,
): string | ContentPart[] {
  const referenced = [...input.matchAll(REF_PATTERN)]
    .map((m) => Number(m[1]))
    .filter((id) => images[id]);

  if (referenced.length === 0) return input;

  const text = input.replace(REF_PATTERN, "").replace(/[ \t]+/g, " ").trim();
  const parts: ContentPart[] = [];
  if (text) parts.push({ type: "text", text });
  for (const id of referenced) {
    const img = images[id]!;
    parts.push({ type: "image", data: img.data, mimeType: img.mimeType });
  }
  return parts;
}

/** Drop attachments whose placeholder no longer appears in the input. */
export function pruneOrphanedImages(input: string, images: AttachedImages): AttachedImages {
  const present = new Set([...input.matchAll(REF_PATTERN)].map((m) => Number(m[1])));
  const next: AttachedImages = {};
  for (const [id, image] of Object.entries(images)) {
    if (present.has(Number(id))) next[Number(id)] = image;
  }
  return next;
}
