import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { ProfileDTO } from '@shared/types';
import { api } from '../api/client';
import { Avatar, AVATARS } from '../components/Avatar';
import { ChevronLeftIcon, PencilIcon, PlusIcon } from '../components/Icons';
import { Logo } from '../components/Logo';
import { useApp } from '../store/app';
import './Profiles.css';

const MAX_PROFILES = 5;

type Draft = Pick<ProfileDTO, 'name' | 'avatar' | 'kids' | 'autoplayNext' | 'autoplayPreviews'> & { id?: string };

function AvatarPicker({ value, onPick, onBack }: { value: string; onPick: (id: string) => void; onBack: () => void }) {
  return (
    <div className="profiles-page profiles-page--top">
      <div className="avatar-picker">
        <div className="avatar-picker__head">
          <button className="avatar-picker__back" onClick={onBack} aria-label="Back">
            <ChevronLeftIcon />
          </button>
          <div>
            <h1>Choose profile icon</h1>
          </div>
          <Avatar id={value} className="avatar-picker__current" />
        </div>
        <h2>The Classics</h2>
        <div className="avatar-picker__grid">
          {AVATARS.map((id) => (
            <button key={id} className={`avatar-picker__item ${id === value ? 'is-active' : ''}`} onClick={() => onPick(id)} aria-label={id}>
              <Avatar id={id} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function EditProfile({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const profiles = useApp((s) => s.profiles);
  const loadProfiles = useApp((s) => s.loadProfiles);
  const selectProfile = useApp((s) => s.selectProfile);
  const currentId = useApp((s) => s.profileId);
  const toast = useApp((s) => s.toast);
  const [draft, setDraft] = useState<Draft>(initial);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isNew = !initial.id;

  const save = async (): Promise<void> => {
    if (!draft.name.trim()) {
      setError('Please enter a name');
      return;
    }
    setSaving(true);
    try {
      if (isNew) await api.createProfile({ name: draft.name, avatar: draft.avatar, kids: draft.kids });
      else await api.updateProfile(initial.id!, draft);
      await loadProfiles();
      if (!isNew && initial.id === currentId) await selectProfile(currentId);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save profile');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!initial.id) return;
    if (!window.confirm(`Delete the profile "${initial.name}"? Its history, ratings and My List will be gone forever.`)) return;
    try {
      await api.deleteProfile(initial.id);
      if (initial.id === currentId) await selectProfile(null);
      await loadProfiles();
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete profile', 'error');
    }
  };

  if (picking) {
    return (
      <AvatarPicker
        value={draft.avatar}
        onBack={() => setPicking(false)}
        onPick={(avatar) => {
          setDraft({ ...draft, avatar });
          setPicking(false);
        }}
      />
    );
  }

  return (
    <div className="profiles-page">
      <div className="edit-profile">
        <h1>{isNew ? 'Add Profile' : 'Edit Profile'}</h1>
        {isNew ? <p className="edit-profile__sub">Add a profile for another person watching Home Blockbuster.</p> : null}
        <div className="edit-profile__body">
          <button className="edit-profile__avatar" onClick={() => setPicking(true)} aria-label="Change avatar">
            <Avatar id={draft.avatar} />
            <span className="edit-profile__avatar-edit">
              <PencilIcon />
            </span>
          </button>
          <div className="edit-profile__form">
            <input
              className="edit-profile__name"
              value={draft.name}
              maxLength={30}
              placeholder="Name"
              aria-label="Profile name"
              autoFocus
              onChange={(e) => {
                setDraft({ ...draft, name: e.target.value });
                setError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && void save()}
            />
            {error ? <p className="error-text edit-profile__error">{error}</p> : null}
            <div className="edit-profile__section">
              <h3>Maturity Settings:</h3>
              <label className="checkbox">
                <input type="checkbox" checked={draft.kids} onChange={(e) => setDraft({ ...draft, kids: e.target.checked })} />
                <span>
                  Kid? <em>Only show titles rated for children (G, PG, TV-Y, TV-G, TV-PG…).</em>
                </span>
              </label>
            </div>
            {!isNew ? (
              <div className="edit-profile__section">
                <h3>Autoplay controls</h3>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={draft.autoplayNext}
                    onChange={(e) => setDraft({ ...draft, autoplayNext: e.target.checked })}
                  />
                  <span>Autoplay next episode in a series on all devices.</span>
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={draft.autoplayPreviews}
                    onChange={(e) => setDraft({ ...draft, autoplayPreviews: e.target.checked })}
                  />
                  <span>Autoplay previews while browsing on all devices.</span>
                </label>
              </div>
            ) : null}
          </div>
        </div>
        <div className="edit-profile__buttons">
          <button className="btn btn--white" onClick={() => void save()} disabled={saving}>
            {isNew ? 'Continue' : 'Save'}
          </button>
          <button className="btn btn--outline" onClick={onDone}>
            Cancel
          </button>
          {!isNew && profiles.length > 1 ? (
            <button className="btn btn--outline" onClick={() => void remove()}>
              Delete Profile
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProfileGrid({ manage }: { manage: boolean }) {
  const profiles = useApp((s) => s.profiles);
  const selectProfile = useApp((s) => s.selectProfile);
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);

  if (editing) return <EditProfile initial={editing} onDone={() => setEditing(null)} />;

  const pick = (p: ProfileDTO): void => {
    if (manage) {
      setEditing(p);
      return;
    }
    setLeaving(p.id);
    void selectProfile(p.id);
    window.setTimeout(() => navigate('/browse'), 450);
  };

  const addNew = (): void => {
    const used = new Set(profiles.map((p) => p.avatar));
    const avatar = AVATARS.find((a) => !used.has(a) && a !== 'kids-rainbow') ?? 'smile-blue';
    setEditing({ name: '', avatar, kids: false, autoplayNext: true, autoplayPreviews: true });
  };

  return (
    <div className="profiles-page">
      <header className="profiles-page__logo">
        <Logo />
      </header>
      <div className={`profile-gate ${leaving ? 'profile-gate--leaving' : ''}`}>
        <h1>{manage ? 'Manage Profiles:' : 'Who’s watching?'}</h1>
        <ul className="profile-gate__list">
          {profiles.map((p) => (
            <li key={p.id} className={leaving === p.id ? 'is-chosen' : ''}>
              <button className="profile-tile" onClick={() => pick(p)}>
                <span className="profile-tile__avatar">
                  <Avatar id={p.avatar} title={p.name} />
                  {manage ? (
                    <span className="profile-tile__edit">
                      <PencilIcon />
                    </span>
                  ) : null}
                </span>
                <span className="profile-tile__name">{p.name}</span>
              </button>
            </li>
          ))}
          {profiles.length < MAX_PROFILES ? (
            <li>
              <button className="profile-tile profile-tile--add" onClick={addNew}>
                <span className="profile-tile__avatar profile-tile__plus">
                  <PlusIcon />
                </span>
                <span className="profile-tile__name">Add Profile</span>
              </button>
            </li>
          ) : null}
        </ul>
        {manage ? (
          <button className="btn btn--white profile-gate__button" onClick={() => navigate('/profiles')}>
            Done
          </button>
        ) : (
          <button className="btn btn--outline profile-gate__button" onClick={() => navigate('/profiles/manage')}>
            Manage Profiles
          </button>
        )}
      </div>
      {leaving ? <div className="profiles-page__loader spinner" /> : null}
    </div>
  );
}

export function ProfileGate() {
  const onboarded = useApp((s) => s.system?.onboarded ?? true);
  const libraries = useApp((s) => s.libraries);
  const setActive = useApp((s) => s.setActivePreview);
  useEffect(() => setActive(null), [setActive]);
  if (!onboarded && libraries.length === 0) return <Navigate to="/welcome" replace />;
  return <ProfileGrid manage={false} />;
}

export function ManageProfiles() {
  return <ProfileGrid manage />;
}
