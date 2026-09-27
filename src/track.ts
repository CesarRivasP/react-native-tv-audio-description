/**
 * The description track: what a producer writes and what this library plays.
 *
 * One file per verbosity level, because the levels do not share a cue list: a
 * short gap that holds a useful sentence at `detailed` may hold nothing useful
 * at `concise`, so the concise track has fewer cues, not shorter ones. In the
 * film this was extracted from the three levels came out at 47 / 55 / 60 cues.
 */

export type Verbosity = 'concise' | 'standard' | 'detailed';

export type CueStatus = 'ok' | 'failed';

export interface DescriptionCue {
  id: string;
  /** the dialogue gap this cue may speak in; `end_ms` is exclusive */
  start_ms: number;
  end_ms: number;
  words: number;
  text: string;
  /** the spoken clip; empty for a `failed` cue */
  audio_uri: string;
  /** frames the description was written from, for traceability */
  source_frames_ms: number[];
  /**
   * A cue whose description could not be produced is WRITTEN as `failed`, not
   * dropped: a player can skip a failed cue, but it cannot tell a missing cue
   * from a gap that was never meant to hold one.
   */
  status: CueStatus;
}

export interface DescriptionTrack {
  version: string;
  asset_id: string;
  generated_at: string;
  source_subtitles: string;
  verbosity: Verbosity;
  model_id: string;
  cues: DescriptionCue[];
}

export const VERBOSITY_LEVELS: readonly Verbosity[] = ['concise', 'standard', 'detailed'];

/**
 * The lookup rule: one file per level, named `<asset_id>.<verbosity>.track.json`
 * beside the asset. A level switch resolves by this name and falls back to
 * `standard` (see `loadTrack`).
 */
export function trackFileName(assetId: string, verbosity: Verbosity): string {
  return `${assetId}.${verbosity}.track.json`;
}
