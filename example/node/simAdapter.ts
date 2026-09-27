import type {
  AppLifecycle,
  AssetSource,
  ClipPlayer,
  MediaAdapter,
  Unsubscribe,
  VideoPlayer,
} from '../../src/MediaAdapter';
import { AD } from '../../src/budget';

/**
 * A `MediaAdapter` with no media in it: a film is a clock, and a clip is a
 * wait as long as its words take to say. It is here to show that the layer
 * above the seam runs unchanged on anything that implements the interface —
 * which is also how you would port it to a platform other than Vega.
 *
 * Time runs `speed` times faster than the wall clock, so a minute of film
 * plays in a few seconds. Every number the example prints is FILM time.
 */

type Listener<T> = (value: T) => void;

class Channel<T> {
  private listeners = new Set<Listener<T>>();
  on(cb: Listener<T>): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit(value: T): void {
    for (const cb of [...this.listeners]) cb(value);
  }
}

export interface VolumeEvent {
  atMs: number;
  pct: number;
}

export class SimVideo implements VideoPlayer {
  private position = 0;
  private playing = false;
  private duration = 0;
  private volume = 100;
  private readonly position$ = new Channel<number>();
  private readonly seek$ = new Channel<number>();
  private readonly playing$ = new Channel<void>();
  private readonly ended$ = new Channel<void>();
  private readonly never$ = new Channel<never>();

  /** every volume write, stamped with film time */
  readonly volumes: VolumeEvent[] = [];

  constructor(durationMs: number) {
    this.duration = durationMs;
  }

  async open(_source: AssetSource): Promise<void> {}
  async play(): Promise<void> {
    this.playing = true;
    this.playing$.emit();
  }
  pause(): void {
    this.playing = false;
  }
  positionMs(): number {
    return this.position;
  }
  durationMs(): number {
    return this.duration;
  }
  isPlaying(): boolean {
    return this.playing;
  }
  setVolumePct(pct: number): void {
    this.volume = pct;
    this.volumes.push({ atMs: this.position, pct });
  }
  volumePct(): number {
    return this.volume;
  }

  onPosition(cb: (ms: number) => void): Unsubscribe {
    return this.position$.on(cb);
  }
  onSeek(cb: (ms: number) => void): Unsubscribe {
    return this.seek$.on(cb);
  }
  onStalled(cb: () => void): Unsubscribe {
    return this.never$.on(cb as never);
  }
  onPlaying(cb: () => void): Unsubscribe {
    return this.playing$.on(cb);
  }
  onEnded(cb: () => void): Unsubscribe {
    return this.ended$.on(cb);
  }
  onError(cb: (err: Error) => void): Unsubscribe {
    return this.never$.on(cb as never);
  }
  async destroy(): Promise<void> {
    this.playing = false;
  }

  /** the driver: advance film time and report it, as 'timeupdate' would */
  advance(ms: number): void {
    if (!this.playing) return;
    this.position = Math.min(this.duration, this.position + ms);
    this.position$.emit(this.position);
    if (this.position >= this.duration) {
      this.playing = false;
      this.ended$.emit();
    }
  }

  /** what a platform does when a seek settles */
  seekTo(ms: number): void {
    this.position = ms;
    this.seek$.emit(ms);
  }
}

export interface ClipEvent {
  uri: string;
  startMs: number;
  endMs: number;
}

export class SimClips implements ClipPlayer {
  readonly played: ClipEvent[] = [];
  private cancel: (() => void) | null = null;

  constructor(
    private readonly video: SimVideo,
    private readonly speed: number,
    /** how many words each clip holds, so it can last as long as speaking them */
    private readonly wordsOf: (uri: string) => number,
  ) {}

  play(uri: string): Promise<void> {
    const words = this.wordsOf(uri);
    const lengthMs = (words / AD.SPEAKING_RATE_WPM) * 60_000;
    const startMs = this.video.positionMs();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.cancel = null;
        this.played.push({ uri, startMs, endMs: this.video.positionMs() });
        resolve();
      }, lengthMs / this.speed);
      this.cancel = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  stop(): void {
    this.cancel?.();
    this.cancel = null;
  }
}

class SimLifecycle implements AppLifecycle {
  private readonly background$ = new Channel<void>();
  onBackground(cb: () => void): Unsubscribe {
    return this.background$.on(cb);
  }
}

export interface SimAdapter extends MediaAdapter {
  video: SimVideo;
  clips: SimClips;
}

export function createSimAdapter(
  durationMs: number,
  speed: number,
  wordsOf: (uri: string) => number,
): SimAdapter {
  const video = new SimVideo(durationMs);
  return {
    video,
    clips: new SimClips(video, speed, wordsOf),
    lifecycle: new SimLifecycle(),
    // there is nothing to render in a terminal
    VideoSurface: () => null,
  };
}
