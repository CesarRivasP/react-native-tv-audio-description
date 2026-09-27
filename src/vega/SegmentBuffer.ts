import type { AssetSegment, AssetSource } from '../MediaAdapter';
import { log } from '../log';

/**
 * Keep a bounded window of the asset in the SourceBuffer, and never the whole
 * thing.
 *
 * Two platform facts shape this and neither was guessable (PLATFORM.md):
 *   - `url_mode_broken` — the player fetches nothing, so the app delivers
 *     every byte;
 *   - `no_range_requests` — a Range request returns the WHOLE file with status
 *     200, so the app cannot read part of one. The window is therefore made of
 *     whole segments cut at build time. A window built on byte ranges would
 *     appear to work and hold the entire film in memory.
 *
 * The window is measured in TIME, never in segment count. ffmpeg cuts on
 * keyframes, so a clip asked for 6 s segments came out 9.94 s, 4.17 s, 5.29 s
 * and 0.65 s — "keep five segments" would mean anything between 3 and 50
 * seconds of media, which is not a memory bound.
 */

/**
 * Only what this class actually uses, declared structurally.
 *
 * `MediaSource.addSourceBuffer` is typed as returning the W3C `SourceBuffer`
 * interface, which does not declare `addEventListener` — but the
 * implementation behind it does, and it was measured to work on the device.
 * Naming the five members this class touches says what it needs and fails
 * loudly if any of them disappears.
 */
export interface AppendTarget {
  readonly updating: boolean;
  appendBuffer(data: Uint8Array): void;
  remove(start: number, end: number): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface BufferWindow {
  /** media kept ahead of the playhead (default 30 s) */
  aheadMs: number;
  /** media kept behind it before eviction (default 10 s) */
  behindMs: number;
}

export const DEFAULT_WINDOW: BufferWindow = { aheadMs: 30_000, behindMs: 10_000 };

/** the two members of MediaSource this class touches, for the same reason */
export interface SourceLike {
  readonly readyState: string;
  endOfStream(): void;
}

export class SegmentBuffer {
  private appended = new Set<number>();
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly source: SourceLike,
    private readonly buffer: AppendTarget,
    private readonly asset: AssetSource,
    private readonly window: BufferWindow = DEFAULT_WINDOW,
  ) {}

  /**
   * Append the init segment, then enough of the asset to start playing.
   *
   * Both steps are queued NOW, behind anything already queued, so a caller
   * that feeds positions before `start()` settles can neither overlap two
   * SourceBuffer operations nor have position 0 processed after a later one.
   * Unlike a segment, a failed init REJECTS: without it nothing after it can
   * decode, and the caller has to say so.
   */
  async start(): Promise<void> {
    const initUri = this.asset.initUri;
    let init: Promise<void> = Promise.resolve();
    if (initUri) {
      init = this.queue.then(async () => {
        await this.append(await this.fetchBytes(initUri), 'init');
      });
      this.queue = init.catch(() => undefined);
    }
    const first = this.ensure(0);
    await init;
    await first;
  }

  /**
   * Bring the window up to date for a playhead position.
   *
   * Safe to call on every `timeupdate`: segments already appended are
   * skipped, and the work is serialised behind one promise chain because a
   * SourceBuffer accepts exactly one operation at a time. Calling
   * `appendBuffer` while `updating` is true throws `InvalidStateError`, which
   * on Vega surfaces as a media error indistinguishable from a bad file.
   */
  ensure(positionMs: number): Promise<void> {
    this.queue = this.queue
      .then(() => this.sync(positionMs))
      .catch((err) => {
        log(`buffer.failed err=${(err as Error).message}`);
      });
    return this.queue;
  }

  /** segment indexes currently held, for diagnostics and tests */
  held(): number[] {
    return [...this.appended].sort((a, b) => a - b);
  }

  private async sync(positionMs: number): Promise<void> {
    if (this.disposed) return;

    for (const segment of this.wanted(positionMs)) {
      if (this.appended.has(segment.index)) continue;
      const bytes = await this.fetchBytes(segment.uri);
      if (this.disposed) return;
      await this.append(bytes, `seg${segment.index}`);
      this.appended.add(segment.index);
    }

    await this.evict(positionMs);

    // `endOfStream` only once the last segment is in, or the player waits
    // forever for media that is not coming.
    const last = this.asset.segments[this.asset.segments.length - 1];
    if (last && this.appended.has(last.index) && this.source.readyState === 'open') {
      this.source.endOfStream();
      log(`buffer.complete segments=${this.appended.size}`);
    }
  }

  /** every segment overlapping [position, position + ahead] */
  private wanted(positionMs: number): AssetSegment[] {
    return this.asset.segments.filter(
      (s) => s.end_ms > positionMs && s.start_ms <= positionMs + this.window.aheadMs,
    );
  }

  private async evict(positionMs: number): Promise<void> {
    const cutoff = positionMs - this.window.behindMs;
    if (cutoff <= 0) return;

    const stale = this.asset.segments.filter(
      (s) => this.appended.has(s.index) && s.end_ms < cutoff,
    );
    if (stale.length === 0) return;

    const end = Math.max(...stale.map((s) => s.end_ms));
    await this.operation(() => this.buffer.remove(0, end / 1000));
    for (const s of stale) this.appended.delete(s.index);

    log(`buffer.evicted n=${stale.length} up_to_ms=${end} held=${this.appended.size}`);
  }

  private async fetchBytes(uri: string): Promise<Uint8Array> {
    const response = await fetch(uri);
    return new Uint8Array(await response.arrayBuffer());
  }

  private async append(bytes: Uint8Array, label: string): Promise<void> {
    await this.operation(() => this.buffer.appendBuffer(bytes));
    log(`buffer.appended ${label} bytes=${bytes.byteLength} held=${this.appended.size}`);
  }

  /** run one SourceBuffer operation and wait for `updateend` */
  private operation(run: () => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const done = () => {
        this.buffer.removeEventListener('updateend', done);
        resolve();
      };
      this.buffer.addEventListener('updateend', done);
      try {
        run();
      } catch (err) {
        this.buffer.removeEventListener('updateend', done);
        reject(err as Error);
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.appended.clear();
  }
}
