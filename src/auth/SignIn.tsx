import { useState } from 'preact/hooks';
import { AuthError, signIn, type Me } from './session';

export function Field(props: { label: string; type?: string; value: string; onInput: (v: string) => void; autocomplete?: string; minLength?: number }) {
  return (
    <label class="field">
      <span class="label">{props.label}</span>
      <input
        type={props.type ?? 'text'}
        value={props.value}
        autocomplete={props.autocomplete}
        minLength={props.minLength}
        required
        onInput={e => props.onInput((e.target as HTMLInputElement).value)}
      />
    </label>
  );
}

export function AuthPage({ title, lede, children }: { title: string; lede?: string; children: preact.ComponentChildren }) {
  return (
    <main class="page center">
      <div class="page-inner">
        <span class="brand">Lull</span>
        <h1>{title}</h1>
        {lede && <p class="lede">{lede}</p>}
        {children}
      </div>
    </main>
  );
}

export function SignIn({ onDone }: { onDone: (me: Me) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onDone(await signIn(email, password));
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthPage title="Welcome back." lede="Sign in once on this device. After that, Lull works offline.">
      <form class="form" onSubmit={submit}>
        <Field label="Email" type="email" autocomplete="email" value={email} onInput={setEmail} />
        <Field label="Password" type="password" autocomplete="current-password" value={password} onInput={setPassword} />
        {error && <span class="error" role="alert">{error}</span>}
        <button class="btn-primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p class="muted">Lull is invite-only. If you have an invite, open its link. Forgot your password? Ask whoever invited you for a reset link.</p>
    </AuthPage>
  );
}
