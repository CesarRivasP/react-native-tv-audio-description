# Changelog

All notable changes to this package are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is `0.x`, a **minor** release may change the public API — the
changelog says so under **Changed** whenever it does. A **patch** release never
does.

A version cannot be published without its section here: `prepublishOnly` checks.

## [Unreleased]

### Changed

- `example/vega` installs the library from npm instead of a local tarball;
  `npm run lib:local` keeps the tarball route for unreleased changes.

## [0.1.0] - 2026-09-27

First release: the TV-side audio description layer extracted from
[Interstice](https://github.com/CesarRivasP/Interstice), with a Vega OS adapter.

### Added

- `MediaAdapter` — the one interface the layer uses to reach a platform: a
  video player, a clip player, the app lifecycle and the video surface.
- `CueScheduler` — fires each cue once, only inside its dialogue gap, and only
  if the gap has room left for it to finish; skips a late cue with a
  `reason=late` log line rather than speaking over the next scene. `resync()`
  after a settled seek, `coalesce()` for a held D-pad direction.
- `DescriptionAudio` — ducks the film to 25% over a 200 ms fade, plays the cue
  as a second stream, restores to 100% — including when the clip fails, the
  app is backgrounded, or description is switched off mid-cue.
- `rampVolumePct` — the fade the platform does not have, timed by elapsed time
  so late timers cannot stretch it.
- `loadTrack` / `validateTrack` — one track file per verbosity level, validated
  field by field, falling back to `standard` when a level is missing and
  refusing to fall back when one is malformed. `ClipCache`, a bounded cache.
- `ADControls` — the remote surface: an on/off switch and three verbosity
  levels, every state announced to the screen reader, once. `stateMessage()`
  for the same sentences outside React Native.
- The word budget for track producers: `wordCeiling`, `wordTarget`,
  `baseWordBudget`, `VERBOSITY_SCALES`.
- `setLogger()` — every diagnostic line handed to the app, silent by default.
- `react-native-tv-audio-description/vega` — `createVegaAdapter()` for Vega OS,
  and `SegmentBuffer`, a buffer window of whole segments measured in time.
  Handles, among the rest of [PLATFORM.md](PLATFORM.md): `srcObject` instead
  of a URL, the surface arriving before the player is ready, `sourceopen`
  firing again after the end of stream, a paused clip that never ends.
- `npm run example` — a minute of film at 20x in a terminal, self-checking.
- `example/vega` — a Vega app on a Tears of Steel excerpt, run on the Vega
  Virtual Device.

[Unreleased]: https://github.com/CesarRivasP/react-native-tv-audio-description/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/CesarRivasP/react-native-tv-audio-description/releases/tag/v0.1.0
