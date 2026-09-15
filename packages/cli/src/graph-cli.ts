import type { GraphImpact } from "@luckycli/core";

/** Format graph impact results for humans and shell logs. */
export function graphImpactLines(query: string, impacts: GraphImpact[]): string[] {
  if (impacts.length === 0) return [`No graph nodes matched "${query}".`];
  const lines = [`Impact for "${query}":`];
  for (const impact of impacts) {
    const location = impact.node.sourceLocation
      ? `${impact.node.sourceFile}:${impact.node.sourceLocation}`
      : impact.node.sourceFile;
    lines.push(`${impact.node.label} [${impact.node.kind}]  ${location}`);
    for (const neighbor of impact.neighbors) {
      const arrow = neighbor.direction === "in" ? "←" : "→";
      const neighborLocation = neighbor.node.sourceLocation
        ? `${neighbor.node.sourceFile}:${neighbor.node.sourceLocation}`
        : neighbor.node.sourceFile;
      lines.push(
        `  ${arrow} ${neighbor.relation}  ${neighbor.node.label} [${neighbor.node.kind}]  ${neighborLocation}`,
      );
    }
  }
  return lines;
}
