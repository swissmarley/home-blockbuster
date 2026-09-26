import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RowDef } from '../lib/rows';
import { canHover, useItemsPerRow } from '../lib/hooks';
import { ChevronLeftIcon, ChevronRightIcon } from './Icons';
import { usePreview } from './previewStore';
import { TitleCard } from './TitleCard';
import './Row.css';

export function Row({ row, topTenIds, exploreHref }: { row: RowDef; topTenIds?: Set<string>; exploreHref?: string }) {
  const perPage = useItemsPerRow();
  const closePopup = usePreview((s) => s.closePopup);
  const total = row.items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const [page, setPage] = useState(0);
  const [moved, setMoved] = useState(false);
  const [touch] = useState(() => !canHover());

  useEffect(() => {
    if (page > pages - 1) setPage(pages - 1);
  }, [page, pages]);

  const go = (dir: 1 | -1): void => {
    closePopup();
    setMoved(true);
    setPage((p) => (p + dir + pages) % pages);
  };

  // The last page is aligned to the end, like the real slider.
  const offset = Math.max(0, Math.min(page * perPage, total - perPage));
  const translate = -(offset * 100) / perPage;
  const showControls = !touch && total > perPage;

  return (
    <section className={`row row--${row.type}`} aria-label={row.title}>
      <h2 className="row__header">
        {exploreHref ? (
          <Link to={exploreHref} className="row__title row__title--link">
            <span>{row.title}</span>
            <span className="row__explore">
              Explore All <ChevronRightIcon />
            </span>
          </Link>
        ) : (
          <span className="row__title">{row.title}</span>
        )}
        {showControls ? (
          <ul className="row__pages" aria-hidden="true">
            {Array.from({ length: pages }, (_, i) => (
              <li key={i} className={i === page ? 'active' : ''} />
            ))}
          </ul>
        ) : null}
      </h2>
      <div className={`row__container ${touch ? 'row__container--touch' : ''}`} style={{ ['--per-page' as string]: perPage }}>
        {showControls && moved ? (
          <button className="row__handle row__handle--prev" aria-label="See previous titles" onClick={() => go(-1)}>
            <ChevronLeftIcon />
          </button>
        ) : null}
        <div className="row__track" style={touch ? undefined : { transform: `translate3d(${translate}%, 0, 0)` }}>
          {row.items.map((title, index) => (
            <div className="row__item" key={`${title.id}-${index}`}>
              <TitleCard
                title={title}
                variant={row.type === 'top10' ? 'top10' : 'standard'}
                rank={row.type === 'top10' ? index + 1 : undefined}
                topTen={topTenIds?.has(title.id)}
                continueItem={row.continueItems?.[index]}
              />
            </div>
          ))}
        </div>
        {showControls ? (
          <button className="row__handle row__handle--next" aria-label="See more titles" onClick={() => go(1)}>
            <ChevronRightIcon />
          </button>
        ) : null}
      </div>
    </section>
  );
}
