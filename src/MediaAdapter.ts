import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * The only surface this library uses to reach a platform's media stack.
 *
 * Everything outside `src/vega/` is written against this interface and never
 * against a platform package; a test fails if that stops being true. Bring
 * your own implementation for another platform, or use the Vega one:
 *
 *   import { createVegaAdapter } from 'react-native-tv-audio-description/vega';
 *
 * Each platform defect the Vega implementation works around is kept OUT of
 * this interface on purpose — a caller that had to know about them would leak
 * one platform's defects into every other. They are listed in PLATFORM.md.
 */

export type Unsubscribe = () => void;

/** one piece of an asset, with times read from the emitted playlist */
export interface AssetSegment {
  index: number;
  start_ms: number;
  end_ms: number;
  uri: string;
}

/**
 * What to play, and how it is cut up.
 *
 * ALWAYS A LIST, even for a single file — a whole-file asset is one segment
 * with no init. One code path for both shapes means a short clip and a
 * feature-length film exercise the same buffering logic, rather than the
 * feature-length one taking a path nothing has ever run.
 */
export interface AssetSource {
  /** appended once, before any segment; absent for a whole-file asset */
  initUri?: string;
  segments: AssetSegment[];
}

export interface VideoPlayer {
  /**
   * Point the player at an asset and get it ready to play.
   *
   * Implementations must NOT assume the platform will fetch anything. On Vega
   * it will not (PLATFORM.md `url_mode_broken`) and the implementation reads
   * the bytes itself — nor can it read PART of a file (`no_range_requests`),
   * which is why the asset arrives already cut into segments.
   */
  open(source: AssetSource): Promise<void>;
  play(): Promise<void>;
  pause(): void;

  /** current playback position, ms */
  positionMs(): number;
  durationMs(): number;
  isPlaying(): boolean;

  /**
   * Set the main track volume as a percentage of full, EFFECTIVE IMMEDIATELY.
   *
   * There is no ramp parameter, and its absence is measured rather than
   * chosen: the W3C volume setter is instantaneous and Vega exposes no fade
   * (PLATFORM.md `no_volume_ramp`). The fade is implemented once, in JS, in
   * `duck.ts`. An interface that accepted `rampMs` would invite every
   * implementation to reimplement the same loop and would imply a capability
   * no platform here has.
   */
  setVolumePct(pct: number): void;

  /** fires on every position update the platform emits ('timeupdate') */
  onPosition(cb: (ms: number) => void): Unsubscribe;
  /** fires after a seek settles, with the new position ('seeked') */
  onSeek(cb: (ms: number) => void): Unsubscribe;
  /**
   * Fires when playback cannot continue because the buffer ran dry
   * ('waiting' / 'stalled').
   *
   * With the app owning byte delivery this is a REACHABLE state and it is NOT
   * an error — no `error` event follows it. A UI that only listens for
   * `onError` shows a frozen picture and says nothing, which for a blind
   * viewer is indistinguishable from a quiet scene.
   */
  onStalled(cb: () => void): Unsubscribe;
  /**
   * Fires when playback is actually running ('playing').
   *
   * The counterpart to `onStalled`, and not optional: MSE emits `waiting` at
   * the START of normal playback while the first frames decode, so a screen
   * that treats stalling as terminal announces "Buffering" over a film that is
   * playing fine (PLATFORM.md `waiting_fires_at_start`).
   */
  onPlaying(cb: () => void): Unsubscribe;
  onEnded(cb: () => void): Unsubscribe;
  onError(cb: (err: Error) => void): Unsubscribe;

  /** release everything; safe to call twice */
  destroy(): Promise<void>;
}

export interface ClipPlayer {
  /**
   * Plays one description clip to completion; rejects if it cannot be played.
   * Same rule as `VideoPlayer.open`: no implementation may assume the
   * platform fetches the URI.
   */
  play(uri: string): Promise<void>;
  stop(): void;
}

export interface AppLifecycle {
  /** fires when the app leaves the foreground */
  onBackground(cb: () => void): Unsubscribe;
}

export interface VideoSurfaceProps {
  style?: StyleProp<ViewStyle>;
}

export interface MediaAdapter {
  video: VideoPlayer;
  clips: ClipPlayer;
  lifecycle: AppLifecycle;
  /**
   * The platform's own view that decoded pixels render into, already wired to
   * `video`.
   *
   * It is part of the adapter rather than something a screen imports, because
   * mounting it IS platform code: on Vega it is `KeplerVideoSurfaceView` and
   * the handle it hands back has to reach the player — and it has to be
   * tracked against `initialize()`, which races it (PLATFORM.md
   * `surface_races_init`).
   */
  VideoSurface: ComponentType<VideoSurfaceProps>;
}
