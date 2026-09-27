import type { Verbosity } from './track';

/**
 * The numbers a player and a track producer have to agree on.
 *
 * The playback half (`DUCK_*`, `MAX_CLIPS_IN_MEMORY`) is what this library
 * uses at runtime. The word budget is exported for whoever PRODUCES tracks: a
 * cue longer than its gap either overruns into dialogue or gets cut off, and
 * both are worse than a shorter sentence.
 */
export const AD = {
  /** a dialogue gap shorter than this holds nothing worth saying */
  MIN_GAP_MS: 1500,
  /** narration pace used to turn a gap into a word count */
  SPEAKING_RATE_WPM: 160,
  /** how far the film is lowered while a cue speaks, as % of full */
  DUCK_TARGET_PCT: 25,
  /** the fade into and out of the duck; stepped in JS, see `duck.ts` */
  DUCK_RAMP_MS: 200,
  /** subtracted from every gap before budgeting: the duck ramp plus 100 ms */
  BUDGET_MARGIN_MS: 300,
} as const;

/**
 * Word TARGETS as a fraction of the physical ceiling — never multipliers of it.
 * Every value is <= 1.0 by construction, so no level can ask for more words
 * than the gap holds and no clamp is needed.
 */
export const VERBOSITY_SCALES: Record<Verbosity, number> = {
  concise: 0.6,
  standard: 0.85,
  detailed: 1.0,
};

/**
 * Description clips held in memory at once. A Fire TV Stick is a 32-bit
 * process with a small heap, so only the next few clips are resident.
 */
export const MAX_CLIPS_IN_MEMORY = 8;

function wordsIn(ms: number): number {
  return Math.floor(((ms / 1000) * AD.SPEAKING_RATE_WPM) / 60);
}

/** floor((gap_ms - 300) / 1000 * 160 / 60), never negative */
export function baseWordBudget(gapMs: number): number {
  return Math.max(0, wordsIn(gapMs - AD.BUDGET_MARGIN_MS));
}

/** the number of words to ASK a describer for at this level */
export function wordTarget(gapMs: number, verbosity: Verbosity): number {
  return Math.floor(baseWordBudget(gapMs) * VERBOSITY_SCALES[verbosity]);
}

/**
 * The number of words a cue may not exceed, at any level. It does not vary by
 * verbosity: the gap is the gap.
 */
export function wordCeiling(gapMs: number): number {
  return baseWordBudget(gapMs);
}
