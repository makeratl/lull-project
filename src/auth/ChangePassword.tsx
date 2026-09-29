import { useState } from 'preact/hooks';
import { Field } from './SignIn';
import { AuthError, changePassword } from './session';

/** Inline "Change password" for the Account section of the Sleep sheet. */
export function ChangePassword({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const reset = () => {
    setCurrent('');
    setNext('');
    setError('');
  };

  if (!open)
    return (
      <div class="row-between">
        <button class="link" onClick={() => { setOpen(true); setDone(false); }}>Change password</button>
        {done && <span class="note" role="status">Password changed.</span>}
      </div>
    );

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await changePassword(email, current, next);
      reset();
      setOpen(false);
      setDone(true);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="form" onSubmit={submit}>
      {/* Lets password managers attach the new password to the right account. */}
      <input type="email" autocomplete="username" value={email} readOnly hidden />
      <Field label="Current password" type="password" autocomplete="current-password" value={current} onInput={setCurrent} />
      <Field label="New password (10+ characters)" type="password" autocomplete="new-password" minLength={10} value={next} onInput={setNext} />
      {error && <span class="error" role="alert">{error}</span>}
      <div class="actions">
        <button class="btn-primary" type="submit" disabled={busy} style={{ flex: 1, padding: '0 20px' }}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
        <button class="btn-quiet" type="button" onClick={() => { reset(); setOpen(false); }} style={{ height: '48px', lineHeight: '48px' }}>
          Cancel
        </button>
      </div>
    </form>
  );
}
