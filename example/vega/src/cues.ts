/**
 * The description cues for the excerpt, one list per verbosity level.
 *
 * Written by hand for this example, from frames of the excerpt, and voiced by
 * Amazon Polly (neural, Joanna) through `scripts/voice.ts`. In a real app these
 * come from a track producer; the times are the dialogue gaps they may speak in.
 * The excerpt is the first 20 s of Tears of Steel, before its first line of
 * dialogue at 23 s, so the whole excerpt is one gap cut into four windows.
 *
 * `scripts/voice.ts` reads the text from here, writes one clip per cue and
 * level, and fails if any clip — plus the fade in and out — would still be
 * speaking when its window closes.
 */
export interface CueText {
  id: string;
  start_ms: number;
  end_ms: number;
  /** the frame the description was written from */
  frame_ms: number;
  standard: string;
  concise: string;
}

export const CUES: CueText[] = [
  {
    id: 'c1',
    start_ms: 200,
    end_ms: 5_000,
    frame_ms: 1_000,
    standard: 'A man with a mechanical eyepiece bends over a human brain.',
    concise: 'A man studies a brain.',
  },
  {
    id: 'c2',
    start_ms: 5_000,
    end_ms: 10_000,
    frame_ms: 7_000,
    standard: 'The title appears: Tears of Steel.',
    concise: 'Tears of Steel.',
  },
  {
    id: 'c3',
    start_ms: 10_000,
    end_ms: 15_000,
    frame_ms: 12_000,
    standard: 'Smoke drifts over an old city and its machine-crowned tower.',
    concise: 'Smoke over an old city.',
  },
  {
    id: 'c4',
    start_ms: 15_000,
    end_ms: 20_047,
    frame_ms: 18_000,
    standard: 'High in a tower, a figure crouches by candles among cables.',
    concise: 'A figure crouches by candlelight.',
  },
];
