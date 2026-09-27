import type { VideoPlayer } from './MediaAdapter';
import { AD } from './budget';

/** how often the fade writes; a floor, since timers on a TV may fire late */
const STEP_MS = 16;

/**
 * Fade the main track between two volume percentages over `rampMs`.
 *
 * The platform setter is instantaneous (PLATFORM.md `no_volume_ramp`), so the
 * ramp is stepped here. Written once, in one place, because a fade duplicated
 * per platform is a fade that differs per platform — which is also why
 * `VideoPlayer.setVolumePct` takes no `rampMs`.
 *
 * Each step sets the level for the time ELAPSED, not for its step number. On
 * the Vega Virtual Device a fade counted in 13 steps of 16 ms took about
 * 510 ms instead of 200 — timers fire late there — and the film came back up
 * after its dialogue window had closed (PLATFORM.md `coarse_timers`).
 */
export async function rampVolumePct(
  video: VideoPlayer,
  fromPct: number,
  toPct: number,
  rampMs: number = AD.DUCK_RAMP_MS,
  /**
   * Checked between steps. A fade is a loop that outlives the reason it
   * started: unmount the screen mid-duck and it keeps stepping the volume of a
   * player that is being torn down, toward a target nobody wants any more.
   */
  isCancelled: () => boolean = () => false,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (isCancelled()) return;
    const t = rampMs > 0 ? Math.min(1, (Date.now() - start) / rampMs) : 1;
    // t reaches exactly 1, so the fade lands exactly on the target: rounding
    // must never leave the film at 99% forever.
    video.setVolumePct(t >= 1 ? toPct : fromPct + (toPct - fromPct) * t);
    if (t >= 1) return;
    await new Promise((r) => setTimeout(r, STEP_MS));
  }
}
