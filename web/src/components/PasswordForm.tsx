import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useApp } from '../store/app';
import './PasswordForm.css';

/**
 * Set, change or remove the password that protects the whole app.
 * With `hasPassword`, the current password must be entered first.
 */
export function PasswordForm({
  hasPassword,
  submitLabel,
  onDone,
}: {
  hasPassword: boolean;
  submitLabel?: string;
  onDone?: (protectedNow: boolean) => void;
}) {
  const toast = useApp((s) => s.toast);
  const loadSystem = useApp((s) => s.loadSystem);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (next: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const auth = await api.setPassword(current, next);
      useApp.setState({ auth: { required: auth.required, authenticated: true } });
      await loadSystem();
      setCurrent('');
      setPassword('');
      setConfirm('');
      toast(
        !next ? 'Password removed.' : hasPassword ? 'Password changed. Other devices will need to sign in again.' : 'Password set. Each device asks for it once.',
        'success',
      );
      onDone?.(auth.required);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the password');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    void apply(password);
  };

  return (
    <form className="password-form" onSubmit={submit}>
      {hasPassword ? (
        <label className="password-form__field">
          <span className="field-label">Current password</span>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
      ) : null}
      <label className="password-form__field">
        <span className="field-label">{hasPassword ? 'New password' : 'Password'}</span>
        <input className="input" type="password" autoComplete="new-password" minLength={4} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label className="password-form__field">
        <span className="field-label">Confirm password</span>
        <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="password-form__buttons">
        <button className="btn btn--red" type="submit" disabled={busy || !password || (hasPassword && !current)}>
          {submitLabel ?? (hasPassword ? 'Change password' : 'Set password')}
        </button>
        {hasPassword ? (
          <button className="btn btn--grey" type="button" disabled={busy || !current} onClick={() => void apply('')}>
            Remove password
          </button>
        ) : null}
      </div>
    </form>
  );
}
