# Tetris cinematic audio

Music: **"tetrinomos" by MoneyRhy$**, supplied by Sean as
`SYNTHWAVE 4 SEAN Cmin 77.mp3` (48 kHz stereo, embedded tempo 77 BPM).
This credit describes the supplied recording; no additional license is inferred.
The older Balcade/runner2088 assets retain their own credits and are no longer
referenced by the Tetris opening or menu.

## Music edit

- `tetrinomos-cinematic.mp3`: 60.474021 seconds, music only.
- Opening uses source 0:00-0:12.5. The source's first full drum hit at 24.965 s
  starts at cinematic 12.5 s, with a short splice fade. Playback stays at 77 BPM;
  there is no pitch shifting or time stretching.
- The action cuts use the same beat grid. Launch is at 12.5 s, the Tetris clear
  at 25.746753 s, multiplayer at 31.201299 s, montage at 54.577922 s, and the
  final logo/menu reveal at 58.474026 s. Playback ends two seconds after that.
- The last 1.7 s crossfade to the menu loop's final 1.7 s. The edit accounts
  for cinematic/menu music gains (0.9/0.55). The loop's first sample is scheduled
  on the shared AudioContext clock at the cinematic end, without an extra fade.

## Exactly 11 seconds from 2:06 to 2:17

`tetrinomos-menu-loop.wav` uses only decoded source samples from **126-137 s**.
A 240 ms circular raised-cosine crossfade conditions both sides of the seam,
preserving exactly 528,000 stereo samples at 48 kHz. It has no fade to silence.
The PCM WAV is the browser's primary asset, preserving the boundary exactly;
`tetrinomos-menu-loop.ogg` is a compressed fallback. Web Audio loops the decoded
buffer from 0 to 11 s, so it does not depend on an HTML media element restarting.

`tools/build_tetrinomos_audio.py` reproduces the music edit, conditioned loop,
handoff preview, and numerical report. It requires Python with numpy and FFmpeg:

```text
python tools/build_tetrinomos_audio.py "PATH/TO/SYNTHWAVE 4 SEAN Cmin 77.mp3" --ffmpeg "PATH/TO/ffmpeg" --out "OUTPUT_DIRECTORY"
```

The generator also exports WAV masters and a cinematic-plus-two-loops preview
for review. Only the cinematic MP3, loop WAV, and loop Ogg are page dependencies.

## Separate sound effects

Effects are generated on `Audio.sfxBus`, separately from the music. **SFX on/off**
changes only that bus and remembers `tetris_cinematic_sfx` in the site's store.
The **Sound on/off** button remains the master mute. Turning effects off leaves
the music source and playback clock untouched. The score follows the same cue
times as spark, launch, clear, streaks, attacks, elimination, shatter, achievement
toasts, messages, invite, mode/skull selections, and the finale. No effects are
baked into the new music assets.

## Simulated board playback

Saved player frames must exclude `bakeJob` as well as `ui`, `cpu`, and `baked`.
Previously, replay restored a finished bake job and each subsequent render
appended another simulated frame. Higher display rates therefore changed the
recording during playback. The regression checks assert stable snapshot counts
and contents across repeated renders at 30, 60, 144, 240, and 360 Hz.

Live boards advance at a fixed 120 Hz step and keep their accumulator outside
the saved player state. Held previews do not advance live boards. Montage
rotation is calculated from elapsed cinematic time instead of adding a fixed
angle every display frame.

```text
node tools/test-tetris-cinematic.cjs
```

Numerical seam checks and browser automation do not establish subjective musical
quality or playback on a physical high refresh rate monitor; those still benefit
from listening and display review.

## Verification on 28 October 2026

- JavaScript syntax checks passed for the cinematic and menu music modules.
- The replay regression passed at 30, 60, 144, 240, and 360 simulated Hz.
- Headless Chrome played the complete cinematic and two menu loop cycles. The
  menu source was scheduled at exactly the film's remaining audio-clock time;
  its decoded duration and loop endpoint were both 11 seconds.
- SFX toggling preserved the music source and clock. Saved effects preference,
  master mute/unmute, skip/replay, and the Ogg fallback passed browser checks.
- Inspected 1920x1080 gameplay/finale and 390x844 controls screenshots. Credit
  and controls fit the narrow viewport without overlap.
- No JavaScript page errors were observed. A separate remote Supabase profile
  request returned HTTP 403 during preview; cutscene assets loaded successfully.
- The generated floating-point loop seam step is below 0.000009 full scale;
  the gain-adjusted handoff step is below 0.000005. These are numerical checks,
  not a claim that a human listening session or hardware display test occurred.
