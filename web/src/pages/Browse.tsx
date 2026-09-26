import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { TitleSummary } from '@shared/types';
import { Billboard } from '../components/Billboard';
import { CaretDownIcon, FolderIcon } from '../components/Icons';
import { Row } from '../components/Row';
import { TitleCard } from '../components/TitleCard';
import { useItemsPerRow, useOnClickOutside, useScrolled } from '../lib/hooks';
import { buildRows, pickBillboard, topTenIds, type BrowseFilter, type RowDef } from '../lib/rows';
import { readSession, writeSession } from '../lib/storage';
import { useApp, useCurrentProfile } from '../store/app';
import './Browse.css';

function sessionSeed(): string {
  let seed = readSession('hb.seed');
  if (!seed) {
    seed = Math.random().toString(36).slice(2);
    writeSession('hb.seed', seed);
  }
  return seed;
}

const BASE_PATH: Record<BrowseFilter, string> = { all: '/browse', show: '/tv', movie: '/movies' };
const FILTER_NAME: Record<BrowseFilter, string> = { all: 'Home', show: 'TV Shows', movie: 'Movies' };

function GenreMenu({ genres, filter }: { genres: string[]; filter: BrowseFilter }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);
  if (!genres.length) return null;
  return (
    <div className="genre-menu" ref={ref}>
      <button className="genre-menu__button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        Genres <CaretDownIcon />
      </button>
      {open ? (
        <ul className="genre-menu__list">
          {genres.map((g) => (
            <li key={g}>
              <Link to={`${BASE_PATH[filter]}?genre=${encodeURIComponent(g)}`} onClick={() => setOpen(false)}>
                {g}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SubNav({ filter, genre, genres }: { filter: BrowseFilter; genre: string | null; genres: string[] }) {
  const scrolled = useScrolled(0);
  return (
    <div className={`subnav ${scrolled ? 'subnav--solid' : ''}`}>
      {genre ? (
        <h1 className="subnav__title">
          {filter !== 'all' ? (
            <>
              <Link to={BASE_PATH[filter]} className="subnav__crumb">
                {FILTER_NAME[filter]}
              </Link>
              <span className="subnav__sep">›</span>
            </>
          ) : null}
          {genre}
        </h1>
      ) : (
        <h1 className="subnav__title">{FILTER_NAME[filter]}</h1>
      )}
      <GenreMenu genres={genres} filter={filter} />
    </div>
  );
}

function Skeleton() {
  const perPage = useItemsPerRow();
  return (
    <div className="browse browse--loading" aria-busy="true">
      <div className="skeleton-billboard" />
      <div className="lolomo">
        {[0, 1, 2].map((r) => (
          <div className="skeleton-row" key={r}>
            <div className="skeleton-row__title" />
            <div className="skeleton-row__items">
              {Array.from({ length: perPage }, (_, i) => (
                <div key={i} className="skeleton-row__item" style={{ animationDelay: `${(r * perPage + i) * 0.08}s` }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyLibrary() {
  const libraries = useApp((s) => s.libraries);
  const scan = useApp((s) => s.scan);
  const scanning = Boolean(scan?.running);
  return (
    <div className="empty-lib">
      <div className="empty-lib__glow" />
      <div className="empty-lib__content">
        <FolderIcon className="empty-lib__icon" />
        {scanning ? (
          <>
            <h1>Setting up your library…</h1>
            <p>
              Home Blockbuster is scanning <strong>{scan?.libraryName}</strong>. Titles will appear here as soon as they are found.
            </p>
            <div className="empty-lib__progress">
              <span style={{ width: scan?.total ? `${Math.round((scan.processed / scan.total) * 100)}%` : '15%' }} />
            </div>
            <p className="empty-lib__current">{scan?.current ?? scan?.message}</p>
          </>
        ) : libraries.length === 0 ? (
          <>
            <h1>Your library is empty</h1>
            <p>
              Point Home Blockbuster at a folder on this computer, an external drive, a server or a NAS share. Movies and shows are detected
              automatically and dressed with posters, artwork and details.
            </p>
            <Link className="btn btn--red empty-lib__cta" to="/settings/libraries?add=1">
              Add a library
            </Link>
          </>
        ) : (
          <>
            <h1>No videos found yet</h1>
            <p>Your libraries don&apos;t contain any playable videos, or a drive is disconnected. Check the folders and scan again.</p>
            <Link className="btn btn--red empty-lib__cta" to="/settings/libraries">
              Manage libraries
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function exploreHref(row: RowDef, filter: BrowseFilter): string | undefined {
  if (row.key.startsWith('genre-')) return `${BASE_PATH[filter]}?genre=${encodeURIComponent(row.key.slice(6))}`;
  if (row.key === 'all-shows') return '/tv';
  if (row.key === 'all-movies') return '/movies';
  if (row.key === 'mylist') return '/my-list';
  if (row.key === 'new') return '/latest';
  return undefined;
}

export function Browse({ filter }: { filter: BrowseFilter }) {
  const titles = useApp((s) => s.titles);
  const titleMap = useApp((s) => s.titleMap);
  const state = useApp((s) => s.profileState);
  const continueItems = useApp((s) => s.continueItems);
  const loaded = useApp((s) => s.titlesLoaded);
  const profile = useCurrentProfile();
  const [params] = useSearchParams();
  const genre = params.get('genre');
  const [seed] = useState(sessionSeed);

  const scoped = useMemo(
    () => titles.filter((t) => (filter === 'all' || t.kind === filter) && (!genre || t.genres.includes(genre))),
    [titles, filter, genre],
  );
  const genres = useMemo(() => {
    const set = new Set<string>();
    for (const t of titles) if (filter === 'all' || t.kind === filter) for (const g of t.genres) set.add(g);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [titles, filter]);
  const rows = useMemo(
    () => buildRows({ titles, titleMap, state, continueItems, profileName: profile?.name ?? '', filter, genre }),
    [titles, titleMap, state, continueItems, profile?.name, filter, genre],
  );
  const topTen = useMemo(() => topTenIds(titles), [titles]);
  const billboard = useMemo<TitleSummary | null>(() => pickBillboard(scoped, `${seed}:${filter}:${genre ?? ''}`), [scoped, seed, filter, genre]);

  if (!loaded) return <Skeleton />;
  if (titles.length === 0) return <EmptyLibrary />;

  return (
    <div className="browse">
      {filter !== 'all' || genre ? <SubNav filter={filter} genre={genre} genres={genres} /> : null}
      {billboard ? <Billboard key={billboard.id} title={billboard} /> : <div className="browse__spacer" />}
      <div className={`lolomo ${billboard ? '' : 'lolomo--flat'}`}>
        {rows.length === 0 ? <p className="browse__none">Nothing here yet.</p> : null}
        {rows.map((row) => (
          <Row key={row.key} row={row} topTenIds={topTen} exploreHref={exploreHref(row, filter)} />
        ))}
      </div>
    </div>
  );
}

/** Wrapping grid of cards (My List, Search, New & Popular galleries). */
export function CardGrid({ titles }: { titles: TitleSummary[] }) {
  const perRow = useItemsPerRow();
  const all = useApp((s) => s.titles);
  const topTen = useMemo(() => topTenIds(all), [all]);
  return (
    <div className="card-grid" style={{ ['--per-row' as string]: perRow }}>
      {titles.map((t) => (
        <div className="card-grid__item" key={t.id}>
          <TitleCard title={t} topTen={topTen.has(t.id)} />
        </div>
      ))}
    </div>
  );
}
