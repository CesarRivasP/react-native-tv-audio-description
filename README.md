# react-native-tv-audio-description

Speak audio description in the gaps between dialogue, **on the TV itself**:
lower the film, say what is on screen, bring the film back — before anyone
speaks again. Driven from the remote, with three verbosity levels, and every
state announced to the screen reader.

For blind and low-vision viewers most films have no audio description track
at all. Tracks can now be generated — subtitles give the dialogue gaps, a
vision model describes the frames, text-to-speech voices it. What was missing
is the part that plays such a track **on a television**, where the media stack
is not a browser's and a remote is the only input. That is this library.

It was extracted from **[Interstice](https://github.com/CesarRivasP/Interstice)**, an entry to the Amazon Developer
Hackathon 2026 (Fire TV, Vega OS), and ships a **Vega OS adapter** along with
the [platform findings](PLATFORM.md) it took to make one work.

```sh
git clone https://github.com/CesarRivasP/react-native-tv-audio-description.git
cd react-native-tv-audio-description
npm install
npm run example
```

`npm run example` plays a minute of film at 20x in your terminal — no device,
no SDK — through the library's real scheduler, audio layer and track loader,
and **checks what it shows**: it exits non-zero if a cue fires outside its
gap, is still speaking when dialogue resumes, or leaves the film ducked.

---

## What it does

```
dialogue ██████████░░░░░░░░░░░░░░░░████████████░░░░░░░░░░░██████
gaps               [    cue c1     )            [  cue c2  )
film volume  100% ─╮                ╭─ 100% ───╮           ╭─ 100%
                   ╰──── 25% ───────╯          ╰── 25% ────╯
description        "A keeper climbs the stairs…" "Waves. An empty boat…"
```

- **Fires a cue only inside its own gap, and only if it can finish there.** A
  cue whose gap has passed, or whose gap has too little left — description
  switched back on mid-gap — is skipped, never played late: a late cue talks
  over dialogue, which is worse than no description.
- **Ducks, speaks, restores** — the film goes to 25% over a 200 ms fade, the
  clip plays as a second stream over it, and the film always comes back to
  100%, including when the clip fails and when the app is backgrounded.
- **Seeks cleanly.** A held D-pad direction is collapsed into one settled
  seek, and the scheduler resyncs once, so jumping through a film does not
  fire a burst of descriptions for scenes the viewer skipped.
- **Three verbosity levels**, one track file each, falling back to `standard`
  when a level was never generated.
- **Refuses to be silent.** A missing or malformed track produces a spoken
  sentence — "Playback continues without description" — not a quiet screen
  that a blind viewer cannot tell from a quiet scene.

## Install

```sh
npm install react-native-tv-audio-description
```

Peer dependencies: `react` ^19.2 and `react-native` ^0.83. For the Vega
adapter, also `@amazon-devices/react-native-w3cmedia ~2.3.2` and
`@amazon-devices/react-native-kepler ~4.0.0` — pin those with `~`, not `^`:
they are system-distributed libraries, and the Kepler linter fails the build
when they float.

## Usage

On Vega OS, a player screen:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  ADControls,
  CueScheduler,
  DescriptionAudio,
  loadTrack,
  type ADState,
  type AssetSource,
  type Verbosity,
} from 'react-native-tv-audio-description';
import { createVegaAdapter } from 'react-native-tv-audio-description/vega';

// Vega's player cannot be pointed at a path, but fetch can read a packaged file.
const fetchJson = async (path: string): Promise<unknown> => (await fetch(path)).json();

interface PlayerProps {
  asset: AssetSource; // the film, cut into fragmented-MP4 segments
  trackDir: string; // where <assetId>.<verbosity>.track.json live
  assetId: string;
  readJson?: (path: string) => Promise<unknown>; // how to read a track file
}

export function Player({ asset, trackDir, assetId, readJson = fetchJson }: PlayerProps) {
  // One adapter, one audio layer, one scheduler per screen.
  const media = useMemo(() => createVegaAdapter(), []);
  const audio = useMemo(() => new DescriptionAudio(media), [media]);
  const scheduler = useMemo(
    () => new CueScheduler({ onFire: (cue) => void audio.speak(cue) }),
    [audio],
  );

  const [verbosity, setVerbosity] = useState<Verbosity>('standard');
  const [enabled, setEnabled] = useState(true);
  const [state, setState] = useState<ADState>({ kind: 'missing', detail: 'loading' });

  // Position drives the scheduler; a settled seek resyncs it.
  useEffect(() => {
    const offs = [
      media.video.onPosition((ms) => scheduler.tick(ms)),
      media.video.onSeek((ms) => scheduler.resync(ms)),
    ];
    void media.video.open(asset).then(() => media.video.play());
    return () => {
      offs.forEach((off) => off());
      void audio.stop();
      void media.video.destroy();
    };
  }, [media, audio, scheduler, asset]);

  // A level switch loads that level's file, falling back to standard.
  useEffect(() => {
    void loadTrack(readJson, trackDir, assetId, verbosity).then((result) => {
      if (!result.ok) {
        scheduler.load([]);
        setState({ kind: result.reason, detail: result.detail });
        return;
      }
      scheduler.load(result.track.cues);
      scheduler.resync(media.video.positionMs());
      setState({
        kind: 'ready',
        enabled,
        verbosity: result.loaded_verbosity,
        cues: result.track.cues.length,
      });
    });
    // `enabled` is applied separately below; reloading on a toggle is not needed
  }, [media, scheduler, trackDir, assetId, verbosity, readJson]);

  const onToggle = (on: boolean) => {
    setEnabled(on);
    scheduler.setEnabled(on); // the film is never touched by a toggle
    if (!on) void audio.stop(); // cuts a cue mid-sentence and restores the film
    setState((s) => (s.kind === 'ready' ? { ...s, enabled: on } : s));
  };

  return (
    <View style={{ flex: 1 }}>
      <media.VideoSurface style={{ flex: 1 }} />
      <ADControls state={state} onToggle={onToggle} onVerbosity={setVerbosity} />
    </View>
  );
}
```

This is [`example/vega/src/Player.tsx`](example/vega/src/Player.tsx), which
`npm run typecheck` compiles against the library — if the API changes, this
README's example stops compiling. A real screen will also want to say
something on `media.video.onStalled` (and stop saying it on `onPlaying` —
see [`waiting_fires_at_start`](PLATFORM.md#waiting_fires_at_start)).

## The track

One JSON file per verbosity level, named `<asset_id>.<verbosity>.track.json`:

```json
{
  "version": "1",
  "asset_id": "lighthouse",
  "generated_at": "2026-09-27T00:00:00.000Z",
  "source_subtitles": "lighthouse.en.srt",
  "verbosity": "standard",
  "model_id": "…",
  "cues": [
    {
      "id": "c1",
      "start_ms": 2000,
      "end_ms": 6500,
      "words": 10,
      "text": "A lighthouse keeper climbs the spiral stairs, lantern in hand.",
      "audio_uri": "audio/c1.standard.m4a",
      "source_frames_ms": [4250],
      "status": "ok"
    }
  ]
}
```

- `start_ms`/`end_ms` is the dialogue gap the cue may speak in; `end_ms` is
  exclusive.
- A cue that could not be produced is **written** with `"status": "failed"`
  and empty `text` and `audio_uri`, not dropped. It is never scheduled, but the
  track still says the gap was considered.
- The levels do **not** share a cue list: a gap that holds a useful sentence at
  `detailed` may hold nothing useful at `concise`. In the film this was built
  on, the three levels came out at 47, 55 and 60 cues.
- `validateTrack` checks every field; `loadTrack` treats a missing file and a
  malformed one differently — missing falls back to `standard`, malformed does
  not, because silently loading a different file would hide a broken producer.

Full examples in [`example/assets/`](example/assets/).

### Producing tracks: the word budget

A cue has to finish before dialogue resumes. At 160 words per minute, with
300 ms kept back for the fade:

```ts
import { wordCeiling, wordTarget } from 'react-native-tv-audio-description';

wordCeiling(4500);             // 11 — never exceed this, at any level
wordTarget(4500, 'concise');   //  6 — what to ask a describer for
wordTarget(4500, 'detailed');  // 11
```

Levels are fractions of the ceiling (0.6 / 0.85 / 1.0), never multipliers, so
no level can ask for more words than the gap holds. `npm run example` checks
its own track against this before playing it.

## The adapter

Everything above is written against one interface,
[`MediaAdapter`](src/MediaAdapter.ts), and never against a platform package —
a test fails if that stops being true. Two rules in it matter if you write
your own:

- **Do not assume the platform fetches anything.** On Vega it will not, so
  the Vega adapter reads every byte itself. The interface takes an
  `AssetSource` — a list of segments, even for a single file — so a short clip
  and a feature film run the same code path.
- **`setVolumePct` is immediate and takes no ramp.** The fade lives in the
  library, once. An interface that took `rampMs` would make every platform
  rewrite it.

### `createVegaAdapter(options?)`

| option | default | |
|---|---|---|
| `videoMime` | `video/mp4; codecs="avc1.42C01E,mp4a.40.2"` | **Set this to your asset's codecs.** A bare `video/mp4` is rejected. |
| `clipMime` | `audio/mp4; codecs="mp4a.40.2"` | Description clips, fragmented AAC. |
| `window` | `{ aheadMs: 30000, behindMs: 10000 }` | Media held around the playhead, in time. |

It handles, so you do not have to: `srcObject` instead of `src`, the surface
arriving before the player is ready, a buffer window of whole segments that
never holds the whole film, one `SourceBuffer` operation at a time, and clips
on an `AudioPlayer` built for accessibility speech. Each is explained in
[PLATFORM.md](PLATFORM.md).

Another platform: implement `MediaAdapter` (the simulated one in
[`example/node/simAdapter.ts`](example/node/simAdapter.ts) is a complete,
small example) and everything else works unchanged.

## Seeing what it does on a device

Nothing is logged by default. On Vega, `console.log` goes nowhere you can read
([`no_js_console`](PLATFORM.md#no_js_console)), so the library hands every
diagnostic line to you instead:

```ts
import { setLogger } from 'react-native-tv-audio-description';

setLogger((line) => {
  // e.g. "scheduler.fire id=c1 pos_ms=2004 window=[2000,6500)"
  void fetch(`http://localhost:8099/?m=${encodeURIComponent(line)}`).catch(() => {});
});
```

## Platform findings

What the Vega adapter works around, each one measured — the short version:

| | what happens | cost if you do not know |
|---|---|---|
| [`url_mode_broken`](PLATFORM.md#url_mode_broken) | `player.src = url` fails before a byte is requested | days, chasing codecs that are fine |
| [`no_range_requests`](PLATFORM.md#no_range_requests) | a `Range` request returns `200` and the whole file | a "bounded" buffer that holds the entire film |
| [`surface_races_init`](PLATFORM.md#surface_races_init) | the surface can arrive before `initialize()` resolves | an error that reads as "unsupported file" |
| [`waiting_fires_at_start`](PLATFORM.md#waiting_fires_at_start) | MSE emits `waiting` 2 ms into normal playback | "Buffering" announced over a film that plays |
| [`no_volume_ramp`](PLATFORM.md#no_volume_ramp) | volume changes are instantaneous, no fade exists | a duck that jumps instead of fading |
| [`no_js_console`](PLATFORM.md#no_js_console) | no readable JS console, in Release or Debug | an app you cannot observe |

And a dozen smaller ones — fragmented MP4 only, a separate media process,
silent manifest failures, `videoWidth` stuck at 0, VoiceView unavailable on the
Virtual Device — in [PLATFORM.md](PLATFORM.md).

## What is verified, and what is not

- **Unit tests** covering every component and the adapter against a
  mock of the platform package. `npm test`.
- **The example** — end to end on a simulated adapter, self-checking.
- **On the Vega Virtual Device**, with [`example/vega`](example/vega): the
  packaged library plays a segmented excerpt of Tears of Steel with four
  cues, each firing inside its window, ducking to 25% and restoring before the
  window closes; the remote switches description off mid-cue, on again, and
  to `concise`. What those runs found — and fixed — is in
  [PLATFORM.md § Found by running this package](PLATFORM.md#sourceopen_refires).
- **Not yet verified, and needing a physical Fire TV:** that the duck is
  *audible* (the Virtual Device has no audio capture path), the controls under
  VoiceView (it cannot be enabled on the Virtual Device), and the memory bound
  over a feature-length film (eviction has run once, at the end of the 20 s
  excerpt — not across a film long enough for the bound to matter).

## Versions

[Semantic Versioning](https://semver.org), recorded in
[CHANGELOG.md](CHANGELOG.md). While the version is `0.x`, a minor release may
change the API and says so under **Changed**; a patch release never does.
Every published version is a tagged commit (`v0.1.0` …): `npm publish` refuses
to run unless HEAD carries the tag, the tree is clean, the changelog has the
version's section, and the typecheck, tests and build pass.

To release: move the **Unreleased** notes under a new dated heading, then
`npm version <major|minor|patch>` (which checks the changelog, commits and
tags), `git push --follow-tags`, `npm publish`.

## License

MIT © César Rivas
