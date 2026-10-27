# tetronimo$: original opening and extended cut

The extended cut follows the complete **137.976-second recording** of
**"tetronimo$" by MoneyRhy$**, supplied by Sean as
`SYNTHWAVE 4 SEAN Cmin 77.mp3`. It plays at its original 77 BPM.

`tetrinomos-full-track.mp3` is byte-for-byte identical to that supplied MP3.
The music has no removed sections, added effects, pitch change, or time stretch.
Displayed credits use the corrected title **tetronimo$**; existing asset filenames
retain their historical spelling to preserve references and the original MP3.
The **60-second original cut also uses this same unmodified tetronimo$ MP3**.
It plays source 0:00-1:00 continuously at normal speed: one source segment,
starting at zero, with no internal splices, jumps, pitch changes or time stretch.
Only the playback gain fades from 58.5-60 seconds to make the requested exit
transition. The music file itself is unchanged. The previously shortened
`tetrinomos-cinematic.mp3` edit and the older Balcade master are not used.
The original cut plays automatically once per browser. Its seen key is
`games_tetris_cinematic_original_seen_v1`, so visitors who saw the previous
extended opening still get the restored original. Reduced-motion and invite/
busy-screen safeguards remain. Watching the extended cut does not mark the
original as seen. Menu buttons replay either cut.

**Both cuts begin on the original head-on pixel arcade cabinet.** The extended
cut leaves the cabinet at 12.5 seconds. The original keeps its original scenes,
including the purple road, game modes and skull selection wall.

## Approved sequence

| Source time / cinematic time | Scene |
| --- | --- |
| 0:00-0:12.5 | Original arcade cabinet, logo, subtitle and sparks |
| 0:12.5-0:24.965 | Front scanner close-up, dashboard play, side departure |
| 0:24.965-0:37.433 | Rear acceleration, wheel close-up, front quarter, aerial |
| 0:37.433-0:49.900 | Coast, live board billboards, falling I and four-line clear |
| 0:49.900-0:53.017 | Low front view into the underpass |
| 0:53.017-1:02.368 | Side-by-side multiplayer boards and active skull/power demonstrations |
| 1:02.368-1:14.835 | Side, aerial and bonnet views through Chess temple scenery |
| 1:14.835-1:27.303 | The grid breaks away beneath the car |
| 1:27.303-1:33.536 | Freefall into black toward a box containing hexagonal space |
| 1:33.536-1:39.770 | Dive through a hex portal with separated colour fringes |
| 1:39.770-1:52.238 | Main return: real boards and streak ascension |
| 1:52.238-2:04.705 | Multiplayer, Star Bomb junk scatter, elimination and montage |
| 2:04.705-2:17.976 | Sunset return, achievements/profile/chat/invite and live menu |

The first full drum hit anchors beat zero at 24.965 s. The portal crossing is
96 beats later at 99.770195 s. Shot-local camera paths stretch to their allotted
slots; the audio itself stays uncut. Acceleration changes the field of view and
adds radial lens distortion to the driving and portal shader. Speed rays are
strongest during surges, leaving the sunset and scenery readable between them.

## Code and art ownership

- `tetris-cinematic.js`: cue sheet, real Player boards, camera and playback clock,
  effects bus, social UI, skip/replay and menu handoff.
- `tetris-cinematic-drive.js`: highway, tunnel, collapse, black box/hex portal,
  scenery placement, camera angles, tetromino rain, car and dashboard inserts.
- `tetris-cinematic-cuts.js`: short-cut cue sheet on the same 77 BPM source grid,
  a single continuous 0-60 second music segment, and separate generated effects.
  It shares the renderer/player engine rather than duplicating the cinematic.
- `tetris-cinematic-features.js`: isolated real Player demonstrations synchronized
  to the 77 BPM beat grid, active skull labels and actual cleared-power callouts.
- `tetris-cinematic-scenery.js`: sky/cloud shader and pixel prop data extracted
  from the current Chess cinematic. Chess files themselves are unchanged.
- `tetris-drive-assets/`: the four original car PNGs and creator/source terms.
- `tetris-menu-music.js`: the independent, gapless 11-second menu loop.
- `tetris.html`: scene dependencies in deferred load order, with cache versions.
- `tools/build_tetrinomos_audio.py`: reproducible full-track copy, exact loop and
  full-track-plus-two-loops WAV for audio review.

The car sprites are **Free Racing Car #1 (64x64)** by **Pay 'n' Sprite**:
https://patricio449.itch.io/free-racing-car-1-64x64
They are used unmodified; the night tint, cyan trim, T-shaped lights and scanner
are separate rendering layers. A simple original car is an image-load fallback.
The creator's usage terms are recorded in `tetris-drive-assets/CREDITS.txt`.

Chess's cloud/sky shader is the existing Deep-Fold PixelPlanets adaptation.
Its MIT notice is preserved in the extracted module. The columns, ivy, ruins,
temple, dolphin, flamingo and beach props retain the existing pixel artwork.

## Separate effects and stable simulation

**SFX on/off** only changes `Audio.sfxBus`, preserving the music source and clock.
The choice is remembered as `tetris_cinematic_sfx`. **Sound on/off** remains the
master audio mute. Engine rises, pass-bys, clear, collapsing road, fall, portal,
streaks, attacks, Star Bomb, shatter and UI cues are generated separately.
Both cuts' effects, including the ending swish, are generated on that separate
bus. Neither cut uses music with baked-in cinematic effects.

The dashboard, billboards and space boards use the actual Tetris Player/renderer
and CPU. Driving feature boards use choreographed setups and inputs, calling real
`Player.lock()` on beats; they are demonstrations, not network matches. Cleared
row powers determine the on-screen icon/name. All nine powers are cycled, with
No Ghost, No Hold, Blind and Birthday Party modifiers. HOLD/NEXT/ghost pieces,
four-line clears, streaks and effect timers use the normal renderer. Freeze pauses
a demo opponent, Blue Shell adds real garbage to its leading rival, Curse places
a skull on a following piece, and Star Bomb calls real `Player.scatterJunk`.
The 53-62 second multiplayer shot shows three boards on desktop and two on phones.

`tetris.js` adds `clearedPowers` to the existing lock result and exposes power
metadata/constants through `cinematicKit()`. Normal game rules are unchanged.
All demonstration players remain isolated from the running game and network.

Bottom Sound/SFX/Skip controls follow Sean's supplied reference: dark pill
buttons, bold white monospace text, purple outlines and a white Skip outline.
Invite controls use the website's `.btn` variants. Panels/cards/skull selections and HUDs reuse `.panel`,
`.panel-title`, `.mode-card`, `.skull-card`, `.chip`, `.board-head`, `.board-stats`
and `.hud-timers`, including the existing Tetris glass surfaces and design tokens.
Cinematic CSS supplies positioning/scaling and the requested bottom controls. Profile,
chat, friends and invite panels sit 160 world units higher; the achievements wall
is scaled to keep its heading in frame.

Saved frames exclude `bakeJob`, `baked`, `cpu` and `ui`. Playback never restarts a
finished bake. Live boards use a 120 Hz simulation accumulator outside saved
state. Car motion, scenery, scanner and lens effects depend on cinematic time.
Recorded CPU locks, including the dashboard, are replayed on each cut's own
77 BPM beat grid, anchored at source 24.965 seconds. Actual recorded lock transitions
provide the retiming anchors; saved Player snapshots remain immutable. Rain
drops move in short bursts on beats and settle between them. Dedicated scripted
clear/attack shots keep their soundtrack cue hits. Driving demonstration boards
already lock and clear their power rows on the 77 BPM grid.
Held previews do not advance live boards. The initial soundtrack decode holds
the opening clock, allowing the full recording to begin at sample zero.

## Reproduction and review

```text
python tools/build_tetrinomos_audio.py "PATH/TO/SYNTHWAVE 4 SEAN Cmin 77.mp3" --ffmpeg "PATH/TO/ffmpeg" --out "OUTPUT_DIRECTORY"
node tools/test-tetris-cinematic.cjs
```

The menu loop still contains exactly 528,000 stereo samples (11 s at 48 kHz)
from source 126-137 s. A 240 ms circular crossfade conditions both sides of its
boundary without shortening the loop or fading to silence. PCM WAV is primary;
Ogg is the fallback. It starts on the shared audio clock after the complete song,
with a short menu-channel fade-in following the extended recording's natural
tail. After the original cut's continuous first minute, the same 11-second loop begins at
60 seconds with a one-time 0.8-second fade-in under the swish tail. The loop
asset, its sample count and its repeated seam remain unchanged.
Its final menu reveal adds an original console-era swish: filtered air and a
descending stereo C-minor/add-nine glass chord. It starts at 58.471 seconds and
decays across the 60-second loop handoff. The original cut's SFX graph stays
alive for a 2.2-second fade after the picture ends. This added layer follows the
SFX toggle and leaves the supplied MP3 and loop assets intact.

Preview URLs: `tetris.html?cinematic=0` for the original;
`tetris.html?cinematic=0&cut=extended` for the full version. Append `&hold=SECONDS`
to inspect a frame. Useful moments include 2 (cabinet), 30 (highway), 55 (skull
demonstration), 67 (temple), 90 (fall),
96 (portal), 99.65 (crossing), 102 (streaks), and 115 (multiplayer/Star Bomb).

## Verification boundary

JavaScript syntax, browser shader compilation and representative scene seeks
were checked. The saved-frame/live-simulation regression passes at 30, 60, 144,
240 and 360 simulated Hz. Source and full-track MP3 SHA-256 hashes match.

Chrome completed the full 137.976-second recording from source offset zero,
followed by two live menu-loop cycles. The menu source starts at the film's
scheduled end on the shared clock. The Star Bomb really scattered junk during
the multiplayer shot; baked snapshot counts stayed unchanged through playback.
SFX toggling preserved the music source and clock. Saved SFX preference, master
mute/unmute, skip and replay passed. Shader and control layouts were checked at
390x844, 1920x1080 and 2560x1080. No page exceptions, cinematic shader warnings,
or missing local assets were observed in these checks.

Both cuts completed a new uninterrupted browser playback check, each followed
by two menu-loop cycles. The extended feature manager produced 72 real beat
clears with zero failed clears, all nine power types, and outgoing Freeze,
Blue Shell and Curse effects. Each recorded beat cleared once. The original
automatic launch, once-per-browser behavior, cabinet opening in both versions,
extended replay choice, scene seeks and separate SFX bus passed. New feature
panel screenshots and browser metrics are saved with the earlier captures.
Phone/ultrawide feature layouts and an ordinary CPU match passed. Cinematic
buttons use the supplied reference's pill corners and bold monospace text, and
their bounds were checked at 390x844 and 1920x1080 after the final styling change.

`docs/previews/tetris-full-track/` contains highway, temple and portal captures
plus the playback report. Screenshots establish those frames, not motion or
subjective sound quality; the separate playback report covers the automated run.

Automated playback, screenshot review, numerical audio checks, human listening,
and a physical high refresh rate display are different verification levels.
The latter two require separate review; they are not implied by browser tests.

The final original-cut transition was rendered through Web Audio offline and
checked during live browser playback. One swish fired, its voices survived the
menu handoff and finished afterward, SFX mute rendered silence, and the mixed
12-second review clip had no clipped samples. `original-menu-swish-preview.wav`
contains the final six seconds of the original cut and six seconds of the loop.
These automated checks do not substitute for listening to its tone and balance.

The final original-cut check verifies that the decoded music is the full
137.976-second supplied asset, while the short film ends at 60 seconds. Its
single music source starts at offset zero with playback rate 1; no music
segments are skipped. The first large drum hit now triggers the hero Tetris
clear at source 24.965 seconds, and later shots use that same 77 BPM grid.
Beat tests check actual CPU locks immediately before/after musical beats in
both cuts. Frame-rate checks preserve snapshot immutability and lock timing
at 30, 60, 144, 240 and 360 Hz.
