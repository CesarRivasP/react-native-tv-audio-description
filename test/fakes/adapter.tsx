import * as React from 'react';
import {View} from 'react-native';
import type {
  AppLifecycle,
  AssetSource,
  ClipPlayer,
  MediaAdapter,
  Unsubscribe,
  VideoPlayer,
  VideoSurfaceProps,
} from '../../src/MediaAdapter';

/**
 * A fake MediaAdapter for the layers above the seam.
 *
 * It implements the INTERFACE, not the Vega player — that is the point of the
 * seam, and it is deliberate: a fake written against the real
 * platform's shape would drift towards whatever the platform happens to do,
 * while a fake written against the interface can only drift if the interface
 * changes, which the compiler catches.
 */
export class FakeVideo implements VideoPlayer {
  opened: AssetSource[] = [];
  volumes: number[] = [];
  playing = false;
  destroyed = 0;
  position = 0;
  duration = 20_000;
  openError: Error | null = null;

  private cbs: Record<string, Array<(...a: never[]) => void>> = {};

  async open(source: AssetSource): Promise<void> {
    if (this.openError) throw this.openError;
    this.opened.push(source);
  }
  async play(): Promise<void> {
    this.playing = true;
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
    this.volumes.push(pct);
  }

  private on(type: string, cb: (...a: never[]) => void): Unsubscribe {
    (this.cbs[type] ??= []).push(cb);
    return () => {
      this.cbs[type] = (this.cbs[type] ?? []).filter(c => c !== cb);
    };
  }
  onPosition(cb: (ms: number) => void): Unsubscribe {
    return this.on('position', cb as never);
  }
  onSeek(cb: (ms: number) => void): Unsubscribe {
    return this.on('seek', cb as never);
  }
  onStalled(cb: () => void): Unsubscribe {
    return this.on('stalled', cb as never);
  }
  onPlaying(cb: () => void): Unsubscribe {
    return this.on('playing', cb as never);
  }
  onEnded(cb: () => void): Unsubscribe {
    return this.on('ended', cb as never);
  }
  onError(cb: (err: Error) => void): Unsubscribe {
    return this.on('error', cb as never);
  }
  async destroy(): Promise<void> {
    this.destroyed++;
  }

  /** test helpers */
  emitStalled(): void {
    (this.cbs.stalled ?? []).forEach(cb => (cb as () => void)());
  }
  emitPlaying(): void {
    (this.cbs.playing ?? []).forEach(cb => (cb as () => void)());
  }
  emitError(err: Error): void {
    (this.cbs.error ?? []).forEach(cb => (cb as (e: Error) => void)(err));
  }
  listenerCount(type: string): number {
    return (this.cbs[type] ?? []).length;
  }
}

export class FakeClips implements ClipPlayer {
  played: string[] = [];
  stops = 0;
  failWith: Error | null = null;

  async play(uri: string): Promise<void> {
    this.played.push(uri);
    if (this.failWith) throw this.failWith;
  }
  stop(): void {
    this.stops++;
  }
}

export class FakeLifecycle implements AppLifecycle {
  private cbs: Array<() => void> = [];
  onBackground(cb: () => void): Unsubscribe {
    this.cbs.push(cb);
    return () => {
      this.cbs = this.cbs.filter(c => c !== cb);
    };
  }
  background(): void {
    this.cbs.forEach(cb => cb());
  }
}

export interface FakeAdapter extends MediaAdapter {
  video: FakeVideo;
  clips: FakeClips;
  lifecycle: FakeLifecycle;
}

export function fakeAdapter(): FakeAdapter {
  return {
    video: new FakeVideo(),
    clips: new FakeClips(),
    lifecycle: new FakeLifecycle(),
    VideoSurface: ({style}: VideoSurfaceProps) => (
      <View testID="video-surface" style={style} />
    ),
  };
}
