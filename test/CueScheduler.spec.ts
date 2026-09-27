import { coalesce, CueScheduler } from '../src/CueScheduler';
import type { DescriptionCue } from '../src/track';

const cue = (id: string, start_ms: number, end_ms: number, over: Partial<DescriptionCue> = {}): DescriptionCue => ({
  id,
  start_ms,
  end_ms,
  words: 10,
  text: 'something happens',
  audio_uri: `audio/${id}.m4a`,
  source_frames_ms: [start_ms + 100],
  status: 'ok',
  ...over,
});

const fired: string[] = [];
const scheduler = () => {
  fired.length = 0;
  return new CueScheduler({ onFire: (c) => fired.push(c.id) });
};

const THREE = [cue('a', 1_000, 3_000), cue('b', 10_000, 12_000), cue('c', 20_000, 22_000)];

describe('CueScheduler.load', () => {
  it('keeps only cues that can actually be heard', () => {
    const s = scheduler();
    s.load([
      cue('ok', 0, 1_000),
      cue('failed', 2_000, 3_000, { status: 'failed', audio_uri: '', text: '', words: 0 }),
      cue('noaudio', 4_000, 5_000, { audio_uri: '' }),
    ]);
    s.tick(500);
    s.tick(2_500);
    s.tick(4_500);
    expect(fired).toEqual(['ok']);
  });

  it('sorts by start time, so an unordered track still schedules correctly', () => {
    const s = scheduler();
    s.load([THREE[2]!, THREE[0]!, THREE[1]!]);
    s.tick(2_000);
    s.tick(11_000);
    s.tick(21_000);
    expect(fired).toEqual(['a', 'b', 'c']);
  });
});

describe('CueScheduler.tick — inside its own window or not at all', () => {
  it('fires a cue once, inside its window', () => {
    const s = scheduler();
    s.load(THREE);
    s.tick(1_500);
    s.tick(1_600);
    s.tick(2_900);
    expect(fired).toEqual(['a']);
  });

  it('does not fire before the window opens', () => {
    const s = scheduler();
    s.load(THREE);
    s.tick(900);
    expect(fired).toEqual([]);
  });

  // Fails if: a cue whose window has closed is played late. A late cue plays
  // over the dialogue the window was measured to avoid, which is the one thing
  // worse than no description at all.
  it('DROPS a cue whose window closed while playback was elsewhere', () => {
    const s = scheduler();
    s.load(THREE);
    s.tick(3_001); // 'a' has closed and was never fired
    expect(fired).toEqual([]);
    s.tick(10_500);
    expect(fired).toEqual(['b']); // and the next one is unaffected
  });

  it('fires nothing while disabled, and resumes on the next window', () => {
    const s = scheduler();
    s.load(THREE);
    s.setEnabled(false);
    s.tick(1_500);
    expect(fired).toEqual([]);
    s.setEnabled(true);
    s.tick(10_500);
    expect(fired).toEqual(['b']);
  });

  it('treats end_ms as exclusive', () => {
    const s = scheduler();
    s.load([cue('a', 1_000, 3_000)]);
    s.tick(3_000);
    expect(fired).toEqual([]);
  });
});

describe('CueScheduler.resync — a seek must not fire a backlog', () => {
  // Fails if: the cursor is left stale after a seek. The next tick then walks
  // every cue between the old and new position, and a jump forward through a
  // film fires a burst of descriptions for scenes the viewer skipped.
  it('fires nothing for the cues a forward seek jumped over', () => {
    const s = scheduler();
    s.load(THREE);
    s.tick(1_500);
    expect(fired).toEqual(['a']);

    s.resync(19_000); // seek past 'b'
    s.tick(19_100);
    expect(fired).toEqual(['a']);

    s.tick(20_500);
    expect(fired).toEqual(['a', 'c']);
  });

  it('re-arms a cue after a seek BACK into its window', () => {
    const s = scheduler();
    s.load(THREE);
    s.tick(1_500);
    s.resync(1_100);
    s.tick(1_200);
    expect(fired).toEqual(['a', 'a']);
  });

  it('lands on the first open cue when seeking into a gap between windows', () => {
    const s = scheduler();
    s.load(THREE);
    s.resync(5_000);
    s.tick(10_500);
    expect(fired).toEqual(['b']);
  });

  it('survives a seek past the end of the track', () => {
    const s = scheduler();
    s.load(THREE);
    s.resync(999_999);
    s.tick(999_999);
    expect(fired).toEqual([]);
  });
});

describe('coalesce — the input half', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // Fails if: every key event is acted on. A held D-pad direction emits a stream
  // of them, and one resync per event is a resync storm during every long seek.
  it('acts once on the settled value, not once per event', () => {
    const seen: number[] = [];
    const settle = coalesce((v) => seen.push(v), 250);

    for (const ms of [1_000, 2_000, 3_000, 4_000, 5_000]) settle(ms);
    jest.advanceTimersByTime(249);
    expect(seen).toEqual([]);

    jest.advanceTimersByTime(1);
    expect(seen).toEqual([5_000]);
  });

  it('acts again for a second burst', () => {
    const seen: number[] = [];
    const settle = coalesce((v) => seen.push(v), 250);

    settle(1_000);
    jest.advanceTimersByTime(250);
    settle(9_000);
    jest.advanceTimersByTime(250);
    expect(seen).toEqual([1_000, 9_000]);
  });
});
