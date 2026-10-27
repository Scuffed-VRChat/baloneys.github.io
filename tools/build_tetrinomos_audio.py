"""Copy the full supplied song and build its exact 2:06-2:17 Tetris menu loop.

Requires numpy and FFmpeg. No effects are mixed into the music assets.
python tools/build_tetrinomos_audio.py SOURCE.mp3 --ffmpeg PATH --out DIRECTORY
"""
import argparse
import json
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np

RATE = 48000


def write_wav(path, samples):
    with wave.open(str(path), 'wb') as out:
        out.setparams((2, 2, RATE, 0, 'NONE', 'not compressed'))
        out.writeframes(np.round(np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())


def build(source, ffmpeg, out):
    out.mkdir(parents=True, exist_ok=True)
    raw = subprocess.check_output([ffmpeg, '-v', 'error', '-i', str(source),
                                   '-f', 'f32le', '-ar', str(RATE), '-ac', '2', 'pipe:1'])
    audio = np.frombuffer(raw, dtype='<f4').reshape(-1, 2).copy()
    if len(audio) < 137 * RATE:
        raise ValueError('Source must include the requested 2:06-2:17 interval')
    # Keep the recording byte-for-byte intact. The film's clock follows its
    # complete decoded duration; neither the intro nor the bridge is removed.
    destination = out / 'tetrinomos-full-track.mp3'
    if source.resolve() != destination.resolve():
        shutil.copyfile(source, destination)
    loop = audio[126 * RATE:137 * RATE].copy()
    n = round(0.12 * RATE)
    tail, head = loop[-n:].copy(), loop[:n].copy()
    a = np.concatenate((tail, tail[::-1]))
    b = np.concatenate((head[::-1], head))
    w = (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, 2 * n)))[:, None]
    seam = a * (1 - w) + b * w
    loop[-n:], loop[:n] = seam[:n], seam[n:]
    write_wav(out / 'tetrinomos-menu-loop.wav', loop)
    subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(out / 'tetrinomos-menu-loop.wav'),
                    '-c:a', 'libvorbis', '-q:a', '6', '-metadata', 'title=tetronimo$',
                    '-metadata', 'artist=MoneyRhy$', str(out / 'tetrinomos-menu-loop.ogg')], check=True)
    # Review the whole uncut recording followed by two loop cycles.
    write_wav(out / 'tetrinomos-full-handoff-preview.wav', np.concatenate((audio, loop, loop)))
    report = {'source_seconds': len(audio) / RATE, 'music_edit': 'uncut byte-identical source MP3',
              'bpm': 77, 'first_drop': 24.965, 'portal_crossing': 24.965 + 96 * 60 / 77,
              'loop_source': [126, 137], 'loop_seconds': len(loop) / RATE,
              'circular_blend_seconds': 2 * n / RATE,
              'loop_boundary_step': float(np.max(np.abs(loop[-1] - loop[0])))}
    (out / 'tetrinomos-audio-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--ffmpeg', required=True)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    build(args.source, args.ffmpeg, args.out)
