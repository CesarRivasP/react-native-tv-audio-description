# Platform findings — Vega OS media

What this library works around, and how each thing was found. Every entry was
**measured**, most of them on the way to shipping
[Interstice](#where-these-come-from) on the Vega Virtual Device; none of it was
in the platform documentation at the time.

**Stack measured against:** Vega SDK 0.24 (0.24.12112), Vega CLI 1.3.4,
`@amazon-devices/react-native-w3cmedia` 2.3.2, React Native 0.83, the **Vega
Virtual Device**. Nothing here has been re-measured on a physical Fire TV
yet; the entries that can only be settled there say so.

Each entry: what happens, how it was measured, what it costs you if you do not
know, and where this library handles it.

---

## The six that shaped the design

### url_mode_broken

**Assigning a URL to `player.src` fails before a single byte is requested.**

`MEDIA_ERR_SRC_NOT_SUPPORTED` (code 4), with an empty native message and no
media log line, for a remote URL, for a packaged `file://` path, and for
`AudioPlayer` as well as `VideoPlayer`. The HTTP server serving the file logs
no request at all. `canPlayType()` answers `"probably"` for the same type it
then refuses, so format negotiation is not where it stops. Same device, same
session, same footage: `.src` fails, `MediaSource` plays.

- **Measured:** 2026-09-25. Reproduced independently by another developer on
  the same stack, in the
  [Amazon developer forum](https://community.amazondeveloper.com/t/audioplayer-url-mode-fails-with-media-err-src-not-supported-on-vvd-app-never-connects-to-com-amazon-media-server-both-official-media-samples-also-fail/29117).
- **Cost of not knowing:** about four days and six rounds of work, most of it
  spent on hypotheses about codecs, containers and paths that the error message
  invites and that are all wrong.
- **Here:** every byte is fetched in JavaScript and appended to a
  `MediaSource` attached through `srcObject`, for the film and for each
  description clip (`src/vega/index.tsx`, `src/vega/SegmentBuffer.ts`). The
  `MediaAdapter` interface says no implementation may assume the platform
  fetches anything. A test fails if the adapter ever assigns `src`.

### no_range_requests

**A `Range` request returns `200` and the whole file.**

A `fetch` of a packaged file with `Range: bytes=0-65535` came back with status
`200`, **2,628,566 bytes** — the entire file — and no `Content-Range` header.

- **Measured:** 2026-09-26, on the Virtual Device, against a packaged
  `file:///pkg/...` path.
- **Cost of not knowing:** a buffer window built on byte ranges *appears to
  work* — playback is fine — while every "chunk" is the whole film. On a
  32-bit Fire TV Stick that is the memory bound failing silently, in the one
  place nobody is looking.
- **Here:** the asset is cut into whole segments at build time, and
  `SegmentBuffer` keeps a window of whole segments measured in **time, not in
  count**: ffmpeg cuts on keyframes, so segments asked for at 6 s came out
  9.94 s, 4.17 s, 5.29 s and 0.65 s, and "keep five segments" would mean
  anything between 3 and 50 seconds of media.

### surface_races_init

**`initialize()` and the surface handle arrive in no guaranteed order.**

The video surface was handed over **26 ms before** `VideoPlayer.initialize()`
resolved. Calling `play()` from the surface callback alone plays a player with
no source yet and yields `MEDIA_ERR_SRC_NOT_SUPPORTED` — which reads exactly
like an unsupported file, and is not one.

- **Measured:** 2026-09-22.
- **Here:** the adapter tracks both signals; whichever lands second starts
  playback. The surface is part of the adapter (`MediaAdapter.VideoSurface`)
  precisely so a screen cannot wire it up on its own. Tests cover both orders.

### waiting_fires_at_start

**MSE emits `waiting` during normal startup.**

2 ms after `play()` resolved, on a clip that then played to the end.

- **Measured:** 2026-09-25. No fake emits a spurious `waiting`, so no unit test
  could have found this; it took running on the device.
- **Cost of not knowing:** a screen that treats a stall as terminal announces
  "Buffering" over a film that is playing perfectly — to a viewer who cannot
  see that it is.
- **Here:** `onStalled` is a state playback can *leave*: the interface exposes
  `onPlaying` as its exit and says so.

### no_volume_ramp

**The volume setter is instantaneous. There is no fade anywhere in the API.**

- **Measured:** 2026-09-22, from the package's own type declarations: no
  ramp parameter exists anywhere in the media surface.
- **Cost of not knowing:** a duck that jumps from 100% to 25% in a single
  step on every cue, because the platform will not fade it for you.
- **Here:** the fade is stepped in JavaScript, once, in `src/duck.ts`, and is
  cancellable so it cannot outlive the screen that started it.
  `VideoPlayer.setVolumePct` deliberately takes no `rampMs`: accepting one
  would invite every platform implementation to rewrite the same loop, and
  imply a capability no platform here has.

### no_js_console

**There is no readable JavaScript console on the device.**

`console.log` reaches `vega device start-log-stream` in neither Release nor
Debug builds, and since React Native 0.73 Metro prints "JavaScript logs have
moved" and routes them to React Native DevTools, which needs a browser. There
is also no way to take a screenshot.

- **Measured:** 2026-09-22.
- **What works:** an HTTP beacon to the development host, over the reverse
  port forwarding the device already uses for Metro
  (`vega device start-port-forwarding --port 8099 --forward false`), with a
  tiny server on the host printing each request.
- **Here:** the library writes nothing by default; `setLogger()` hands you
  every diagnostic line, and where they go is your app's decision.

---

## Found by running this package on the Virtual Device

Measured 2026-09-27 with `example/vega`, on the stack above. None of these
shows up in a unit test against a mock — each needed the device.

### sourceopen_refires

**`sourceopen` fires again after `endOfStream()`, whenever the buffer changes.**

This one is the MSE specification, not a Vega defect: `appendBuffer()` or
`remove()` on a source whose `readyState` is `ended` moves it back to `open`
and fires `sourceopen` again. Evicting old media behind the playhead once the
last segment is in does exactly that. A `sourceopen` handler that builds the
`SourceBuffer` therefore runs twice. On the device that built a second buffer,
re-appended the whole asset, evicted again, reopened again — a loop at the end
of every film, with `endOfStream()` throwing *"exception when updating
attribute is true"* as the two chains collided.

- **Here:** the adapter handles `sourceopen` once per `open()`, and
  `endOfStream()` is only called when no buffer operation is in flight.

### coarse_timers

**`setTimeout(fn, 16)` fires late.** A fade written as 13 steps of 16 ms took
about **510 ms** instead of 200. With the fade down, the clip start and the
fade back up all stretched, three of four cues brought the film back up after
their window had closed — by up to 0.57 s.

- **Here:** `rampVolumePct` sets each step's level from the time *elapsed*,
  not from its step number, so the fade ends on time however late the timer
  fires. Measured after the change: fades of 200–260 ms.

### paused_never_ends

**A paused `AudioPlayer` never emits `ended`.** Stopping a cue by pausing its
clip player left the promise waiting for `ended` pending forever — so the
player was never torn down: one leaked player per interrupted cue.

- **Here:** `clips.stop()` settles the clip's promise itself, and teardown
  (`deinitialize()`, ~120 ms on the device) runs without holding up the
  restore of the film.

### What a cue costs, end to end

From the scheduler firing a cue to the film being back at full, on the
Virtual Device with the changes above: **fade down + clip start 250–290 ms**,
then the speech, then **fade up 200–260 ms**. `CueScheduler` will not fire a
cue that its window cannot hold — reached late, say, because description was
switched back on mid-gap — and skips it with a `reason=late` log line instead.

---

## Also measured, and worth knowing

### concurrent_streams — a second stream over the film works

A `VideoPlayer` fed by one `MediaSource` and an `AudioPlayer` built with
`(CONTENT_TYPE_SPEECH, USAGE_ACCESSIBILITY)` fed by another played
**simultaneously**: the cue ran its full 4.50 s while the video reported
`paused=false` and zero dropped frames. Ducking the film to `volume = 0.25`
disturbed neither. This is what makes the library possible.
**Not measured:** that a listener *hears* it — there is no audio capture path
off the Virtual Device. What is measured is that both pipelines ran and the
volume was applied. Audible ducking needs a physical Fire TV.

### mse_path — fragmented MP4, full codec string

The media must be **fragmented MP4**
(`ffmpeg -movflags +frag_keyframe+empty_moov+default_base_moof`), and
`addSourceBuffer` rejects a bare `video/mp4`: it needs the full parameters,
e.g. `video/mp4; codecs="avc1.42C01E,mp4a.40.2"`. Pass yours as
`createVegaAdapter({ videoMime })`. An MP3 cannot be appended to a
`SourceBuffer` at all, so description clips need repackaging as fragmented
AAC.

### media_process_is_separate — what JS can reach, the player may not

JavaScript fetched `http://localhost:8100/clip.mp4` over the reverse port
forward and got `200`; the player rejected the same URL and the server logged
no request from it. The media pipeline runs in its own process
(`com.amazon.media.server`). Host-localhost forwarding works for the app and
not for playback, and the two look identical from JavaScript. (With
`url_mode_broken` this is moot for this library — JS does all the fetching —
but it will bite anything that hands the player a URL.)

### manifest services — missing ones fail silently

Media services must be declared under `[wants]` in `manifest.toml`. Missing,
the result is no video **and no error**.

### video_width_unreported — `videoWidth` stays 0

`videoWidth` and `videoHeight` stay 0 through `loadedmetadata`, `playing` and
beyond, and the platform's `resize` event carries `w=0 h=0` — while 253 frames
decode with 0 dropped. Do not gate "is video playing" on the width; use
`getVideoPlaybackQuality().totalVideoFrames`.

### voiceview_not_enablable — screen reader testing needs hardware

VoiceView cannot be turned on on the Virtual Device by any developer route:
the config key is readable but `vdcm set` returns "No permission for
operation" from both `vega device run-cmd` and `vega device shell`. Another
developer on the same platform reports the other two documented routes failing
too: the Virtual Device's Settings app has no Accessibility section, and the
Back+Menu chord does not fire. So `ADControls`' accessibility contract is unit-tested by
what it **announces**, and has not been exercised under VoiceView itself.

### run_cmd_is_sandboxed — "does not exist" means nothing

`vega device run-cmd` runs as an app user inside an app context: `ps` lists two
processes and `/dev/input` "does not exist" while input injection through the
same shell works. **Any probe run from there that reports a resource absent has
reported nothing.** Key injection that does work:
`vega device run-cmd -c 'inputd-cli button_press KEY_ENTER'`.

### build_packages_assets_dir — `assets/` ships, all of it

`react-native build-vega` copies the entire project-root `assets/` directory
into the package whether or not anything references it. A 372 MB source video
left there made a 497 MB package, with nothing in the build output to say so.
Keep host-side media somewhere else.

### Kepler types and `noUncheckedIndexedAccess`

`@amazon-devices/react-native-kepler` ships `.ts` sources behind its type
entry point, so `skipLibCheck` does not cover them, and
`KeplerBackHandler.ts` fails with TS2722 under `noUncheckedIndexedAccess`. A
project that imports the w3cmedia types with that flag on cannot type-check.
This library leaves the flag off for that reason.

---

## Where these come from

This library was extracted from **Interstice**, an AI audio description app
for Fire TV built for the Amazon Developer Hackathon 2026. Its specification
keeps every one of these as a measured entry with date and evidence, and the
dates above are those measurements. If you re-measure any of them on another
SDK version or on hardware and get a different answer, an issue saying so is
the most useful contribution this file can get.
