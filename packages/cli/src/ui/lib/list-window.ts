export interface ListWindow {
  /** Index of the first visible row. */
  start: number;
  /** One past the last visible row. */
  end: number;
  /** Rows hidden above / below the window. */
  above: number;
  below: number;
}

/**
 * The slice of a long list to render so it stays at most `max` rows tall while
 * the selected row is always visible. The selection sits mid-window when it
 * can, so a scrolling list shows context on both sides; at the ends the window
 * pins to the edge instead of leaving blank rows.
 */
export function listWindow(total: number, selected: number, max: number): ListWindow {
  if (max <= 0 || total <= max) return { start: 0, end: total, above: 0, below: 0 };
  const clamped = Math.min(Math.max(selected, 0), total - 1);
  const start = Math.min(Math.max(clamped - Math.floor(max / 2), 0), total - max);
  const end = start + max;
  return { start, end, above: start, below: total - end };
}
