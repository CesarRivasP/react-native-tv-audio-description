# example/vega — on a Vega OS device

The library in a real Vega app: the first 20 seconds of *Tears of Steel*, cut
into fragmented-MP4 segments, with four description cues at two verbosity
levels, driven from the remote.

It needs the **Vega SDK** and a device — the Vega Virtual Device is enough. For
a look at the library with nothing installed, `npm run example` at the
repository root runs the same components in a terminal.

## Run it

```sh
# from this directory, with the Vega SDK set up (source ~/vega/env)
npm run lib                   # pack the library from ../.. and install it here
npm install
npm run build:release

vega virtual-device start
vega device install-app --packagePath build/aarch64-release/tvad-example-vega_aarch64.vpkg
vega device launch-app --appName com.cesarrivasp.tvadexample.main
```

Vega has no readable JavaScript console, so the diagnostic lines come over
HTTP. In a second terminal, before launching:

```sh
npm run beacon
vega device start-port-forwarding --port 8098 --forward false
```

The remote, or key injection on the Virtual Device:

```sh
vega device run-cmd -c 'inputd-cli button_press KEY_ENTER'   # description on/off
vega device run-cmd -c 'inputd-cli button_press KEY_DOWN'    # to the verbosity levels
```

## What a run looks like

From the Virtual Device, 2026-09-27, unedited except for timestamps and the
announcements. Injected keys are marked where the host logged them, which is
just after the device had reacted. Description is switched off
mid-cue, back on while the second cue can still finish in its window, then
switched to `concise` 18 ms before that window closes — so the concise version
of the same cue is skipped rather than played over the next scene:

```
scheduler.fire id=c1 pos_ms=219 window=[200,5000)
audio.duck id=c1 to_pct=25
cue.audio bytes=41914
controls.toggle to=false
cue.audio state=stopped
audio.stopped
audio.interrupted id=c1
# KEY_ENTER
audio.restored after=stop
controls.toggle to=true
scheduler.fire id=c2 pos_ms=6219 window=[5000,10000)
audio.duck id=c2 to_pct=25
# KEY_ENTER
cue.audio bytes=31422
# KEY_DOWN
cue.audio state=ended t=2.48
audio.spoke id=c2 words=6
audio.restored id=c2
controls.verbosity to=concise
loader.load path=tracks/tears-of-steel-excerpt.concise.track.json ok=true cues=4
scheduler.load cues=4
scheduler.resync pos_ms=9863 cursor=1
scheduler.skip id=c2 pos_ms=9982 reason=late remaining_ms=18 needs_ms=1525
# KEY_ENTER
scheduler.fire id=c3 pos_ms=10232 window=[10000,15000)
audio.duck id=c3 to_pct=25
cue.audio bytes=21398
cue.audio state=ended t=1.67
audio.spoke id=c3 words=5
audio.restored id=c3
scheduler.fire id=c4 pos_ms=15244 window=[15000,20047)
audio.duck id=c4 to_pct=25
cue.audio bytes=26323
cue.audio state=ended t=2.07
audio.spoke id=c4 words=5
audio.restored id=c4
buffer.evicted n=1 up_to_ms=9940 held=3
buffer.complete segments=3
```

## The cues

[`src/cues.ts`](src/cues.ts) holds the text, written by hand from frames of
the excerpt. [`scripts/voice.ts`](scripts/voice.ts) voices them with Amazon
Polly (neural, Joanna), repackages each as fragmented AAC — an MP3 cannot be
appended to a `SourceBuffer` — and **fails if a clip would still be speaking
when its window closes**, using the costs measured on the device. It caught
one on its first run: a ten-word sentence within its word budget, whose full
stop added a pause that took it past the window.

The clips are committed; running the example does not need AWS.

## The film

*Tears of Steel* © Blender Foundation | [mango.blender.org](https://mango.blender.org),
licensed under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).
The excerpt is the first 20 seconds, re-encoded to H.264 Constrained Baseline
and cut into segments; nothing else is changed.
