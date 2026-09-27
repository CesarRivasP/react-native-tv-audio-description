import * as React from 'react';
import { act, render } from '@testing-library/react-native';
import { createVegaAdapter } from '../src/vega';
import type { AssetSource } from '../src/MediaAdapter';
import {
  AudioContentType,
  AudioUsageType,
  instances,
  surfaceCallbacks,
  type AudioPlayer,
} from './mocks/w3cmedia';

const ASSET: AssetSource = {
  initUri: 'seg/init.mp4',
  segments: [{ index: 0, start_ms: 0, end_ms: 9_940, uri: 'seg/0.m4s' }],
};

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  instances.players.length = 0;
  instances.sources.length = 0;
  surfaceCallbacks.created.length = 0;
  surfaceCallbacks.destroyed.length = 0;
  (global as { fetch?: unknown }).fetch = jest.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(64),
  }));
});

/** open() and let the mock platform open the MediaSource it was handed */
async function open(adapter: ReturnType<typeof createVegaAdapter>) {
  const opening = adapter.video.open(ASSET);
  await settle();
  instances.sources[instances.sources.length - 1]!.open();
  await opening;
}

function mountSurface(adapter: ReturnType<typeof createVegaAdapter>) {
  const { VideoSurface } = adapter;
  render(<VideoSurface />);
  act(() => surfaceCallbacks.created.forEach((cb) => cb('surface-1')));
}

describe('createVegaAdapter — url_mode_broken', () => {
  // Fails if: the player is pointed at a URL. On this SDK that fails with
  // MEDIA_ERR_SRC_NOT_SUPPORTED before a single byte is requested.
  it('attaches through srcObject and never assigns src', async () => {
    const adapter = createVegaAdapter();
    await open(adapter);
    const player = instances.players[0]!;
    expect(player.src).toBe('');
    expect(player.srcObject).toBe(instances.sources[0]);
  });

  it('uses the codec string it is given, because a bare video/mp4 is rejected', async () => {
    const mime = 'video/mp4; codecs="avc1.640028,mp4a.40.2"';
    const adapter = createVegaAdapter({ videoMime: mime });
    await open(adapter);
    expect(instances.sources[0]!.types).toEqual([mime]);
  });
});

describe('createVegaAdapter — sourceopen_refires', () => {
  // Fails if: 'sourceopen' is handled more than once. Per MSE, remove() or
  // appendBuffer() on an 'ended' source reopens it and fires 'sourceopen'
  // again; evicting after the last segment does exactly that. On the Virtual
  // Device the second handling built another SourceBuffer, re-appended the
  // whole asset and evicted again — a loop at the end of every film.
  it('builds one SourceBuffer however many times the source reopens', async () => {
    const adapter = createVegaAdapter();
    await open(adapter);
    const source = instances.sources[0]!;
    source.open();
    source.open();
    await settle();
    expect(source.types).toHaveLength(1);
  });
});

describe('createVegaAdapter — surface_races_init', () => {
  // Fails if: play() starts on either signal alone. The surface arrived 26 ms
  // BEFORE initialize() resolved on the device, and playing then fails with an
  // error that reads like an unsupported file.
  it('does not play when the surface arrives before the player is ready', async () => {
    const adapter = createVegaAdapter();
    mountSurface(adapter);
    const playing = adapter.video.play();
    await settle();
    const player = instances.players[0]!;
    expect(player.play).not.toHaveBeenCalled();

    await open(adapter);
    await playing;
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('does not play when the player is ready before the surface arrives', async () => {
    const adapter = createVegaAdapter();
    await open(adapter);
    const playing = adapter.video.play();
    await settle();
    const player = instances.players[0]!;
    expect(player.play).not.toHaveBeenCalled();

    mountSurface(adapter);
    await playing;
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.calls).toContain('setSurfaceHandle:surface-1');
  });
});

describe('createVegaAdapter — the player surface', () => {
  it('maps a volume percentage onto 0..1, clamped', () => {
    const adapter = createVegaAdapter();
    const player = instances.players[0]!;
    adapter.video.setVolumePct(25);
    expect(player.volume).toBe(0.25);
    adapter.video.setVolumePct(140);
    expect(player.volume).toBe(1);
    adapter.video.setVolumePct(-5);
    expect(player.volume).toBe(0);
  });

  // Fails if: position is NaN before the player has media. The scheduler
  // would receive it as a seek to nowhere (seen on the device: resync pos_ms=NaN).
  it('reports position 0 while the player has no media yet', () => {
    const adapter = createVegaAdapter();
    instances.players[0]!.currentTime = NaN;
    expect(adapter.video.positionMs()).toBe(0);
  });

  // Fails if: only one of the two platform events reaches onStalled, or if
  // `playing` is not exposed — then a stall is a state the UI cannot leave,
  // and MSE's spurious `waiting` at startup announces "Buffering" forever.
  it('reports both waiting and stalled as a stall, and playing as its way out', async () => {
    const adapter = createVegaAdapter();
    await open(adapter);
    const player = instances.players[0]!;
    const seen: string[] = [];
    adapter.video.onStalled(() => seen.push('stalled'));
    adapter.video.onPlaying(() => seen.push('playing'));

    player.emit('waiting');
    player.emit('playing');
    player.emit('stalled');
    expect(seen).toEqual(['stalled', 'playing', 'stalled']);
  });
});

describe('createVegaAdapter — clips', () => {
  // Fails if: cues are played as media. The accessibility usage is what the
  // platform routes speech prompts by; testing under USAGE_MEDIA would test a
  // different thing.
  it('builds the clip player for accessibility speech', async () => {
    const adapter = createVegaAdapter();
    const playing = adapter.clips.play('audio/cue.m4a');
    await settle();
    const clip = instances.players[instances.players.length - 1] as unknown as AudioPlayer;
    expect(clip.constructedWith).toEqual([
      AudioContentType.CONTENT_TYPE_SPEECH,
      AudioUsageType.USAGE_ACCESSIBILITY,
    ]);

    instances.sources[instances.sources.length - 1]!.open();
    await settle();
    await settle();
    clip.emit('ended');
    await playing;
    expect(clip.srcObject).not.toBeNull();
    expect(clip.src).toBe('');
  });

  // Fails if: stop() leaves the clip's promise pending. A paused AudioPlayer
  // never emits 'ended', so the promise never settled and the player was never
  // torn down — one leaked player per interrupted cue on the Virtual Device.
  it('settles the clip and tears its player down when stopped', async () => {
    const adapter = createVegaAdapter();
    const playing = adapter.clips.play('audio/cue.m4a');
    await settle();
    const clip = instances.players[instances.players.length - 1] as unknown as AudioPlayer;
    instances.sources[instances.sources.length - 1]!.open();
    await settle();
    await settle();

    adapter.clips.stop();
    await expect(Promise.race([playing.then(() => 'settled'), settle().then(() => 'pending')]))
      .resolves.toBe('settled');
    expect(clip.pause).toHaveBeenCalled();
    expect(clip.deinitialize).toHaveBeenCalled();
  });

  // Fails if: the clip's promise waits for the player's teardown. Measured at
  // ~130 ms on the Virtual Device, every one of them with the film still ducked.
  it('resolves when the clip ends, without waiting for teardown', async () => {
    const adapter = createVegaAdapter();
    const playing = adapter.clips.play('audio/cue.m4a');
    await settle();
    const clip = instances.players[instances.players.length - 1] as unknown as AudioPlayer;
    clip.deinitialize.mockImplementation(() => new Promise<void>(() => undefined));

    instances.sources[instances.sources.length - 1]!.open();
    await settle();
    await settle();
    clip.emit('ended');
    await expect(Promise.race([playing.then(() => 'resolved'), settle().then(() => 'waiting')]))
      .resolves.toBe('resolved');
  });
});
