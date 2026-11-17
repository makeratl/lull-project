import { useState } from 'preact/hooks';
import { AuthError, signIn, api, type Me } from './session';
import { markSvg } from '../brand/mark';

const MARK = markSvg({ id: 'auth', bg: false });

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
        <div class="auth-mark" aria-label="Lull" role="img" dangerouslySetInnerHTML={{ __html: MARK }} />
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
  const [forgot, setForgot] = useState<'closed' | 'open' | 'sent'>('closed');

  const sendReset = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/forgot', { method: 'POST', body: JSON.stringify({ email }) });
      setForgot('sent');
    } catch {
      setError('Can’t send that right now. Try again in a little while.');
    } finally {
      setBusy(false);
    }
  };

  if (forgot !== 'closed') return (
    <AuthPage title="Forgot your password?" lede="We’ll email you a link to choose a new one.">
      {forgot === 'sent' ? (
        <p class="muted" role="status">If {email} has a Lull account, a reset link is on its way. It works once and lasts an hour; check spam if it’s slow to arrive.</p>
      ) : (
        <form class="form" onSubmit={sendReset}>
          <Field label="Email" type="email" autocomplete="email" value={email} onInput={setEmail} />
          {error && <span class="error" role="alert">{error}</span>}
          <button class="btn-primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Email me a link'}</button>
        </form>
      )}
      <button type="button" class="link" onClick={() => { setForgot('closed'); setError(''); }}>Back to sign in</button>
    </AuthPage>
  );

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
      <button type="button" class="link" onClick={() => { setForgot('open'); setError(''); }}>Forgot your password?</button>
      <p class="muted">Lull is invite-only. If you have an invite, open its link.</p>
    </AuthPage>
  );
}
