import { describe, expect, it } from 'vitest';
import {
  VIDEO_EXTENSIONS,
  cleanTitle,
  isExtraOrSample,
  isVideoFile,
  parseMediaPath,
  shouldSkipDirectory,
  sortName,
  titleKey,
} from '../src/library/filenameParser.js';
import type { LibraryKind } from '../src/shared/types.js';
import type { ParsedName } from '../src/types.js';

type Case = [path: string, kind: LibraryKind, expected: Partial<ParsedName>];

function check(cases: Case[]): void {
  it.each(cases)('%s (%s)', (path, kind, expected) => {
    expect(parseMediaPath(path, kind)).toMatchObject(expected);
  });
}

describe('parseMediaPath: movies', () => {
  check([
    // Scene releases
    ['The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv', 'movies', { kind: 'movie', title: 'The Matrix', year: 1999, resolution: '1080p', part: null, edition: null }],
    ['Avengers.Endgame.2019.1080p.BluRay.x264-SPARKS[rarbg].mkv', 'movies', { title: 'Avengers Endgame', year: 2019 }],
    ['Joker.2019.1080p.WEBRip.x264-[YTS.LT].mp4', 'movies', { title: 'Joker', year: 2019, resolution: '1080p' }],
    ['The.Movie.2019.2160p.UHD.BluRay.x265.10bit.HDR.TrueHD.7.1.Atmos-GROUP.mkv', 'movies', { title: 'The Movie', year: 2019, resolution: '2160p' }],
    ['THE.MATRIX.1999.1080P.BLURAY.X264-GROUP.mkv', 'movies', { title: 'The Matrix', year: 1999, resolution: '1080p' }],
    ['Movie.Name.2010.UNRATED.DVDRip.XviD-GROUP.avi', 'movies', { title: 'Movie Name', year: 2010, edition: 'Unrated' }],
    ['Aliens.1986.Directors.Cut.1080p.BluRay.x264.mkv', 'movies', { title: 'Aliens', year: 1986, edition: "Director's Cut" }],
    ['Blade.Runner.1982.The.Final.Cut.1080p.BluRay.mkv', 'movies', { title: 'Blade Runner', year: 1982, edition: 'Final Cut' }],
    ['Avatar.2009.EXTENDED.1080p.BluRay.x264.mkv', 'movies', { title: 'Avatar', year: 2009, edition: 'Extended' }],
    // Plex / Jellyfin naming
    ['Movie Name [2010] [1080p].mkv', 'movies', { title: 'Movie Name', year: 2010, resolution: '1080p' }],
    ['Movie.Name.(2010).mkv', 'movies', { title: 'Movie Name', year: 2010 }],
    ['Movies/Inception (2010)/Inception (2010) - 1080p.mkv', 'movies', { title: 'Inception', year: 2010, resolution: '1080p' }],
    ['Parasite (2019) [1080p] [BluRay] [5.1] [YTS.MX].mp4', 'movies', { title: 'Parasite', year: 2019, resolution: '1080p' }],
    ['Amélie (2001).mkv', 'movies', { title: 'Amélie', year: 2001 }],
    ['Crouching Tiger, Hidden Dragon (2000).mkv', 'movies', { title: 'Crouching Tiger, Hidden Dragon', year: 2000 }],
    // Numbers in titles
    ['2012.2009.1080p.mkv', 'movies', { title: '2012', year: 2009 }],
    ['1917 (2019).mkv', 'movies', { title: '1917', year: 2019 }],
    ['1917.mkv', 'movies', { title: '1917', year: null }],
    ['Blade Runner 2049 (2017).mkv', 'movies', { title: 'Blade Runner 2049', year: 2017 }],
    ['2001 A Space Odyssey (1968).mkv', 'movies', { title: '2001 A Space Odyssey', year: 1968 }],
    ['2001.A.Space.Odyssey.1968.1080p.BluRay.mkv', 'movies', { title: '2001 A Space Odyssey', year: 1968 }],
    ["Ocean's Eleven (2001).mkv", 'movies', { title: "Ocean's Eleven", year: 2001 }],
    ['Se7en (1995).mkv', 'movies', { kind: 'movie', title: 'Se7en', year: 1995 }],
    ['District 9 (2009).mkv', 'movies', { title: 'District 9', year: 2009 }],
    ['The 40 Year Old Virgin (2005).mkv', 'movies', { title: 'The 40 Year Old Virgin', year: 2005 }],
    ['12 Angry Men (1957).mkv', 'movies', { title: '12 Angry Men', year: 1957 }],
    ['Apollo 13 (1995).mkv', 'movies', { title: 'Apollo 13', year: 1995 }],
    ['Top Gun Maverick 2022 2160p.mkv', 'movies', { title: 'Top Gun Maverick', year: 2022, resolution: '2160p' }],
    ['9 (2009).mkv', 'movies', { title: '9', year: 2009 }],
    ['(500) Days of Summer (2009).mkv', 'movies', { title: '(500) Days of Summer', year: 2009 }],
    ['Robot 2.0 (2018).mkv', 'movies', { title: 'Robot 2.0', year: 2018 }],
    ['S1m0ne (2002)/S1m0ne.2002.mkv', 'movies', { kind: 'movie', title: 'S1m0ne', year: 2002 }],
    // Dots, acronyms and abbreviations
    ['Kill.Bill.Vol.1.2003.1080p.mkv', 'movies', { title: 'Kill Bill Vol. 1', year: 2003 }],
    ['L.A.Confidential.1997.mkv', 'movies', { title: 'L.A. Confidential', year: 1997 }],
    ['E.T.the.Extra-Terrestrial.1982.mkv', 'movies', { title: 'E.T. the Extra-Terrestrial', year: 1982 }],
    ['Mr.and.Mrs.Smith.2005.mkv', 'movies', { title: 'Mr. and Mrs. Smith', year: 2005 }],
    ['Mr. & Mrs. Smith (2005).mkv', 'movies', { title: 'Mr. & Mrs. Smith', year: 2005 }],
    ['Dr.No.1962.mkv', 'movies', { title: 'Dr. No', year: 1962 }],
    ['Spider-Man.2002.mkv', 'movies', { title: 'Spider-Man', year: 2002 }],
    // Casing
    ['the.matrix.1999.mkv', 'movies', { title: 'The Matrix', year: 1999 }],
    ['THE MATRIX.mkv', 'movies', { title: 'The Matrix', year: null }],
    ['star wars episode v the empire strikes back (1980).mkv', 'movies', { title: 'Star Wars Episode V the Empire Strikes Back', year: 1980 }],
    // Tag-like words that are part of the title
    ["Charlotte's Web 1080p.mkv", 'movies', { title: "Charlotte's Web", resolution: '1080p' }],
    ['The Final Cut (2004).mkv', 'movies', { title: 'The Final Cut', year: 2004, edition: null }],
    ['Uncut Gems (2019).mkv', 'movies', { title: 'Uncut Gems', year: 2019, edition: null }],
    ['A Complete Unknown (2024).mkv', 'movies', { title: 'A Complete Unknown', year: 2024 }],
    // Editions and ids
    ["The Matrix (1999) {imdb-tt0133093}/The Matrix (1999) {edition-Director's Cut}.mkv", 'movies', { title: 'The Matrix', year: 1999, imdbId: 'tt0133093', edition: "Director's Cut" }],
    ["Hellboy (2004)/Hellboy (2004) {edition-Director's Cut} [imdbid-tt0167190].mkv", 'movies', { title: 'Hellboy', year: 2004, edition: "Director's Cut", imdbId: 'tt0167190' }],
    ['The Lord of the Rings The Fellowship of the Ring Extended Edition (2001).mkv', 'movies', { title: 'The Lord of the Rings The Fellowship of the Ring', year: 2001, edition: 'Extended Edition' }],
    ['Heat (1995) [tmdbid=949].mkv', 'movies', { title: 'Heat', year: 1995, tmdbId: 949 }],
    ['Heat (1995) {tmdb-949}.mkv', 'movies', { title: 'Heat', tmdbId: 949 }],
    ['Movie Title (2010) [tt1375666].mkv', 'movies', { title: 'Movie Title', imdbId: 'tt1375666' }],
    ['Inception.2010.tt1375666.1080p.mkv', 'movies', { title: 'Inception', year: 2010, imdbId: 'tt1375666' }],
    // Stacked parts
    ['Movie Title (2010) - cd1.avi', 'movies', { title: 'Movie Title', year: 2010, part: 1 }],
    ['Movie.Name.2003.DVDRip.XviD.CD2-GROUP.avi', 'movies', { title: 'Movie Name', year: 2003, part: 2 }],
    ['Some Movie (2010) - Part 2.mkv', 'movies', { title: 'Some Movie', year: 2010, part: 2 }],
    ['Some Movie (2010) - pt1.mkv', 'movies', { title: 'Some Movie', part: 1 }],
    ['Heat (1995)/CD1/heat-cd1.avi', 'movies', { title: 'Heat', year: 1995, part: 1 }],
    ['Harry Potter and the Deathly Hallows Part 1 (2010).mkv', 'movies', { title: 'Harry Potter and the Deathly Hallows Part 1', year: 2010, part: null }],
    // Generic file names fall back to the folder
    ['The Matrix (1999)/matrix.mkv', 'movies', { title: 'The Matrix', year: 1999 }],
    ['The Matrix (1999)/tt0133093.mkv', 'movies', { title: 'The Matrix', year: 1999, imdbId: 'tt0133093' }],
    ['Heat (1995)/VIDEO_TS/VTS_01_1.VOB', 'movies', { title: 'Heat', year: 1995 }],
    ['Movie Title (2010)/BDMV/STREAM/00001.m2ts', 'movies', { title: 'Movie Title', year: 2010 }],
    ['Some Film (2012)/title_t00.mkv', 'movies', { title: 'Some Film', year: 2012 }],
    ['Some Film (2012)/movie.mkv', 'movies', { title: 'Some Film', year: 2012 }],
    ['The.Matrix.1999.1080p.BluRay.x264-GROUP/the.matrix.1999.1080p.bluray.x264-group.mkv', 'movies', { title: 'The Matrix', year: 1999 }],
    // Folders that are not the movie's own folder
    ['Batman/Batman Begins (2005).mkv', 'movies', { title: 'Batman Begins', year: 2005 }],
    ['Movies/Star Wars Collection/Star.Wars.Episode.IV.A.New.Hope.1977.1080p.mkv', 'movies', { title: 'Star Wars Episode IV A New Hope', year: 1977 }],
    // Windows paths
    ['Movies\\Alien (1979)\\Alien.1979.mkv', 'movies', { title: 'Alien', year: 1979 }],
    ['Alien (1979)\\alien.mkv', 'movies', { title: 'Alien', year: 1979 }],
    // Movies libraries never turn dates / numbers into episodes...
    ['The.Daily.Show.2011.03.14.720p.mkv', 'movies', { kind: 'movie', title: 'The Daily Show', year: 2011 }],
    ['Some Film - 12 [1080p].mkv', 'movies', { kind: 'movie' }],
    // ...and mixed libraries keep obvious movies as movies.
    ['Star Wars Episode 4 A New Hope (1977).mkv', 'mixed', { kind: 'movie', title: 'Star Wars Episode 4 A New Hope', year: 1977 }],
    ['Mission Impossible - 3.mkv', 'mixed', { kind: 'movie', title: 'Mission Impossible - 3' }],
    ['Movie.1920x1080.mkv', 'shows', { kind: 'movie', title: 'Movie', resolution: '1080p' }],
  ]);
});

describe('parseMediaPath: episodes', () => {
  check([
    // SxxEyy variants
    ['Breaking.Bad.S01E01.Pilot.720p.BluRay.x264-DEMAND.mkv', 'shows', { kind: 'episode', title: 'Breaking Bad', season: 1, episode: 1, episodeEnd: null, episodeTitle: 'Pilot', resolution: '720p' }],
    ["Breaking Bad/Season 1/Breaking Bad - S01E02 - The Cat's in the Bag.mkv", 'shows', { title: 'Breaking Bad', season: 1, episode: 2, episodeTitle: "The Cat's in the Bag" }],
    ['show.name.s1e2.mkv', 'shows', { title: 'Show Name', season: 1, episode: 2 }],
    ['Show.Name.S01.E02.mkv', 'shows', { season: 1, episode: 2 }],
    ['Show Name S01 E02.mkv', 'shows', { title: 'Show Name', season: 1, episode: 2 }],
    ['Show_Name_S01_E02.mkv', 'shows', { title: 'Show Name', season: 1, episode: 2 }],
    ['Show.S2010E05.mkv', 'shows', { season: 2010, episode: 5 }],
    ['Show.Name.S01E01.1080p.mkv', 'movies', { kind: 'episode', title: 'Show Name', season: 1, episode: 1 }],
    // Scene abbreviations defer to the show folder
    ['Game of Thrones/Season 1/got.s01e01.720p.mkv', 'shows', { title: 'Game of Thrones', season: 1, episode: 1 }],
    ['The Big Bang Theory (2007)/Season 02/tbbt.s02e05.hdtv.mkv', 'shows', { title: 'The Big Bang Theory', year: 2007, season: 2, episode: 5 }],
    ['Kids/bluey.s01e01.mkv', 'shows', { title: 'Bluey', season: 1, episode: 1 }],
    // Multi-episode files
    ['Show.S01E01E02.mkv', 'shows', { season: 1, episode: 1, episodeEnd: 2 }],
    ['Show.S01E01-E02.mkv', 'shows', { episode: 1, episodeEnd: 2 }],
    ['Show.S01E01-02.mkv', 'shows', { episode: 1, episodeEnd: 2 }],
    ['Show - S01E01-E03 - Title.mkv', 'shows', { episode: 1, episodeEnd: 3, episodeTitle: 'Title' }],
    ['Show.S01E01.1080p-720p.mkv', 'shows', { episode: 1, episodeEnd: null }],
    // NxM
    ['Seinfeld/Season 4/Seinfeld - 4x11 - The Contest.avi', 'shows', { title: 'Seinfeld', season: 4, episode: 11, episodeTitle: 'The Contest' }],
    ['Show 01x02 Title.mkv', 'mixed', { kind: 'episode', title: 'Show', season: 1, episode: 2, episodeTitle: 'Title' }],
    ['Show Name - 1x02 - 1920x1080.mkv', 'shows', { season: 1, episode: 2, episodeTitle: null, resolution: '1080p' }],
    // Words
    ['Show Season 1 Episode 2.mkv', 'shows', { title: 'Show', season: 1, episode: 2 }],
    ['Show/Season 3/Episode 12.mkv', 'shows', { title: 'Show', season: 3, episode: 12 }],
    ['Show/Saison 2/Show - Episode 3.mkv', 'shows', { title: 'Show', season: 2, episode: 3 }],
    ['Show/Series 1/Show - E02.mkv', 'shows', { season: 1, episode: 2 }],
    ['Show/S02/Show.E05.mkv', 'shows', { title: 'Show', season: 2, episode: 5 }],
    ['Ep 12.mkv', 'shows', { kind: 'episode', title: 'Unknown', season: 1, episode: 12 }],
    // Leading numbers inside season folders
    ['Show/Season 2/05 - The Title.mkv', 'shows', { title: 'Show', season: 2, episode: 5, episodeTitle: 'The Title' }],
    ['Show/Season 2/05. The Title.mkv', 'shows', { season: 2, episode: 5, episodeTitle: 'The Title' }],
    ['Show/Season 2/E05 The Title.mkv', 'shows', { season: 2, episode: 5, episodeTitle: 'The Title' }],
    ['Show/Temporada 3/03.mkv', 'shows', { title: 'Show', season: 3, episode: 3, episodeTitle: null }],
    ['Show/Season 1/101 - Pilot.mkv', 'shows', { season: 1, episode: 1, episodeTitle: 'Pilot' }],
    ['Show/Staffel 2/08 - Titel.mkv', 'shows', { season: 2, episode: 8 }],
    ['Show/Stagione 1/Show 1x04.mkv', 'mixed', { season: 1, episode: 4 }],
    // Specials
    ['Show/Specials/Show - S00E01 - Special.mkv', 'shows', { season: 0, episode: 1, episodeTitle: 'Special' }],
    ['Show/Specials/01 - Special Title.mkv', 'shows', { title: 'Show', season: 0, episode: 1, episodeTitle: 'Special Title' }],
    // The explicit season in the file name wins over the folder
    ['Show/Season 2/Show - S03E04.mkv', 'shows', { season: 3, episode: 4 }],
    // Anime absolute numbering
    ['Anime/[SubsPlease] Frieren - 12 [1080p].mkv', 'shows', { kind: 'episode', title: 'Frieren', season: 1, episode: 12, resolution: '1080p' }],
    ['Show Name - 012 (BD 1080p).mkv', 'mixed', { kind: 'episode', title: 'Show Name', season: 1, episode: 12 }],
    ['Show Name - 12v2.mkv', 'shows', { title: 'Show Name', episode: 12 }],
    ['Naruto Shippuden - 250 [720p].mkv', 'mixed', { title: 'Naruto Shippuden', season: 1, episode: 250 }],
    ['[HorribleSubs] Boku no Hero Academia S4 - 05 [720p].mkv', 'shows', { title: 'Boku no Hero Academia', season: 4, episode: 5 }],
    ['Show Name 2nd Season - 05 [1080p].mkv', 'mixed', { title: 'Show Name', season: 2, episode: 5 }],
    ['Cowboy Bebop/Season 1/Cowboy Bebop - 05 - Ballad of Fallen Angels.mkv', 'shows', { title: 'Cowboy Bebop', season: 1, episode: 5, episodeTitle: 'Ballad of Fallen Angels' }],
    ['[Judas] Jujutsu Kaisen - S01E05.mkv', 'shows', { title: 'Jujutsu Kaisen', season: 1, episode: 5 }],
    // Daily shows
    ['The Daily Show/The.Daily.Show.2011.03.14.Guest.Name.720p.mkv', 'shows', { kind: 'episode', title: 'The Daily Show', airDate: '2011-03-14', season: 2011, episode: null, episodeTitle: 'Guest Name' }],
    ['Jeopardy/Jeopardy.2019-05-10.mkv', 'mixed', { kind: 'episode', title: 'Jeopardy', airDate: '2019-05-10' }],
    ['Last Week Tonight/Season 2019/Last Week Tonight - 2019-03-17 - Episode Title.mkv', 'shows', { title: 'Last Week Tonight', season: 2019, airDate: '2019-03-17', episodeTitle: 'Episode Title' }],
    ['Show.2019.02.30.mkv', 'shows', { airDate: null }],
    // Show names: folders vs. file names
    ['Doctor Who (2005)/Season 1/Doctor.Who.S01E01.mkv', 'shows', { title: 'Doctor Who', year: 2005, season: 1, episode: 1 }],
    ['Doctor.Who.2005.S01E01.Rose.mkv', 'shows', { title: 'Doctor Who', year: 2005, episodeTitle: 'Rose' }],
    ["Marvel's Agents of S.H.I.E.L.D./Season 1/Marvels.Agents.of.S.H.I.E.L.D.S01E01.720p.HDTV.x264-KILLERS.mkv", 'shows', { title: "Marvel's Agents of S.H.I.E.L.D.", season: 1, episode: 1 }],
    ['Marvels.Agents.of.S.H.I.E.L.D.S01E01.720p.mkv', 'shows', { title: 'Marvels Agents of S.H.I.E.L.D.' }],
    ['S.W.A.T. (2017)/Season 1/S.W.A.T.2017.S01E01.720p.HDTV.x264-KILLERS.mkv', 'shows', { title: 'S.W.A.T.', year: 2017, season: 1, episode: 1 }],
    ['Mr.Robot.S01E01.720p.mkv', 'shows', { title: 'Mr. Robot' }],
    ['Mr. Robot/Season 1/Mr. Robot - S01E01 - eps1.0_hellofriend.mov.mkv', 'shows', { title: 'Mr. Robot', season: 1, episode: 1 }],
    ['Breaking.Bad.S01.1080p.BluRay.x264-ROVERS/Breaking.Bad.S01E03.1080p.BluRay.x264-ROVERS.mkv', 'shows', { title: 'Breaking Bad', season: 1, episode: 3 }],
    ['Downloads/Breaking.Bad.S01E01.720p.HDTV.x264-GROUP/breaking.bad.s01e01.720p.hdtv.x264-group.mkv', 'shows', { title: 'Breaking Bad', season: 1, episode: 1 }],
    ['TV Shows/Breaking.Bad.S01E01.mkv', 'shows', { title: 'Breaking Bad' }],
    ['Breaking Bad/Season 1/S01E01.mkv', 'shows', { title: 'Breaking Bad', season: 1, episode: 1 }],
    ['Breaking Bad (2008) [tvdbid-81189]/Season 01/Breaking Bad - S01E01.mkv', 'shows', { title: 'Breaking Bad', year: 2008, tvdbId: 81189 }],
    ['The Office (US)/Season 1/The Office (US) - S01E01 - Pilot.mkv', 'shows', { title: 'The Office (US)', episodeTitle: 'Pilot' }],
    ['The Office (UK)/Series 1/The Office - S01E01.mkv', 'shows', { title: 'The Office (UK)', season: 1 }],
    ['Planet Earth II (2016)/Season 1/Planet Earth II - S01E01 - Islands.mkv', 'shows', { title: 'Planet Earth II', year: 2016, episodeTitle: 'Islands' }],
    ['Love, Death & Robots/Season 1/Love, Death & Robots - S01E01.mkv', 'shows', { title: 'Love, Death & Robots' }],
    ['9-1-1/Season 1/9-1-1 - S01E01.mkv', 'shows', { title: '9-1-1', year: null }],
    ['The.100.S01E01.mkv', 'shows', { title: 'The 100' }],
    ['1883/Season 1/1883 - S01E01.mkv', 'shows', { title: '1883', year: null }],
    ['Castle (2009)/Season 1/Castle.2009.S01E01.mkv', 'shows', { title: 'Castle', year: 2009 }],
    ['Kids/Bluey/Season 1/Bluey - S01E01 - Magic Xylophone.mkv', 'shows', { title: 'Bluey', episodeTitle: 'Magic Xylophone' }],
    ['Friends/Friends Season 1/Friends - 01.mkv', 'shows', { title: 'Friends', season: 1, episode: 1 }],
    ['www.Torrenting.com - Show.Name.S01E01.720p.mkv', 'shows', { title: 'Show Name' }],
    ['the.walking.dead.s05e03.720p.hdtv.x264-killers.mkv', 'shows', { title: 'The Walking Dead', season: 5, episode: 3 }],
    // Episode titles
    ['Stranger.Things.S04E09.Chapter.Nine.The.Piggyback.2160p.NF.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv', 'shows', { title: 'Stranger Things', episodeTitle: 'Chapter Nine The Piggyback', resolution: '2160p' }],
    ['House.of.the.Dragon.S01E01.The.Heirs.of.the.Dragon.1080p.HMAX.WEB-DL.DDP5.1.Atmos.H.264-CMRG.mkv', 'shows', { title: 'House of the Dragon', episodeTitle: 'The Heirs of the Dragon' }],
    ['Show.S01E01.1080p.WEB-DL.mkv', 'shows', { episodeTitle: null }],
    ['Show.S01E01-GROUP.mkv', 'shows', { episodeTitle: null }],
    ['Show.Name.S01E01.REPACK.mkv', 'shows', { episodeTitle: null }],
    ['Show/Season 1/Show - S01E01 - Pilot (1080p).mkv', 'shows', { episodeTitle: 'Pilot', resolution: '1080p' }],
    ['Show - S01E01 - Part 1.mkv', 'shows', { episodeTitle: 'Part 1', part: null }],
    ['Game.of.Thrones.S01E01.EXTENDED.720p.mkv', 'shows', { title: 'Game of Thrones', edition: 'Extended', episodeTitle: null }],
    // Windows paths and odd season folders
    ['TV\\Breaking Bad\\Season 01\\Breaking.Bad.S01E01.mkv', 'shows', { title: 'Breaking Bad', season: 1, episode: 1 }],
    ['Show/Season 1 [1080p]/Show - S01E01.mkv', 'shows', { title: 'Show', resolution: '1080p' }],
  ]);
});

describe('parseMediaPath: robustness', () => {
  it('always returns a usable title and never throws', () => {
    for (const p of ['', '   ', '.mkv', '[].mkv', '1080p.mkv', '////', '\\\\', 'S01E01.mkv', '-.mkv', '()[]{}.mp4']) {
      for (const kind of ['movies', 'shows', 'mixed'] as const) {
        const r = parseMediaPath(p, kind);
        expect(typeof r.title).toBe('string');
        expect(r.title.length).toBeGreaterThan(0);
      }
    }
    expect(parseMediaPath('', 'movies').title).toBe('Unknown');
    expect(parseMediaPath('S01E01.mkv', 'shows')).toMatchObject({ kind: 'episode', title: 'Unknown', season: 1, episode: 1 });
  });

  it('survives random garbage', () => {
    let seed = 42;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const alphabet = 'aZ09 ._-[](){}\\/SExp1080#$&\'"éß日本';
    for (let i = 0; i < 500; i++) {
      let s = '';
      const len = Math.floor(rand() * 60);
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rand() * alphabet.length)];
      const r = parseMediaPath(`${s}.mkv`, (['movies', 'shows', 'mixed'] as const)[i % 3]);
      expect(r.title.length).toBeGreaterThan(0);
    }
  });

  it('handles very long names quickly', () => {
    const long = `${'Some.Very.Long.Name.'.repeat(200)}S01E01.${'x'.repeat(2000)}.mkv`;
    const started = Date.now();
    expect(parseMediaPath(long, 'shows').kind).toBe('episode');
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('file and folder classification', () => {
  it('knows the video extensions', () => {
    for (const ext of ['mp4', 'm4v', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'mpg', 'mpeg', 'm2ts', 'mts', 'ts', 'flv', 'ogv', '3gp', 'divx', 'vob', 'asf']) {
      expect(VIDEO_EXTENSIONS.has(ext)).toBe(true);
    }
    expect(VIDEO_EXTENSIONS.has('srt')).toBe(false);
  });

  it('isVideoFile', () => {
    expect(isVideoFile('Movie.MKV')).toBe(true);
    expect(isVideoFile('clip.m2ts')).toBe(true);
    expect(isVideoFile('._Movie.mkv')).toBe(false);
    expect(isVideoFile('Movie.srt')).toBe(false);
    expect(isVideoFile('Movie.mkv.part')).toBe(false);
    expect(isVideoFile('noext')).toBe(false);
  });

  it('shouldSkipDirectory', () => {
    for (const d of ['@eaDir', '#recycle', '#snapshot', '@Recycle', '.@__thumb', '$RECYCLE.BIN', 'System Volume Information', 'lost+found', '.Trash-1000', 'Plex Versions', '.hidden', 'Extras', 'featurettes', 'Behind The Scenes', 'Deleted Scenes', 'Interviews', 'Scenes', 'Shorts', 'Trailers', 'Sample', 'SAMPLES', 'Other']) {
      expect(shouldSkipDirectory(d), d).toBe(true);
    }
    for (const d of ['Specials', 'Season 1', 'Movies', 'The Others (2001)', 'Extras (2005)']) {
      expect(shouldSkipDirectory(d), d).toBe(false);
    }
  });

  it('isExtraOrSample', () => {
    const MB = 1024 * 1024;
    expect(isExtraOrSample('movie.sample.mkv', 50 * MB)).toBe(true);
    expect(isExtraOrSample('sample-movie.mkv', 50 * MB)).toBe(true);
    expect(isExtraOrSample('Sample.mkv', 50 * MB)).toBe(true);
    expect(isExtraOrSample('movie.sample.mkv', 800 * MB)).toBe(false);
    expect(isExtraOrSample('The Sample (2020).mkv', 2048 * MB)).toBe(false);
    expect(isExtraOrSample('Samples of Life (2020).mkv', 50 * MB)).toBe(false);
    for (const suffix of ['trailer', 'sample', 'featurette', 'behindthescenes', 'deleted', 'interview', 'scene', 'short', 'other']) {
      expect(isExtraOrSample(`Inception (2010)-${suffix}.mp4`, 2048 * MB), suffix).toBe(true);
    }
    expect(isExtraOrSample('trailer.mp4', 90 * MB)).toBe(true);
    expect(isExtraOrSample('Inception (2010).mkv', 2048 * MB)).toBe(false);
    expect(isExtraOrSample('Show - S01E03 - Other.mkv', 400 * MB)).toBe(false);
  });
});

describe('cleanTitle / titleKey / sortName', () => {
  it('cleans names', () => {
    expect(cleanTitle('The.Matrix.1999.1080p.BluRay.x264-GROUP')).toBe('The Matrix');
    expect(cleanTitle('Breaking.Bad.S01.1080p.BluRay.x264-ROVERS')).toBe('Breaking Bad');
    expect(cleanTitle('Breaking Bad Complete Series')).toBe('Breaking Bad');
    expect(cleanTitle('Breaking.Bad.COMPLETE.720p')).toBe('Breaking Bad');
    expect(cleanTitle('The Wire - The Complete Series (2002)')).toBe('The Wire');
    expect(cleanTitle('Show.Name.Season.1-5.1080p')).toBe('Show Name');
    expect(cleanTitle('Friends Season 1')).toBe('Friends');
    expect(cleanTitle('A Complete Unknown (2024)')).toBe('A Complete Unknown');
    expect(cleanTitle('Movie Name [2010] [1080p]')).toBe('Movie Name');
    expect(cleanTitle('the office')).toBe('The Office');
    expect(cleanTitle('rocky ii')).toBe('Rocky II');
    expect(cleanTitle('x-men: days of future past')).toBe('X-Men: Days of Future Past');
    expect(cleanTitle("Marvel's Agents of S.H.I.E.L.D.")).toBe("Marvel's Agents of S.H.I.E.L.D.");
    expect(cleanTitle('HEAT')).toBe('HEAT');
    expect(cleanTitle('   ')).toBe('');
    expect(cleanTitle('[1080p]')).toBe('');
  });

  it('builds grouping keys', () => {
    expect(titleKey("Marvel's Agents of S.H.I.E.L.D.")).toBe('marvels agents of shield');
    expect(titleKey('Marvels Agents of SHIELD')).toBe(titleKey("Marvel's Agents of S.H.I.E.L.D."));
    expect(titleKey('S.W.A.T.')).toBe(titleKey('SWAT'));
    expect(titleKey('Law & Order')).toBe(titleKey('Law and Order'));
    expect(titleKey('Amélie')).toBe('amelie');
    expect(titleKey('Pokémon: The   Movie')).toBe('pokemon the movie');
    expect(titleKey('Ocean’s Eleven')).toBe('oceans eleven');
    expect(titleKey('Mr. Robot')).toBe(titleKey('Mr Robot'));
    expect(titleKey('進撃の巨人')).toBe('進撃の巨人');
    expect(titleKey('Spider-Man: No Way Home')).toBe('spider man no way home');
  });

  it('builds sort names', () => {
    expect(sortName('The Matrix')).toBe('matrix');
    expect(sortName('A Beautiful Mind')).toBe('beautiful mind');
    expect(sortName('An American Tail')).toBe('american tail');
    expect(sortName('Theater Camp')).toBe('theater camp');
    expect(sortName('Up')).toBe('up');
  });
});

describe('parseMediaPath: Sonarr / Radarr / fansub naming', () => {
  check([
    ['Show Name (2019)/Season 01/Show Name (2019) - S01E01 - Title [WEBDL-1080p][EAC3 5.1][h264]-GROUP.mkv', 'shows', { title: 'Show Name', year: 2019, season: 1, episode: 1, episodeTitle: 'Title', resolution: '1080p' }],
    ['Show Name - S01E01 - Episode Title WEBDL-1080p.mkv', 'shows', { title: 'Show Name', episodeTitle: 'Episode Title', resolution: '1080p' }],
    ['Movie Title (2010) Bluray-1080p.mkv', 'movies', { title: 'Movie Title', year: 2010, resolution: '1080p' }],
    ['Movie Title (2010) [Bluray-1080p][DTS 5.1][x264]-GROUP.mkv', 'movies', { title: 'Movie Title', year: 2010 }],
    ["Movie Title (2010) [Director's Cut].mkv", 'movies', { title: 'Movie Title', year: 2010, edition: "Director's Cut" }],
    ["Movie Title (2010) - Director's Cut.mkv", 'movies', { title: 'Movie Title', edition: "Director's Cut" }],
    ['Movie Name [1080p]-GROUP.mkv', 'movies', { title: 'Movie Name', year: null }],
    ['[Group] Show Name - 01 (1920x1080 HEVC AAC) [ABCDEF12].mkv', 'shows', { title: 'Show Name', episode: 1, resolution: '1080p', episodeTitle: null }],
    ['[Group] Show Name (2019) - 01 [1080p].mkv', 'mixed', { kind: 'episode', title: 'Show Name', year: 2019, episode: 1 }],
    ['Battlestar Galactica (2003)/Season 1/Battlestar.Galactica.S01E01.mkv', 'shows', { title: 'Battlestar Galactica', year: 2003 }],
    ['90210/Season 1/90210 - S01E01.mkv', 'shows', { title: '90210' }],
  ]);
});
