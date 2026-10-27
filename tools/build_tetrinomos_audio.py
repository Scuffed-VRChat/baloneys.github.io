"""Build Tetris music assets from Sean's source. Requires numpy and FFmpeg.

python build_tetrinomos_audio.py SOURCE.mp3 --ffmpeg PATH --out DIRECTORY
No effects are mixed into either music asset. Sample positions use decoded time.
"""
import argparse
import json
import subprocess
import wave
from pathlib import Path

import numpy as np

RATE = 48000
DROP = 12.5
SOURCE_DROP = 24.965
END = DROP + 59 * 60 / 77 + 2


def write_wav(path, samples):
    with wave.open(str(path), "wb") as out:
        out.setparams((2, 2, RATE, 0, "NONE", "not compressed"))
        out.writeframes(np.round(np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())


def build(source, ffmpeg, out):
    out.mkdir(parents=True, exist_ok=True)
    raw = subprocess.check_output([ffmpeg, "-v", "error", "-i", str(source),
                                   "-f", "f32le", "-ar", str(RATE), "-ac", "2", "pipe:1"])
    audio = np.frombuffer(raw, dtype="<f4").reshape(-1, 2).copy()
    if len(audio) < 137 * RATE:
        raise ValueError("Source must include the requested 2:06-2:17 interval")

    # Preserve exactly 11 seconds. A circular, 240 ms raised-cosine blend
    # mirrors only the selected interval's edge samples across the boundary.
    # Both sides meet halfway; this avoids a fade to silence or a shorter loop.
    loop = audio[126 * RATE:137 * RATE].copy()
    n = round(0.12 * RATE)
    tail, head = loop[-n:].copy(), loop[:n].copy()
    a = np.concatenate((tail, tail[::-1]))
    b = np.concatenate((head[::-1], head))
    w = (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, 2 * n)))[:, None]
    seam = a * (1 - w) + b * w
    loop[-n:], loop[:n] = seam[:n], seam[n:]

    # Keep the original opening, jump to the first full drum hit for launch,
    # then use the unaltered 77 BPM recording through the action sequence.
    length, launch = round(END * RATE), round(DROP * RATE)
    film = np.empty((length, 2), dtype=np.float32)
    film[:launch] = audio[:launch]
    start = round(SOURCE_DROP * RATE)
    film[launch:] = audio[start:start + length - launch]
    fade = round(0.025 * RATE)
    film[launch - fade:launch] *= np.linspace(1, 0, fade)[:, None]
    film[launch:launch + 240] *= np.linspace(0, 1, 240)[:, None]
    film[:240] *= np.linspace(0, 1, 240)[:, None]

    # Last 1.7 seconds become the loop's last 1.7 seconds. At END the
    # audio-clock-scheduled menu starts at loop sample zero without a gap.
    cross = round(1.7 * RATE)
    w = (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, cross)))[:, None]
    # The cinematic music bus is 0.9 and the menu bus is 0.55. Match their
    # audible levels too, rather than introducing a volume step at the handoff.
    film[-cross:] = film[-cross:] * (1 - w) + loop[-cross:] * (0.55 / 0.9) * w
    write_wav(out / "tetrinomos-menu-loop.wav", loop)
    write_wav(out / "tetrinomos-cinematic.wav", film)
    metadata = ["-metadata", "title=tetrinomos", "-metadata", "artist=MoneyRhy$", "-metadata", "TBPM=77"]
    subprocess.run([ffmpeg, "-v", "error", "-y", "-i", str(out / "tetrinomos-cinematic.wav"),
                    "-c:a", "libmp3lame", "-b:a", "256k", *metadata,
                    str(out / "tetrinomos-cinematic.mp3")], check=True)
    subprocess.run([ffmpeg, "-v", "error", "-y", "-i", str(out / "tetrinomos-menu-loop.wav"),
                    "-c:a", "libvorbis", "-q:a", "6", *metadata,
                    str(out / "tetrinomos-menu-loop.ogg")], check=True)
    preview = np.concatenate((film, loop, loop))
    write_wav(out / "tetrinomos-handoff-preview.wav", preview)
    subprocess.run([ffmpeg, "-v", "error", "-y", "-i", str(out / "tetrinomos-handoff-preview.wav"),
                    "-c:a", "libmp3lame", "-b:a", "192k", *metadata,
                    str(out / "tetrinomos-handoff-preview.mp3")], check=True)
    report = {"source_drop": SOURCE_DROP, "cinematic_drop": DROP, "bpm": 77,
              "cinematic_seconds": len(film) / RATE, "loop_source": [126, 137],
              "loop_seconds": len(loop) / RATE, "circular_blend_seconds": 2 * n / RATE,
              "loop_boundary_step": float(np.max(np.abs(loop[-1] - loop[0]))),
              "loop_peak": float(np.max(np.abs(loop))), "film_peak": float(np.max(np.abs(film))),
              "handoff_boundary_step_at_playback_gain": float(np.max(np.abs(film[-1] * 0.9 - loop[0] * 0.55)))}
    (out / "tetrinomos-audio-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    build(args.source, args.ffmpeg, args.out)
