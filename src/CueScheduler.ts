import type { DescriptionCue } from './track';
import { AD } from './budget';
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

export interface SchedulerOptions {
  /**
   * How long a cue needs, from firing to the film being back at full. A cue
   * is only fired if that much of its window is left. Default: its words at
   * the narration pace plus the fade down and up — pass a better figure if you
   * have the clips' real durations.
   */
  estimateMs?: (cue: DescriptionCue) => number;
}

/** words at the narration pace, plus the fade down and the fade back up */
export function estimateCueMs(cue: DescriptionCue): number {
  return (cue.words / AD.SPEAKING_RATE_WPM) * 60_000 + 2 * AD.DUCK_RAMP_MS;
}

export class CueScheduler {
  private cues: DescriptionCue[] = [];
  private cursor = 0;
  private firing: DescriptionCue | null = null;
  private enabled = true;

  private readonly estimateMs: (cue: DescriptionCue) => number;

  constructor(
    private readonly events: SchedulerEvents,
    options: SchedulerOptions = {},
  ) {
    this.estimateMs = options.estimateMs ?? estimateCueMs;
  }

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

    // Fire only INSIDE the window, and only if the cue can FINISH there. A cue
    // reached late — description switched back on, a seek into the middle of a
    // gap — would otherwise still be speaking when dialogue resumes. Measured
    // on the Vega Virtual Device: switched on 2.5 s before its window closed, a
    // 2.6 s cue brought the film back up half a second into the next line.
    if (positionMs >= next.start_ms && positionMs < next.end_ms && this.firing !== next) {
      const remaining = next.end_ms - positionMs;
      const needs = Math.round(this.estimateMs(next));
      if (remaining < needs) {
        this.cursor++;
        log(
          `scheduler.skip id=${next.id} pos_ms=${positionMs} reason=late` +
            ` remaining_ms=${remaining} needs_ms=${needs}`,
        );
        return;
      }
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
