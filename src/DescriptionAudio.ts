import type { MediaAdapter } from './MediaAdapter';
import { AD } from './budget';
import type { DescriptionCue } from './track';
import { rampVolumePct } from './duck';
import { log } from './log';

export interface DescriptionAudioOptions {
  /** main track level while a cue speaks, % of full (default 25) */
  duckTargetPct?: number;
  /** fade length into and out of the duck (default 200) */
  rampMs?: number;
}

/**
 * Duck, speak, restore.
 *
 * The cue plays as a SECOND stream over the film rather than by switching to
 * a pre-mixed track. On Vega that was measured to work: a video player and an
 * audio player built for accessibility speech ran simultaneously with zero
 * dropped frames (PLATFORM.md `concurrent_streams`).
 */
export class DescriptionAudio {
  private active = false;
  /**
   * Bumped by `stop()`. A cue in flight when the screen unmounts keeps running
   * — its `await` chain does not know the component is gone — and its
   * `finally` would then ramp the volume on a player that has been destroyed,
   * after `stop()` already restored it.
   */
  private generation = 0;
  private readonly duckPct: number;
  private readonly rampMs: number;

  constructor(
    private readonly media: MediaAdapter,
    options: DescriptionAudioOptions = {},
  ) {
    this.duckPct = options.duckTargetPct ?? AD.DUCK_TARGET_PCT;
    this.rampMs = options.rampMs ?? AD.DUCK_RAMP_MS;
    // Backgrounding during a cue must stop the clip and restore the main
    // level, or the app returns to the foreground ducked and silent.
    this.media.lifecycle.onBackground(() => {
      if (!this.active) return;
      log('audio.background active=true');
      void this.stop();
    });
  }

  async speak(cue: DescriptionCue): Promise<void> {
    if (this.active) return; // a cue already speaking is never interrupted by another
    this.active = true;
    const mine = this.generation;
    const stale = () => mine !== this.generation;

    try {
      log(`audio.duck id=${cue.id} to_pct=${this.duckPct}`);
      await rampVolumePct(this.media.video, 100, this.duckPct, this.rampMs, stale);
      await this.media.clips.play(cue.audio_uri);
      log(`audio.spoke id=${cue.id} words=${cue.words}`);
    } catch (err) {
      log(`audio.failed id=${cue.id} err=${(err as Error).message}`);
    } finally {
      // The main track ALWAYS returns to full, including on failure. A cue
      // that fails must not leave the film at 25% for the rest of the runtime.
      //
      // Unless stop() already did it: then this cue is stale, the player may
      // be torn down, and ramping again is work against a dead object.
      if (!stale()) {
        await rampVolumePct(this.media.video, this.duckPct, 100, this.rampMs, stale);
        log(`audio.restored id=${cue.id}`);
        this.active = false;
      }
    }
  }

  /**
   * Stop the cue that is speaking, if any, and bring the film back to full.
   * Safe to call at any time — turning description off, leaving the screen.
   */
  async stop(): Promise<void> {
    this.generation++; // anything in flight is now stale and must not restore
    this.media.clips.stop();
    // Nothing speaking means the film is already at full. Ramping "back" from
    // the duck level anyway would first SET it to the duck level: an audible
    // dip every time description is switched off between cues.
    if (!this.active) return;
    await rampVolumePct(this.media.video, this.duckPct, 100, this.rampMs);
    this.active = false;
  }
}
