export interface Block {
  type: "paragraph" | "code" | "list" | "header";
  text: string;
  codeLines?: string[];
  language?: string;
  level?: number;
}

/** Split assistant text into renderable blocks (paragraphs, code, headers, lists). */
export function parseMessageIntoBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let currentCodeBlock: { language: string; lines: string[] } | null = null;
  let prevEmpty = false; // track if the previous block was an empty line

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (currentCodeBlock) {
        blocks.push({
          type: "code",
          text: "",
          codeLines: currentCodeBlock.lines,
          language: currentCodeBlock.language,
        });
        currentCodeBlock = null;
      } else {
        const lang = line.trim().slice(3).trim();
        currentCodeBlock = { language: lang || "code", lines: [] };
      }
      continue;
    }

    if (currentCodeBlock) {
      currentCodeBlock.lines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      // Only emit one empty-line block, skip consecutive whitespace-only lines
      if (prevEmpty) continue;
      blocks.push({ type: "paragraph", text: "" });
      prevEmpty = true;
      continue;
    }
    prevEmpty = false;

    const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      blocks.push({
        type: "header",
        text: headerMatch[2] ?? "",
        level: headerMatch[1]?.length ?? 1,
      });
      continue;
    }

    const listMatch = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/);
    if (listMatch) {
      blocks.push({
        type: "list",
        text: line,
      });
      continue;
    }

    blocks.push({
      type: "paragraph",
      text: line,
    });
  }

  if (currentCodeBlock) {
    blocks.push({
      type: "code",
      text: "",
      codeLines: currentCodeBlock.lines,
      language: currentCodeBlock.language,
    });
  }

  return blocks;
}
