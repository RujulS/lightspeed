// Sound: music from files listed in public/music/tracks.json, and sound effects synthesised live with
// Web Audio (no sample files): launch ignition, countdown blips, planet flybys, rock fields, arrival and
// a low drone while the engines burn. Browsers only allow audio after the first click or key press, so
// nothing starts before that. Choices are remembered in localStorage when it is available.

const store = {
  get(k, d) { try { const v = localStorage.getItem('ls-' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ls-' + k, JSON.stringify(v)); } catch { /* private mode etc. */ } },
};

export class Sound {
  constructor() {
    this.sfxOn = store.get('sfx', true);
    this.musicOn = store.get('music', true);
    this.track = store.get('track', null);
    this.volume = store.get('volume', 0.6);
    this.tracks = [];
    this.ctx = null;
    this.audio = new Audio();
    this.audio.loop = true;
    this.audio.preload = 'none';
    this.ready = fetch('music/tracks.json').then((r) => (r.ok ? r.json() : [])).catch(() => []).then((t) => {
      this.tracks = Array.isArray(t) ? t : [];
      if (!this.tracks.some((x) => x.file === this.track)) this.track = this.tracks[0]?.file ?? null;
    });
    const unlock = () => { this.start(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  // ---------------------------------------------------------------- set-up (on the first gesture)
  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.out = ctx.createDynamicsCompressor(); // keeps stacked effects from clipping
    this.out.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxOn ? 1 : 0;
    this.sfx.connect(this.out);
    this.music = ctx.createGain();
    this.music.gain.value = 0;
    ctx.createMediaElementSource(this.audio).connect(this.music);
    this.music.connect(this.out);
    // two seconds of white noise, the raw material of every rumble and whoosh
    const n = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    // the engine drone runs all the time; engine(level) only turns its volume up and down
    this.drone = ctx.createGain();
    this.drone.gain.value = 0;
    const src = this.noiseSource(true), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 110; lp.Q.value = 0.7;
    const hum = ctx.createOscillator();
    hum.frequency.value = 41;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.25;
    src.connect(lp).connect(this.drone);
    hum.connect(humGain).connect(this.drone);
    this.drone.connect(this.sfx);
    src.start(); hum.start();
    this.ready.then(() => this.updateMusic());
  }

  noiseSource(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    return s;
  }

  // ---------------------------------------------------------------- settings
  setSfx(on) {
    this.sfxOn = on; store.set('sfx', on);
    if (this.ctx) this.sfx.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }
  setMusic(on) { this.musicOn = on; store.set('music', on); this.start(); this.updateMusic(); }
  setTrack(file) { this.track = file; store.set('track', file); this.start(); this.updateMusic(true); }
  setVolume(v) { this.volume = v; store.set('volume', v); this.updateMusic(); }

  updateMusic(restart = false) {
    if (!this.ctx) return;
    const want = this.musicOn && this.track;
    const t = this.ctx.currentTime;
    if (want) {
      const url = 'music/' + this.track;
      if (restart || !this.audio.src.endsWith(encodeURI(url))) { this.audio.src = url; this.audio.currentTime = 0; }
      this.audio.play().catch(() => {});
      this.music.gain.cancelScheduledValues(t);
      this.music.gain.setTargetAtTime(this.volume * 0.8, t, 0.6); // fade in
    } else {
      this.music.gain.cancelScheduledValues(t);
      this.music.gain.setTargetAtTime(0, t, 0.3);
      setTimeout(() => { if (!this.musicOn || !this.track) this.audio.pause(); }, 1500);
    }
  }

  get live() { return this.ctx && this.sfxOn && this.ctx.state === 'running'; }

  // ---------------------------------------------------------------- effects
  /** Engines: 0 = silent … 1 = full burn. Called every frame; changes glide. */
  engine(level) {
    if (!this.ctx) return;
    this.drone.gain.setTargetAtTime(0.16 * level, this.ctx.currentTime, 0.4);
  }

  /** Countdown blip; last = the higher "go" tone. */
  beep(last = false) {
    if (!this.live) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.value = last ? 1320 : 880;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (last ? 0.5 : 0.18));
    o.connect(g).connect(this.sfx);
    o.start(t); o.stop(t + 0.6);
  }

  /** Booster ignition: a deep thump, a roar that opens up, crackle on top, then a long fade. */
  ignition() {
    if (!this.live) return;
    const c = this.ctx, t = c.currentTime, dur = 6;
    // roar: low-passed noise whose cutoff jumps open and settles
    const roar = this.noiseSource(true), lp = c.createBiquadFilter(), rg = c.createGain();
    lp.type = 'lowpass'; lp.Q.value = 0.9;
    lp.frequency.setValueAtTime(80, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + 0.35);
    lp.frequency.exponentialRampToValueAtTime(260, t + 2.5);
    rg.gain.setValueAtTime(0, t);
    rg.gain.linearRampToValueAtTime(0.9, t + 0.12);
    rg.gain.setTargetAtTime(0.45, t + 0.6, 0.8);
    rg.gain.setTargetAtTime(0, t + 2.8, 1.1);
    roar.connect(lp).connect(rg).connect(this.sfx);
    roar.start(t); roar.stop(t + dur);
    // thump: a falling sine
    const o = c.createOscillator(), og = c.createGain();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.8);
    og.gain.setValueAtTime(0.9, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(og).connect(this.sfx);
    o.start(t); o.stop(t + 1.7);
    // crackle: high-passed noise chopped by a fast random-ish tremolo
    const cr = this.noiseSource(true), hp = c.createBiquadFilter(), cg = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    hp.type = 'highpass'; hp.frequency.value = 2400;
    cg.gain.setValueAtTime(0, t);
    cg.gain.linearRampToValueAtTime(0.12, t + 0.2);
    cg.gain.setTargetAtTime(0, t + 1.6, 0.7);
    lfo.type = 'square'; lfo.frequency.value = 23;
    lg.gain.value = 0.08;
    lfo.connect(lg).connect(cg.gain);
    cr.connect(hp).connect(cg).connect(this.sfx);
    cr.start(t); lfo.start(t); cr.stop(t + dur); lfo.stop(t + dur);
  }

  /** A body sweeping past: a filtered whoosh that pans across and peaks after `lead` seconds. */
  whoosh(lead = 1, { gain = 0.55, low = 220, high = 1700, len = 2.6 } = {}) {
    if (!this.live) return;
    const c = this.ctx, t = c.currentTime, peak = t + lead, end = peak + len * 0.6;
    const src = this.noiseSource(true), bp = c.createBiquadFilter(), g = c.createGain(), pan = c.createStereoPanner();
    bp.type = 'bandpass'; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(low, t);
    bp.frequency.exponentialRampToValueAtTime(high, peak);
    bp.frequency.exponentialRampToValueAtTime(low * 0.8, end);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, peak);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    const side = Math.random() < 0.5 ? -1 : 1;
    pan.pan.setValueAtTime(-0.8 * side, t);
    pan.pan.linearRampToValueAtTime(0.8 * side, end);
    src.connect(bp).connect(g).connect(pan).connect(this.sfx);
    src.start(t); src.stop(end + 0.1);
  }

  /** A field of rocks streaming past: a scatter of small whooshes over `dur` seconds. */
  rocks(dur = 8) {
    if (!this.live) return;
    for (let i = 0; i < 14; i++) {
      const at = Math.random() * dur * 0.8;
      setTimeout(() => this.whoosh(0.25, { gain: 0.12 + Math.random() * 0.12, low: 400, high: 2600 + Math.random() * 1500, len: 0.8 }), at * 1000);
    }
  }

  /** Arrival: a soft bell chord. */
  arrive() {
    if (!this.live) return;
    const c = this.ctx, t = c.currentTime;
    [523.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain(), at = t + i * 0.09;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.09, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 3.5);
      o.connect(g).connect(this.sfx);
      o.start(at); o.stop(at + 3.6);
    });
  }
}
