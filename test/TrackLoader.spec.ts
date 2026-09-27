import { ClipCache, loadTrack, validateTrack } from '../src/TrackLoader';
import type { DescriptionTrack } from '../src/track';

const cue = (over: Partial<DescriptionTrack['cues'][number]> = {}) => ({
  id: 'cue_0-12000',
  start_ms: 0,
  end_ms: 12_000,
  words: 20,
  text: 'A man steps between the machines.',
  audio_uri: 'audio/cue_0-12000.standard.m4a',
  source_frames_ms: [6_000],
  status: 'ok' as const,
  ...over,
});

const track = (over: Partial<DescriptionTrack> = {}): DescriptionTrack => ({
  version: '1',
  asset_id: 'tears-of-steel',
  generated_at: '2026-09-25T00:00:00.000Z',
  source_subtitles: 'media/tears-of-steel.en.srt',
  verbosity: 'standard',
  model_id: 'amazon.nova-lite-v1:0',
  cues: [cue()],
  ...over,
});

describe('validateTrack — the track contract', () => {
  it('accepts a well-formed track', () => {
    const result = validateTrack(track());
    expect(result.ok).toBe(true);
  });

  it('rejects a track missing a contract field', () => {
    const { model_id: _dropped, ...without } = track();
    const result = validateTrack(without);
    expect(result).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('rejects an unknown verbosity', () => {
    expect(validateTrack(track({ verbosity: 'verbose' as never }))).toMatchObject({
      reason: 'malformed',
      detail: 'verbosity=verbose',
    });
  });

  it('rejects a cue missing a contract field', () => {
    const { audio_uri: _dropped, ...broken } = cue();
    expect(validateTrack(track({ cues: [broken as never] }))).toMatchObject({
      reason: 'malformed',
      detail: 'cues',
    });
  });

  // Fails if: a `failed` cue is rejected by the validator. A producer writes
  // failed cues into the track deliberately — empty text, no audio — so that a
  // throttled or rejected description does not break the whole track. A
  // validator that refuses them turns one bad cue into no description at all.
  it('accepts a failed cue, which a producer writes on purpose', () => {
    const failed = cue({ status: 'failed', text: '', audio_uri: '', words: 0 });
    expect(validateTrack(track({ cues: [failed] })).ok).toBe(true);
  });

  it('rejects something that is not an object', () => {
    expect(validateTrack('a string')).toMatchObject({ ok: false });
    expect(validateTrack(null)).toMatchObject({ ok: false });
  });
});

describe('loadTrack — the verbosity lookup rule', () => {
  const reader = (available: Record<string, unknown>) => async (path: string) => {
    if (!(path in available)) throw new Error('ENOENT');
    return available[path];
  };

  it('resolves the requested level by its file name', async () => {
    const result = await loadTrack(
      reader({ 'media/tears-of-steel.detailed.track.json': track({ verbosity: 'detailed' }) }),
      'media',
      'tears-of-steel',
      'detailed',
    );
    expect(result).toMatchObject({ ok: true, loaded_verbosity: 'detailed' });
  });

  // Fails if: a missing level turns description off. The fallback is what keeps
  // the feature working when only `standard` was generated.
  it('falls back to standard when the requested level was never generated', async () => {
    const result = await loadTrack(
      reader({ 'media/tears-of-steel.standard.track.json': track() }),
      'media',
      'tears-of-steel',
      'detailed',
    );
    expect(result).toMatchObject({ ok: true, loaded_verbosity: 'standard' });
  });

  // Fails if: a malformed file falls back. Missing and malformed are different
  // answers — one means the level was never generated, the other means something
  // produced a file that is not a track, and silently loading a different one
  // hides it.
  it('does NOT fall back when the requested level is malformed', async () => {
    const result = await loadTrack(
      reader({
        'media/tears-of-steel.detailed.track.json': { not: 'a track' },
        'media/tears-of-steel.standard.track.json': track(),
      }),
      'media',
      'tears-of-steel',
      'detailed',
    );
    expect(result).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('reports missing when nothing is there, which the controls turn into a spoken state', async () => {
    const result = await loadTrack(reader({}), 'media', 'tears-of-steel', 'standard');
    expect(result).toMatchObject({ ok: false, reason: 'missing' });
  });
});

describe('ClipCache — the clip bound', () => {
  const bytes = () => new ArrayBuffer(8);

  it('never holds more than its bound', () => {
    const cache = new ClipCache(3);
    for (let i = 0; i < 10; i++) cache.put(`clip${i}`, bytes());
    expect(cache.size).toBe(3);
  });

  it('evicts the oldest first', () => {
    const cache = new ClipCache(2);
    cache.put('a', bytes());
    cache.put('b', bytes());
    cache.put('c', bytes());
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBeDefined();
  });

  // Fails if: re-putting an entry adds a second order record. The cache would
  // then evict live entries while holding stale duplicates, and the bound that
  // exists for a 32-bit heap would be quietly wrong.
  it('does not double-count a uri that is put twice', () => {
    const cache = new ClipCache(2);
    cache.put('a', bytes());
    cache.put('a', bytes());
    cache.put('b', bytes());
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('b')).toBeDefined();
  });
});
