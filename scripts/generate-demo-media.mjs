#!/usr/bin/env node
/**
 * Generates a small demo library (synthetic videos) to try Home Blockbuster without your own media.
 *
 *   node scripts/generate-demo-media.mjs [--out ./test-media] [--seconds 150]
 *
 * Titles are Blender Foundation open movies (so online metadata can match them) plus a few
 * made-up ones. Files cover the interesting cases: MP4 with embedded tags + cover art, MKV with
 * AC3 5.1 audio and attached cover, HEVC, WebM/VP9, AVI/MPEG-4, multiple audio tracks, sidecar
 * and embedded subtitles, Plex-style and scene-style names, seasons and a date-based show.
 * Requires ffmpeg with libx264, libx265, libvpx and drawtext (freetype).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = path.resolve(option('out', 'test-media'));
const SECONDS = Number(option('seconds', '150'));
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/Library/Fonts/Arial Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  'C:\\Windows\\Fonts\\arialbd.ttf',
];
const FONT = FONT_CANDIDATES.find((f) => existsSync(f));
if (!FONT) {
  console.error('No usable font found for drawtext. Edit FONT_CANDIDATES in this script.');
  process.exit(1);
}
const font = FONT.replace(/\\/g, '/').replace(/:/g, '\\:');

function ff(argv) {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { stdio: 'inherit' });
}

const esc = (text) => text.replace(/\\/g, '\\\\').replace(/'/g, "\u2019").replace(/:/g, '\\:').replace(/%/g, '\\%');

/** Animated gradient "footage" with a title card, as lavfi input args. */
function footage(title, subtitle, colors, seconds, size = '1280x720') {
  const [c0, c1] = colors;
  const text =
    `drawtext=fontfile='${font}':text='${esc(title)}':fontsize=h/9:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-h/12:shadowcolor=black@0.6:shadowx=4:shadowy=4,` +
    `drawtext=fontfile='${font}':text='${esc(subtitle)}':fontsize=h/24:fontcolor=white@0.85:x=(w-tw)/2:y=(h/2)+h/10,` +
    `drawtext=fontfile='${font}':text='%{pts\\:hms}':fontsize=h/30:fontcolor=white@0.7:x=w-tw-40:y=h-th-30`;
  return [
    '-f', 'lavfi', '-t', String(seconds),
    '-i', `gradients=s=${size}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${size.split('x')[0]}:y1=${size.split('x')[1]}:speed=0.015:rate=24,${text}`,
  ];
}

function tone(freq, seconds, channels = 2) {
  const layout = channels === 6 ? '5.1' : channels === 1 ? 'mono' : 'stereo';
  return ['-f', 'lavfi', '-t', String(seconds), '-i', `sine=frequency=${freq}:sample_rate=48000,aformat=channel_layouts=${layout}`];
}

function poster(file, title, year, colors) {
  const [c0, c1] = colors;
  ff([
    '-f', 'lavfi', '-i', `gradients=s=600x900:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=600:y1=900,drawtext=fontfile='${font}':text='${esc(title.toUpperCase())}':fontsize=54:fontcolor=white:x=(w-tw)/2:y=h*0.62:shadowcolor=black@0.6:shadowx=3:shadowy=3,drawtext=fontfile='${font}':text='${year}':fontsize=32:fontcolor=white@0.8:x=(w-tw)/2:y=h*0.62+80`,
    '-frames:v', '1', file,
  ]);
}

function srt(file, lines) {
  let out = '';
  lines.forEach((line, i) => {
    const start = 2 + i * 6;
    const fmt = (s) => `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},000`;
    out += `${i + 1}\n${fmt(start)} --> ${fmt(start + 4)}\n${line}\n\n`;
  });
  writeFileSync(file, out);
}

const tmp = path.join(os.tmpdir(), `hb-demo-${process.pid}`);
mkdirSync(tmp, { recursive: true });
const movies = path.join(OUT, 'Movies');
const shows = path.join(OUT, 'TV Shows');
mkdirSync(movies, { recursive: true });
mkdirSync(shows, { recursive: true });

const PALETTE = [
  ['0x0f2027', '0x2c5364'],
  ['0x42275a', '0x734b6d'],
  ['0x141e30', '0x243b55'],
  ['0x3a1c71', '0xd76d77'],
  ['0x134e5e', '0x71b280'],
  ['0x4b134f', '0xc94b4b'],
  ['0x232526', '0x414345'],
  ['0x1f4037', '0x99f2c8'],
  ['0x870000', '0x190a05'],
  ['0x0b486b', '0xf56217'],
];

let step = 0;
const log = (msg) => console.log(`[${++step}] ${msg}`);

// ---------------------------------------------------------------------------
// Movies
// ---------------------------------------------------------------------------

// 1. MP4 (H.264 + AAC) with iTunes-style tags and embedded cover art -> direct play.
{
  const dir = path.join(movies, 'Sintel (2010)');
  mkdirSync(dir, { recursive: true });
  const cover = path.join(tmp, 'sintel.jpg');
  poster(cover, 'Sintel', 2010, PALETTE[1]);
  log('Sintel (2010).mp4 — H.264/AAC, tags + cover');
  ff([
    ...footage('SINTEL', 'A Blender Foundation open movie', PALETTE[1], SECONDS),
    ...tone(330, SECONDS),
    '-i', cover,
    '-map', '0:v', '-map', '1:a', '-map', '2:v',
    '-c:v:0', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k',
    '-c:v:1', 'copy', '-disposition:v:1', 'attached_pic',
    '-metadata', 'title=Sintel', '-metadata', 'date=2010', '-metadata', 'genre=Animation',
    '-metadata', 'description=A lonely young woman searches for the baby dragon she once rescued.',
    '-movflags', '+faststart',
    path.join(dir, 'Sintel (2010).mp4'),
  ]);
  srt(path.join(dir, 'Sintel (2010).en.srt'), ['Where are you going?', 'I am looking for a dragon.', '<i>Scales</i>...', 'He was my friend.']);
  srt(path.join(dir, 'Sintel (2010).de.srt'), ['Wohin gehst du?', 'Ich suche einen Drachen.', '<i>Scales</i>...', 'Er war mein Freund.']);
}

// 2. Scene-named MKV (H.264 + AC3 5.1) with attached cover + embedded subtitles -> remux.
{
  const dir = path.join(movies, 'Big.Buck.Bunny.2008.1080p.BluRay.x264-DEMO');
  mkdirSync(dir, { recursive: true });
  const cover = path.join(tmp, 'bbb.jpg');
  const sub = path.join(tmp, 'bbb.srt');
  poster(cover, 'Big Buck Bunny', 2008, PALETTE[4]);
  srt(sub, ['[birds chirping]', 'A giant rabbit wakes up.', 'Three bullies arrive.', 'Revenge is sweet.']);
  log('Big.Buck.Bunny.2008.1080p.BluRay.x264-DEMO.mkv — H.264/AC3 5.1, attachment, subs');
  ff([
    ...footage('BIG BUCK BUNNY', 'Peach open movie project', PALETTE[4], SECONDS),
    ...tone(220, SECONDS, 6),
    '-i', sub,
    '-map', '0:v', '-map', '1:a', '-map', '2:s',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'ac3', '-b:a', '384k',
    '-c:s', 'srt', '-metadata:s:s:0', 'language=eng', '-metadata:s:a:0', 'language=eng',
    '-attach', cover, '-metadata:s:t', 'mimetype=image/jpeg', '-metadata:s:t', 'filename=cover.jpg',
    path.join(dir, 'Big.Buck.Bunny.2008.1080p.BluRay.x264-DEMO.mkv'),
  ]);
}

// 3. HEVC in MKV -> needs a transcode on browsers without HEVC.
log('Tears of Steel (2012) — HEVC/AAC MKV');
{
  const dir = path.join(movies, 'Tears of Steel (2012)');
  mkdirSync(dir, { recursive: true });
  ff([
    ...footage('TEARS OF STEEL', 'Project Mango', PALETTE[2], SECONDS),
    ...tone(440, SECONDS),
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '32', '-pix_fmt', 'yuv420p', '-x265-params', 'log-level=error',
    '-c:a', 'aac', '-b:a', '96k',
    path.join(dir, 'Tears.of.Steel.2012.2160p.WEB-DL.HEVC.mkv'),
  ]);
}

// 4. WebM (VP9 + Opus) -> direct play.
log('Elephants Dream (2006) — VP9/Opus WebM');
{
  const dir = path.join(movies, 'Elephants Dream (2006)');
  mkdirSync(dir, { recursive: true });
  ff([
    ...footage('ELEPHANTS DREAM', 'Project Orange', PALETTE[6], SECONDS, '960x540'),
    ...tone(262, SECONDS),
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '600k',
    '-c:a', 'libopus', '-b:a', '64k',
    path.join(dir, 'Elephants Dream (2006).webm'),
  ]);
}

// 5. Two audio tracks (English AAC + German AC3).
log('Cosmos Laundromat (2015) — two audio tracks');
{
  const dir = path.join(movies, 'Cosmos Laundromat (2015)');
  mkdirSync(dir, { recursive: true });
  ff([
    ...footage('COSMOS LAUNDROMAT', 'First Cycle', PALETTE[3], SECONDS),
    ...tone(392, SECONDS),
    ...tone(196, SECONDS, 6),
    '-map', '0:v', '-map', '1:a', '-map', '2:a',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-c:a:0', 'aac', '-b:a:0', '96k', '-c:a:1', 'ac3', '-b:a:1', '384k',
    '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=ger',
    '-disposition:a:0', 'default', '-disposition:a:1', '0',
    path.join(dir, 'Cosmos Laundromat (2015) {tmdb-358332}.mp4'),
  ]);
}

// 6. AVI (MPEG-4 Part 2 + MP3) -> full transcode.
log('Spring (2019) — MPEG-4/MP3 AVI');
{
  ff([
    ...footage('SPRING', 'Blender Studio', PALETTE[7], SECONDS),
    ...tone(523, SECONDS),
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'mpeg4', '-q:v', '8', '-c:a', 'libmp3lame', '-b:a', '128k',
    path.join(movies, 'Spring.2019.720p.avi'),
  ]);
}

// 7-10. More loose movie files with different naming styles.
const loose = [
  ['Agent 327 Operation Barbershop (2017).mp4', 'AGENT 327', 'Operation Barbershop', PALETTE[8]],
  ['caminandes.llamigos.2016.1080p.mp4', 'CAMINANDES', 'Llamigos', PALETTE[9]],
  ['Coffee Run [2020].mp4', 'COFFEE RUN', 'Blender Studio', PALETTE[0]],
  ['Sprite.Fright.2021.PROPER.1080p.WEB.h264.mp4', 'SPRITE FRIGHT', 'Blender Studio', PALETTE[5]],
  ['Charge (2022).mp4', 'CHARGE', 'Blender Studio', PALETTE[2]],
  ['Family Holiday 2019-07-04.mp4', 'FAMILY HOLIDAY', 'July 2019', PALETTE[7]],
];
for (const [name, title, sub, colors] of loose) {
  log(name);
  ff([
    ...footage(title, sub, colors, Math.round(SECONDS * 0.8)),
    ...tone(300 + name.length * 7, Math.round(SECONDS * 0.8)),
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart',
    path.join(movies, name),
  ]);
}

// A sample file that must be ignored.
ff([...footage('SAMPLE', 'ignore me', PALETTE[0], 5), '-c:v', 'libx264', '-preset', 'ultrafast', path.join(movies, 'sample-charge.mp4')]);

// ---------------------------------------------------------------------------
// TV shows
// ---------------------------------------------------------------------------

function episode(file, show, code, title, colors, seconds, opts = {}) {
  log(path.relative(OUT, file));
  const extra = [];
  if (opts.tags) {
    extra.push('-metadata', `show=${show}`, '-metadata', `season_number=${opts.tags.season}`, '-metadata', `episode_sort=${opts.tags.episode}`, '-metadata', `title=${title}`);
  }
  ff([
    ...footage(show.toUpperCase(), `${code} · ${title}`, colors, seconds),
    ...tone(200 + code.length * 40 + title.length * 3, seconds),
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k',
    ...extra,
    file,
  ]);
}

// Plex-style show with two seasons.
const pioneer = path.join(shows, 'Pioneer One (2010)');
for (const [season, episodes] of [
  [1, ['Earthfall', 'The Man From Mars', 'Alone in the Night', 'Sea Change']],
  [2, ['The Forgotten', 'Salvation']],
]) {
  const dir = path.join(pioneer, `Season ${String(season).padStart(2, '0')}`);
  mkdirSync(dir, { recursive: true });
  episodes.forEach((title, i) => {
    const code = `S${String(season).padStart(2, '0')}E${String(i + 1).padStart(2, '0')}`;
    const file = path.join(dir, `Pioneer One - ${code} - ${title}.mkv`);
    episode(file, 'Pioneer One', code, title, PALETTE[(season + i) % PALETTE.length], Math.round(SECONDS * 0.7));
    if (season === 1 && i === 0) srt(file.replace(/\.mkv$/, '.en.srt'), ['Something fell from the sky.', 'Get me the director.', 'This changes everything.']);
  });
}

// Scene-style release folder.
const nightOwls = path.join(shows, 'Night.Owls.S01.1080p.WEB-DL.x264-DEMO');
mkdirSync(nightOwls, { recursive: true });
['Pilot', 'After Midnight', 'Last Call'].forEach((title, i) => {
  const code = `S01E0${i + 1}`;
  episode(path.join(nightOwls, `Night.Owls.${code}.${title.replace(/ /g, '.')}.1080p.WEB-DL.x264-DEMO.mkv`), 'Night Owls', code, title, PALETTE[(i + 3) % PALETTE.length], Math.round(SECONDS * 0.6));
});

// MP4s tagged with iTunes TV atoms (names alone would not say which episode they are).
const tagged = path.join(shows, 'Kitchen Heroes');
mkdirSync(tagged, { recursive: true });
['Soup of the Day', 'The Great Bake'].forEach((title, i) => {
  episode(path.join(tagged, `kh_ep${i + 1}.mp4`), 'Kitchen Heroes', `S01E0${i + 1}`, title, PALETTE[(i + 6) % PALETTE.length], Math.round(SECONDS * 0.5), {
    tags: { season: 1, episode: i + 1 },
  });
});

// Date-based daily show.
const daily = path.join(shows, 'The Daily Byte');
mkdirSync(daily, { recursive: true });
['2024-03-14', '2024-03-15'].forEach((date, i) => {
  episode(path.join(daily, `The Daily Byte ${date}.mp4`), 'The Daily Byte', date, 'News of the day', PALETTE[(i + 1) % PALETTE.length], Math.round(SECONDS * 0.4));
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\nDemo library ready in ${OUT}\n  Add "${movies}" as a Movies library and "${shows}" as a TV Shows library.`);
