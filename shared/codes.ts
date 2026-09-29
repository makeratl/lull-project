/** Invitation codes: 8 characters without 0/O/1/I, shown XXXX-XXXX. (Same scheme as wellofwyrd.) */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const isValidCode = (s: string) => new RegExp(`^[${CODE_ALPHABET}]{8}$`).test(normalizeCode(s));
export const formatCode = (s: string) => {
  const n = normalizeCode(s).slice(0, 8);
  return n.length > 4 ? `${n.slice(0, 4)}-${n.slice(4)}` : n;
};
export const inviteLink = (origin: string, code: string) => `${origin.replace(/\/$/, '')}/join?invite=${normalizeCode(code)}`;
