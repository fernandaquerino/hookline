'use client';

import { type FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError, post } from '@/lib/api';

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/auth/login', { password });
      const next = params.get('next');
      // Only follow same-site relative paths.
      window.location.assign(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'INVALID_CREDENTIALS'
          ? 'Wrong password.'
          : e instanceof Error
            ? e.message
            : 'Sign-in failed.',
      );
      setBusy(false);
    }
  };

  return (
    <form className="card login-card" onSubmit={(e) => void submit(e)}>
      <h1>
        <span className="brand-mark" aria-hidden="true">
          ⤳
        </span>{' '}
        Hookline
      </h1>
      <p className="muted">Sign in with the admin password.</p>
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
        />
      </label>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="button primary" disabled={busy || password.length === 0}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="login">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
