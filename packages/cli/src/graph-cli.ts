import type { BlastRadius, GraphImpact } from "@luckycli/core";

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

/** Transitive dependents of one node, grouped as "what could break". */
export function blastRadiusLines(label: string, radius: BlastRadius, maxDepth: number): string[] {
  if (radius.dependents.length === 0) {
    return [`Transitive impact of ${label}: nothing in the project depends on it.`];
  }
  const lines = [
    `Transitive impact of ${label} (up to ${maxDepth} hops): ${count(radius.dependents.length, "dependent")} in ${count(radius.files.length, "file")}${radius.truncated ? " (truncated)" : ""}`,
  ];
  for (const { node, depth, relation } of radius.dependents) {
    const location = node.sourceLocation ? `${node.sourceFile}:${node.sourceLocation}` : node.sourceFile;
    lines.push(`  ${depth === 1 ? "direct" : `${depth} hops`}  ${relation}  ${node.label} [${node.kind}]  ${location}`);
  }
  lines.push("Files to review:", ...radius.files.map((file) => `  ${file}`));
  return lines;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
