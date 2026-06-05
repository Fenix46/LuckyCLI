/**
 * STUB — `resize-event.ts` was referenced by event-handlers.ts but not present
 * in the leaked Claude Code source. Only the type is used (onResize handler
 * signature), reconstructed from the terminal-resize use case.
 */
import { Event } from "./event.js";

export class ResizeEvent extends Event {
  /** New terminal width in columns. */
  readonly columns: number;
  /** New terminal height in rows. */
  readonly rows: number;

  constructor(columns: number, rows: number) {
    super();
    this.columns = columns;
    this.rows = rows;
  }
}
