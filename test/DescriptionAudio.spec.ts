import { DescriptionAudio } from '../src/DescriptionAudio';
import { rampVolumePct } from '../src/duck';
import type { DescriptionCue } from '../src/track';
import { fakeAdapter, type FakeAdapter } from './fakes/adapter';

const cue = (id = 'a'): DescriptionCue => ({
  id,
  start_ms: 1_000,
  end_ms: 4_000,
  words: 6,
  text: 'She opens the door slowly.',
  audio_uri: `audio/${id}.m4a`,
  source_frames_ms: [2_000],
  status: 'ok',
});

/** a clip that plays until the test says it has finished */
function holdClips(media: FakeAdapter) {
  const pending: Array<{ uri: string; finish: () => void; fail: (e: Error) => void }> = [];
  const volumeAtPlay: number[] = [];
  media.clips.play = (uri: string) =>
    new Promise<void>((finish, fail) => {
      volumeAtPlay.push(media.video.volumes[media.video.volumes.length - 1] ?? 100);
      pending.push({ uri, finish, fail });
    });
  return { pending, volumeAtPlay };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/** the levels the film passed through, with repeated writes of one level collapsed */
const levels = (v: number[]) => v.filter((x, i) => i === 0 || x !== v[i - 1]);

describe('DescriptionAudio — duck, speak, restore', () => {
  // rampMs 0 collapses the fade to one step so the assertions are about levels,
  // not about timing; the fade itself is covered below.
  const opts = { rampMs: 0 };

  it('ducks the film to the target BEFORE the clip starts, and restores it after', async () => {
    const media = fakeAdapter();
    const clips = holdClips(media);
    const audio = new DescriptionAudio(media, opts);

    const spoken = audio.speak(cue());
    await settle();
    expect(clips.volumeAtPlay).toEqual([25]);

    clips.pending[0]!.finish();
    await spoken;
    expect(media.video.volumes[media.video.volumes.length - 1]).toBe(100);
  });

  // Fails if: restoration lives on the success path only. A clip that cannot
  // play would then leave the film at 25% for the rest of the runtime.
  it('restores the film to full when the clip FAILS', async () => {
    const media = fakeAdapter();
    media.clips.failWith = new Error('cue media error 4');
    const audio = new DescriptionAudio(media, opts);

    await audio.speak(cue());
    expect(levels(media.video.volumes)).toEqual([25, 100]);
  });

  // Fails if: a second cue can start while one is speaking. Two descriptions
  // over each other is noise, and the second one's restore would un-duck the
  // film under the first.
  it('never interrupts a cue that is already speaking', async () => {
    const media = fakeAdapter();
    const clips = holdClips(media);
    const audio = new DescriptionAudio(media, opts);

    const first = audio.speak(cue('a'));
    await settle();
    await audio.speak(cue('b'));
    expect(clips.pending.map((p) => p.uri)).toEqual(['audio/a.m4a']);

    clips.pending[0]!.finish();
    await first;
  });

  it('honours a custom duck level', async () => {
    const media = fakeAdapter();
    const audio = new DescriptionAudio(media, { rampMs: 0, duckTargetPct: 40 });
    await audio.speak(cue());
    expect(levels(media.video.volumes)).toEqual([40, 100]);
  });
});

describe('DescriptionAudio — leaving the screen mid-cue', () => {
  // Fails if: backgrounding during a cue leaves the clip running or the film
  // ducked. The viewer comes back to a quiet film and no explanation.
  it('stops the clip and restores the film when the app is backgrounded', async () => {
    const media = fakeAdapter();
    holdClips(media);
    const audio = new DescriptionAudio(media, { rampMs: 0 });

    void audio.speak(cue());
    await settle();
    media.lifecycle.background();
    await settle();

    expect(media.clips.stops).toBe(1);
    expect(media.video.volumes[media.video.volumes.length - 1]).toBe(100);
  });

  // Fails if: the stale cue's `finally` still ramps after stop(). On a real
  // device that is volume writes against a player being torn down.
  it('does not touch the volume again once stop() has restored it', async () => {
    const media = fakeAdapter();
    const clips = holdClips(media);
    const audio = new DescriptionAudio(media, { rampMs: 0 });

    const spoken = audio.speak(cue());
    await settle();
    await audio.stop();
    const afterStop = media.video.volumes.length;

    clips.pending[0]!.finish();
    await spoken;
    expect(media.video.volumes).toHaveLength(afterStop);
  });

  // Fails if: stop() ramps when nothing is speaking. The ramp starts FROM the
  // duck level, so an idle stop() drops a film at full to 25% and back — a
  // dip the viewer hears every time description is switched off between cues.
  it('does not touch the volume when stop() is called with nothing speaking', async () => {
    const media = fakeAdapter();
    const audio = new DescriptionAudio(media, { rampMs: 0 });
    await audio.stop();
    expect(media.video.volumes).toEqual([]);
  });

  it('ignores backgrounding when nothing is speaking', async () => {
    const media = fakeAdapter();
    new DescriptionAudio(media, { rampMs: 0 });
    media.lifecycle.background();
    await settle();
    expect(media.clips.stops).toBe(0);
    expect(media.video.volumes).toEqual([]);
  });
});

describe('rampVolumePct — the fade the platform does not have', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('steps the volume over the ramp and lands exactly on the target', async () => {
    const media = fakeAdapter();
    const done = rampVolumePct(media.video, 100, 25, 200);
    await jest.runAllTimersAsync();
    await done;

    const v = media.video.volumes;
    expect(v.length).toBeGreaterThan(5);
    expect(v[v.length - 1]).toBe(25);
    // monotonic: a fade that overshoots is audible as a pump
    for (let i = 1; i < v.length; i++) expect(v[i]!).toBeLessThanOrEqual(v[i - 1]!);
  });

  it('stops stepping as soon as it is cancelled', async () => {
    const media = fakeAdapter();
    let cancelled = false;
    const done = rampVolumePct(media.video, 100, 25, 200, () => cancelled);
    await jest.advanceTimersByTimeAsync(50);
    cancelled = true;
    await jest.runAllTimersAsync();
    await done;
    expect(media.video.volumes[media.video.volumes.length - 1]).not.toBe(25);
  });
});
