# Lull

A private, invite-only PWA for falling asleep:
- generated ocean, rain, fan, stream and noise soundscapes
- a sleep timer with a long fade
- a near-black dim screen
- paced breathing

Built from the design handoff in `reference/` (the spec is `reference/README.md`).

- **App:** Vite + Preact + TypeScript. Sound is generated on the device with Web Audio, except for recordings: Ocean's waves, Shore, Brook and Haunt's clips (see below).
- **Accounts:** Supabase Auth with invite codes (the wellofwyrd pattern), plus three Vercel functions in `api/`. Only admins create invites.
- **Offline-first:** once signed in, the app opens and plays with no network. Sessions are re-checked only when online and **never while sound is playing**.
- **Private by default:** sounds, mixes and settings stay on the device. The one thing saved to the account is the breathing practice log (pattern, time, length, rounds), readable only by its owner.

## Layout

| Path | What |
|---|---|
| `src/core/` | Framework-free engine: the `lull-core.js` port (`lull.ts`, `engine.ts`, `recipes.ts`), the view model, and lock-screen safe mode (`safeMode.ts`) |
| `src/ui/` | Screens, sheet, gestures, styles (design tokens are in `styles.css`) |
| `src/auth/` | Sign in, join, reset, admin, session (`session.ts`) |
| `api/` | `invite.ts` (validate), `signup.ts` (atomic redeem), `admin.ts` (invites, members, reset links) |
| `shared/codes.ts` | Invite code format (`XXXX-XXXX`, no 0/O/1/I) |
| `supabase/migrations/` | Schema, RLS and invite functions |
| `scripts/` | `bootstrap-admin.ts` (first admin), `brand.ts` (icons, lockups, social card), `haunt.sh` (Haunt's clips), `freesound.ts` + `recordings.ts` (recorded sounds) |

## Local development

```bash
npm install
supabase start          # Lull's own stack on ports 554xx (doesn't clash with wellofwyrd)
cp .env.example .env.local   # fill with the keys `supabase start` prints
npm run bootstrap       # creates ADMIN_EMAIL as admin, prints a one-time password
npm run dev             # http://localhost:5190; /api runs in-process (no `vercel dev` needed)
npm test                # vitest: timer/fade copy, breathing, mixes, safe-mode maths, WAV, codes
```

In dev, `window.lull` exposes the core for poking at state.

## Brand

- **The mark:** the moon resting on still water, with its reflection breaking up below. It's defined once in `src/brand/mark.ts`.
- **Generated assets:** `npm run brand` regenerates the app icons, favicon, `public/brand/` lockups and the `public/og.png` social card from that file. Text is converted to paths from the Cormorant files in `node_modules`.
- **Opening:** `src/ui/opening/` holds a moonrise over the water, after which the moon glides into the play button.
  - It runs about 5.4 s on a device's first launch, about 1.9 s after that, and as a plain fade under reduced motion.
  - A tap or any key skips it.
  - Force a mode with `?intro=full|short|still|off`, and hold a single frame with `&at=<seconds>`.
  - Setting `localStorage['lull.intro'] = 'off'` disables it.
- **Early explorations:** `design/logo-lab.html`, viewable in dev.

## Water

- **Stream** is generated: thousands of tiny bubbles a second, each a short tone rising in pitch as it decays, over a soft rush of noise. A bank of bubble shapes keeps generation to about 50 ms.
- **Ocean** is recorded waves breaking at random (0.7–1.3× the wave slider's spacing, with varied size, rate and angle) over the same beach heard from further off.
- **Shore** and **Brook** are field recordings, looped seamlessly, about 3 minutes each.
- **Sources:** CC0 recordings from Freesound, credited in `public/sounds/CREDITS.md`.
  - `npm run sounds:fetch` shortlists candidates into `~/Music/lull-sources/`. It needs `FREESOUND_API_KEY` in `.env.local`.
  - Listen, put the picks in `scripts/sounds.json`, then run `npm run sounds:build`. It cuts the waves at the troughs, crossfades the loops, trims the gong and normalizes loudness.
- **Memory:** recordings load only when their sound is turned on, decoded at 32 kHz (a 3-minute loop is about 45 MB decoded).
- **Safe mode:** the loop stretches to the longest active recording, up to 3 minutes, so it plays through before repeating.

## Sharing and the family tree

- **Everyone can share:** **Share Lull** in the account menu (tap "Lull") opens straight to an invite's QR code and link. A name is optional for members; the admin page still requires one.
- **Member invites:** single use, up to 5 waiting at a time, and they expire after 30 days unused. Admin invites have no limit and don't expire. An admin can stop a member sharing (**Stop sharing**).
- **The tree:** each profile's `invited_by` is whoever made the code they joined with (`shared/tree.ts` builds it).
  - Members see their own branch: names and join dates only.
  - The admin page shows the whole tree, and which member shared each waiting invite.
- **APIs:**
  - `api/share.ts` (any member): your open invites and your branch; create, name and take back your own invites.
  - `api/admin.ts`: adds the sharing switch.
  - The rules (limit, expiry, sharing off) live in the database function `create_invitation`.

## Practice log (Relax)

- **What's logged:** breathing sessions of a minute or more, finished or stopped early: pattern, start, length, rounds and whether it ran to the end. They're saved to the `relax_sessions` table and are readable, insertable and deletable only by their owner (RLS).
- **Offline:** logged on the device first (`src/core/practice.ts`, `lull.practice.<userId>`), then uploaded when online. Ids are made on the device, so a retried upload is stored once.
- **Days:** plain calendar days (midnight). Streaks count consecutive days with any practice; a streak isn't broken until today is over.
- **Daily goal:** 5, 10 or 15 minutes (default 15, set in the Relax sheet). Five a day is a well-studied amount (Balban et al., Cell Reports Medicine, 2023); fifteen fits a morning, afternoon and evening five. It doesn't restart a running session.
- **Where:** a streak line under the Relax pills opens "Your practice": the streaks, a month calendar where each day's moon waxes toward the goal (full when it's met) with a dot per session (up to three), and that day's sessions, each removable.
- **Deploying:** run `supabase db push` on the hosted project before the app update that needs the table goes out.

## Haunt

- A spooky sound: a generated wind-and-drone bed, with a scare at random every 20–90 s. Scares are whispers, screams and knocks, each at a random level and stereo position.
- **Clips:** 17 mono MP3s (~800 KB) in `public/sounds/haunt/`, precached by the service worker so Haunt works offline.
  - The voices are Chatterbox lines, pitched down and given a reversed-echo swell.
  - The screams are a cappella ACE-Step takes with added room echo.
  - The knock is synthesized.
  - `npm run haunt` rebuilds them from the raw takes; the script lists the sources and how to add a clip.
- **Live:** scares are scheduled 3 minutes ahead on the audio clock and topped up every 30 s.
- **Safe mode:** 2–3 scares are baked into the 2-minute loop, so they repeat each loop.

## Lock-screen safe mode

- On by default on iPhone/iPad, and switchable under **Sounds & timer → Playback**.
- The mix is rendered offline into a seamless loop: 32 kHz stereo, 2 minutes (about 15 MB), or up to 3 minutes when a recording is on. Rendering takes about 0.3 s on desktop.
- The loop plays through a plain `<audio loop>` element.
- iOS ignores `audio.volume`, so the timer fade is played as loop-length segments with the gain ramp baked in. They start from the exact loop position and are chained on `ended`.
- Slider changes re-render, debounced by 800 ms.
- In safe mode the fade is rounded to whole loops, so "Fading out" on screen can differ from the real fade by up to about 1 minute.

## Deploy (Vercel + Supabase): not done yet, needs your go-ahead

1. Create a Supabase project, then run `supabase link --project-ref <ref>` and `supabase db push`.
2. In Supabase → Auth settings:
   - disable "Allow new users to sign up"
   - set the minimum password length to 10
   - set Site URL to `https://lull.makeratl.com`
   - add `https://lull.makeratl.com/reset` to the redirect URLs
3. Create a Vercel project from this repo (framework: Vite) and set these env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN=https://lull.makeratl.com`.
4. Add the domain `lull.makeratl.com` in Vercel, and a DNS `CNAME lull → cname.vercel-dns.com` wherever makeratl.com's DNS lives.
5. Run `npm run bootstrap` against production env vars. That creates steven@makeratl.com as admin.
6. Sign in, go to **Sounds & timer → Invite & admin**, and create an invite.

## On-device test matrix (the part a desktop can't prove)

Run 1 h and 8 h with the screen locked, in both safe mode and Web Audio mode, across:
- {iOS Safari tab, iOS Home Screen app, Android Chrome installed}
- × {headband connected, headband disconnected mid-session}

Check that:
- the sound keeps going
- the timer fade happens and it stops
- lock-screen play/pause works
- the app opens in airplane mode

On Android, if sound stops overnight, set Chrome's battery usage to Unrestricted (the app says this too).
