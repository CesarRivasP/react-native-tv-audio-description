import type { VideoPlayer } from './MediaAdapter';
import { AD } from './budget';

/** one step per frame at 60 Hz, near enough for a 200 ms fade */
const STEP_MS = 16;

/**
 * Fade the main track between two volume percentages over `rampMs`.
 *
 * The platform setter is instantaneous (PLATFORM.md `no_volume_ramp`), so the
 * ramp is stepped here. Written once, in one place, because a fade duplicated
 * per platform is a fade that differs per platform — which is also why
 * `VideoPlayer.setVolumePct` takes no `rampMs`.
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
  const steps = Math.max(1, Math.round(rampMs / STEP_MS));
  for (let i = 1; i <= steps; i++) {
    if (isCancelled()) return;
    video.setVolumePct(fromPct + ((toPct - fromPct) * i) / steps);
    if (i < steps) await new Promise((r) => setTimeout(r, STEP_MS));
  }
  if (isCancelled()) return;
  // Land exactly on the target: accumulated rounding must never leave the film
  // at 99% forever.
  video.setVolumePct(toPct);
}
