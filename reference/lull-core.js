(function () {
  if (window.LullCore) return;
  const SOUNDS = [
    { id: 'ocean', name: 'Ocean', note: 'Waves, no gulls' },
    { id: 'rain', name: 'Rain', note: 'Steady shower' },
    { id: 'fan', name: 'Fan', note: 'Low whir' },
    { id: 'stream', name: 'Stream', note: 'Moving water' },
    { id: 'brown', name: 'Brown', note: 'Deep rumble' },
    { id: 'pink', name: 'Pink', note: 'Soft, balanced' },
    { id: 'white', name: 'White', note: 'Bright hiss' },
  ];
  const PATTERNS = {
    '478': { name: '4-7-8', sub: 'For falling asleep', steps: [['Breathe in', 4, 1], ['Hold', 7, 1], ['Breathe out', 8, 0]] },
    box: { name: 'Box', sub: 'Quiet a busy mind', steps: [['Breathe in', 4, 1], ['Hold', 4, 1], ['Breathe out', 4, 0], ['Hold', 4, 0]] },
    even: { name: '5-5', sub: 'Slow and even', steps: [['Breathe in', 5, 1], ['Breathe out', 5, 0]] },
  };
  const PRESETS = [
    { name: 'Just the ocean', mix: { ocean: 0.75 } },
    { name: 'Ocean & brown', mix: { ocean: 0.65, brown: 0.25 } },
    { name: 'Rain on the roof', mix: { rain: 0.7, brown: 0.3 } },
  ];
  const KEY = 'lull.v2';
  const fmt = ms => {
    const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    const p = n => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
  };
  const idb = () => new Promise((res, rej) => {
    const r = indexedDB.open('lull', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const idbAll = async () => { try { const db = await idb(); return await new Promise(res => { const q = db.transaction('files').objectStore('files').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); } catch (e) { return []; } };
  const idbTx = async (fn) => { try { const db = await idb(); await new Promise(res => { const tx = db.transaction('files', 'readwrite'); fn(tx.objectStore('files')); tx.oncomplete = res; tx.onerror = res; }); } catch (e) {} };
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  class LullCore {
    constructor(onChange, opts, React) {
      this.onChange = onChange; this.opts = opts || {}; this.React = React;
      let sv = {};
      try { sv = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
      this.s = {
        levels: sv.levels || { ocean: 0.75 }, active: sv.active || { ocean: true },
        timer: sv.timer === undefined ? 60 : sv.timer, wave: sv.wave || 11, mixes: sv.mixes || PRESETS,
        fade: sv.fade ?? null, relax: sv.relax || { p: '478', min: 5 },
        customs: [], playing: false, endsAt: null, dim: false, now: Date.now(), breath: null,
      };
      this.nodes = {}; this.buffers = {}; this.blobs = {}; this.last = Date.now();
      this.iv = setInterval(() => this.tick(), 1000);
      idbAll().then(recs => {
        recs.forEach(r => { this.blobs[r.id] = r.blob; });
        this.s.customs = recs.map(r => ({ id: r.id, name: r.name, note: 'Your recording', custom: true }));
        this.onChange();
      });
    }
    destroy() { clearInterval(this.iv); clearInterval(this.biv); try { this.el && this.el.pause(); this.ctx && this.ctx.close(); } catch (e) {} }
    set(p) { Object.assign(this.s, typeof p === 'function' ? p(this.s) : p); this.sync(); this.save(); this.onChange(); }
    save() {
      const { levels, active, timer, wave, mixes, fade, relax } = this.s;
      const j = JSON.stringify({ levels, active, timer, wave, mixes, fade, relax });
      if (j !== this.saved) { this.saved = j; try { localStorage.setItem(KEY, j); } catch (e) {} }
    }
    fadeMin() { return Number(this.s.fade ?? this.opts.fadeMinutes ?? 10); }
    setFade(v) { this.set({ fade: v }); if (this.s.playing) this.schedule(); }
    setRelax(patch) { this.set(s => ({ relax: { ...s.relax, ...patch } })); if (this.s.breath) this.startBreath(); }
    startBreath() { this.openBreath(this.s.relax.p, this.s.relax.min); }
    all() { return [...SOUNDS, ...this.s.customs]; }
    known(id) { return this.all().some(x => x.id === id); }
    activeList() { return this.all().filter(x => this.s.active[x.id]); }
    mixLabel() { const a = this.activeList(); return a.length ? a.map(x => x.name).join(' + ') : 'Nothing selected'; }

    ensureCtx() {
      if (this.ctx) return this.ctx;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.ctx = ctx;
      this.master = ctx.createGain(); this.master.gain.value = 0;
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
      // On iPhone, route through an <audio> element so playback survives the lock screen.
      try {
        if (isIOS && ctx.createMediaStreamDestination) {
          const dest = ctx.createMediaStreamDestination();
          this.master.connect(dest);
          const el = new Audio(); el.setAttribute('playsinline', ''); el.srcObject = dest.stream; this.el = el;
        } else this.master.connect(ctx.destination);
      } catch (e) { this.master.connect(ctx.destination); }
      const sr = ctx.sampleRate, len = sr * 10, fade = Math.floor(sr * 0.5), total = len + fade;
      const gen = kind => {
        const buf = ctx.createBuffer(2, len, sr);
        for (let ch = 0; ch < 2; ch++) {
          const d = new Float32Array(total);
          let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
          for (let i = 0; i < total; i++) {
            const w = Math.random() * 2 - 1;
            if (kind === 'white') d[i] = w * 0.5;
            else if (kind === 'pink') {
              b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
              b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
              d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
            } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
          }
          const out = buf.getChannelData(ch);
          for (let i = 0; i < len; i++) out[i] = d[i];
          for (let i = 0; i < fade; i++) { const a = i / fade; out[i] = d[i] * a + d[len + i] * (1 - a); }
        }
        return buf;
      };
      this.noise = { white: gen('white'), pink: gen('pink'), brown: gen('brown') };
      return ctx;
    }
    async decodeAll() {
      const ctx = this.ensureCtx();
      for (const c of this.s.customs) {
        if (!this.buffers[c.id] && this.blobs[c.id]) {
          try { this.buffers[c.id] = await ctx.decodeAudioData(await this.blobs[c.id].arrayBuffer()); } catch (e) {}
        }
      }
      this.sync();
    }
    build(id) {
      const ctx = this.ctx, B = this.noise, extra = [], srcs = [];
      const g = ctx.createGain(); g.gain.value = 0; g.connect(this.master);
      const loop = buf => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * Math.max(0, buf.duration - 0.1)); srcs.push(s); return s; };
      const filt = (type, f, q) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q != null) n.Q.value = q; return n; };
      const lfo = (rate, depth, target) => { const o = ctx.createOscillator(); o.frequency.value = rate; const og = ctx.createGain(); og.gain.value = depth; o.connect(og); og.connect(target); o.start(); extra.push(o); };
      const pipe = (...n) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); };
      let base = 1, more = {};
      switch (id) {
        case 'white': pipe(loop(B.white), g); base = 0.3; break;
        case 'pink': pipe(loop(B.pink), g); base = 0.55; break;
        case 'brown': pipe(loop(B.brown), g); base = 0.8; break;
        case 'rain': { const m = ctx.createGain(); m.gain.value = 0.9; lfo(0.13, 0.08, m.gain); pipe(loop(B.white), filt('highpass', 900, 0.5), filt('lowpass', 6500, 0.5), m, g); base = 0.5; break; }
        case 'fan': { const p = filt('peaking', 160, 1.2); p.gain.value = 5; pipe(loop(B.brown), filt('lowpass', 420, 0.7), p, g); base = 1.2; break; }
        case 'stream': { const m = ctx.createGain(); m.gain.value = 0.85; lfo(0.35, 0.15, m.gain); pipe(loop(B.pink), filt('bandpass', 1400, 0.6), m, g); base = 1.4; break; }
        case 'ocean': {
          // Asymmetric swell: slow build, quicker fall. Body = filtered brown noise; wash = hiss trailing each crest.
          const osc = ctx.createOscillator();
          osc.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, 0, 0.15]), new Float32Array([0, 1, 0.3])));
          osc.frequency.value = 1 / this.s.wave; osc.start(); extra.push(osc);
          const lp = filt('lowpass', 650, 0.5); const lm = ctx.createGain(); lm.gain.value = 450; osc.connect(lm); lm.connect(lp.frequency);
          const sw = ctx.createGain(); sw.gain.value = 0.55; const sm = ctx.createGain(); sm.gain.value = 0.45; osc.connect(sm); sm.connect(sw.gain);
          pipe(loop(B.brown), lp, sw, g);
          const dl = ctx.createDelay(10); dl.delayTime.value = this.s.wave * 0.18;
          const wg = ctx.createGain(); wg.gain.value = 0.1; const wm = ctx.createGain(); wm.gain.value = 0.1;
          osc.connect(dl); dl.connect(wm); wm.connect(wg.gain);
          pipe(loop(B.white), filt('bandpass', 2400, 0.5), wg, g);
          more = { osc, dl }; base = 1.1; break;
        }
        default:
          if (!this.buffers[id]) { g.disconnect(); return null; }
          pipe(loop(this.buffers[id]), g);
      }
      return { srcs, g, extra, base, ...more };
    }
    sync() {
      if (!this.ctx || !this.noise) return;
      const { playing, active, levels } = this.s, t = this.ctx.currentTime;
      new Set([...Object.keys(this.nodes), ...Object.keys(active)]).forEach(id => {
        const lv = levels[id] ?? 0.5, want = playing && active[id] && lv > 0;
        let n = this.nodes[id];
        if (want && !n) { n = this.build(id); if (!n) return; this.nodes[id] = n; }
        if (!n) return;
        n.g.gain.setTargetAtTime(want ? lv * n.base : 0, t, 0.25);
        if (!want) {
          delete this.nodes[id];
          setTimeout(() => { try { n.srcs.forEach(x => x.stop()); n.extra.forEach(o => o.stop()); n.g.disconnect(); } catch (e) {} }, 1500);
        }
      });
    }
    schedule() {
      if (!this.ctx) return;
      const s = this.s, t = this.ctx.currentTime, m = this.master.gain;
      m.cancelScheduledValues(t); m.setValueAtTime(m.value, t); m.linearRampToValueAtTime(1, t + 2.5);
      if (s.timer && s.endsAt) {
        const total = Math.max(3, (s.endsAt - Date.now()) / 1000);
        const fade = Math.min(this.fadeMin() * 60, s.timer * 30);
        m.setValueAtTime(1, t + Math.max(2.6, total - fade));
        m.linearRampToValueAtTime(0, t + total);
      }
    }
    play() {
      const ctx = this.ensureCtx();
      ctx.resume();
      if (this.el) this.el.play().catch(() => { try { this.master.disconnect(); } catch (e) {} this.master.connect(ctx.destination); this.el = null; });
      this.decodeAll();
      this.last = Date.now();
      const s = this.s;
      const anyOn = Object.keys(s.active).some(k => s.active[k] && this.known(k));
      const extra = anyOn ? {} : { active: { ocean: true }, levels: { ...s.levels, ocean: s.levels.ocean || 0.7 } };
      this.set({ ...extra, playing: true, endsAt: s.timer ? Date.now() + s.timer * 60000 : null });
      this.schedule(); this.media();
    }
    stop() {
      if (this.ctx) { const t = this.ctx.currentTime, m = this.master.gain; m.cancelScheduledValues(t); m.setValueAtTime(m.value, t); m.linearRampToValueAtTime(0, t + 1); }
      this.set({ playing: false, endsAt: null, dim: false }); this.media();
      clearTimeout(this.susp);
      this.susp = setTimeout(() => { if (!this.s.playing && this.ctx) { this.ctx.suspend(); this.el && this.el.pause(); } }, 2500);
    }
    media() {
      if (!('mediaSession' in navigator)) return;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: this.mixLabel(), artist: 'Lull' });
        navigator.mediaSession.playbackState = this.s.playing ? 'playing' : 'paused';
        navigator.mediaSession.setActionHandler('play', () => this.play());
        navigator.mediaSession.setActionHandler('pause', () => this.stop());
      } catch (e) {}
    }
    tick() {
      const now = Date.now(), s = this.s;
      if (s.playing && s.endsAt && now >= s.endsAt) { this.stop(); return; }
      if (s.playing && !s.dim && !s.breath && (this.opts.autoDim ?? true) && now - this.last > 30000) s.dim = true;
      s.now = now; this.onChange();
    }
    setTimer(min) {
      const playing = this.s.playing;
      this.set({ timer: min, endsAt: playing && min ? Date.now() + min * 60000 : null });
      if (playing) this.schedule();
    }
    setWave(sec) {
      this.set({ wave: sec });
      const n = this.nodes.ocean;
      if (n && this.ctx) { const t = this.ctx.currentTime; n.osc.frequency.setTargetAtTime(1 / sec, t, 0.8); n.dl.delayTime.setTargetAtTime(sec * 0.18, t, 0.8); }
    }
    toggleSound(id) { this.set(s => ({ active: { ...s.active, [id]: !s.active[id] } })); this.media(); }
    setLevel(id, v) { this.set(s => ({ levels: { ...s.levels, [id]: v }, active: { ...s.active, [id]: v > 0 } })); }
    isCurrent(mix) {
      const s = this.s, on = Object.keys(s.active).filter(k => s.active[k] && this.known(k)), keys = Object.keys(mix);
      return on.length === keys.length && keys.every(k => s.active[k] && Math.abs((s.levels[k] ?? 0.5) - mix[k]) < 0.03);
    }
    saveMix() {
      const s = this.s, a = this.activeList().filter(x => !x.custom);
      if (!a.length) return;
      this.set({ mixes: [...s.mixes, { name: a.map(x => x.name).join(' & '), mix: Object.fromEntries(a.map(x => [x.id, s.levels[x.id] ?? 0.5])) }] });
    }
    applyMix(mix) { this.set(s => ({ active: Object.fromEntries(Object.keys(mix).map(k => [k, true])), levels: { ...s.levels, ...mix } })); this.media(); }
    async addFile(file) {
      if (!file) return;
      const id = 'file-' + Date.now(), name = file.name.replace(/\.[^.]+$/, '').slice(0, 24);
      try {
        const ctx = this.ensureCtx();
        this.buffers[id] = await ctx.decodeAudioData(await file.arrayBuffer());
      } catch (e) { alert('That file couldn’t be played. Try an MP3 or M4A.'); return; }
      this.blobs[id] = file;
      await idbTx(st => st.put({ id, name, blob: file }));
      this.set(s => ({ customs: [...s.customs, { id, name, note: 'Your recording', custom: true }], active: { ...s.active, [id]: true }, levels: { ...s.levels, [id]: 0.6 } }));
    }
    async removeFile(id) {
      await idbTx(st => st.delete(id));
      delete this.buffers[id]; delete this.blobs[id];
      this.set(s => { const a = { ...s.active }, l = { ...s.levels }; delete a[id]; delete l[id]; return { customs: s.customs.filter(c => c.id !== id), active: a, levels: l }; });
    }
    openBreath(p, min) {
      this.s.breath = { p, i: -1, ends: Date.now() + 2000, cycles: 0, until: min ? Date.now() + 2000 + min * 60000 : null };
      this.s.now = Date.now(); this.onChange();
      clearInterval(this.biv); this.biv = setInterval(() => this.btick(), 200);
    }
    btick() {
      const b = this.s.breath; if (!b) { clearInterval(this.biv); return; }
      const now = Date.now();
      if (b.until && now >= b.until) { this.closeBreath(); return; }
      if (now >= b.ends) {
        const steps = PATTERNS[b.p].steps; let i = b.i + 1;
        if (i >= steps.length) { i = 0; b.cycles++; }
        b.i = i; b.ends = now + steps[i][1] * 1000;
      }
      this.s.now = now; this.onChange();
    }
    closeBreath() { this.s.breath = null; clearInterval(this.biv); this.last = Date.now(); this.onChange(); }

    vals(T) {
      const s = this.s, now = s.now, R = this.React;
      const clock = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const name = (this.opts.name || '').trim();
      const rem = s.endsAt ? s.endsAt - now : null;
      const fadeMs = s.timer ? Math.min(this.fadeMin() * 60000, s.timer * 30000) : 0;
      let status;
      if (!s.playing) status = s.timer ? `${s.timer} min, then silence` : 'Plays all night';
      else if (rem == null) status = 'Playing all night';
      else if (rem <= fadeMs) status = `Fading out · ${fmt(rem)}`;
      else status = `Fades out in ${fmt(rem)}`;
      const oceanOn = !!s.active.ocean;
      const period = oceanOn ? s.wave : 10;
      const halo = R ? R.createElement('div', { style: Object.assign({ position: 'absolute', borderRadius: '50%', pointerEvents: 'none', opacity: s.playing ? undefined : 0, animation: s.playing ? `lullBreath ${period}s ease-in-out infinite` : 'none', transition: 'opacity 1.2s' }, T.halo || {}) }) : null;
      const b = s.breath, P = b && PATTERNS[b.p];
      const step = b ? (b.i < 0 ? ['Settle in', 2, 0] : P.steps[b.i]) : null;
      const pick = (on, a, z) => (on ? a : z) || {};
      return {
        clock, greeting: name ? `Good night, ${name}.` : 'Good night.',
        mixLabel: this.mixLabel(), playing: s.playing, notPlaying: !s.playing, playLabel: s.playing ? 'Pause' : 'Begin', status, halo,
        togglePlay: () => (s.playing ? this.stop() : this.play()),
        oceanOn, wave: s.wave, waveSlider: 25 - s.wave, waveLabel: `One wave every ${s.wave} s`,
        onWave: e => this.setWave(25 - Number(e.target.value)),
        sounds: this.all().map(x => {
          const on = !!s.active[x.id];
          return { ...x, ...pick(on, T.on, T.off), on, custom: !!x.custom, pct: Math.round((s.levels[x.id] ?? 0.5) * 100),
            onToggle: () => this.toggleSound(x.id), onVol: e => this.setLevel(x.id, Number(e.target.value) / 100), onRemove: () => this.removeFile(x.id) };
        }),
        timers: [15, 30, 60, 90, 0].map(v => ({ label: v ? `${v}m` : 'All night', long: v ? `${v} min` : 'All night', ...pick(s.timer === v, T.chipOn, T.chipOff), onPick: () => this.setTimer(v) })),
        mixes: s.mixes.map((m, i) => ({
          name: m.name,
          summary: Object.entries(m.mix).map(([k, v]) => `${(SOUNDS.find(x => x.id === k) || { name: k }).name} ${Math.round(v * 100)}`).join(' · '),
          ...pick(this.isCurrent(m.mix), T.mixOn, T.mixOff),
          onApply: () => this.applyMix(m.mix), onDelete: () => this.set(st => ({ mixes: st.mixes.filter((_, j) => j !== i) })),
        })),
        saveMix: () => this.saveMix(),
        onFile: e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; this.addFile(f); },
        patterns: Object.entries(PATTERNS).map(([id, p]) => ({ id, name: p.name, sub: p.sub, onPick: () => this.openBreath(id) })),
        breathOpen: !!b, breathName: P ? P.name : '', breathSub: P ? P.sub : '',
        breathLabel: step ? step[0] : '', breathCount: b ? Math.max(1, Math.ceil((b.ends - now) / 1000)) : '',
        breathScale: step && step[2] ? 1 : 0.5, breathDur: step ? (b.i < 0 ? 0.8 : step[1]) : 1,
        breathCycles: b && b.cycles ? `${b.cycles} ${b.cycles === 1 ? 'round' : 'rounds'}` : 'Follow the moon',
        closeBreath: () => this.closeBreath(),
        breathRunning: !!b,
        fades: [5, 10, 20].map(v => ({ label: `${v} min`, ...pick(this.fadeMin() === v, T.chipOn, T.chipOff), onPick: () => this.setFade(v) })),
        relaxPatterns: Object.entries(PATTERNS).map(([id, p]) => ({ id, name: p.name, sub: p.sub, ...pick(s.relax.p === id, T.cardOn || T.chipOn, T.cardOff || T.chipOff), chip: pick(s.relax.p === id, T.chipOn, T.chipOff), onPick: () => this.setRelax({ p: id }) })),
        relaxLengths: [3, 5, 10, 0].map(v => ({ label: v ? `${v} min` : 'Open', ...pick(s.relax.min === v, T.chipOn, T.chipOff), onPick: () => this.setRelax({ min: v }) })),
        relaxName: PATTERNS[s.relax.p].name, relaxSub: PATTERNS[s.relax.p].sub,
        relaxLabel: step ? step[0] : 'Tap the moon to begin',
        relaxCount: b ? Math.max(1, Math.ceil((b.ends - now) / 1000)) : '',
        relaxMeta: b ? (b.until ? `${fmt(b.until - now)} left${b.cycles ? ' · ' + b.cycles + (b.cycles === 1 ? ' round' : ' rounds') : ''}` : (b.cycles ? `${b.cycles} ${b.cycles === 1 ? 'round' : 'rounds'}` : 'Follow the moon')) : (s.relax.min ? `${s.relax.min} minute session` : 'Open session'),
        dim: s.dim, goDim: () => { this.s.dim = true; this.onChange(); },
        wake: () => { this.last = Date.now(); this.s.dim = false; this.onChange(); },
        touch: () => { this.last = Date.now(); },
        dimBig: rem != null ? fmt(rem) : clock, dimSmall: rem != null ? 'until silence · tap to wake' : 'playing all night · tap to wake',
      };
    }
  }
  window.LullCore = LullCore;
})();
