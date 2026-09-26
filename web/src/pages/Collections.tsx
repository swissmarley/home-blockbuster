import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { TitleSummary } from '@shared/types';
import { Row } from '../components/Row';
import { isRecentlyAdded } from '../lib/format';
import { searchTitles, topTenIds, trendScore, type RowDef } from '../lib/rows';
import { useApp } from '../store/app';
import { CardGrid, EmptyLibrary } from './Browse';

export function MyList() {
  const titleMap = useApp((s) => s.titleMap);
  const list = useApp((s) => s.profileState?.myList ?? []);
  const loaded = useApp((s) => s.titlesLoaded);
  const titles = list.map((id) => titleMap[id]).filter((t): t is TitleSummary => Boolean(t));
  return (
    <div className="browse">
      <h1 className="page-heading">My List</h1>
      {loaded && titles.length === 0 ? (
        <p className="page-empty">
          You haven&apos;t added any titles to your list yet.
          <br />
          Hover over a title and select <strong>+</strong> to save it here.
        </p>
      ) : (
        <CardGrid titles={titles} />
      )}
    </div>
  );
}

export function Latest() {
  const titles = useApp((s) => s.titles);
  const loaded = useApp((s) => s.titlesLoaded);
  const rows = useMemo<RowDef[]>(() => {
    const byAdded = [...titles].sort((a, b) => b.addedAt - a.addedAt);
    const recent = byAdded.filter((t) => isRecentlyAdded(t, 30));
    const top = (kind: TitleSummary['kind']) =>
      titles.filter((t) => t.kind === kind && (t.rating || t.popularity)).sort((a, b) => trendScore(b) - trendScore(a));
    const year = new Date().getFullYear();
    const fresh = titles
      .filter((t) => t.year && t.year >= year - 3)
      .sort((a, b) => (b.releaseDate ?? String(b.year)).localeCompare(a.releaseDate ?? String(a.year)));
    const out: RowDef[] = [
      { key: 'new', title: 'New on Home Blockbuster', type: 'standard', items: (recent.length >= 4 ? recent : byAdded).slice(0, 40) },
      { key: 'top-shows', title: 'Top 10 TV Shows in Your Library Today', type: 'top10', items: top('show').slice(0, 10) },
      { key: 'top-movies', title: 'Top 10 Movies in Your Library Today', type: 'top10', items: top('movie').slice(0, 10) },
      { key: 'fresh', title: 'Worth the Wait', type: 'standard', items: fresh.slice(0, 40) },
      { key: 'rated', title: 'Highest Rated', type: 'standard', items: [...titles].filter((t) => t.rating).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 40) },
    ];
    return out.filter((r) => (r.type === 'top10' ? r.items.length >= 5 : r.items.length > 0));
  }, [titles]);
  const topTen = useMemo(() => topTenIds(titles), [titles]);
  if (loaded && titles.length === 0) return <EmptyLibrary />;
  return (
    <div className="browse">
      <h1 className="page-heading">New &amp; Popular</h1>
      {rows.map((row) => (
        <Row key={row.key} row={row} topTenIds={topTen} />
      ))}
    </div>
  );
}

export function Search() {
  const [params] = useSearchParams();
  const query = params.get('q') ?? '';
  const titles = useApp((s) => s.titles);
  const results = useMemo(() => searchTitles(titles, query), [titles, query]);
  const related = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of results.slice(0, 12)) {
      for (const g of t.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
      for (const p of t.people.slice(0, 2)) counts.set(p, (counts.get(p) ?? 0) + 0.5);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)
      .filter((name) => name.toLowerCase() !== query.toLowerCase())
      .slice(0, 8);
  }, [results, query]);

  return (
    <div className="browse search-page">
      <div className="search-page__head">
        {related.length ? (
          <p className="search-page__related">
            <span>Explore titles related to:</span>
            {related.map((r) => (
              <Link key={r} to={`/search?q=${encodeURIComponent(r)}`} replace>
                {r}
              </Link>
            ))}
          </p>
        ) : null}
      </div>
      {results.length ? (
        <CardGrid titles={results} />
      ) : query ? (
        <div className="page-empty search-page__none">
          <p>Your search for &quot;{query}&quot; did not have any matches.</p>
          <p>Suggestions:</p>
          <ul>
            <li>Try different keywords</li>
            <li>Looking for a movie or TV show? Check that its folder is part of a library</li>
            <li>Try using a movie, TV show title, an actor or director</li>
            <li>Try a genre, like comedy, romance, sports, or drama</li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
