import type { Me } from '../auth/session';
import { ChangePassword } from '../auth/ChangePassword';

/** The account menu, opened from the "Lull" wordmark: global, so it lives outside the screens' sheets. */
export function AccountMenu({ me, onClose, onSignOut, onAdmin }: { me: Me; onClose: () => void; onSignOut: () => void; onAdmin: () => void }) {
  return (
    <>
      <div class="menu-backdrop" onClick={onClose} />
      <div class="menu" role="dialog" aria-label="Account">
        <div class="menu-who">
          <span class="menu-name">{me.name}</span>
          <span class="note">{me.email}</span>
          {me.role === 'admin' && <span class="badge menu-role">Admin</span>}
        </div>
        {me.role === 'admin' && (
          <button class="menu-item" onClick={onAdmin}>
            <span>People &amp; invites</span>
            <span class="menu-chev" aria-hidden="true" />
          </button>
        )}
        <div class="menu-block">
          <ChangePassword email={me.email} />
        </div>
        <button class="menu-item quiet" onClick={onSignOut}>Sign out</button>
      </div>
    </>
  );
}
