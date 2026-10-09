import { useState } from 'react';
import { api } from '../api/client';
import { Logo } from '../components/Logo';
import { useApp } from '../store/app';
import './Welcome.css';
import './Login.css';

/** Netflix-style sign-in page, shown when the server runs with HB_PASSWORD. */
export function Login() {
  const init = useApp((s) => s.init);
  const setAuthenticated = useApp((s) => s.setAuthenticated);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      setAuthenticated(true);
      await init();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome login">
      <div className="welcome__shade" />
      <header className="welcome__header">
        <Logo className="welcome__logo" />
      </header>
      <main className="login__box">
        <h1>Sign In</h1>
        <form onSubmit={(e) => void submit(e)}>
          <div className="login__field">
            <input
              id="password"
              type="password"
              value={password}
              autoFocus
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              placeholder=" "
            />
            <label htmlFor="password">Password</label>
          </div>
          {error ? (
            <p className="login__error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="btn btn--red login__submit" type="submit" disabled={busy || !password}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <p className="login__hint">
          This Home Blockbuster server is protected with a password. Ask the person who set it up. It is set in Settings → Security, or with the <code>HB_PASSWORD</code> setting on the server.
        </p>
      </main>
    </div>
  );
}
