# Handoff: Lull, a private sleep-sound PWA

## Overview
Lull is a private, single-user web app (PWA) for falling asleep. It plays generated ocean, nature and noise soundscapes through Bluetooth sleep headphones. It has a sleep timer with a long fade-out, a near-black bedtime screen, and paced breathing. It replaces the parts of a commercial sleep app that the user actually relied on. No account, no server, no subscription.

- **Primary user:** iPhone (Safari) with a Bluetooth sleep headband. Her go-to is **ocean waves only, no seagulls**, with the wave rhythm adjustable.
- **Secondary user:** Android (Chrome). The same hosted app, installed separately.
- **Out of scope for v1:** guided meditations (voice content), accounts, and syncing between devices.

## About the design files
`reference/` holds an **HTML prototype that already works**: real audio, timers, breathing and storage. Treat it as the reference for both behavior and visual design. It is not production code to ship as-is: the `.dc.html` file runs on a design-tool runtime (`support.js`) that shouldn't go into production.

**Rebuild it as a small standalone PWA.** Suggested stack: Vite with TypeScript, using either no framework or Preact/React. Keep the audio engine as a framework-free module. `reference/lull-core.js` is already written that way and can be ported to TypeScript almost line for line.

To view the reference, serve the `reference/` folder over HTTP (e.g. `npx serve reference`) and open `Lull.dc.html`.

## Fidelity
**High fidelity.** Colors, type, spacing, copy and motion are final. Match them.

---

## Screens

The app is a fixed full-viewport shell (`position:fixed; inset:0; overflow:hidden`) with:
- a top bar,
- a horizontal 2-screen track (Sleep | Relax), switched by swiping left/right,
- a bottom sheet opened by swiping up, whose content depends on the current screen,
- a black "dim" overlay.

Every edge respects the notch and home-bar safe areas (`env(safe-area-inset-*)`).

### Top bar (always visible)
Absolute at the top, padding `calc(18px + safe-top) 22px 0`. It's a 3-column grid (`1fr auto 1fr`):
- **Left:** "Lull", Cormorant Garamond italic 500, 24px, `#cdd8ea`.
- **Center:** the tabs "Sleep" and "Relax", 22px apart. Each tab is Cormorant 500 20px. Active tab: `#f4f6fa` with a 5px dot `#cdd8ea` underneath. Inactive tab: `#7d8494`, no dot. Tabs are tappable, min height 44px.
- **Right:** the current time (e.g. "11:42 PM"), Newsreader 14px, `#969dab`, tabular numbers.

### Screen 1: Sleep
Column, centered with `justify-content: safe center`. Padding `calc(78px + safe-top) 24px calc(84px + safe-bottom)`. Gap `clamp(14px, 3.6vh, 34px)`. Contents, top to bottom:
1. **Greeting:** "Good night." (or "Good night, {name}." if a name is set). Cormorant 400, `clamp(34px, 5.4vh, 44px)`, line-height 1.02, `#f1f3f7`, `text-wrap: balance`.
2. **Moon play button:** a circle `min(208px, 30vh)`, `flex:none`.
   - Background `radial-gradient(circle at 38% 34%, #f5f7fb, #cfd8e6 58%, #aeb9cc)`.
   - Shadow `0 0 100px rgba(205,216,234,.22), inset -12px -16px 34px rgba(60,72,96,.25)`.
   - Icon in `#1a1f2b`: a play triangle (37×48) or two pause bars (9×40, radius 3, gap 12).
   - **Halo:** a 1px ring `rgba(205,216,234,.6)` at inset −20px. While playing it runs `lullBreath` (below) with duration = the wave period when Ocean is on, otherwise 10s. It's hidden when stopped.
3. **Mix label:** active sound names joined with " + " (e.g. "Ocean + Brown"), or "Nothing selected". Cormorant 500 26px, `#e8ebf1`.
4. **Status line:** Newsreader 16px, `#a8afbb`, tabular numbers. Exact copy:
   - Stopped: "60 min, then silence" or "Plays all night".
   - Playing with a timer: "Fades out in 42:10". Inside the fade window: "Fading out · 3:12".
   - Playing without a timer: "Playing all night".
5. **"Dim screen" pill:** only while playing, in a reserved 44px-tall slot. 36px tall, radius 18, border `1px rgba(205,216,234,.2)`, Newsreader 14px, `#cdd8ea`.
6. **Sheet hint:** absolute, bottom-center at `calc(18px + safe-bottom)`. An up chevron (a 9px square with a left and top border of 1.5px `#969dab`, rotated 45°) above "Sounds & timer" in Newsreader 13px `#969dab`. Tapping it opens the sheet.

### Screen 2: Relax (breathing)
Same shell, gap `clamp(10px, 2.6vh, 28px)`.
1. **Pattern name:** e.g. "4-7-8", Cormorant 400 `clamp(34px, 5.4vh, 44px)`. Subtitle below (e.g. "For falling asleep"), Newsreader 15px `#969dab`.
2. **Breathing moon:** a container `min(250px, 28vh)` with a 1px ring `rgba(205,216,234,.14)`.
   - The disc inside fills it. Background `radial-gradient(circle at 38% 34%, #eef2f8, #c3cddd 58%, #a0acc1)`, glow `0 0 90px rgba(205,216,234,.2)`.
   - It animates `transform: scale()` between **0.5** (exhaled) and **1** (inhaled). Transition duration = the length of the current phase, ease-in-out.
   - Tapping the disc starts or stops a session.
3. **Phase label:** "Tap the moon to begin", "Settle in", "Breathe in", "Hold" or "Breathe out". Cormorant italic 36px, `#e8ebf1`.
   - Below it, the seconds left in the phase: Newsreader 20px `#b9bfca`.
   - Below that, a meta line: Newsreader 14px `#8a91a0`. Idle: "5 minute session" or "Open session". Running: "4:12 left · 3 rounds".
4. **Pattern pills:** "4-7-8", "Box", "5-5". Each is 40px tall, radius 20, Cormorant 500 18px.
   - Selected: border `rgba(205,216,234,.55)`, background `rgba(205,216,234,.1)`, text `#f4f6fa`.
   - Unselected: border `rgba(205,216,234,.12)`, transparent, text `#a8afbb`.
5. **Sheet hint:** "Session & sound", styled like the Sleep hint.

### Bottom sheet
- **Backdrop:** `rgba(5,6,10,.62)`; tapping it closes the sheet.
- **Sheet:** 88% tall. Background `#161a23`, top corners radius 26, top border `1px rgba(205,216,234,.1)`, shadow `0 -24px 60px rgba(0,0,0,.45)`.
- **Header** (the drag handle area): a 40×5 grabber `rgba(205,216,234,.22)`. Then the title (Cormorant 500 28px `#f1f3f7`) on the left: "Sounds & timer" on Sleep, "Session" on Relax. A "Done" pill on the right: 40px tall, background `rgba(205,216,234,.1)`.
- **Body:** scrolls. Padding `4px 22px calc(36px + safe-bottom)`, gap 30px between sections.
- **Section labels:** Newsreader 500 12px, uppercase, letter-spacing .16em, `#969dab`.

**Sleep sheet sections:**
- **Sleep timer:** chips "15m", "30m", "60m", "90m", "All night". Each is 44px tall, radius 22, and grows to fill the row (`flex: 1 0 auto`). Below: "Fade out over" with chips "5 min", "10 min", "20 min" (36px tall).
- **Wave rhythm:** only shown when Ocean is on.
  - A card: `#1b202a`, radius 18, padding 16/18.
  - Title "Wave rhythm" in italic Cormorant 22px, with "One wave every 11 s" on the right.
  - A range slider (5–20 s, with slow swells on the left), and the labels "Slow swells" / "Shoreline" underneath.
- **Sounds:** "+ Add your own" on the right (a file picker, `accept="audio/*"`). Below, a 2-column grid of sound tiles, gap 10.
  - Each tile: radius 18, padding `4px 14px 10px`. A tap target containing a 9px dot, the name (Cormorant 500 22px) and a note (Newsreader 13px `#8a91a0`). A volume slider (0–100) underneath.
  - Tile on: border `rgba(205,216,234,.4)`, background `rgba(205,216,234,.07)`, name `#f4f6fa`, dot `#dfe6f1` with a glow `0 0 10px rgba(205,216,234,.7)`, slider opacity 1.
  - Tile off: border `rgba(205,216,234,.08)`, background `#1b202a`, name `#b9bfca`, dot `rgba(205,216,234,.16)`, slider opacity .35.
  - Moving the slider on an off tile turns it on. Setting the level to 0 turns it off.
  - The user's own files get a "×" remove button.
- **Mixes:** "Save this mix" on the right. A list of rows with 1px dividers: dot, name (Cormorant 21px), and a summary like "Ocean 65 · Brown 25". A row whose levels match the current mix is highlighted. Each row has a "×" delete button (44×44).

**Relax sheet sections:**
- **Pattern:** 3 cards (radius 16, padding 16/18), with the name (Cormorant 26px) on the left and the subtitle on the right.
- **Session length:** "3 min", "5 min", "10 min", "Open".
- **Sound while breathing:** a card showing the current mix label, the note "Change it on the Sleep screen", and a Play/Pause pill (`#cdd8ea` background, `#141821` text).

### Dim overlay
- Solid `#000`, above everything.
- It shows the remaining time, or the current clock if playing all night: Cormorant 68px `#5d6577`.
- Below: "until silence · tap to wake" or "playing all night · tap to wake", Newsreader 13px `#3f4552`.
- Tapping anywhere dismisses it.
- It appears automatically after **30 seconds of no touches while playing**, but not during a breathing session. The "Dim screen" pill also triggers it.

---

## Interactions & gestures
- **Horizontal swipe** anywhere on the screens (ignored when starting on a slider or file picker):
  - The track follows the finger live.
  - Beyond the first/last screen there's 0.3× rubber-band resistance.
  - Releasing past 60px moves one screen.
  - Transition `transform .5s cubic-bezier(.2,.8,.2,1)`.
  - Leaving Relax ends any breathing session in progress. Sound keeps playing.
- **Vertical swipe up** past 60px opens the sheet. The sheet peeks up with the finger, up to 220px, and the backdrop fades in proportionally.
- **Sheet dismiss:** drag the header down past 90px (use pointer capture on the header), tap the backdrop, or tap Done.
- **Suppress taps after a swipe:** ignore button taps within 350 ms of a swipe ending, so a swipe across the moon doesn't toggle play.
- **Keyboard (desktop testing):** ←/→ change mode, ↑ opens the sheet, ↓ or Esc closes it.
- Set `touch-action: none` on the shell and `pan-y` on the sheet body, and disable text selection.

### Animation keyframes
```css
@keyframes lullBreath { 0%,100% { transform: scale(1); opacity: .15 } 50% { transform: scale(1.12); opacity: .55 } }
```

## Audio engine (port `reference/lull-core.js`)
All sound is **generated on the device with Web Audio**: no network and no audio files needed.
- **Noise buffers:** 10 s, stereo (the two channels are independent, which sounds wider on headphones). White; pink (Paul Kellet filter); brown (integrated with leak `(last + 0.02w)/1.02`, ×3.5).
  - Make each loop seamless by generating 0.5 s extra and crossfading the tail into the head.
  - Start each source at a random offset so layered loops don't line up.
- **Sound recipes** (each goes through its own gain, then the master):

  | Sound | Recipe | Level multiplier |
  |---|---|---|
  | White | white noise | 0.3 |
  | Pink | pink noise | 0.55 |
  | Brown | brown noise | 0.8 |
  | Rain | white → highpass 900 → lowpass 6500 → 0.13 Hz LFO (±0.08) | 0.5 |
  | Fan | brown → lowpass 420 (Q .7) → peaking 160 Hz +5 dB | 1.2 |
  | Stream | pink → bandpass 1400 (Q .6) → 0.35 Hz LFO (±0.15) | 1.4 |
  | Ocean | see below | 1.1 |

- **Ocean** (no gulls, by design):
  - A shared LFO at `1/waveSeconds` Hz, using a PeriodicWave with imag `[0,1,.3]` and real `[0,0,.15]`. That gives each wave a slow build and a quicker fall.
  - **Body:** brown → lowpass 650 Hz, with its cutoff modulated ±450 by the LFO → a swell gain of 0.55 ± 0.45.
  - **Wash:** white → bandpass 2400 → a gain of 0.1 ± 0.1, driven by the LFO through a **DelayNode of 0.18 × period**, so the hiss trails each crest.
  - Changing the wave rhythm eases the LFO frequency and delay time (`setTargetAtTime`, τ 0.8 s).
- **Level changes:** `setTargetAtTime(level × multiplier, now, 0.25)`. A sound that's turned off ramps to 0, then its nodes are stopped after 1.5 s.
- **Master:** ramps 0 → 1 over 2.5 s on play, and → 0 over 1 s on pause. The AudioContext is suspended 2.5 s after pausing.
- **Sleep timer:** schedule the whole fade **on the audio clock when play is pressed**: hold at 1 until `total − fade`, then a linear ramp to 0 at `total`. The fade is `min(fadeMinutes × 60, timerSeconds / 2)`. This matters: it still fades with the screen locked while JavaScript timers are throttled. A 1 s tick only updates the UI and does the final stop.
- **User files:** decode with `decodeAudioData`, loop, and store the original Blob in IndexedDB (db `lull`, store `files`, keyPath `id`) so files survive reloads. Show the error message "That file couldn't be played. Try an MP3 or M4A." for unsupported files.
- **Media Session:** set the title to the mix label and the artist to "Lull", and add play/pause action handlers.
- **iOS audio session:** set `navigator.audioSession.type = 'playback'` where available.

## Background playback: the #1 risk (read this)
- **Android/Chrome:** reliable with the screen off. Some manufacturers (Samsung, Xiaomi, OnePlus) kill background apps overnight; the fix is setting Chrome's battery usage to "Unrestricted". Put a note about this in the app or setup doc.
- **iOS:** continuous playback usually survives the lock screen. Known problems:
  - Home-Screen-installed web apps have had audio bugs on iOS 26 that don't happen in Safari itself.
  - After ~30 s paused in the background, play from the lock screen may not work until the app is brought back to the foreground.
- **Current mitigation in the reference:** on iOS, the Web Audio master is routed into a `MediaStreamAudioDestinationNode`, played through a hidden `<audio playsinline>` element (`el.play()` inside the tap handler). If that fails, it falls back to `ctx.destination`. This is untested on real hardware; please verify.
- **Required fallback (please build):** a "Lock-screen safe mode" setting.
  - Render the current mix offline (`OfflineAudioContext`, e.g. a 2–5 minute seamless loop, with the ocean LFO period dividing the loop length evenly) into a WAV Blob.
  - Play it with a plain `<audio loop>` element. That is iOS's most dependable background path.
  - Handle the timer fade via re-rendering or a stepped volume (iOS ignores `audio.volume`, so for the fade, render a version with the fade baked in, or cut to a fade-out segment).
  - Slider changes re-render the Blob, debounced.
- **Test matrix:** 1 hour and 8 hours with the screen locked. {iOS Safari tab, iOS Home Screen app, Android Chrome installed} × {Bluetooth headband connected, disconnected mid-session}.

## PWA requirements (not in the prototype yet)
- `manifest.webmanifest`: name "Lull", `display: standalone`, `background_color` and `theme_color` `#11141b`, portrait orientation, icons at 192/512 plus maskable versions, and a 180 px `apple-touch-icon` (a pale moon disc on `#11141b` is fine).
- A service worker that caches the app shell and fonts for full offline use. Self-host the fonts rather than loading them from Google.
- It must be served over **HTTPS** (GitHub Pages, Netlify, Cloudflare Pages: any static host works). There's no backend.
- iOS meta tags: `apple-mobile-web-app-capable`, `status-bar-style: black-translucent`, `viewport-fit=cover`.

## State & persistence
- **localStorage `lull.v2`:** `{ levels: {id: 0..1}, active: {id: bool}, timer: 15|30|60|90|0, wave: 5..20, mixes: [{name, mix}], fade: 5|10|20, relax: {p: '478'|'box'|'even', min: 3|5|10|0} }`.
  - Defaults: Ocean at 0.75 and on; 60 min timer; wave 11 s; 10 min fade; relax 4-7-8 for 5 min.
  - Preset mixes: "Just the ocean" {ocean .75}, "Ocean & brown" {ocean .65, brown .25}, "Rain on the roof" {rain .7, brown .3}.
- **IndexedDB:** the user's audio files.
- **Runtime only:** `playing`, `endsAt`, `dim`, the breath state `{p, i, ends, cycles, until}`, and UI state `mode`, `sheet`, drag offsets.
- **Play with nothing selected:** turns on Ocean at 0.7.
- Save a mix only from built-in sounds (not the user's files). Its name is the active names joined with " & ".

## Breathing patterns
| id | Name | Subtitle | Steps (label, seconds, inhaled?) |
|---|---|---|---|
| 478 | 4-7-8 | For falling asleep | Breathe in 4 ●, Hold 7 ●, Breathe out 8 ○ |
| box | Box | Quiet a busy mind | Breathe in 4 ●, Hold 4 ●, Breathe out 4 ○, Hold 4 ○ |
| even | 5-5 | Slow and even | Breathe in 5 ●, Breathe out 5 ○ |

- A session starts with a 2 s "Settle in" at scale 0.5.
- A round is counted each time the pattern wraps back to the start.
- Timed sessions end automatically.
- Changing the pattern or length during a session restarts it.

## Design tokens
**Colors:**
- Backgrounds: app `#11141b`, sheet `#161a23`, card `#1b202a`, dim `#000`.
- Text: primary `#f1f3f7` / `#e8ebf1` / `#f4f6fa`, secondary `#c3c9d4` / `#b9bfca` / `#a8afbb`, muted `#969dab` / `#8a91a0` / `#7d8494`.
- Moonlight accent: `#cdd8ea`, as `rgba(205,216,234, .08 / .1 / .12 / .2 / .4 / .55)` for lines and fills.
- Dim text: `#5d6577` / `#3f4552`.

**Type:**
- Cormorant Garamond (400, 500, italic 400/500) for display and names.
- Newsreader (optical size 6–72, 400/500) for UI text.
- Sizes: 68 / 44 / 36 / 28 / 26 / 22 / 20 / 18, then 16 / 15 / 14 / 13 / 12.

**Radii:** pills 18–22, cards 16–18, sheet 26, circles 50%.

**Hit targets:** at least 44 px.

## Files
- `reference/Lull.dc.html`: the final app layout (template plus gesture and shell logic).
- `reference/lull-core.js`: the audio engine, timer, breathing, persistence and view-model builder. **This is the main logic to port.**
- `reference/support.js`: the prototype runtime, needed only to open the reference. Don't ship it.

Earlier explorations (Tide, Mist, and the original Moonlight direction) are in the design project only and were not chosen.
