/**
 * Fuzzy matching for the slash-command menu.
 *
 * Exact and prefix matches always beat a scattered subsequence, so typing
 * `/mod` keeps `/model` above an unrelated command that merely contains the
 * letters. Within the same score the registry order wins, except for commands
 * used recently in this session, which are lifted to the top.
 *
 * The returned positions are indices in the name *without* the leading slash,
 * ready for the menu's highlight.
 */
export interface FuzzyMatch {
  score: number;
  positions: number[];
}

export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q === "") return { score: 0, positions: [] };
  if (q === t) return { score: 1000, positions: [...t].map((_, index) => index) };
  if (t.startsWith(q)) {
    return { score: 900 - (t.length - q.length), positions: [...q].map((_, index) => index) };
  }

  // Subsequence: every query char in order. Consecutive runs and word starts
  // score higher, so `/mcp` prefers "mcp-server" over "my-copy-paste".
  const positions: number[] = [];
  let from = 0;
  let score = 100;
  let previous = -2;
  for (const char of q) {
    const index = t.indexOf(char, from);
    if (index === -1) return null;
    positions.push(index);
    if (index === previous + 1) score += 12;
    if (index === 0 || t[index - 1] === "-" || t[index - 1] === ":" || t[index - 1] === "_") score += 8;
    score -= index * 0.5;
    previous = index;
    from = index + 1;
  }
  return { score: Math.round(score), positions };
}

export interface CommandMatch<T> {
  item: T;
  positions: number[];
}

/**
 * Filter and order entries for the menu. `recent` is a most-recent-first list
 * of command names (with or without the slash); matching names get a large
 * bonus without bypassing the fuzzy filter.
 */
export function filterCommands<T extends { name: string }>(
  entries: readonly T[],
  query: string,
  recent: readonly string[] = [],
): CommandMatch<T>[] {
  const recentRank = new Map<string, number>();
  recent.forEach((name, index) => {
    if (!recentRank.has(name)) recentRank.set(name, index);
  });

  const matches: Array<CommandMatch<T> & { order: number; rank: number; score: number }> = [];
  entries.forEach((item, order) => {
    const name = item.name.startsWith("/") ? item.name.slice(1) : item.name;
    const match = fuzzyMatch(query, name);
    if (!match) return;
    const rank = recentRank.get(item.name) ?? recentRank.get(name);
    matches.push({
      item,
      positions: match.positions,
      score: match.score,
      order,
      rank: rank === undefined ? Number.POSITIVE_INFINITY : rank,
    });
  });

  matches.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.score !== b.score) return b.score - a.score;
    return a.order - b.order;
  });
  return matches.map(({ item, positions }) => ({ item, positions }));
}
