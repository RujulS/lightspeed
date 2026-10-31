// Sound: music from files listed in public/music/tracks.json, and sound effects synthesised live with
// Web Audio (no sample files): launch ignition, countdown blips, planet flybys, rock fields, arrival and
// a low drone while the engines burn. Browsers only allow audio after the first click or key press, so
// nothing starts before that. Choices are remembered in localStorage when it is available.

const store = {
  get(k, d) { try { const v = localStorage.getItem('ls-' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ls-' + k, JSON.stringify(v)); } catch { /* private mode etc. */ } },
};

/** The effects, each with its own volume: [id, label]. */
export const EFFECTS = [['countdown', 'Countdown'], ['ignition', 'Ignition'], ['engine', 'Engine'], ['warp', 'Warp bubble'], ['flyby', 'Flybys'], ['rocks', 'Rock fields'], ['arrival', 'Arrival']];

export class Sound {
  constructor() {
    this.sfxOn = store.get('sfx', true);
    this.musicOn = store.get('music', false);
    this.track = store.get('track', null);
    this.volume = store.get('volume', 0.6);
    this.levels = { ...Object.fromEntries(EFFECTS.map(([id]) => [id, 1])), ...store.get('levels', {}) };
    this.tracks = [];
    this.ctx = null;
    this.inJourney = false;
    this.audio = new Audio();
    this.audio.loop = true;
    this.audio.preload = 'none';
    // tracks.json is published; music/local/tracks.json (git-ignored) lists files kept on this machine only
    const list = (url) => fetch(url).then((r) => (r.ok ? r.json() : [])).then((t) => (Array.isArray(t) ? t : [])).catch(() => []);
    this.ready = Promise.all([list('music/tracks.json'), list('music/local/tracks.json')]).then(([pub, local]) => {
      this.tracks = [...local, ...pub];
      if (!this.tracks.some((x) => x.file === this.track)) this.track = this.tracks[0]?.file ?? null;
    });
    this.ignitionBuffer = null;
    this.ignitionLoad = fetch('audio/ignition.mp3')
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    this.flybyBuffers = [];
    this.flybyLoads = Promise.all([
      fetch('audio/flyby1.mp3').then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null),
      fetch('audio/flyby2.mp3').then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null),
    ]);
    this.lastFlybyIdx = -1;
    this.engineBuffer = null;
    this.engineSource = null;
    this.rockTimers = new Set();
    this.activeNodes = new Set();
    this.engineLoad = fetch('audio/engine.wav')
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    this.warpTravelBuffer = null;
    this.warpTravelSource = null;
    this.warpTravelLoad = fetch('audio/warp_travel.wav')
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    this.pulseBuffer = null;
    this.pulseLoad = fetch('audio/orion_pulse.wav')
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    this.warpIgnitionBuffer = null;
    this.warpIgnitionLoad = fetch('audio/warp_ignition.mp3')
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    this.warpArrivalBuffer = null;
    this.warpArrivalLoad = fetch('audio/warp_arrival.mp3')
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
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
    this.bus = {}; // one gain per effect, all into the effects master
    for (const [id] of EFFECTS) { const g = (this.bus[id] = ctx.createGain()); g.gain.value = this.levels[id]; g.connect(this.sfx); }
    this.music = ctx.createGain();
    this.music.gain.value = 0;
    ctx.createMediaElementSource(this.audio).connect(this.music);
    this.music.connect(this.out);
    if (this.ignitionLoad) {
      this.ignitionLoad.then((buf) => {
        if (buf && this.ctx) {
          this.ctx.decodeAudioData(buf.slice(0), (decoded) => { this.ignitionBuffer = decoded; }, () => {});
        }
      });
    }
    if (this.pulseLoad) {
      this.pulseLoad.then((buf) => {
        if (buf && this.ctx) {
          this.ctx.decodeAudioData(buf.slice(0), (decoded) => { this.pulseBuffer = decoded; }, () => {});
        }
      });
    }
    if (this.warpIgnitionLoad) {
      this.warpIgnitionLoad.then((buf) => {
        if (buf && this.ctx) {
          this.ctx.decodeAudioData(buf.slice(0), (decoded) => { this.warpIgnitionBuffer = decoded; }, () => {});
        }
      });
    }
    if (this.warpArrivalLoad) {
      this.warpArrivalLoad.then((buf) => {
        if (buf && this.ctx) {
          this.ctx.decodeAudioData(buf.slice(0), (decoded) => { this.warpArrivalBuffer = decoded; }, () => {});
        }
      });
    }
    if (this.flybyLoads) {
      this.flybyLoads.then(([b1, b2]) => {
        if (!this.ctx) return;
        if (b1) this.ctx.decodeAudioData(b1.slice(0), (decoded) => { this.flybyBuffers[0] = decoded; }, () => {});
        if (b2) this.ctx.decodeAudioData(b2.slice(0), (decoded) => { this.flybyBuffers[1] = decoded; }, () => {});
      });
    }
    // two seconds of white noise, the raw material of every rumble and whoosh
    const n = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    // the engine loop: plays the recorded engine sound, engine(level) scales its volume
    this.drone = ctx.createGain();
    this.drone.gain.value = 0;
    this.drone.connect(this.bus.engine);
    if (this.engineLoad) {
      this.engineLoad.then((buf) => {
        if (buf && this.ctx) {
          this.ctx.decodeAudioData(buf.slice(0), (decoded) => {
            this.engineBuffer = decoded;
            if (this.inJourney) this.startEngineLoop();
          }, () => {});
        }
      });
    }
    // the warp engine travel loop: plays the recorded warp engine travel sound, warpHum(level) scales its volume
    this.warpGain = ctx.createGain();
    this.warpGain.gain.value = 0;
    this.warpGain.connect(this.bus.warp);
    if (this.warpTravelLoad) {
      this.warpTravelLoad.then((buf) => {
        if (buf && this.ctx) {
          this.ctx.decodeAudioData(buf.slice(0), (decoded) => {
            this.warpTravelBuffer = decoded;
          }, () => {});
        }
      });
    }
    // the warp hum: a low fifth, slowly beating, under an airy high shimmer; warpHum(level) sets its volume
    this.hum = ctx.createGain();
    this.hum.gain.value = 0;
    for (const [f, k] of [[55, 0.5], [82.6, 0.3], [110.4, 0.15]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; g.gain.value = k;
      o.connect(g).connect(this.hum); o.start();
    }
    const air = this.noiseSource(true), bp = ctx.createBiquadFilter(), ag = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 3;
    ag.gain.value = 0.25;
    lfo.frequency.value = 0.4; lg.gain.value = 0.15;
    lfo.connect(lg).connect(ag.gain);
    air.connect(bp).connect(ag).connect(this.hum);
    air.start(); lfo.start();
    this.hum.connect(this.bus.warp);
    this.ready.then(() => this.updateMusic());
  }

  noiseSource(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    return s;
  }

  _trackNode(node) {
    if (!node) return;
    this.activeNodes.add(node);
    const prevEnded = node.onended;
    node.onended = (e) => {
      this.activeNodes.delete(node);
      if (prevEnded) prevEnded.call(node, e);
    };
  }

  _playSource(buf, targetBus, gain = 1.0) {
    if (!this.ctx || !buf) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(targetBus);
    this._trackNode(src);
    src.start();
    return src;
  }

  startEngineLoop() {
    if (!this.ctx || !this.engineBuffer) return;
    this.stopEngineLoop();
    const src = this.ctx.createBufferSource();
    src.buffer = this.engineBuffer;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = this.engineBuffer.duration;
    src.connect(this.drone);
    src.start(0);
    this.engineSource = src;
  }

  stopEngineLoop() {
    if (this.engineSource) {
      try { this.engineSource.stop(); } catch (e) {}
      this.engineSource = null;
    }
  }

  startWarpTravelLoop() {
    if (!this.ctx || !this.warpTravelBuffer) return;
    this.stopWarpTravelLoop();
    const src = this.ctx.createBufferSource();
    src.buffer = this.warpTravelBuffer;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = this.warpTravelBuffer.duration;
    src.connect(this.warpGain);
    src.start(0);
    this.warpTravelSource = src;
  }

  stopWarpTravelLoop() {
    if (this.warpTravelSource) {
      try { this.warpTravelSource.stop(); } catch (e) {}
      this.warpTravelSource = null;
    }
  }

  stopAll() {
    // Cancel all queued rock field whooshes
    for (const tid of this.rockTimers) clearTimeout(tid);
    this.rockTimers.clear();

    // Terminate any active transient sound effects
    for (const node of this.activeNodes) {
      try { node.stop(); } catch (e) {}
    }
    this.activeNodes.clear();

    // Kill engine sound loop
    this.stopEngineLoop();
    // Kill warp travel loop
    this.stopWarpTravelLoop();

    // Mute Web Audio gains immediately
    if (this.ctx) {
      const t = this.ctx.currentTime;
      if (this.music) {
        this.music.gain.cancelScheduledValues(t);
        this.music.gain.setValueAtTime(0, t);
      }
      if (this.drone) {
        this.drone.gain.cancelScheduledValues(t);
        this.drone.gain.setValueAtTime(0, t);
      }
      if (this.warpGain) {
        this.warpGain.gain.cancelScheduledValues(t);
        this.warpGain.gain.setValueAtTime(0, t);
      }
      if (this.hum) {
        this.hum.gain.cancelScheduledValues(t);
        this.hum.gain.setValueAtTime(0, t);
      }
    }

    // Stop and rewind background music track to 0:00
    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.currentTime = 0;
      } catch (e) {}
    }
    this.inJourney = false;
  }

  // ---------------------------------------------------------------- settings
  setSfx(on) {
    this.sfxOn = on; store.set('sfx', on);
    if (this.ctx) this.sfx.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }
  setMusic(on) { this.musicOn = on; store.set('music', on); this.start(); this.updateMusic(); }
  setTrack(file) { this.track = file; store.set('track', file); this.start(); this.updateMusic(true); }
  setVolume(v) { this.volume = v; store.set('volume', v); this.updateMusic(); }
  setInJourney(inJourney, restart = false) {
    const wasInJourney = this.inJourney;
    this.inJourney = !!inJourney;
    if (!this.inJourney) {
      this.stopAll();
    } else {
      this.updateMusic(restart || !wasInJourney);
    }
  }
  setLevel(id, v) {
    this.levels[id] = v; store.set('levels', this.levels);
    if (this.ctx) this.bus[id].gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  updateMusic(restart = false) {
    if (!this.ctx) return;
    const want = this.musicOn && this.track && this.inJourney;
    const t = this.ctx.currentTime;
    if (want) {
      const url = 'music/' + this.track;
      if (restart || !this.audio.src.endsWith(encodeURI(url))) {
        this.audio.src = url;
        this.audio.currentTime = 0;
      }
      this.audio.play().catch(() => {});
      this.music.gain.cancelScheduledValues(t);
      this.music.gain.setTargetAtTime(this.volume * 0.8, t, 0.6); // fade in
    } else {
      this.music.gain.cancelScheduledValues(t);
      this.music.gain.setValueAtTime(0, t);
      try {
        this.audio.pause();
        this.audio.currentTime = 0;
      } catch (e) {}
    }
  }

  get live() { return this.ctx && this.sfxOn && this.ctx.state === 'running'; }

  // ---------------------------------------------------------------- effects
  /** Engines: 0 = silent … 1 = full burn. Called every frame; changes glide. */
  engine(level) {
    if (!this.ctx) return;
    if (level > 0 && !this.engineSource && this.engineBuffer) {
      this.startEngineLoop();
    }
    this.drone.gain.setTargetAtTime(0.55 * level, this.ctx.currentTime, 0.06);
  }

  /** Warp engine travel sound: level 0 … 1 based on bubble & camera distance. */
  warpHum(level) {
    if (!this.ctx) return;
    if (level > 0.005 && !this.warpTravelSource && this.warpTravelBuffer) {
      this.startWarpTravelLoop();
    }
    if (this.warpGain) {
      this.warpGain.gain.setTargetAtTime(0.72 * level, this.ctx.currentTime, 0.06);
    }
    if (this.hum) {
      this.hum.gain.setTargetAtTime(0.04 * level, this.ctx.currentTime, 0.06);
    }
  }

  /** Warp ignition: plays the recorded Enterprise warp ignition sound through the warp bus. */
  warpIgnition(gain = 1.0) {
    if (!this.live) return;
    const play = (buffer) => {
      this._playSource(buffer, this.bus.warp, gain);
    };
    if (this.warpIgnitionBuffer) {
      play(this.warpIgnitionBuffer);
    } else if (this.warpIgnitionLoad) {
      this.warpIgnitionLoad.then((buf) => {
        if (buf && this.ctx) {
          this.ctx.decodeAudioData(buf.slice(0), (decoded) => {
            this.warpIgnitionBuffer = decoded;
            play(decoded);
          }, () => {});
        }
      });
    }
  }

  warpBlast() {
    this.warpIgnition();
  }

  /** The bubble forming: a deep sweep up into a bright swell. */
  warpUp() {
    if (!this.live) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(40, t);
    o.frequency.exponentialRampToValueAtTime(320, t + 2.2);
    f.type = 'lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(120, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 2.2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 1.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    o.connect(f).connect(g).connect(this.bus.warp);
    this._trackNode(o);
    o.start(t); o.stop(t + 3.5);
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
    o.connect(g).connect(this.bus.countdown);
    this._trackNode(o);
    o.start(t); o.stop(t + 0.6);
  }

  /** Booster ignition: plays the recorded booster ignition sound through the ignition bus. */
  ignition(probe) {
    const id = typeof probe === 'object' ? probe?.id : probe;
    const kind = typeof probe === 'object' ? probe?.kind : probe;
    if (['voyager', 'parker', 'warp', 'orion'].includes(id) || ['ballistic', 'cruise', 'warp'].includes(kind)) return;
    if (!this.live) return;
    if (this.ignitionBuffer) {
      this._playSource(this.ignitionBuffer, this.bus.ignition);
    } else if (this.ignitionLoad) {
      this.ignitionLoad.then((buf) => {
        if (buf && this.ctx) {
          this.ctx.decodeAudioData(buf.slice(0), (decoded) => {
            this.ignitionBuffer = decoded;
            this._playSource(decoded, this.bus.ignition);
          }, () => {});
        }
      });
    }
  }

  /** Project Orion nuclear pulse detonation: blasts an explosion timed to the orb */
  nuclearPulse(gain = 1.0) {
    if (!this.live) return;
    const play = (buffer) => {
      this._playSource(buffer, this.bus.ignition, gain * 0.95);
    };
    if (this.pulseBuffer) {
      play(this.pulseBuffer);
    } else if (this.pulseLoad) {
      this.pulseLoad.then((buf) => {
        if (buf && this.ctx) {
          this.ctx.decodeAudioData(buf.slice(0), (decoded) => {
            this.pulseBuffer = decoded;
            play(decoded);
          }, () => {});
        }
      });
    }
  }

  /** A celestial body, star, or rock field sweeping past: plays the recorded flyby sounds. */
  flyby(gain = 1.0, bus = 'flyby') {
    if (!this.live) return;
    const bufs = this.flybyBuffers.filter(Boolean);
    const targetBus = this.bus[bus] || this.bus.flyby;
    if (bufs.length) {
      this.lastFlybyIdx = (this.lastFlybyIdx + 1) % bufs.length;
      this._playSource(bufs[this.lastFlybyIdx], targetBus, gain);
    } else if (this.flybyLoads) {
      this.flybyLoads.then(([b1, b2]) => {
        if (!this.ctx) return;
        const pick = Math.random() < 0.5 ? (b1 || b2) : (b2 || b1);
        if (pick) {
          this.ctx.decodeAudioData(pick.slice(0), (d) => {
            this._playSource(d, targetBus, gain);
          }, () => {});
        }
      });
    }
  }

  /** A body or rock sweeping past: plays the recorded flyby sound. */
  whoosh(lead = 1, { gain = 0.55, bus = 'flyby' } = {}) {
    this.flyby(gain, bus);
  }

  /** A field of rocks streaming past: plays the recorded flyby sounds as rocks zap past. */
  rocks(dur = 8) {
    if (!this.live) return;
    const passes = Math.max(2, Math.min(4, Math.floor(dur / 2.4)));
    for (let i = 0; i < passes; i++) {
      const at = i * (dur / passes) + 0.15;
      const tid = setTimeout(() => {
        this.rockTimers.delete(tid);
        this.flyby(0.65, 'rocks');
      }, at * 1000);
      this.rockTimers.add(tid);
    }
  }

  /** A rock hitting the forward deflector shield: crisp kinetic impact clang + energy hiss. */
  shieldHit(intensity = 1.0) {
    if (!this.live) return;
    const c = this.ctx, t = c.currentTime;
    // 1. Sharp metallic / plasma strike (frequency dropping rapidly)
    const osc = c.createOscillator(), gOsc = c.createGain();
    osc.type = 'triangle';
    const startF = 850 + Math.random() * 600;
    osc.frequency.setValueAtTime(startF, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.11);
    gOsc.gain.setValueAtTime(0.32 * intensity, t);
    gOsc.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(gOsc).connect(this.bus.rocks);
    this._trackNode(osc);
    osc.start(t); osc.stop(t + 0.15);

    // 2. High-energy burst of sparks / shield sizzle
    const src = this.noiseSource(true), bp = c.createBiquadFilter(), gNoise = c.createGain();
    bp.type = 'bandpass'; bp.Q.value = 2.8;
    bp.frequency.setValueAtTime(2600 + Math.random() * 900, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.1);
    gNoise.gain.setValueAtTime(0.24 * intensity, t);
    gNoise.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(bp).connect(gNoise).connect(this.bus.rocks);
    this._trackNode(src);
    src.start(t); src.stop(t + 0.13);
  }

  /** Enterprise warp arrival: plays the recorded Star Trek warp drop-out arrival sound. */
  warpArrival(gain = 1.0) {
    if (!this.live) return;
    const play = (buffer) => {
      this._playSource(buffer, this.bus.arrival, gain);
    };
    if (this.warpArrivalBuffer) {
      play(this.warpArrivalBuffer);
    } else if (this.warpArrivalLoad) {
      this.warpArrivalLoad.then((buf) => {
        if (buf && this.ctx) {
          this.ctx.decodeAudioData(buf.slice(0), (decoded) => {
            this.warpArrivalBuffer = decoded;
            play(decoded);
          }, () => {});
        }
      });
    }
  }

  /** Arrival: a soft bell chord, or warp drop-out arrival for the Enterprise. */
  arrive(probe) {
    const id = typeof probe === 'object' ? probe?.id : probe;
    if (id === 'enterprise') {
      this.warpArrival();
      return;
    }
    if (!this.live) return;
    const c = this.ctx, t = c.currentTime;
    [523.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain(), at = t + i * 0.09;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.09, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 3.5);
      o.connect(g).connect(this.bus.arrival);
      this._trackNode(o);
      o.start(at); o.stop(at + 3.6);
    });
  }
}
