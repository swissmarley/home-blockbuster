import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Avatar, AVATARS } from '../components/Avatar';
import { ChevronRightIcon, CheckIcon } from '../components/Icons';
import { Logo } from '../components/Logo';
import { PasswordForm } from '../components/PasswordForm';
import { useApp } from '../store/app';
import { LibraryForm } from './LibraryForm';
import './Welcome.css';

type Step = 'hero' | 'profile' | 'security' | 'library' | 'scanning';

const STEPS = ['profile', 'security', 'library', 'scanning'] as const;
const STEP_LABEL: Record<(typeof STEPS)[number], string> = {
  profile: 'Your profile',
  security: 'Password',
  library: 'Your media',
  scanning: 'Scan',
};

/** Decorative wall of "posters" behind the landing hero (no artwork exists yet on first run). */
function PosterWall() {
  const tiles = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => {
        const h = (i * 47 + 11) % 360;
        return `linear-gradient(${(i * 37) % 360}deg, hsl(${h} 55% 28%), hsl(${(h + 50) % 360} 60% 12%))`;
      }),
    [],
  );
  return (
    <div className="wall" aria-hidden="true">
      <div className="wall__grid">
        {tiles.map((bg, i) => (
          <span key={i} style={{ background: bg }} />
        ))}
      </div>
    </div>
  );
}

export function Welcome() {
  const navigate = useNavigate();
  const profiles = useApp((s) => s.profiles);
  const loadProfiles = useApp((s) => s.loadProfiles);
  const loadSystem = useApp((s) => s.loadSystem);
  const scan = useApp((s) => s.scan);
  // No profile is selected yet, so count titles from the library stats (kept live over SSE).
  const titleCount = useApp((s) => s.libraries.reduce((n, l) => n + l.titleCount, 0));
  const first = profiles.find((p) => !p.kids) ?? profiles[0];
  const [step, setStep] = useState<Step>('hero');
  const [name, setName] = useState(first?.name === 'Me' ? '' : (first?.name ?? ''));
  const [avatar, setAvatar] = useState(first?.avatar ?? 'smile-blue');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const authSource = useApp((s) => s.system?.authSource ?? null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  const finish = async (): Promise<void> => {
    await api.completeOnboarding().catch(() => undefined);
    await loadSystem();
    navigate('/profiles', { replace: true });
  };

  const saveProfile = async (): Promise<void> => {
    if (first && (name.trim() || avatar !== first.avatar)) {
      setSaving(true);
      setProfileError(null);
      try {
        await api.updateProfile(first.id, { name: name.trim() || first.name, avatar });
        await loadProfiles();
      } catch (err) {
        setProfileError(err instanceof Error ? err.message : 'Could not save your profile.');
        return;
      } finally {
        setSaving(false);
      }
    }
    // A password set through HB_PASSWORD (or earlier) needs no setup step.
    setStep(authSource ? 'library' : 'security');
  };

  const scanning = Boolean(scan?.running);
  const pct = scan?.total ? Math.round((scan.processed / scan.total) * 100) : null;

  return (
    <div className="welcome">
      <PosterWall />
      <div className="welcome__shade" />
      <header className="welcome__header">
        <Logo className="welcome__logo" />
        {step !== 'scanning' ? (
          <button className="btn btn--red btn--small" onClick={() => void finish()}>
            Skip setup
          </button>
        ) : null}
      </header>

      {step === 'hero' ? (
        <main className="welcome__hero">
          <h1>Unlimited movies, TV shows, and more.</h1>
          <p className="welcome__sub">Streamed from your own drives. Watch on any screen in your home.</p>
          <p className="welcome__cta-text">Ready to watch? Point Home Blockbuster at the folders where your movies and shows live.</p>
          <button className="btn btn--red welcome__cta" onClick={() => setStep('profile')}>
            Get Started <ChevronRightIcon />
          </button>
        </main>
      ) : (
        <main className="welcome__panel">
          <ol className="welcome__steps">
            {STEPS.map((s, i) => {
              const done = (STEPS as readonly string[]).indexOf(step) > i;
              return (
                <li key={s} className={step === s ? 'is-active' : done ? 'is-done' : ''}>
                  <span>{done ? <CheckIcon /> : i + 1}</span>
                  {STEP_LABEL[s]}
                </li>
              );
            })}
          </ol>

          {step === 'profile' ? (
            <section className="welcome__card">
              <h2>Who&apos;s watching?</h2>
              <p className="welcome__muted">Create your profile. Everyone at home can get their own, each with a personal My List and history.</p>
              <div className="welcome__profile">
                <Avatar id={avatar} className="welcome__avatar" />
                <input
                  className="input"
                  placeholder="Your name"
                  aria-label="Your name"
                  value={name}
                  maxLength={30}
                  onChange={(e) => {
                    setName(e.target.value);
                    setProfileError(null);
                  }}
                  autoFocus
                />
              </div>
              {profileError ? (
                <p className="error-text" role="alert">
                  {profileError}
                </p>
              ) : null}
              <div className="welcome__avatars">
                {AVATARS.filter((a) => a !== 'kids-rainbow').map((a) => (
                  <button key={a} className={a === avatar ? 'is-active' : ''} onClick={() => setAvatar(a)} aria-label={`Avatar: ${a.replace(/-/g, ' ')}`} aria-pressed={a === avatar}>
                    <Avatar id={a} />
                  </button>
                ))}
              </div>
              <button className="btn btn--red welcome__next" disabled={saving} onClick={() => void saveProfile()}>
                Next
              </button>
            </section>
          ) : null}

          {step === 'security' ? (
            <section className="welcome__card">
              <h2>Protect it with a password?</h2>
              <p className="welcome__muted">
                Without a password, anyone on your network can open Home Blockbuster, browse the server&apos;s folders and change its settings. Each device
                signs in once. You can change this later in Settings → Security.
              </p>
              <PasswordForm hasPassword={false} submitLabel="Set password & continue" onDone={() => setStep('library')} />
              <button className="btn btn--grey welcome__next" onClick={() => setStep('library')}>
                Not now
              </button>
            </section>
          ) : null}

          {step === 'library' ? (
            <section className="welcome__card">
              <h2>Where are your videos?</h2>
              <p className="welcome__muted">
                Pick a folder on this computer, an external drive, a server or a NAS share. You can add more libraries later.
              </p>
              <LibraryForm library={null} submitLabel="Add & start scanning" onSaved={() => setStep('scanning')} />
            </section>
          ) : null}

          {step === 'scanning' ? (
            <section className="welcome__card welcome__card--center">
              <h2>{scanning ? 'Building your library…' : 'Your library is ready'}</h2>
              <p className="welcome__muted">
                {scanning
                  ? 'Reading your files, their tags and cover art, and fetching posters, artwork and details. This can take a while for big collections — you can start watching right away.'
                  : `Found ${titleCount} title${titleCount === 1 ? '' : 's'}. New files are picked up automatically.`}
              </p>
              {scanning ? (
                <>
                  <div className="welcome__progress">
                    <span style={{ width: pct !== null ? `${pct}%` : '20%' }} />
                  </div>
                  <p className="welcome__current">{scan?.current ?? scan?.message ?? ''}</p>
                </>
              ) : null}
              <button className="btn btn--red welcome__next" onClick={() => void finish()}>
                Start watching <ChevronRightIcon />
              </button>
            </section>
          ) : null}
        </main>
      )}
    </div>
  );
}
