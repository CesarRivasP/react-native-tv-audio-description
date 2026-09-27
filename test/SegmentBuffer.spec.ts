import { SegmentBuffer, type AppendTarget } from '../src/vega/SegmentBuffer';
import type { AssetSource } from '../src/MediaAdapter';
import { setLogger } from '../src/log';

/**
 * A SourceBuffer that behaves like the real one where it matters: operations
 * complete ASYNCHRONOUSLY, and starting one while another is in flight throws
 * InvalidStateError. The w3cmedia mock completes synchronously, which is why
 * these tests use this instead — a synchronous fake cannot catch a missing
 * serialisation.
 */
class StrictBuffer implements AppendTarget {
  updating = false;
  readonly ops: string[] = [];
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, fn: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  appendBuffer(data: Uint8Array): void {
    this.begin(`append:${data.byteLength}`);
  }
  remove(start: number, end: number): void {
    this.begin(`remove:${start}-${end}`);
  }
  private begin(op: string): void {
    if (this.updating) throw new Error('InvalidStateError: SourceBuffer is updating');
    this.updating = true;
    this.ops.push(op);
    setTimeout(() => {
      this.updating = false;
      [...(this.listeners.get('updateend') ?? [])].forEach((fn) => fn());
    }, 1);
  }
}

class Source {
  readyState: 'open' | 'ended' = 'open';
  ended = 0;
  endOfStream(): void {
    this.readyState = 'ended';
    this.ended++;
  }
}

/**
 * Uneven on purpose — ffmpeg cuts on keyframes, and the first real clip came
 * out 9.94 s / 4.17 s / 5.29 s / 0.65 s. Segment i is (i + 1) * 100 bytes so an
 * append can be traced back to its segment.
 */
const LENGTHS_MS = [9_940, 4_170, 5_290, 12_000, 3_000, 15_000, 8_000, 20_000, 650];
function asset(withInit = true): AssetSource {
  let at = 0;
  const segments = LENGTHS_MS.map((len, index) => {
    const s = { index, start_ms: at, end_ms: at + len, uri: `seg/${index}.m4s` };
    at += len;
    return s;
  });
  return { initUri: withInit ? 'seg/init.mp4' : undefined, segments };
}

const bytesFor = (uri: string) => (uri.endsWith('init.mp4') ? 42 : (Number(/(\d+)\.m4s$/.exec(uri)![1]) + 1) * 100);

let lines: string[] = [];
beforeEach(() => {
  lines = [];
  setLogger((l) => lines.push(l));
  (global as { fetch?: unknown }).fetch = jest.fn(async (uri: string) => ({
    arrayBuffer: async () => new ArrayBuffer(bytesFor(uri)),
  }));
});
afterEach(() => setLogger(null));

describe('SegmentBuffer — start', () => {
  it('appends the init segment first, then what the window needs', async () => {
    const buffer = new StrictBuffer();
    const sb = new SegmentBuffer(new Source(), buffer, asset());
    await sb.start();
    expect(buffer.ops[0]).toBe('append:42');
    expect(buffer.ops.slice(1)).toEqual(['append:100', 'append:200', 'append:300', 'append:400']);
  });

  // Fails if: a failed init is swallowed like a failed segment. Nothing after
  // the init can decode, so open() would resolve onto a player that never plays.
  it('rejects when the init segment cannot be appended', async () => {
    const buffer = new StrictBuffer();
    buffer.appendBuffer = () => {
      throw new Error('QuotaExceededError');
    };
    const sb = new SegmentBuffer(new Source(), buffer, asset());
    await expect(sb.start()).rejects.toThrow('QuotaExceededError');
  });

  it('works for a whole-file asset with no init segment', async () => {
    const buffer = new StrictBuffer();
    const sb = new SegmentBuffer(new Source(), buffer, asset(false));
    await sb.start();
    expect(buffer.ops[0]).toBe('append:100');
  });
});

describe('SegmentBuffer — the window is TIME, not a segment count', () => {
  // Fails if: the window is counted in segments. With uneven segments a count
  // is not a memory bound — "keep N" means anything from seconds to minutes.
  it('holds every segment overlapping [position, position + ahead], and no more', async () => {
    const sb = new SegmentBuffer(new Source(), new StrictBuffer(), asset(), {
      aheadMs: 30_000,
      behindMs: 10_000,
    });
    await sb.start();
    // 0..30 s touches segments 0 (0-9.94), 1 (-14.11), 2 (-19.4), 3 (-31.4)
    expect(sb.held()).toEqual([0, 1, 2, 3]);

    await sb.ensure(40_000);
    // 40..70 s touches 5 (34.4-49.4), 6 (-57.4), 7 (-77.4); 4 ends at 34.4 < 40
    expect(sb.held()).toEqual(expect.arrayContaining([5, 6, 7]));
    expect(sb.held()).not.toContain(8);
  });

  it('evicts what fell more than `behind` behind the playhead, by one remove()', async () => {
    const buffer = new StrictBuffer();
    const sb = new SegmentBuffer(new Source(), buffer, asset(), { aheadMs: 30_000, behindMs: 10_000 });
    await sb.start();
    await sb.ensure(40_000);

    // cutoff 30 s: segments 0, 1, 2 end before it (19.4 s); 3 ends at 31.4 and stays
    expect(sb.held()).toEqual([3, 5, 6, 7]);
    expect(buffer.ops.filter((op) => op.startsWith('remove'))).toEqual(['remove:0-19.4']);
  });
});

describe('SegmentBuffer — one SourceBuffer operation at a time', () => {
  // Fails if: ensure() calls are not serialised. Every timeupdate calls it, so
  // overlapping calls are the normal case, and appending while `updating`
  // throws InvalidStateError — which Vega reports as a media error that looks
  // exactly like a bad file.
  it('survives overlapping ensure() calls without an InvalidStateError', async () => {
    const buffer = new StrictBuffer();
    const sb = new SegmentBuffer(new Source(), buffer, asset());
    const all = [sb.start(), sb.ensure(5_000), sb.ensure(20_000), sb.ensure(45_000)];
    await Promise.all(all);
    expect(lines.filter((l) => l.startsWith('buffer.failed'))).toEqual([]);
    // and no segment was appended twice
    const appends = buffer.ops.filter((op) => op.startsWith('append'));
    expect(new Set(appends).size).toBe(appends.length);
  });
});

describe('SegmentBuffer — end of stream', () => {
  // Fails if: endOfStream is called before the last segment is in. The player
  // then treats the film as ending wherever the buffer happens to stop.
  it('is signalled only once the LAST segment has been appended', async () => {
    const source = new Source();
    const sb = new SegmentBuffer(source, new StrictBuffer(), asset());
    await sb.start();
    await sb.ensure(40_000); // window reaches 70 s; the last segment starts at 77.4 s
    expect(source.ended).toBe(0);

    await sb.ensure(78_000);
    expect(source.ended).toBe(1);
  });
});

describe('SegmentBuffer — dispose', () => {
  it('appends nothing after it is disposed', async () => {
    const buffer = new StrictBuffer();
    const sb = new SegmentBuffer(new Source(), buffer, asset());
    await sb.start();
    const before = buffer.ops.length;
    sb.dispose();
    await sb.ensure(40_000);
    expect(buffer.ops).toHaveLength(before);
  });
});
