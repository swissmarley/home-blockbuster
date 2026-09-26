import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { relativeTime } from '../lib/format';
import { useScrolled } from '../lib/hooks';
import { readLocal, writeLocal } from '../lib/storage';
import { useApp, useCurrentProfile } from '../store/app';
import { Avatar } from './Avatar';
import { BellIcon, CaretDownIcon, CloseIcon, FolderIcon, HelpIcon, LogoutIcon, PencilIcon, SearchIcon, SlidersIcon } from './Icons';
import { Logo, LogoMark } from './Logo';
import { useOpenTitle } from './titleNavigation';
import './Nav.css';

const LINKS = [
  { to: '/browse', label: 'Home' },
  { to: '/tv', label: 'TV Shows' },
  { to: '/movies', label: 'Movies' },
  { to: '/latest', label: 'New & Popular' },
  { to: '/my-list', label: 'My List' },
];

function SearchBox() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const onSearchPage = location.pathname === '/search';
  const [value, setValue] = useState(onSearchPage ? (params.get('q') ?? '') : '');
  const [open, setOpen] = useState(onSearchPage);
  const input = useRef<HTMLInputElement>(null);
  const returnTo = useRef('/browse');

  useEffect(() => {
    if (!onSearchPage) {
      returnTo.current = location.pathname + location.search;
      setValue('');
    }
  }, [onSearchPage, location.pathname, location.search]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
  }, [open]);

  const update = (next: string): void => {
    setValue(next);
    if (next.trim()) navigate(`/search?q=${encodeURIComponent(next)}`, { replace: onSearchPage });
    else if (onSearchPage) navigate(returnTo.current, { replace: true });
  };

  return (
    <div className={`search ${open ? 'search--open' : ''}`}>
      <button
        className="search__toggle"
        aria-label="Search"
        onClick={() => {
          setOpen(true);
          input.current?.focus();
        }}
      >
        <SearchIcon />
      </button>
      <input
        ref={input}
        className="search__input"
        value={value}
        placeholder="Titles, people, genres"
        aria-label="Search titles, people, genres"
        onChange={(e) => update(e.target.value)}
        onBlur={() => {
          if (!value) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            update('');
            setOpen(false);
            input.current?.blur();
          }
        }}
        tabIndex={open ? 0 : -1}
      />
      {value ? (
        <button className="search__clear" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={() => update('')}>
          <CloseIcon />
        </button>
      ) : null}
    </div>
  );
}

const SEEN_KEY = 'hb.notifications.seen';

function Notifications() {
  const titles = useApp((s) => s.titles);
  const openTitle = useOpenTitle();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => Number(readLocal(SEEN_KEY) ?? 0));
  const closeTimer = useRef<number>(0);
  const recent = useMemo(
    () =>
      titles
        .filter((t) => Date.now() - t.addedAt < 30 * 86_400_000)
        .sort((a, b) => b.addedAt - a.addedAt)
        .slice(0, 12),
    [titles],
  );
  const unread = recent.filter((t) => t.addedAt > seen).length;

  const show = (): void => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = (): void => {
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      if (recent[0]) {
        writeLocal(SEEN_KEY, String(recent[0].addedAt));
        setSeen(recent[0].addedAt);
      }
    }, 250);
  };

  return (
    <div className="notif" onMouseEnter={show} onMouseLeave={hide}>
      <button className="notif__bell" aria-label={`Notifications${unread ? ` (${unread} new)` : ''}`} onClick={() => (open ? hide() : show())}>
        <BellIcon />
        {unread ? <span className="notif__count">{unread > 9 ? '9+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="dropdown notif__menu" role="menu">
          <span className="dropdown__arrow" />
          {recent.length === 0 ? (
            <p className="notif__empty">No recent notifications</p>
          ) : (
            recent.map((t) => (
              <button key={t.id} className="notif__item" role="menuitem" onClick={() => openTitle(t.id)}>
                <span className="notif__img">
                  {t.images.card || t.images.backdrop || t.images.thumb || t.images.poster ? (
                    <img src={(t.images.card || t.images.backdrop || t.images.thumb || t.images.poster)!} alt="" loading="lazy" />
                  ) : null}
                </span>
                <span className="notif__text">
                  <span>New Arrival</span>
                  <strong>{t.name}</strong>
                  <em>{relativeTime(t.addedAt)}</em>
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function ProfileMenu() {
  const profiles = useApp((s) => s.profiles);
  const selectProfile = useApp((s) => s.selectProfile);
  const authRequired = useApp((s) => s.auth.required);
  const current = useCurrentProfile();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number>(0);
  if (!current) return null;

  const show = (): void => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = (): void => {
    closeTimer.current = window.setTimeout(() => setOpen(false), 200);
  };

  const signOut = async (): Promise<void> => {
    await selectProfile(null);
    if (authRequired) {
      await api.logout().catch(() => undefined);
      window.location.href = '/';
      return;
    }
    navigate('/profiles');
  };

  return (
    <div className={`account ${open ? 'account--open' : ''}`} onMouseEnter={show} onMouseLeave={hide}>
      <button className="account__button" aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? setOpen(false) : show())}>
        <Avatar id={current.avatar} className="account__avatar" title={current.name} />
        <CaretDownIcon className="account__caret" />
      </button>
      {open ? (
        <div className="dropdown account__menu" role="menu">
          <span className="dropdown__arrow" />
          <ul className="account__profiles">
            {profiles
              .filter((p) => p.id !== current.id)
              .map((p) => (
                <li key={p.id}>
                  <button
                    role="menuitem"
                    onClick={async () => {
                      setOpen(false);
                      await selectProfile(p.id);
                      navigate('/browse');
                    }}
                  >
                    <Avatar id={p.avatar} className="account__menu-avatar" />
                    <span>{p.name}</span>
                  </button>
                </li>
              ))}
            <li>
              <button role="menuitem" onClick={() => navigate('/profiles/manage')}>
                <span className="account__icon">
                  <PencilIcon />
                </span>
                <span>Manage Profiles</span>
              </button>
            </li>
            <li>
              <button role="menuitem" onClick={() => navigate('/settings/libraries')}>
                <span className="account__icon">
                  <FolderIcon />
                </span>
                <span>Media Libraries</span>
              </button>
            </li>
            <li>
              <button role="menuitem" onClick={() => navigate('/settings/metadata')}>
                <span className="account__icon">
                  <SlidersIcon />
                </span>
                <span>Settings</span>
              </button>
            </li>
            <li>
              <button role="menuitem" onClick={() => navigate('/settings/about')}>
                <span className="account__icon">
                  <HelpIcon />
                </span>
                <span>Help Center</span>
              </button>
            </li>
          </ul>
          <button className="account__signout" role="menuitem" onClick={() => void signOut()}>
            <LogoutIcon />
            {authRequired ? 'Sign out of Home Blockbuster' : 'Switch Profiles'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MobileMenu() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const current = LINKS.find((l) => location.pathname.startsWith(l.to))?.label ?? 'Browse';
  useEffect(() => setOpen(false), [location.pathname]);
  return (
    <div className="mobile-menu" onMouseLeave={() => setOpen(false)}>
      <button className="mobile-menu__button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {current === 'Home' ? 'Browse' : current}
        <CaretDownIcon />
      </button>
      {open ? (
        <div className="dropdown mobile-menu__list">
          <span className="dropdown__arrow dropdown__arrow--center" />
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {l.label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Nav() {
  const scrolled = useScrolled(0);
  const profiles = useApp((s) => s.profiles);
  const current = useCurrentProfile();
  const selectProfile = useApp((s) => s.selectProfile);
  const navigate = useNavigate();
  const kidsProfile = profiles.find((p) => p.kids && p.id !== current?.id);

  return (
    <header className={`nav ${scrolled ? 'nav--solid' : ''}`}>
      <Link to="/browse" className="nav__logo" aria-label="Home Blockbuster home">
        <Logo className="nav__logo-full" />
        <LogoMark className="nav__logo-mark" />
      </Link>
      <nav className="nav__links" aria-label="Primary">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'active' : '')}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <MobileMenu />
      <div className="nav__right">
        <SearchBox />
        {kidsProfile && !current?.kids ? (
          <button
            className="nav__kids"
            onClick={async () => {
              await selectProfile(kidsProfile.id);
              navigate('/browse');
            }}
          >
            Kids
          </button>
        ) : null}
        <Notifications />
        <ProfileMenu />
      </div>
    </header>
  );
}
