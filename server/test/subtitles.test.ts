import { describe, expect, it } from 'vitest';
import {
  SUBTITLE_EXTENSIONS,
  decodeSubtitleBuffer,
  embeddedSubtitleTracks,
  findSidecarSubtitles,
  languageInfo,
  parseSubtitles,
  subtitleFormatFromPath,
} from '../src/library/subtitles.js';
import type { ProbeSubtitle } from '../src/types.js';

describe('formats', () => {
  it('knows the sidecar extensions', () => {
    expect([...SUBTITLE_EXTENSIONS].sort()).toEqual(['ass', 'srt', 'ssa', 'vtt']);
    expect(subtitleFormatFromPath('/a/Movie.en.SRT')).toBe('srt');
    expect(subtitleFormatFromPath('C:\\a\\Movie.vtt')).toBe('vtt');
    expect(subtitleFormatFromPath('Movie.ass')).toBe('ass');
    expect(subtitleFormatFromPath('Movie.ssa')).toBe('ssa');
    expect(subtitleFormatFromPath('Movie.sub')).toBeNull();
    expect(subtitleFormatFromPath('Movie.mkv')).toBeNull();
    expect(subtitleFormatFromPath('srt')).toBeNull();
  });
});

describe('languageInfo', () => {
  it.each([
    ['en', 'en', 'English'],
    ['EN', 'en', 'English'],
    ['eng', 'en', 'English'],
    ['ger', 'de', 'German'],
    ['deu', 'de', 'German'],
    ['fre', 'fr', 'French'],
    ['fra', 'fr', 'French'],
    ['spa', 'es', 'Spanish'],
    ['jpn', 'ja', 'Japanese'],
    ['chi', 'zh', 'Chinese'],
    ['zho', 'zh', 'Chinese'],
    ['dut', 'nl', 'Dutch'],
    ['cze', 'cs', 'Czech'],
    ['ces', 'cs', 'Czech'],
    ['gre', 'el', 'Greek'],
    ['rum', 'ro', 'Romanian'],
    ['slo', 'sk', 'Slovak'],
    ['may', 'ms', 'Malay'],
    ['per', 'fa', 'Persian'],
    ['nor', 'no', 'Norwegian'],
    ['english', 'en', 'English'],
    ['German', 'de', 'German'],
    ['deutsch', 'de', 'German'],
    ['Français', 'fr', 'French'],
    ['francais', 'fr', 'French'],
    ['Español', 'es', 'Spanish'],
    ['castellano', 'es', 'Spanish'],
    ['italiano', 'it', 'Italian'],
    ['Russian', 'ru', 'Russian'],
    ['korean', 'ko', 'Korean'],
    ['Ελληνικά', 'el', 'Greek'],
  ])('%s -> %s', (tag, code, name) => {
    expect(languageInfo(tag)).toEqual({ code, name });
  });

  it('handles regions and scripts', () => {
    expect(languageInfo('pt-BR').code).toBe('pt-BR');
    expect(languageInfo('pt_BR').code).toBe('pt-BR');
    expect(languageInfo('pt-br').code).toBe('pt-BR');
    expect(languageInfo('brazilian').code).toBe('pt-BR');
    expect(languageInfo('Portuguese (Brazil)').code).toBe('pt-BR');
    expect(languageInfo('pob').code).toBe('pt-BR');
    expect(languageInfo('pt-BR').name).toMatch(/Portuguese/);
    expect(languageInfo('zh-Hans')).toEqual({ code: 'zh-Hans', name: expect.stringMatching(/Chinese/) });
    expect(languageInfo('chs').code).toBe('zh-Hans');
    expect(languageInfo('es-419')).toEqual({ code: 'es-419', name: expect.stringMatching(/Spanish/) });
    expect(languageInfo('latino').code).toBe('es-419');
    expect(languageInfo('eng-US').code).toBe('en-US');
    expect(languageInfo('English (US)').code).toBe('en-US');
  });

  it('returns nulls for unknown or undetermined languages', () => {
    for (const tag of ['und', 'UND', 'unknown', 'zxx', '', '   ', 'xx', 'qqq', 'klingon', '1080p', 'constructor', '__proto__', 'toString', null, undefined]) {
      expect(languageInfo(tag)).toEqual({ code: null, name: null });
    }
  });
});

describe('decodeSubtitleBuffer', () => {
  it('decodes plain and BOM-prefixed UTF-8', () => {
    expect(decodeSubtitleBuffer(Buffer.from('café ✓', 'utf8'))).toBe('café ✓');
    expect(decodeSubtitleBuffer(Buffer.from('\uFEFFcafé', 'utf8'))).toBe('café');
    expect(decodeSubtitleBuffer(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe('hi');
  });

  it('falls back to Windows-1252 for invalid UTF-8', () => {
    // "Café – €" in Windows-1252
    expect(decodeSubtitleBuffer(Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x96, 0x20, 0x80]))).toBe('Café – €');
    expect(decodeSubtitleBuffer(Buffer.from([0x47, 0x72, 0xfc, 0xdf, 0x65]))).toBe('Grüße');
  });

  it('decodes UTF-16 LE and BE with a BOM', () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('1\r\nHéllo ✓', 'utf16le')]);
    expect(decodeSubtitleBuffer(le)).toBe('1\r\nHéllo ✓');
    const be = Buffer.from('Hi ✓', 'utf16le');
    for (let i = 0; i < be.length; i += 2) [be[i], be[i + 1]] = [be[i + 1], be[i]];
    expect(decodeSubtitleBuffer(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe('Hi ✓');
  });

  it('detects BOM-less UTF-16 LE', () => {
    expect(decodeSubtitleBuffer(Buffer.from('1\n00:00:01,000', 'utf16le'))).toBe('1\n00:00:01,000');
  });

  it('handles empty input', () => {
    expect(decodeSubtitleBuffer(new Uint8Array(0))).toBe('');
  });
});

describe('parseSubtitles: SRT', () => {
  it('parses a regular file with CRLF line endings', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\nworld\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nBye\r\n';
    expect(parseSubtitles(srt, 'srt')).toEqual([
      { start: 1, end: 2.5, text: 'Hello\nworld' },
      { start: 3, end: 4, text: 'Bye' },
    ]);
  });

  it('parses CR-only line endings and a BOM', () => {
    const srt = '\uFEFF1\r00:00:01,000 --> 00:00:02,000\rMac line endings\r\r2\r00:00:03,000 --> 00:00:04,000\rSecond\r';
    expect(parseSubtitles(srt, 'srt').map((c) => c.text)).toEqual(['Mac line endings', 'Second']);
  });

  it('tolerates missing / garbled indexes, extra blank lines and odd timestamps', () => {
    const srt = [
      '00:00:01,000 --> 00:00:02,000',
      'No index',
      '',
      '',
      '',
      '#2x',
      '00:00:03.5 --> 00:00:04.25',
      'Dot separators, short ms',
      '',
      '3',
      '00:05,000 --> 00:06,000 X1:100 X2:200 Y1:10 Y2:20',
      'No hours, coordinates',
      '',
      '4',
      '0:00:07,1 --> 0:00:08,12',
      'One and two digit ms',
    ].join('\n');
    expect(parseSubtitles(srt, 'srt')).toEqual([
      { start: 1, end: 2, text: 'No index' },
      { start: 3.5, end: 4.25, text: 'Dot separators, short ms' },
      { start: 5, end: 6, text: 'No hours, coordinates' },
      { start: 7.1, end: 8.12, text: 'One and two digit ms' },
    ]);
  });

  it('keeps numeric text that is not an index', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\n42\n\n2\n00:00:03,000 --> 00:00:04,000\nThe answer is\n42\n';
    expect(parseSubtitles(srt, 'srt').map((c) => c.text)).toEqual(['42', 'The answer is\n42']);
  });

  it('drops empty and negative-duration cues and sorts by start', () => {
    const srt = [
      '1', '00:00:10,000 --> 00:00:11,000', 'Later', '',
      '2', '00:00:05,000 --> 00:00:04,000', 'Negative', '',
      '3', '00:00:06,000 --> 00:00:07,000', '', '',
      '4', '00:00:01,000 --> 00:00:02,000', 'Earlier', '',
    ].join('\n');
    expect(parseSubtitles(srt, 'srt')).toEqual([
      { start: 1, end: 2, text: 'Earlier' },
      { start: 10, end: 11, text: 'Later' },
    ]);
  });

  it('keeps only <i>, <b>, <u> and strips font tags and ASS overrides', () => {
    const srt = [
      '1', '00:00:01,000 --> 00:00:02,000', '{\\an8}<font color="#ffff00">Top</font> <I>italic</I>', '',
      '2', '00:00:03,000 --> 00:00:04,000', '<b>Bold <u>under</u></b> &amp; <span>more</span>', '',
      '3', '00:00:05,000 --> 00:00:06,000', '<i>Unclosed italic', 'second line', '',
      '4', '00:00:07,000 --> 00:00:08,000', '{\\i1}ASS style{\\i0} in SRT', '',
      '5', '00:00:09,000 --> 00:00:10,000', '<font color="red"></font>', '',
    ].join('\n');
    expect(parseSubtitles(srt, 'srt').map((c) => c.text)).toEqual([
      'Top <i>italic</i>',
      '<b>Bold <u>under</u></b> & more',
      '<i>Unclosed italic\nsecond line</i>',
      '<i>ASS style</i> in SRT',
    ]);
  });

  it('returns [] for garbage', () => {
    expect(parseSubtitles('', 'srt')).toEqual([]);
    expect(parseSubtitles('not a subtitle file\n\nat all', 'srt')).toEqual([]);
  });
});

describe('parseSubtitles: WebVTT', () => {
  const vtt = [
    'WEBVTT - Some title',
    'Kind: captions',
    'Language: en',
    '',
    'NOTE This is a note',
    'that spans two lines --> with an arrow-ish thing',
    '',
    'STYLE',
    '::cue { color: yellow }',
    '',
    'REGION',
    'id:fred width:40%',
    '',
    'intro',
    '00:01.000 --> 00:02.500 align:start position:10%',
    '<v Bob>Hi <c.yellow>there</c></v>',
    '',
    '2',
    '00:00:03.000 --> 00:00:04.000 line:0',
    '<i.loud>Loud</i> <00:00:03.500><b>karaoke</b> &lt;3 &amp;&nbsp;more&lrm;&rlm;',
    '',
    '01:00:00.000 --> 01:00:01.000',
    '<ruby>漢<rt>kan</rt></ruby> <u>under</u>',
  ].join('\n');

  it('skips header / NOTE / STYLE / REGION blocks, identifiers and cue settings', () => {
    expect(parseSubtitles(vtt, 'vtt')).toEqual([
      { start: 1, end: 2.5, text: 'Hi there' },
      { start: 3, end: 4, text: '<i>Loud</i> <b>karaoke</b> <3 & more' },
      { start: 3600, end: 3601, text: '漢kan <u>under</u>' },
    ]);
  });

  it('handles CRLF and a missing blank line between cues', () => {
    const text = 'WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nOne\r\n00:00:02.000 --> 00:00:03.000\r\nTwo\r\n';
    expect(parseSubtitles(text, 'vtt').map((c) => c.text)).toEqual(['One', 'Two']);
  });

  it('detects WebVTT content saved as .srt', () => {
    expect(parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.000\nHello', 'srt')).toEqual([{ start: 1, end: 2, text: 'Hello' }]);
  });
});

describe('parseSubtitles: ASS / SSA', () => {
  const ass = [
    '[Script Info]',
    'Title: Example',
    'ScriptType: v4.00+',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize',
    'Style: Default,Arial,20',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\i1}Hello{\\i0}, world, with commas\\Nsecond\\hline',
    'Comment: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,This is a comment',
    'Dialogue: 0,0:00:00.50,0:00:01.00,Default,Bob,0,0,0,,{\\an8\\bord2\\blur1}Top {\\b1}bold{\\b0} {\\u1}u{\\u0}',
    'Dialogue: 0,0:00:02.00,0:00:05.00,Sign,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}',
    'Dialogue: 0,0:00:06.00,0:00:07.00,Default,,0,0,0,,{Just a comment}Visible\\nsoft break',
    'Dialogue: 0,0:00:08.00,0:00:07.00,Default,,0,0,0,,Negative duration',
    'Dialogue: 0,1:02:03.04,1:02:04.00,Default,,0,0,0,,Late',
  ].join('\r\n');

  it('parses dialogue lines using the Format columns', () => {
    expect(parseSubtitles(ass, 'ass')).toEqual([
      { start: 0.5, end: 1, text: 'Top <b>bold</b> <u>u</u>' },
      { start: 1.5, end: 3, text: '<i>Hello</i>, world, with commas\nsecond line' },
      { start: 6, end: 7, text: 'Visible\nsoft break' },
      { start: 3723.04, end: 3724, text: 'Late' },
    ]);
  });

  it('uses a non-default column order (SSA v4)', () => {
    const ssa = [
      '[Script Info]',
      'ScriptType: v4.00',
      '[Events]',
      'Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: Marked=0,0:00:01.00,0:00:02.00,*Default,NTP,0000,0000,0000,!Effect,SSA line, with comma',
    ].join('\n');
    expect(parseSubtitles(ssa, 'ssa')).toEqual([{ start: 1, end: 2, text: 'SSA line, with comma' }]);
    const reordered = '[Events]\nFormat: Text, Start, End\nDialogue: odd,0:00:01.00,0:00:02.00';
    expect(parseSubtitles(reordered, 'ass')).toEqual([{ start: 1, end: 2, text: 'odd' }]);
  });

  it('ignores dialogue-like lines outside [Events]', () => {
    const text = '[Script Info]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,nope\n[Events]\nDialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,yes';
    expect(parseSubtitles(text, 'ass').map((c) => c.text)).toEqual(['yes']);
  });
});

describe('findSidecarSubtitles', () => {
  const fakeFs = (tree: Record<string, string[]>) => {
    const calls: string[] = [];
    const listDir = async (dir: string): Promise<string[]> => {
      calls.push(dir);
      return tree[dir] ?? [];
    };
    return { listDir, calls };
  };
  const summary = (subs: Awaited<ReturnType<typeof findSidecarSubtitles>>) =>
    subs.map((s) => ({ path: s.path, language: s.language, label: s.label, forced: s.forced, sdh: s.sdh, format: s.format }));

  it('matches same-prefix files and parses language / flags (POSIX, single video)', async () => {
    const dir = '/media/Movies/Inception (2010)';
    const { listDir } = fakeFs({
      [dir]: [
        'Inception (2010).mkv',
        'Inception (2010)-trailer.mp4',
        'Inception (2010).en.srt',
        'Inception (2010).eng.forced.srt',
        'Inception (2010).English.SDH.srt',
        'Inception (2010).pt-BR.srt',
        'Inception (2010).srt',
        'Inception (2010).fr.default.ass',
        'Inception (2010).Commentary.srt',
        'English.srt',
        'poster.jpg',
      ],
    });
    const subs = await findSidecarSubtitles(`${dir}/Inception (2010).mkv`, listDir);
    expect(summary(subs)).toEqual([
      { path: `${dir}/Inception (2010).pt-BR.srt`, language: 'pt-BR', label: expect.stringMatching(/Portuguese/), forced: false, sdh: false, format: 'srt' },
      { path: `${dir}/Inception (2010).Commentary.srt`, language: null, label: 'Commentary', forced: false, sdh: false, format: 'srt' },
      { path: `${dir}/English.srt`, language: 'en', label: 'English', forced: false, sdh: false, format: 'srt' },
      { path: `${dir}/Inception (2010).en.srt`, language: 'en', label: 'English', forced: false, sdh: false, format: 'srt' },
      { path: `${dir}/Inception (2010).English.SDH.srt`, language: 'en', label: 'English [CC]', forced: false, sdh: true, format: 'srt' },
      { path: `${dir}/Inception (2010).fr.default.ass`, language: 'fr', label: 'French', forced: false, sdh: false, format: 'ass' },
      { path: `${dir}/Inception (2010).srt`, language: null, label: 'Unknown', forced: false, sdh: false, format: 'srt' },
      { path: `${dir}/Inception (2010).eng.forced.srt`, language: 'en', label: 'English (Forced)', forced: true, sdh: false, format: 'srt' },
    ]);
    for (const s of subs) {
      expect(s.source).toBe('sidecar');
      expect(s.id).toMatch(/^sc-[0-9a-f]{10}$/);
      expect(s.streamIndex).toBeUndefined();
    }
    expect(new Set(subs.map((s) => s.id)).size).toBe(subs.length);
  });

  it('does not steal subtitles of sibling videos (season folder with Subs / scene layout)', async () => {
    const season = '/tv/Show/Season 1';
    const { listDir } = fakeFs({
      [season]: [
        'Show.S01E01.1080p.mkv',
        'Show.S01E01.1080p.en.srt',
        'Show.S01E01.1080p.Spanish.srt',
        'Show.S01E02.1080p.mkv',
        'Show.S01E02.1080p.en.srt',
        'random.srt',
        'Subs',
      ],
      [`${season}/Subs`]: ['Show.S01E01.1080p.de.srt', 'Show.S01E02.1080p.de.srt', 'Show.S01E01.1080p', 'Show.S01E02.1080p', 'loose.srt'],
      [`${season}/Subs/Show.S01E01.1080p`]: ['2_English.srt', '3_Spanish.srt', '5_English_SDH.srt', 'notes.txt'],
      [`${season}/Subs/Show.S01E02.1080p`]: ['2_English.srt'],
    });
    const subs = await findSidecarSubtitles(`${season}/Show.S01E01.1080p.mkv`, listDir);
    expect(summary(subs).map((s) => [s.path?.slice(season.length + 1), s.language, s.label])).toEqual([
      // Same label: ties are broken by path, so files next to the video come first.
      ['Show.S01E01.1080p.en.srt', 'en', 'English'],
      ['Subs/Show.S01E01.1080p/2_English.srt', 'en', 'English'],
      ['Subs/Show.S01E01.1080p/5_English_SDH.srt', 'en', 'English [CC]'],
      ['Subs/Show.S01E01.1080p.de.srt', 'de', 'German'],
      ['Show.S01E01.1080p.Spanish.srt', 'es', 'Spanish'],
      ['Subs/Show.S01E01.1080p/3_Spanish.srt', 'es', 'Spanish'],
    ]);
  });

  it('assigns every subtitle of a single-video folder, including Subs/ (movie release layout)', async () => {
    const dir = '/dl/Movie.2010.1080p.BluRay.x264-GRP';
    const { listDir } = fakeFs({
      [dir]: ['movie.2010.1080p.bluray.x264-grp.mkv', 'movie.2010.1080p.bluray.x264-grp-sample.mkv', 'Subs', 'It.Follows.2014.srt'],
      [`${dir}/Subs`]: ['English.srt', 'French.srt', 'Signs & Songs.ass', 'movie.2010.1080p.bluray.x264-grp.ita.srt'],
    });
    const subs = await findSidecarSubtitles(`${dir}/movie.2010.1080p.bluray.x264-grp.mkv`, listDir);
    expect(summary(subs).map((s) => [s.path?.slice(dir.length + 1), s.language, s.label])).toEqual([
      ['Subs/English.srt', 'en', 'English'],
      ['Subs/French.srt', 'fr', 'French'],
      ['It.Follows.2014.srt', null, 'It Follows 2014'],
      ['Subs/movie.2010.1080p.bluray.x264-grp.ita.srt', 'it', 'Italian'],
      ['Subs/Signs & Songs.ass', null, 'Signs & Songs'],
    ]);
  });

  it('reads language, region and flag tokens after the video name', async () => {
    const dir = '/tv/Show/Season 1';
    const { listDir } = fakeFs({
      [dir]: [
        'Show.S01E01.mkv',
        'Show.S01E02.mkv',
        'Show.S01E01.en.hi.srt',
        'Show.S01E01.es.419.srt',
        'Show.S01E01.it.Commentary.srt',
        'Show.S01E01_Deutsch_Forced.vtt',
        'Show.S01E01 - zh-Hans.ass',
        'Show.S01E01.hearing.impaired.eng.srt',
      ],
    });
    const subs = await findSidecarSubtitles(`${dir}/Show.S01E01.mkv`, listDir);
    const byName = Object.fromEntries(subs.map((s) => [s.path?.slice(dir.length + 1), [s.language, s.label, s.forced, s.sdh, s.format]]));
    expect(byName).toEqual({
      'Show.S01E01.en.hi.srt': ['en', 'English [CC]', false, true, 'srt'],
      'Show.S01E01.es.419.srt': ['es-419', expect.stringMatching(/Spanish/), false, false, 'srt'],
      'Show.S01E01.it.Commentary.srt': ['it', 'Italian', false, false, 'srt'],
      'Show.S01E01_Deutsch_Forced.vtt': ['de', 'German (Forced)', true, false, 'vtt'],
      'Show.S01E01 - zh-Hans.ass': ['zh-Hans', expect.stringMatching(/Chinese/), false, false, 'ass'],
      'Show.S01E01.hearing.impaired.eng.srt': ['en', 'English [CC]', false, true, 'srt'],
    });
    expect(subs.at(-1)?.forced).toBe(true);
  });

  it('prefers the longest matching video name', async () => {
    const dir = '/m/Collection';
    const { listDir } = fakeFs({ [dir]: ['Movie.mkv', 'Movie 2.mkv', 'Movie.en.srt', 'Movie 2.en.srt', 'MOVIE.FR.SRT'] });
    const first = await findSidecarSubtitles(`${dir}/Movie.mkv`, listDir);
    expect(first.map((s) => s.path)).toEqual([`${dir}/Movie.en.srt`, `${dir}/MOVIE.FR.SRT`]);
    const second = await findSidecarSubtitles(`${dir}/Movie 2.mkv`, listDir);
    expect(second.map((s) => s.path)).toEqual([`${dir}/Movie 2.en.srt`]);
  });

  it('works with Windows paths', async () => {
    const dir = 'D:\\Movies\\Alien (1979)';
    const { listDir } = fakeFs({
      [dir]: ['Alien (1979).mkv', 'Alien (1979).fr.srt', 'Subtitles'],
      [`${dir}\\Subtitles`]: ['Alien (1979).es.srt'],
    });
    const subs = await findSidecarSubtitles(`${dir}\\Alien (1979).mkv`, listDir);
    expect(subs.map((s) => [s.path, s.language])).toEqual([
      [`${dir}\\Alien (1979).fr.srt`, 'fr'],
      [`${dir}\\Subtitles\\Alien (1979).es.srt`, 'es'],
    ]);
  });

  it('de-duplicates and survives failing / empty listings', async () => {
    const dir = '/x';
    const dup = await findSidecarSubtitles('/x/Movie.mkv', async (d) => (d === dir ? ['Movie.mkv', 'Movie.en.srt', 'Movie.en.srt'] : []));
    expect(dup).toHaveLength(1);
    const failing = await findSidecarSubtitles('/x/Movie.mkv', async () => {
      throw new Error('EACCES');
    });
    expect(failing).toEqual([]);
    expect(await findSidecarSubtitles('/nowhere/Movie.mkv', async () => [])).toEqual([]);
  });
});

describe('embeddedSubtitleTracks', () => {
  const stream = (index: number, codec: string, language: string | null, title: string | null = null, forced = false): ProbeSubtitle => ({
    index,
    codec,
    language,
    title,
    forced,
    default: false,
  });

  it('keeps text codecs only and labels them', () => {
    const tracks = embeddedSubtitleTracks([
      stream(0, 'subrip', 'eng'),
      stream(1, 'hdmv_pgs_subtitle', 'eng'),
      stream(2, 'ass', 'jpn', 'Signs', true),
      stream(3, 'mov_text', null, 'Commentary'),
      stream(4, 'dvd_subtitle', 'fre'),
      stream(5, 'webvtt', 'und'),
      stream(6, 'SubRip', 'eng', 'English SDH'),
      stream(7, 'dvb_subtitle', 'ger'),
      stream(8, 'text', 'ger', 'Forced'),
    ]);
    expect(tracks).toEqual([
      { id: 'emb-0', source: 'embedded', streamIndex: 0, format: 'embedded', language: 'en', label: 'English', forced: false, sdh: false },
      { id: 'emb-2', source: 'embedded', streamIndex: 2, format: 'embedded', language: 'ja', label: 'Japanese (Forced)', forced: true, sdh: false },
      { id: 'emb-3', source: 'embedded', streamIndex: 3, format: 'embedded', language: null, label: 'Commentary', forced: false, sdh: false },
      { id: 'emb-5', source: 'embedded', streamIndex: 5, format: 'embedded', language: null, label: 'Track 6', forced: false, sdh: false },
      { id: 'emb-6', source: 'embedded', streamIndex: 6, format: 'embedded', language: 'en', label: 'English [CC]', forced: false, sdh: true },
      { id: 'emb-8', source: 'embedded', streamIndex: 8, format: 'embedded', language: 'de', label: 'German (Forced)', forced: true, sdh: false },
    ]);
  });

  it('returns [] when nothing is usable', () => {
    expect(embeddedSubtitleTracks([])).toEqual([]);
    expect(embeddedSubtitleTracks([stream(0, 'hdmv_pgs_subtitle', 'eng'), stream(1, 'dvd_subtitle', 'eng')])).toEqual([]);
  });
});
