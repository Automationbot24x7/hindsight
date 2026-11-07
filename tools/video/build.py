#!/usr/bin/env python3
"""Builds the demo video from cinematic clips, captured scenes, stills, narration and music.
Run in WSL/Linux with ffmpeg:  python3 tools/video/build.py
In:  video/clips/{intro,voices,rebuild}.mp4, video/cap/s2..s10/{list.txt,f*.jpg},
     video/diagram.png, video/endcard.png, video/vo/s1..s12.wav, video/music.mp3, video/durations.json
Out: video/hindsight-demo.mp4 (1920x1080, 30 fps, H.264 + AAC)
"""
import json, os, subprocess, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
T = 'video/tmp'
shutil.rmtree(T, ignore_errors=True); os.makedirs(T)
SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
D = json.load(open('video/durations.json'))
N = len(D)

CAPTIONS = {
    's1': 'Everyone listens to someone. Nobody keeps score.',
    's2': 'Hindsight: a pick journal with a long-term memory',
    's3': 'Log a call, priced live by Tatum',
    's4': 'Scored at the deadline. Every write is a Walrus mainnet blob',
    's5': 'Trust, learned from outcomes',
    's6': 'A briefing and a verdict recalled from Walrus Memory',
    's7': "Memory flips the crowd's view",
    's8': 'Lessons and reflections, written back to Walrus',
    's9': 'Plain-language answers that cite Walrus memories',
    's10': 'Rebuild trust from Walrus alone',
    's11': 'Tatum Data API + Sui RPC  ·  Walrus Memory  ·  memory analyst',
}

def run(*args):
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *args], check=True)

def esc(t):
    return t.replace('\\', '\\\\').replace(':', '\\:').replace("'", '’').replace(',', '\\,')

def caption(s):
    if s not in CAPTIONS:
        return ''
    return (f",drawbox=x=0:y=ih-96:w=iw:h=96:color=0x0d1117@0.88:t=fill,"
            f"drawtext=fontfile={SANS}:text='{esc(CAPTIONS[s])}':fontsize=40:fontcolor=0x6ee7c7:x=(w-tw)/2:y=h-66")

ENC = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '18', '-r', '30']
FIT = 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1'

def cine(src, dur, out, extra=''):
    """Kling clip stretched (slowed) to dur seconds."""
    probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src],
                           capture_output=True, text=True, check=True)
    k = max(1.0, dur / float(probe.stdout.strip()))
    run('-i', src, '-vf', f'setpts={k:.4f}*PTS,{FIT},fps=30{extra}', '-t', str(dur), '-an', *ENC, out)

def screen(s, dur, out):
    run('-f', 'concat', '-safe', '0', '-i', f'video/cap/{s}/list.txt', '-t', str(dur),
        '-vf', f'{FIT},fps=30{caption(s)}', *ENC, out)

def still(img, dur, out, s):
    frames = int(dur * 30)
    run('-loop', '1', '-i', img, '-t', str(dur),
        '-vf', f"scale=3840:2160,zoompan=z='1+0.05*on/{frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1920x1080:fps=30,setsar=1{caption(s)}",
        *ENC, out)

parts = []
# s1: two cinematic clips under the opening line
half = round(D['s1'] / 2, 3)
cine('video/clips/hero-live.mp4', half, f'{T}/s1a.mp4', caption('s1'))
cine('video/clips/voices.mp4', D['s1'] - half, f'{T}/s1b.mp4', caption('s1'))
parts += [f'{T}/s1a.mp4', f'{T}/s1b.mp4']
for i in range(2, 10):
    s = f's{i}'
    screen(s, D[s], f'{T}/{s}.mp4'); parts.append(f'{T}/{s}.mp4')
# s10: cinematic rebuild, then the real rebuild in the app
SCREEN10 = 8.75  # length of the captured part of s10
cine('video/clips/rebuild.mp4', round(D['s10'] - SCREEN10, 3), f'{T}/s10a.mp4', caption('s10'))
screen('s10', SCREEN10, f'{T}/s10b.mp4')
parts += [f'{T}/s10a.mp4', f'{T}/s10b.mp4']
still('video/diagram.png', D['s11'], f'{T}/s11.mp4', 's11'); parts.append(f'{T}/s11.mp4')
still('video/endcard.png', D['s12'], f'{T}/s12.mp4', 's12'); parts.append(f'{T}/s12.mp4')

# Video: short crossfades between parts
total = sum(D.values())
inputs, chain, off, last = [], '', 0.0, '[0:v]'
durs = []
for p in parts:
    pr = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], capture_output=True, text=True, check=True)
    durs.append(float(pr.stdout.strip()))
    inputs += ['-i', p]
XF = 0.35
for i in range(1, len(parts)):
    off = sum(durs[:i]) - i * XF  # where part i starts on the crossfaded timeline
    out = f'[x{i}]'
    chain += f'{last}[{i}:v]xfade=transition=fade:duration={XF}:offset={off:.3f}{out};'
    last = out
run(*inputs, '-filter_complex', chain.rstrip(';'), '-map', last, *ENC, f'{T}/video.mp4')

# Narration: each line padded to its scene length; the crossfades shorten the picture by XF per cut,
# so the audio timeline is matched by trimming the same amount from each scene's tail padding.
cuts = len(parts) - 1
auds = []
for i in range(1, N + 1):
    s = f's{i}'
    a = f'{T}/{s}.wav'
    trim = XF * (2 if s in ('s1', 's10') else 1) if i < N else 0
    run('-i', f'video/vo/{s}.wav', '-af', 'adelay=150:all=1,apad', '-t', f'{D[s] - trim:.3f}', '-ar', '48000', '-ac', '2', a)
    auds.append(a)
with open(f'{T}/a.txt', 'w') as f:
    f.writelines(f"file '{os.path.basename(a)}'\n" for a in auds)
run('-f', 'concat', '-safe', '0', '-i', f'{T}/a.txt', '-c:a', 'pcm_s16le', f'{T}/voice.wav')

vd = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f'{T}/video.mp4'], capture_output=True, text=True, check=True).stdout.strip())
# Music bed under the voice, faded in and out.
run('-stream_loop', '-1', '-i', 'video/music.mp3', '-t', f'{vd:.3f}',
    '-af', f'volume=0.13,afade=t=in:st=0:d=1.5,afade=t=out:st={vd - 3.5:.3f}:d=3.5', '-ar', '48000', '-ac', '2', f'{T}/music.wav')
run('-i', f'{T}/voice.wav', '-i', f'{T}/music.wav', '-filter_complex',
    '[0:a][1:a]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[a]', '-map', '[a]', '-t', f'{vd:.3f}', f'{T}/audio.wav')
run('-i', f'{T}/video.mp4', '-i', f'{T}/audio.wav', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', '-shortest', 'video/hindsight-demo.mp4')
print(f'built video/hindsight-demo.mp4 ({vd:.1f}s)')
