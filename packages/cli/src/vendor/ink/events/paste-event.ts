/**
 * STUB — `paste-event.ts` was referenced by event-handlers.ts but not present
 * in the leaked Claude Code source. Only the type is used (onPaste handler
 * signature), reconstructed from the bracketed-paste use case.
 */
import { Event } from "./event.js";

export class PasteEvent extends Event {
  /** The pasted text payload (bracketed-paste mode). */
  readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }
}
