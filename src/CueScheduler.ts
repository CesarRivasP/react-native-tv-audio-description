import type { DescriptionCue } from './track';
import { log } from './log';

/**
 * Playback position becomes "fire this cue now, once".
 *
 * The invariant this file exists to hold: a cue fires only while position is
 * inside its own window. A cue whose window has already passed is DROPPED,
 * never played late — a late cue is a cue playing over dialogue, which is the
 * one thing worse than no description.
 */

export interface SchedulerEvents {
  onFire: (cue: DescriptionCue) => void;
}

export class CueScheduler {
  private cues: DescriptionCue[] = [];
  private cursor = 0;
  private firing: DescriptionCue | null = null;
  private enabled = true;

  constructor(private readonly events: SchedulerEvents) {}

  /** `failed` cues carry no audio; they never enter the schedule. */
  load(cues: DescriptionCue[]): void {
    this.cues = cues
      .filter((c) => c.status === 'ok' && c.audio_uri !== '')
      .sort((a, b) => a.start_ms - b.start_ms);
    this.cursor = 0;
    this.firing = null;
    log(`scheduler.load cues=${this.cues.length}`);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.firing = null;
  }

  /** Called on every position update from the platform. */
  tick(positionMs: number): void {
    if (!this.enabled) return;

    // Advance past every cue whose window closed while we were elsewhere.
    while (this.cursor < this.cues.length && this.cues[this.cursor]!.end_ms <= positionMs) {
      const skipped = this.cues[this.cursor]!;
      if (skipped !== this.firing) {
        log(`scheduler.skip id=${skipped.id} pos_ms=${positionMs}`);
      }
      this.cursor++;
    }

    const next = this.cues[this.cursor];
    if (!next) return;

    // Fire only INSIDE the window. Never before it, never after it.
    if (positionMs >= next.start_ms && positionMs < next.end_ms && this.firing !== next) {
      this.firing = next;
      this.cursor++;
      log(
        `scheduler.fire id=${next.id} pos_ms=${positionMs}` +
          ` window=[${next.start_ms},${next.end_ms})`,
      );
      this.events.onFire(next);
    }
  }

  /**
   * Called with the SETTLED position after a seek — not with each
   * intermediate position a held direction produces. Resets the cursor to the
   * first cue that has not closed yet, so no backlog fires.
   */
  resync(positionMs: number): void {
    let lo = 0;
    let hi = this.cues.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cues[mid]!.end_ms <= positionMs) lo = mid + 1;
      else hi = mid;
    }
    this.cursor = lo;
    this.firing = null;
    log(`scheduler.resync pos_ms=${positionMs} cursor=${this.cursor}`);
  }
}

/**
 * The input half of seeking. A held D-pad direction emits a stream of key
 * events; acting on each one produces a seek storm and a resync per event.
 * This defers the action until the stream stops for `quietMs`.
 */
export function coalesce(fn: (value: number) => void, quietMs = 250) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = 0;
  let events = 0;

  return (value: number): void => {
    pending = value;
    events++;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      log(`scheduler.coalesced events=${events} settled_ms=${pending}`);
      events = 0;
      timer = null;
      fn(pending);
    }, quietMs);
  };
}
