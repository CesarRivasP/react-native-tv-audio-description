import { VERBOSITY_LEVELS } from '../src/track';
import { baseWordBudget, wordTarget, wordCeiling, VERBOSITY_SCALES } from '../src/budget';

// Every gap size from the minimum useful gap upward that a real film produces.
// The loop is the point: a single spot-check at one gap is what hid the
// standard/detailed collapse twice while the formula was being designed.
const GAPS = [1500, 1600, 1800, 2000, 2500, 3000, 4000, 5000, 8000, 12000];

describe('baseWordBudget', () => {
  it('matches floor((gap - 300) / 1000 * 160 / 60) at known points', () => {
    expect(baseWordBudget(1500)).toBe(3);
    expect(baseWordBudget(1000)).toBe(1);
  });

  it('never goes negative on a gap shorter than the margin', () => {
    expect(baseWordBudget(200)).toBe(0);
    expect(baseWordBudget(0)).toBe(0);
  });
});

describe('verbosity levels', () => {
  it('are strictly distinct at every gap size, not just at a convenient one', () => {
    for (const gap of GAPS) {
      const concise = wordTarget(gap, 'concise');
      const standard = wordTarget(gap, 'standard');
      const detailed = wordTarget(gap, 'detailed');
      // the gap rides along so a failure names the size that collapsed
      expect({ gap, strictlyDistinct: concise < standard && standard < detailed }).toEqual({
        gap,
        strictlyDistinct: true,
      });
    }
  });

  it('never exceed the ceiling at any level', () => {
    for (const gap of GAPS) {
      for (const level of VERBOSITY_LEVELS) {
        expect(wordTarget(gap, level)).toBeLessThanOrEqual(wordCeiling(gap));
      }
    }
  });

  it('keeps every scale at or below 1.0 — a level above the ceiling is unreachable', () => {
    for (const level of VERBOSITY_LEVELS) {
      expect(VERBOSITY_SCALES[level]).toBeLessThanOrEqual(1.0);
    }
  });
});

describe('wordCeiling', () => {
  it('does not vary by verbosity — the gap is the gap', () => {
    for (const gap of GAPS) {
      expect(wordCeiling(gap)).toBe(baseWordBudget(gap));
    }
  });
});
