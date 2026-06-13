import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  imageMimeForPath,
  extractImagePaths,
  buildTurnContent,
  formatImageRef,
  nextImageId,
  loadImage,
  pruneOrphanedImages,
  type AttachedImages,
} from "./image-input.js";

describe("imageMimeForPath", () => {
  it("maps known image extensions, case-insensitively", () => {
    expect(imageMimeForPath("/a/b.png")).toBe("image/png");
    expect(imageMimeForPath("shot.JPG")).toBe("image/jpeg");
    expect(imageMimeForPath("x.jpeg")).toBe("image/jpeg");
    expect(imageMimeForPath("y.webp")).toBe("image/webp");
  });
  it("returns undefined for non-images", () => {
    expect(imageMimeForPath("notes.txt")).toBeUndefined();
    expect(imageMimeForPath("/no/ext")).toBeUndefined();
  });
});

describe("extractImagePaths", () => {
  it("separates image paths from leftover text", () => {
    const { images, rest } = extractImagePaths("/tmp/a.png");
    expect(images).toEqual(["/tmp/a.png"]);
    expect(rest).toBe("");
  });
  it("keeps non-image tokens as rest", () => {
    const { images, rest } = extractImagePaths("look at this hello.txt");
    expect(images).toEqual([]);
    expect(rest).toBe("look at this hello.txt");
  });
  it("handles space-escaped and quoted paths", () => {
    expect(extractImagePaths("/My\\ Pics/a.png").images).toEqual(["/My Pics/a.png"]);
    expect(extractImagePaths('"/q path/b.jpg"').images).toEqual(["/q path/b.jpg"]);
  });
  it("splits multiple dropped paths", () => {
    const { images } = extractImagePaths("/a.png /b.jpeg");
    expect(images).toEqual(["/a.png", "/b.jpeg"]);
  });
});

describe("buildTurnContent", () => {
  const images: AttachedImages = {
    1: { id: 1, data: "AAAA", mimeType: "image/png" },
    2: { id: 2, data: "BBBB", mimeType: "image/jpeg" },
  };

  it("returns a plain string when no placeholders are present", () => {
    expect(buildTurnContent("just text", images)).toBe("just text");
  });

  it("builds text + image parts in placeholder order", () => {
    const content = buildTurnContent("describe [Image #1] and [Image #2]", images);
    expect(content).toEqual([
      { type: "text", text: "describe and" },
      { type: "image", data: "AAAA", mimeType: "image/png" },
      { type: "image", data: "BBBB", mimeType: "image/jpeg" },
    ]);
  });

  it("omits the text part when only an image was sent", () => {
    expect(buildTurnContent("[Image #1]", images)).toEqual([
      { type: "image", data: "AAAA", mimeType: "image/png" },
    ]);
  });

  it("ignores placeholders with no matching attachment", () => {
    expect(buildTurnContent("hi [Image #9]", images)).toBe("hi [Image #9]");
  });
});

describe("pruneOrphanedImages", () => {
  it("drops attachments whose placeholder is gone", () => {
    const images: AttachedImages = {
      1: { id: 1, data: "A", mimeType: "image/png" },
      2: { id: 2, data: "B", mimeType: "image/png" },
    };
    const pruned = pruneOrphanedImages("kept [Image #2]", images);
    expect(Object.keys(pruned)).toEqual(["2"]);
  });
});

describe("ids and refs", () => {
  it("formats and allocates ids", () => {
    expect(formatImageRef(3)).toBe("[Image #3]");
    expect(nextImageId({})).toBe(1);
    expect(nextImageId({ 1: { id: 1, data: "", mimeType: "" }, 4: { id: 4, data: "", mimeType: "" } })).toBe(5);
  });
});

describe("loadImage", () => {
  it("reads a file and base64-encodes it", () => {
    const dir = mkdtempSync(join(tmpdir(), "lucky-img-"));
    const path = join(dir, "p.png");
    writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const img = loadImage(path, 7);
    expect(img).toEqual({ id: 7, data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"), mimeType: "image/png" });
  });
  it("throws on an unsupported type", () => {
    expect(() => loadImage("/x/y.txt", 1)).toThrow(/Unsupported/);
  });
});
