import { useEffect, useState } from 'preact/hooks';
import { formatCode, isValidCode } from '../../shared/codes';
import { AuthPage, Field } from './SignIn';
import { api, ApiError, AuthError, signIn, type Me } from './session';

const MESSAGES: Record<string, string> = {
  bad_format: 'That doesn’t look like an invite code.',
  not_found: 'That invite code wasn’t found.',
  used: 'That invite has already been used.',
  revoked: 'That invite is no longer valid. Ask for a new one.',
  expired: 'That invite has expired. Ask for a new one.',
  rate_limited: 'Too many tries. Wait a few minutes and try again.',
  email_taken: 'That email already has an account. Sign in instead.',
  weak_password: 'Choose a longer password (at least 10 characters).',
  invalid_input: 'Check your name, email and password (at least 10 characters).',
};
const message = (e: unknown) => (e instanceof ApiError ? MESSAGES[e.code] : e instanceof AuthError ? e.message : null) ?? 'Something went wrong. Try again.';

export function Join({ onDone }: { onDone: (me: Me) => void }) {
  const [code, setCode] = useState(() => formatCode(new URLSearchParams(location.search).get('invite') ?? ''));
  const [inviter, setInviter] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const check = async (c = code) => {
    if (!isValidCode(c)) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ inviterName: string }>('/api/invite', { method: 'POST', body: JSON.stringify({ code: c }) });
      setInviter(r.inviterName);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { check(); }, []);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!inviter) return check();
    setBusy(true);
    setError('');
    try {
      await api('/api/signup', { method: 'POST', body: JSON.stringify({ code, name, email, password }) });
      onDone(await signIn(email, password));
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  return (
    <AuthPage
      title={inviter ? 'You’re invited.' : 'Join Lull'}
      lede={inviter ? `Invited by ${inviter}. Make your account, and Lull is yours on this device.` : 'Enter the invite code you were sent.'}
    >
      <form class="form" onSubmit={submit}>
        {!inviter ? (
          <Field label="Invite code" autocomplete="off" value={code} onInput={v => setCode(formatCode(v))} />
        ) : (
          <>
            <span class="code">{formatCode(code)}</span>
            <Field label="Your name" autocomplete="given-name" value={name} onInput={setName} />
            <Field label="Email" type="email" autocomplete="email" value={email} onInput={setEmail} />
            <Field label="Password (10+ characters)" type="password" autocomplete="new-password" minLength={10} value={password} onInput={setPassword} />
          </>
        )}
        {error && <span class="error" role="alert">{error}</span>}
        <button class="btn-primary" type="submit" disabled={busy}>
          {busy ? 'One moment…' : inviter ? 'Create account' : 'Check code'}
        </button>
      </form>
      <a class="muted" href="/">I already have an account</a>
    </AuthPage>
  );
}
