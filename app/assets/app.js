/* MIDI 钢琴 · 下落音符 + 粒子特效 + 背景图 */
(function () {
  'use strict';

  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d', { alpha: false });
  function $(id) { return document.getElementById(id); }

  var LOW = 21, HIGH = 108;
  var BLACK_PC = { 1: 1, 3: 1, 6: 1, 8: 1, 10: 1 };
  var COLORS = ['#4cc9f0', '#f72585', '#ffd166', '#7bf1a8', '#b892ff', '#ff9f68', '#64dfdf', '#f15bb5'];
  var VISIBLE_SECONDS = 6.5;

  var state = {
    notes: [], duration: 0, title: '', tracks: 0,
    playing: false, position: 0, speed: 1, volume: 0.8,
    keys: [], keyMap: {}, keyW: 8, kbH: 90, hitY: 0, pxPerSec: 100,
    bg: null, stars: [],
    particles: [], waves: [], ambParts: [], ambAcc: 0, hitPulse: 0,
    pedals: [], keyLabel: '', pedalOn: false,
    look: { bgBlur: 0, perfAuto: false, shape: 'capsule', fx: 'splash', gradient: 'random', pedal: true, topbar: true,
      amb: 'none', ambDensity: 1, barlines: false, fullscreen: false, sidebar: true,
      leftColor: 'red', rightColor: 'gold', dyn: true, tab: 'fx', freeMove: true, collapsed: false,
      glow: 'none', glowL: 'none', glowR: 'none', glowLevel: 1, fps: false, stats: false, guiAlpha: 72, guiColor: 'navy', lineColor: 'none', linePower: 2, mistColor: 'none', mistOn: true, mistPower: 1, mistLife: 1.2, kbLen: 20, np: { on: true, region: 'tail', count: 1, lc: '', rc: '' }, pedalMix: 60, ext: { on: false, lines: 4, alpha: 85, mpl: 0, xoff: 0, yoff: 0, lineShift: 0 }, rec: { on: false, fade: 1.0, title: true, style: 'classic', fx: 'none' },
      score: { on: true, glow: true, color: 'white', pos: 20, size: 0.9, glowLevel: 1, bgAlpha: 0.72 } },
    freePlay: false, ext: { imgs: [] }, freeBars: [], freePressed: {}, home: true, keyMarks: [], curKey: '',
    view: { zoom: 1, pan: 0, vzoom: 1 }, gesture: { pointers: {}, mode: null },
    fps: 0, fpsAcc: 0, fpsFrames: 0, dbgAcc: 0,
    prevT: 0, spawnCursor: 0, schedIndex: 0,
    startCtx: 0, dragging: false, lastFrame: 0,
    demoTried: false
  };

  // ---------------- 工具 ----------------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function lowerBound(arr, t) {
    var lo = 0, hi = arr.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (arr[mid].start < t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    c.beginPath();
    if (c.roundRect) { c.roundRect(x, y, w, h, r); return; }
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  var toastTimer = 0;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }
  function hexToRgba(hex, alpha) {
    var h = (hex || '#ffffff').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }
  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ---------------- 键盘几何 ----------------
  function layout() {
    var w = window.innerWidth, h = window.innerHeight;
    var kbH = clamp(h * 0.17, 70, 130);
    var kbW = w;
    var xOff = 0;
    var keyW = kbW / 52;
    var keys = [], map = {};
    var wi = 0;
    for (var m = LOW; m <= HIGH; m++) {
      var black = !!BLACK_PC[m % 12];
      var k;
      if (black) {
        k = { midi: m, black: true, x: xOff + wi * keyW - keyW * 0.31, w: keyW * 0.62 };
      } else {
        k = { midi: m, black: false, x: xOff + wi * keyW, w: keyW };
        wi++;
      }
      keys.push(k);
      map[m] = k;
    }
    state.keys = keys;
    state.keyMap = map;
    state.keyW = keyW;
    state.kbH = kbH;
    state.hitY = h - kbH;
    state.pxPerSec = state.hitY / VISIBLE_SECONDS;
    state.kbW = kbW;
    kbCache = null;
  }
  function noteGeom(k) {
    if (k.black) return { x: k.x + k.w * 0.16, w: k.w * 0.68 };
    return { x: k.x + k.w * 0.07, w: k.w * 0.86 };
  }

  // ---------------- 音频 ----------------
  var audio = {
    ctx: null, master: null, comp: null, low: null, voices: [],
    verb: null, verbIn: null, wet: null,
    piano: { loading: false, ready: false, done: 0, buffers: {} }
  };

  function makeImpulse(seconds, decay) {
    var rate = audio.ctx.sampleRate;
    var len = Math.floor(rate * seconds);
    var buf = audio.ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function ensureAudio() {
    if (audio.ctx) return audio.ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { toast('当前环境不支持 Web Audio'); return null; }
    audio.ctx = new AC();
    audio.comp = audio.ctx.createDynamicsCompressor();
    audio.comp.threshold.value = -20;
    audio.comp.knee.value = 22;
    audio.comp.ratio.value = 5;
    audio.comp.attack.value = 0.004;
    audio.comp.release.value = 0.28;
    audio.low = audio.ctx.createBiquadFilter();
    audio.low.type = 'lowshelf';
    audio.low.frequency.value = 180;
    audio.low.gain.value = 5;
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = state.volume;
    audio.master.connect(audio.low);
    audio.low.connect(audio.comp);
    audio.comp.connect(audio.ctx.destination);
    // 踏板用混响制造“制音器抬起”的余响，比单纯延长采样更明显
    audio.verbIn = audio.ctx.createGain();
    audio.verb = audio.ctx.createConvolver();
    audio.verb.buffer = makeImpulse(2.2, 3.0);
    audio.wet = audio.ctx.createGain();
    audio.wet.gain.value = 0.14;
    audio.verbIn.connect(audio.verb);
    audio.verb.connect(audio.wet);
    audio.wet.connect(audio.master);
    ensurePiano();
    return audio.ctx;
  }

  function stopVoice(v) {
    for (var i = 0; i < v.nodes.length; i++) {
      try { v.nodes[i].stop(); } catch (e) { /* 已停止 */ }
    }
  }
  function stopAllVoices() {
    for (var i = 0; i < audio.voices.length; i++) stopVoice(audio.voices[i]);
    audio.voices.length = 0;
  }

  // ---- 原声大钢琴采样（FluidR3_GM，52 个白键采样，黑键用播放速率微调） ----
  var pianoKeys = null;
  function ensureKeyList() {
    if (pianoKeys) return;
    pianoKeys = [];
    if (!window.PIANO_SAMPLES) return;
    Object.keys(window.PIANO_SAMPLES).forEach(function (name) {
      var m = /^([A-G])(#?)(-?\d)$/.exec(name);
      if (!m) return;
      var base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
      pianoKeys.push({ midi: 12 * (parseInt(m[3], 10) + 1) + base + (m[2] ? 1 : 0), name: name });
    });
  }
  function nearestWhite(midi) {
    ensureKeyList();
    if (!pianoKeys || !pianoKeys.length) return null;
    var best = pianoKeys[0], bd = Math.abs(best.midi - midi);
    for (var i = 1; i < pianoKeys.length; i++) {
      var d = Math.abs(pianoKeys[i].midi - midi);
      if (d < bd) { bd = d; best = pianoKeys[i]; }
    }
    return best;
  }
  function ensurePiano() {
    var ac = audio.ctx;
    if (!ac || audio.piano.loading || !window.PIANO_SAMPLES) return;
    audio.piano.loading = true;
    var names = Object.keys(window.PIANO_SAMPLES);
    var idx = 0;
    function next() {
      if (idx >= names.length) { audio.piano.ready = true; return; }
      var name = names[idx++];
      try {
        var raw = atob(window.PIANO_SAMPLES[name]);
        var arr = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
        ac.decodeAudioData(arr.buffer, function (buf) {
          audio.piano.buffers[name] = buf;
          audio.piano.done++;
          setTimeout(next, 0);
        }, function () { setTimeout(next, 0); });
      } catch (e) { setTimeout(next, 0); }
    }
    for (var k = 0; k < 4; k++) next();
  }

  function scheduleSample(midi, when, dur, vel, entry, sustain, gain) {
    var ac = audio.ctx, buf = audio.piano.buffers[entry.name];
    if (!buf) return false;
    var rate = Math.pow(2, (midi - entry.midi) / 12);
    var src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    var g = ac.createGain();
    var bass = midi < 60 ? 1 + (60 - midi) * 0.022 : 1;
    var amp = (gain == null ? vel : gain);
    var peak = 0.5 * (0.05 + 0.95 * amp) * bass;
    var t0 = when;
    var sampleDur = buf.duration / rate;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.007);
    var endT = t0 + Math.max(0.12, dur);
    var stoppedByRelease = endT < t0 + sampleDur - 0.18;
    var rel = sustain ? 0.55 : 0.06;
    if (stoppedByRelease) {
      g.gain.setValueAtTime(Math.max(peak * (sustain ? 0.9 : 0.7), 0.0002), Math.max(t0 + 0.02, endT - 0.08));
      g.gain.exponentialRampToValueAtTime(0.0008, endT + rel);
    }
    src.connect(g);
    g.connect(audio.master);
    if (audio.verbIn) g.connect(audio.verbIn);
    src.start(t0);
    var stopAt = stoppedByRelease
      ? endT + rel + 0.05
      : t0 + sampleDur + 0.12;
    src.stop(Math.max(stopAt, t0 + 0.12));
    var voice = { nodes: [src], end: stopAt };
    audio.voices.push(voice);
    src.onended = function () {
      var idx2 = audio.voices.indexOf(voice);
      if (idx2 >= 0) audio.voices.splice(idx2, 1);
    };
    if (audio.voices.length > 90) {
      var drop = audio.voices.splice(0, 20);
      for (var d = 0; d < drop.length; d++) stopVoice(drop[d]);
    }
    return true;
  }

  function scheduleVoice(midi, when, dur, vel, sustain, gain) {
    var ac = audio.ctx;
    if (!ac) return;
    var entry = nearestWhite(midi);
    if (entry && audio.piano.buffers[entry.name] && scheduleSample(midi, when, dur, vel, entry, sustain, gain)) return;
    var f = 440 * Math.pow(2, (midi - 69) / 12);
    var g = ac.createGain();
    var bassGain = midi < 60 ? 1 + (60 - midi) * 0.022 : 1;
    var ampG = (gain == null ? vel : gain);
    var peak = 0.16 * (0.08 + 0.92 * ampG) * bassGain;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + 0.008);
    g.gain.exponentialRampToValueAtTime(Math.max(peak * 0.22, 0.0002), when + Math.min(0.2, dur * 0.6));
    var tail = sustain ? 0.75 : 0.18;
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + tail);
    g.connect(audio.master);

    var parts = [[1, 1], [2, 0.32], [3, 0.14], [4, 0.07]];
    var nodes = [];
    for (var i = 0; i < parts.length; i++) {
      var h = parts[i][0];
      if (f * h > 10500) continue;
      var o = ac.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = f * h;
      o.detune.value = (Math.random() - 0.5) * 3;
      var og = ac.createGain();
      og.gain.value = parts[i][1];
      o.connect(og);
      og.connect(g);
      o.start(when);
      o.stop(when + dur + tail + 0.05);
      nodes.push(o);
    }
    if (audio.verbIn) g.connect(audio.verbIn);
    var voice = { nodes: nodes, end: when + dur + tail + 0.05 };
    audio.voices.push(voice);
    if (nodes.length) {
      nodes[0].onended = function () {
        var idx = audio.voices.indexOf(voice);
        if (idx >= 0) audio.voices.splice(idx, 1);
      };
    }
    if (audio.voices.length > 80) {
      var drop = audio.voices.splice(0, 20);
      for (var d = 0; d < drop.length; d++) stopVoice(drop[d]);
    }
  }

  // ---------------- 播放控制 ----------------
  var schedTimer = 0;

  function songTime() {
    if (!state.playing || !audio.ctx) return state.position;
    return Math.max(0, (audio.ctx.currentTime - state.startCtx) * state.speed);
  }

  function startTitleFx(fx, tw, tt) {
    if (!fx || fx === 'none') return;
    var cv = document.createElement('canvas'); cv.className = 'rt-fx'; document.body.appendChild(cv);
    var W = window.innerWidth, H = window.innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    var c = cv.getContext('2d'); c.scale(dpr, dpr);
    var t0 = performance.now(), ash = [], shards = [], wind = [], broken = false;
    var lineEls = tw ? tw.querySelectorAll('.rt-line') : [], lines = [];
    function measureLines() {
      lines = [];
      for (var le = 0; le < lineEls.length; le++) {
        var b0 = lineEls[le].getBoundingClientRect();
        lines.push({ x: b0.left, y: b0.top, w: b0.width, h: Math.max(2, b0.height) });
      }
    }
    var strokes = [], debris = [], redDone = false;
    var DUR = fx === 'swords' ? 4.6 : 3.25;
    function rnd(a2, b2) { return a2 + Math.random() * (b2 - a2); }
    function segHit(x1, y1, x2, y2, x3, y3, x4, y4) {
      var d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3); if (Math.abs(d) < 1e-6) return null;
      var ua = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
      var ub = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
      if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
      return { x: x1 + ua * (x2 - x1), y: y1 + ua * (y2 - y1) };
    }
    function frame(now) {
      var t = (now - t0) / 1000; c.clearRect(0, 0, W, H);
      if (fx === 'swords') {
        if (t < 0.05) debris.length = 0;
        var shake = (t >= 2.1 && t < 2.55) ? 19 : 0;
        c.save(); if (shake) c.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
        var dim = t > 2.4 ? Math.max(0, 1 - (t - 2.4) / 0.8) : 1;
        var cx = W / 2, cy = H * 0.5, R = Math.min(W, H) * 0.34, pts = [];
        for (var pi = 0; pi < 6; pi++) { var an = -Math.PI / 2 + pi * Math.PI / 3; pts.push({ x: cx + Math.cos(an) * R, y: cy + Math.sin(an) * R }); }
        var order = [[0, 2], [2, 4], [4, 0], [1, 3], [3, 5], [5, 1]];
        if (t < 2.9) {
          for (var li0 = 0; li0 < lines.length; li0++) { var L0 = lines[li0]; c.save(); c.strokeStyle = 'rgba(190,220,255,.7)'; c.shadowColor = 'rgba(120,170,255,.5)'; c.shadowBlur = 12; c.lineWidth = 2; c.beginPath(); c.moveTo(L0.x, L0.y); c.lineTo(L0.x + L0.w, L0.y); c.stroke(); c.restore(); }
        }
        for (var si0 = 0; si0 < 6; si0++) {
          var e0 = order[si0], A0 = pts[e0[0]], B0 = pts[e0[1]], pr0 = Math.max(0, Math.min(1, (t - (0.03 + si0 * 0.10)) / 0.10));
          if (pr0 > 0) {
            var ex0 = A0.x + (B0.x - A0.x) * pr0, ey0 = A0.y + (B0.y - A0.y) * pr0;
            c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = dim; c.shadowColor = '#8fe4ff'; c.shadowBlur = 52; c.strokeStyle = 'rgba(150,230,255,.95)'; c.lineWidth = 4.2; c.lineCap = 'round';
            c.beginPath(); c.moveTo(A0.x, A0.y); c.lineTo(ex0, ey0); c.stroke();
            c.globalCompositeOperation = 'source-over'; c.globalAlpha = dim; c.shadowColor = '#ffffff'; c.shadowBlur = 26; c.strokeStyle = '#ffffff'; c.lineWidth = 1.7;
            c.beginPath(); c.moveTo(A0.x, A0.y); c.lineTo(ex0, ey0); c.stroke();
            c.fillStyle = '#fff'; c.shadowColor = '#fff'; c.shadowBlur = 30; c.beginPath(); c.arc(ex0, ey0, 2.0, 0, 7); c.fill(); c.restore();
          }
        }
        var midA = { x: W * 0.04, y: H * 0.5 }, midB = { x: W * 0.96, y: H * 0.5 };
        var mp0 = Math.max(0, Math.min(1, (t - 1.5) / 0.12));
        if (mp0 > 0) {
          var mx0 = midA.x + (midB.x - midA.x) * mp0;
          c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = dim; c.shadowColor = '#ff9aa6'; c.shadowBlur = 64; c.strokeStyle = 'rgba(255,200,210,.95)'; c.lineWidth = 9; c.lineCap = 'round';
          c.beginPath(); c.moveTo(midA.x, midA.y); c.lineTo(mx0, midB.y); c.stroke();
          c.globalCompositeOperation = 'source-over'; c.globalAlpha = dim; c.shadowColor = '#ffffff'; c.shadowBlur = 34; c.strokeStyle = '#ffffff'; c.lineWidth = 2.6;
          c.beginPath(); c.moveTo(midA.x, midA.y); c.lineTo(mx0, midB.y); c.stroke(); c.restore();
        }
        if (t > 2.4 && dim > 0) {
          for (var sp = 0; sp < 6; sp++) {
            var eS = order[Math.floor(Math.random() * 6)], AS = pts[eS[0]], BS = pts[eS[1]], pS = Math.random();
            debris.push({ x: AS.x + (BS.x - AS.x) * pS, y: AS.y + (BS.y - AS.y) * pS, ang: 0, len: 2, vx: rnd(-18, 18), vy: rnd(-60, -12), vr: rnd(-2, 2), life: 1.2, max: 1.2, color: '#eaf6ff', spark: true });
          }
          if (Math.random() < .6) debris.push({ x: W * .5 + rnd(-W * .3, W * .3), y: H * .5, ang: 0, len: 2, vx: rnd(-30, 30), vy: rnd(-50, -10), vr: 0, life: 1.0, max: 1.0, color: '#fff', spark: true });
        }
        if (t >= 1.7 && wind.length === 0) {
          for (var w0 = 0; w0 < 40; w0++) { var dir0 = Math.random() < .5 ? -1 : 1; wind.push({ x: W / 2 + rnd(-W * .3, W * .3), y: H / 2 + rnd(-8, 8), vx: dir0 * rnd(260, 720), vy: rnd(-20, 20), life: 0.6 }); }
          for (var wr = 0; wr < 8; wr++) { wind.push({ x: W / 2 + rnd(-W * .12, W * .12), y: H / 2 + rnd(-3, 3), vx: (Math.random() < .5 ? -1 : 1) * rnd(700, 1300), vy: rnd(-6, 6), life: 0.7, red: true }); }
        }
        if (t >= 2.1 && !broken) {
          broken = true;
          measureLines();
          for (var lh = 0; lh < lineEls.length; lh++) lineEls[lh].style.opacity = '0';
          for (var s9 = 0; s9 < 6; s9++) { var e9 = order[s9], A9 = pts[e9[0]], B9 = pts[e9[1]]; for (var w9 = 0; w9 < 16; w9++) wind.push({ x: A9.x + (B9.x - A9.x) * Math.random(), y: A9.y + (B9.y - A9.y) * Math.random(), vx: rnd(-680, 680), vy: rnd(-340, 340), life: 0.8 }); }
          for (var lb = 0; lb < lines.length; lb++) {
            var LB = lines[lb], cuts = [];
            for (var sb = 0; sb < 6; sb++) { var eb = order[sb], Ab = pts[eb[0]], Bb = pts[eb[1]], hb = segHit(Ab.x, Ab.y, Bb.x, Bb.y, LB.x, LB.y, LB.x + LB.w, LB.y); if (hb) cuts.push(hb.x); }
            cuts.sort(function (a2, b2) { return a2 - b2; });
            var xs = [LB.x].concat(cuts, [LB.x + LB.w]);
            for (var kx = 0; kx < xs.length - 1; kx++) { if (xs[kx + 1] - xs[kx] < 4) continue; debris.push({ x: (xs[kx] + xs[kx + 1]) / 2, y: LB.y, ang: 0, len: xs[kx + 1] - xs[kx], vx: rnd(-26, 26), vy: rnd(-30, 6), vr: rnd(-2.2, 2.2), life: 2.0, max: 2.0, color: '#f4fbff' });
              for (var spk = 0; spk < 8; spk++) debris.push({ x: (xs[kx] + xs[kx + 1]) / 2 + rnd(-12, 12), y: LB.y + rnd(-4, 4), ang: 0, len: 2, vx: rnd(-90, 90), vy: rnd(-110, -20), vr: rnd(-3, 3), life: rnd(.6, 1.2), max: 1.2, color: '#dff4ff', spark: true }); }
          }
        }
        for (var wi0 = wind.length - 1; wi0 >= 0; wi0--) { var p0 = wind[wi0]; if (p0.life <= 0) { wind.splice(wi0, 1); continue; } c.save(); c.globalAlpha = Math.max(0, p0.life); c.strokeStyle = p0.red ? 'rgba(255,80,100,.98)' : 'rgba(235,250,255,.95)'; c.lineWidth = p0.red ? 3 : 2; c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p0.x - p0.vx * 0.04, p0.y - p0.vy * 0.04); c.stroke(); c.restore(); p0.x += p0.vx * .016; p0.y += p0.vy * .016; p0.life -= .03; }
        for (var db0 = debris.length - 1; db0 >= 0; db0--) {
          var d0 = debris[db0]; if (d0.life <= 0) { debris.splice(db0, 1); continue; }
          c.save(); c.translate(d0.x, d0.y); c.rotate(d0.ang); c.globalAlpha = Math.max(0, d0.life / d0.max);
          c.shadowColor = '#cfeaff'; c.shadowBlur = 24;
          if (d0.spark) { c.fillStyle = '#eaf7ff'; c.beginPath(); c.arc(0, 0, 2, 0, 7); c.fill(); }
          else { c.strokeStyle = '#f7fcff'; c.lineWidth = 3; c.beginPath(); c.moveTo(-d0.len / 2, 0); c.lineTo(d0.len / 2, 0); c.stroke(); }
          c.restore();
          d0.x += d0.vx * .016; d0.y += d0.vy * .016; d0.vy += (d0.spark ? 280 : 620) * .016; d0.ang += d0.vr * .016; d0.life -= .016;
        }
        c.restore();
      } else if (fx === 'flame') {
        var L = [{ x: W * .1, y: H * .42, w: W * .8, h: 2 }, { x: W * .1, y: H * .56, w: W * .8, h: 2 }];
        var prog = Math.min(1, t / 3.0);
        for (var li = 0; li < L.length; li++) {
          var L2 = L[li], front = L2.x + L2.w * (1 - prog);
          var fg = c.createLinearGradient(L2.x, 0, front, 0);
          fg.addColorStop(0, 'rgba(80,20,0,0)'); fg.addColorStop(.75, 'rgba(255,120,40,.35)'); fg.addColorStop(1, 'rgba(255,220,120,.95)');
          c.fillStyle = fg; c.fillRect(L2.x, L2.y - 3, front - L2.x, L2.h + 6);
          if (Math.random() < 0.6) ash.push({ x: front, y: L2.y + (Math.random() - 0.5) * 8, vx: -10 - Math.random() * 20, vy: 8 + Math.random() * 18, life: 0.8 });
        }
        for (var ai = ash.length - 1; ai >= 0; ai--) { var p2 = ash[ai]; if (p2.life <= 0) { ash.splice(ai, 1); continue; } c.globalAlpha = Math.max(0, p2.life); c.fillStyle = 'rgba(255,190,120,.8)'; c.fillRect(p2.x, p2.y, 1.5, 1.5); p2.x += p2.vx * .016; p2.y += p2.vy * .016; p2.life -= .016; }
        c.globalAlpha = 1;
      } else if (fx === 'prism') {
        var pg = c.createLinearGradient(0, 0, W, H);
        pg.addColorStop(0, 'rgba(120,220,255,.16)'); pg.addColorStop(.5, 'rgba(247,37,133,.14)'); pg.addColorStop(1, 'rgba(255,209,102,.16)');
        c.fillStyle = pg; c.fillRect(0, 0, W, H);
        if (t >= 3.0 && shards.length === 0) {
          var tb = tt.getBoundingClientRect();
          for (var k = 0; k < 26; k++) shards.push({ x: tb.left + Math.random() * tb.width, y: tb.top + Math.random() * tb.height, vx: (Math.random() - .5) * 220, vy: (Math.random() - .5) * 180 - 40, rot: Math.random() * 6, vr: (Math.random() - .5) * 8, s: 3 + Math.random() * 7, life: 1.2 });
        }
        for (var sh = shards.length - 1; sh >= 0; sh--) {
          var q = shards[sh]; if (q.life <= 0) { shards.splice(sh, 1); continue; }
          c.save(); c.translate(q.x, q.y); c.rotate(q.rot); c.globalAlpha = Math.max(0, q.life); c.fillStyle = ['#8fe8ff', '#ff8fd0', '#ffe08a'][sh % 3];
          c.beginPath(); c.moveTo(0, -q.s); c.lineTo(q.s, q.s); c.lineTo(-q.s, q.s * .6); c.closePath(); c.fill(); c.restore();
          q.x += q.vx * .016; q.y += q.vy * .016; q.vy += 260 * .016; q.rot += q.vr * .016; q.life -= .016;
        }
        c.globalAlpha = 1;
      } else if (fx === 'neon') {
        var a3 = 0.35 + 0.55 * Math.abs(Math.sin(t * 9));
        c.strokeStyle = 'rgba(76,201,240,' + a3 + ')'; c.lineWidth = 2; c.shadowColor = '#f72585'; c.shadowBlur = 18;
        c.strokeRect(W * .07, H * .36, W * .86, H * .28);
        if (t >= 3.0) { c.strokeStyle = 'rgba(255,255,255,.9)'; c.strokeRect(W * .068, H * .358, W * .864, H * .284); }
        c.shadowBlur = 0;
      } else if (fx === 'ink') {
        var grow = Math.min(1, t / 1.2), fade = t > 2.6 ? Math.max(0, 1 - (t - 2.6) / 0.4) : 1;
        var rad = Math.max(W, H) * 0.55 * grow;
        var ig = c.createRadialGradient(W / 2, H / 2, rad * 0.2, W / 2, H / 2, rad);
        ig.addColorStop(0, 'rgba(220,235,255,' + (0.20 * fade) + ')'); ig.addColorStop(1, 'rgba(120,160,220,0)');
        c.fillStyle = ig; c.fillRect(0, 0, W, H);
      }
      if (t < DUR) requestAnimationFrame(frame); else { cv.remove(); if (tt) tt.classList.remove('fx-prism', 'fx-neon'); for (var le2 = 0; le2 < lineEls.length; le2++) lineEls[le2].style.opacity = ''; }
    }
    requestAnimationFrame(frame);
  }

  function runIntro(cb) {
    var rec = state.look.rec, black = document.getElementById('recBlack'), tw = document.getElementById('recTitleWrap'), tt = document.getElementById('recTitle');
    if (!black) { cb(); return; }
    state.introActive = true;
    chromeHide();
    black.style.transitionDuration = '1s';
    black.classList.add('show');
    function reveal() {
      black.style.transitionDuration = Math.max(0.3, rec.fade) + 's';
      black.classList.add('fadeout');
      try { cb(true); } catch (e) { }
      setTimeout(function () { black.classList.remove('show', 'fadeout'); state.introActive = false; }, Math.max(1200, rec.fade * 1000 + 300));
    }
    setTimeout(function () {
      if (rec.title && tt && tw) {
        var name = state.title || 'MIDI 钢琴';
        tt.textContent = name;
        tt.className = rec.style || 'classic';
        tw.setAttribute('data-fx', rec.fx || 'none');
        tw.classList.add('show');
        try { startTitleFx(rec.fx, tw, tt); } catch (e) { }
        setTimeout(function () { tw.classList.remove('show'); reveal(); }, 3000);
      } else {
        reveal();
      }
    }, 1000);
  }

  function play() {
    if (!state.notes.length) { toast('先导入一个 MIDI 文件'); return; }
    if (state.look.rec && state.look.rec.on && !state.introActive && state.position < 0.05) { runIntro(playNow); return; }
    playNow();
  }

  function playNow(keepHidden) {
    if (!state.notes.length) { toast('先导入一个 MIDI 文件'); return; }
    if (state.position >= state.duration - 0.05) state.position = 0;
    var ac = ensureAudio();
    if (!ac) return;
    ac.resume();
    state.startCtx = ac.currentTime - state.position / state.speed;
    state.schedIndex = lowerBound(state.notes, state.position - 0.001);
    state.prevT = state.position;
    state.spawnCursor = lowerBound(state.notes, state.position - 0.001);
    state.particles.length = 0;
    state.waves.length = 0;
    state.playing = true;
    updatePlayButton();
    bumpControls();
    showBpmBubble();
    if (keepHidden) chromeHide(); else chromeShow();
    startScheduler();
  }

  function pause() {
    if (!state.playing) return;
    state.position = clamp(songTime(), 0, state.duration);
    state.playing = false;
    stopScheduler();
    stopAllVoices();
    updatePlayButton();
    updateTransport(state.position);
    clearTimeout(hideTimer);
    setControlsHidden(false);
    chromeStay();
  }

  function togglePlay() { if (state.playing) pause(); else play(); }

  function seekTo(t) {
    t = clamp(t, 0, state.duration);
    stopAllVoices();
    state.position = t;
    state.prevT = t;
    state.spawnCursor = lowerBound(state.notes, t);
    state.schedIndex = lowerBound(state.notes, t);
    state.particles.length = 0;
    state.waves.length = 0;
    if (state.playing && audio.ctx) {
      state.startCtx = audio.ctx.currentTime - t / state.speed;
    }
    updateTransport(t);
  }

  function startScheduler() {
    if (schedTimer) return;
    schedTimer = setInterval(schedulerTick, 50);
    schedulerTick();
  }
  function stopScheduler() {
    if (schedTimer) { clearInterval(schedTimer); schedTimer = 0; }
  }
  function schedulerTick() {
    if (!state.playing || !audio.ctx) return;
    var ac = audio.ctx;
    var t = (ac.currentTime - state.startCtx) * state.speed;
    var horizon = t + 0.9 * state.speed + 0.05;
    while (state.schedIndex < state.notes.length && state.notes[state.schedIndex].start <= horizon) {
      var n = state.notes[state.schedIndex++];
      if (n.start < t - 0.1) continue;
      var when = ac.currentTime + Math.max(0.006, (n.start - t) / state.speed);
      var endSec = (state.look.pedal && n.soundEnd) ? n.soundEnd : n.end;
      var raw = n.velocity * (typeof n.vol === 'number' ? n.vol : 1);
      var gain = state.look.dyn ? clamp(Math.pow(raw, 2.2), 0.02, 1.2) : raw;
      scheduleVoice(n.midi, when, Math.max(0.06, (endSec - n.start) / state.speed), n.velocity,
        !!(state.look.pedal && endSec > n.end + 0.02), gain);
    }
  }

  // ---------------- 背景 ----------------
  var bgCache = null, bgCacheW = 0, bgCacheH = 0;

  function buildBgCache() {
    var w = window.innerWidth, h = window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    bgCache = document.createElement('canvas');
    bgCache.width = Math.max(1, Math.floor(w * dpr));
    bgCache.height = Math.max(1, Math.floor(h * dpr));
    var c = bgCache.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state.bg) {
      var img = state.bg;
      var sc = Math.max(w / img.width, h / img.height);
      var dw = img.width * sc, dh = img.height * sc;
      var fl = 'brightness(1.22) saturate(1.06)';
      if ((state.look.bgBlur || 0) > 0) fl += ' blur(' + state.look.bgBlur + 'px)';
      c.filter = fl;
      c.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      c.filter = 'none';
      c.fillStyle = 'rgba(4, 7, 18, 0.36)';
      c.fillRect(0, 0, w, h);
    } else {
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#080c20');
      g.addColorStop(0.5, '#0b1028');
      g.addColorStop(1, '#04060e');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      var rg = c.createRadialGradient(w * 0.5, state.hitY, 0, w * 0.5, state.hitY, w * 0.9);
      rg.addColorStop(0, 'rgba(76, 201, 240, 0.10)');
      rg.addColorStop(1, 'rgba(76, 201, 240, 0)');
      c.fillStyle = rg;
      c.fillRect(0, 0, w, h);
    }
    var ov = c.createLinearGradient(0, 0, 0, h);
    ov.addColorStop(0, 'rgba(3, 5, 14, 0.55)');
    ov.addColorStop(0.25, 'rgba(3, 5, 14, 0.10)');
    ov.addColorStop(0.8, 'rgba(3, 5, 14, 0.35)');
    ov.addColorStop(1, 'rgba(3, 5, 14, 0.72)');
    c.fillStyle = ov;
    c.fillRect(0, 0, w, h);
    bgCacheW = w;
    bgCacheH = h;
  }

  function drawBackground(t) {
    var w = window.innerWidth, h = window.innerHeight;
    if (!bgCache || bgCacheW !== w || bgCacheH !== h) buildBgCache();
    ctx.drawImage(bgCache, 0, 0, w, h);
    if (!state.bg) {
      for (var i = 0; i < state.stars.length; i++) {
        var s = state.stars[i];
        var sy = ((s.y * h + t * s.v) % h + h) % h;
        ctx.globalAlpha = s.a * (0.55 + 0.45 * Math.sin(t * 1.2 + s.p));
        ctx.fillStyle = '#a9dcff';
        ctx.beginPath();
        ctx.arc(s.x * w, sy, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    drawAmbience();
  }

  // ---------------- 氛围特效 ----------------
  var AMB_COLORS = { spark: [255, 168, 84], calm: [150, 255, 214], snow: [235, 244, 255], rain: [150, 190, 255], sakura: [255, 176, 198], maple: [255, 140, 70], cyber: [0, 229, 255], wind: [205, 222, 255] };
  function newAmbPart(kind, w, h) {
    var p = { kind: kind, life: 0 };
    if (kind === 'spark') {
      p.x = Math.random() * w; p.y = h + 8;
      p.vx = (Math.random() - 0.5) * 14; p.vy = -(50 + Math.random() * 90);
      p.size = 1 + Math.random() * 2.2; p.max = 3 + Math.random() * 3;
      p.alpha = 0.5 + Math.random() * 0.4;
    } else if (kind === 'calm') {
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = (Math.random() - 0.5) * 10; p.vy = (Math.random() - 0.5) * 6;
      p.size = 1 + Math.random() * 1.6; p.max = 7 + Math.random() * 7;
      p.alpha = 0.25 + Math.random() * 0.35; p.phase = Math.random() * 6.28;
    } else if (kind === 'snow') {
      p.x = Math.random() * w; p.y = -12;
      p.vx = (Math.random() - 0.5) * 16; p.vy = 28 + Math.random() * 46;
      p.size = 1.2 + Math.random() * 2.2; p.max = 9 + Math.random() * 8;
      p.alpha = 0.45 + Math.random() * 0.4; p.phase = Math.random() * 6.28;
    } else if (kind === 'sakura') {
      p.x = Math.random() * w * 1.1; p.y = -14;
      p.vx = -10 - Math.random() * 16; p.vy = 24 + Math.random() * 30;
      p.size = 2.0 + Math.random() * 1.8; p.max = 12 + Math.random() * 6;
      p.alpha = 0.5 + Math.random() * 0.35; p.phase = Math.random() * 6.28;
      p.rot = Math.random() * 6.28; p.vr = (Math.random() - 0.5) * 2.6;
    } else if (kind === 'maple') {
      p.x = Math.random() * w * 1.05; p.y = -14;
      p.vx = -8 - Math.random() * 16; p.vy = 26 + Math.random() * 26;
      p.size = 2.4 + Math.random() * 1.8; p.max = 13 + Math.random() * 7;
      p.alpha = 0.55 + Math.random() * 0.35; p.phase = Math.random() * 6.28;
      p.rot = Math.random() * 6.28; p.vr = (Math.random() - 0.5) * 2.2;
    } else if (kind === 'cyber') {
      p.x = -24; p.y = Math.random() * h;
      p.vx = 150 + Math.random() * 190; p.vy = (Math.random() - 0.5) * 16;
      p.size = 1.2 + Math.random() * 1.2; p.max = 3.5 + Math.random() * 3;
      p.alpha = 0.35 + Math.random() * 0.4; p.len = 14 + Math.random() * 26;
      p.phase = Math.random() * 6.28;
      p.mag = Math.random() < 0.35;
    } else if (kind === 'wind') {
      p.x = w + 26; p.y = Math.random() * h;
      p.vx = -(300 + Math.random() * 280); p.vy = (Math.random() - 0.5) * 24;
      p.size = 1; p.max = 2.4 + Math.random() * 1.6;
      p.alpha = 0.10 + Math.random() * 0.16; p.len = 40 + Math.random() * 70;
      p.phase = Math.random() * 6.28;
    } else {
      p.x = Math.random() * w * 1.15; p.y = -20;
      p.vx = -70 - Math.random() * 40; p.vy = 330 + Math.random() * 240;
      p.size = 1; p.max = 2.4; p.alpha = 0.32 + Math.random() * 0.3;
      p.len = 9 + Math.random() * 12;
    }
    return p;
  }
  function updateAmbience(dt) {
    var kind = state.look.amb;
    if (!kind || kind === 'none') { state.ambParts.length = 0; return; }
    var w = window.innerWidth, h = window.innerHeight;
    var d = Math.max(0, Math.min(3, state.look.ambDensity | 0));
    var mul = [0.45, 1, 1.7, 2.6][d];
    var base = kind === 'rain' ? 55 : kind === 'snow' ? 24 : kind === 'spark' ? 16 : kind === 'sakura' ? 22 : kind === 'cyber' ? 30 : kind === 'wind' ? 42 : kind === 'maple' ? 20 : 7;
    state.ambAcc = (state.ambAcc || 0) + dt * base * mul;
    while (state.ambAcc >= 1) {
      state.ambAcc -= 1;
      state.ambParts.push(newAmbPart(kind, w, h));
    }
    var ps = state.ambParts;
    for (var i = ps.length - 1; i >= 0; i--) {
      var p = ps[i];
      p.life += dt;
      if (p.life > p.max || p.y > h + 30 || p.x < -30 || p.x > w + 30) { ps.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'snow' || p.kind === 'calm') p.x += Math.sin(p.life * 1.3 + (p.phase || 0)) * 12 * dt;
      if (p.kind === 'sakura') {
        p.x += Math.sin(p.life * 1.6 + (p.phase || 0)) * 22 * dt;
        p.rot += p.vr * dt;
      }
      if (p.kind === 'maple') {
        p.x += Math.sin(p.life * 1.35 + (p.phase || 0)) * 18 * dt;
        p.rot += p.vr * dt;
      }
      if (p.kind === 'cyber' || p.kind === 'wind') {
        p.y += Math.sin(p.life * 2.2 + (p.phase || 0)) * 7 * dt;
      }
    }
    var cap = [120, 220, 340, 500][d];
    if (ps.length > cap) ps.splice(0, ps.length - cap);
  }
  function drawAmbience() {
    var ps = state.ambParts, col = AMB_COLORS[state.look.amb];
    if (!col || !ps.length) return;
    var c = col[0] + ',' + col[1] + ',' + col[2];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      var k = 1 - p.life / p.max;
      if (k <= 0) continue;
      if (p.kind === 'rain') {
        ctx.strokeStyle = 'rgba(' + c + ',' + (p.alpha * k).toFixed(3) + ')';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.02, p.y - p.len);
        ctx.stroke();
        continue;
      }
      if (p.kind === 'cyber') {
        var ca = (p.alpha * Math.min(1, k * 2)).toFixed(3);
        var cc = p.mag ? '255,61,242' : '0,229,255';
        ctx.strokeStyle = 'rgba(' + cc + ',' + ca + ')';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.len, p.y - 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,' + (p.alpha * 0.8 * k).toFixed(3) + ')';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.len * 0.65, p.y - 1);
        ctx.stroke();
        continue;
      }
      if (p.kind === 'wind') {
        var wa = (p.alpha * Math.min(1, k * 2)).toFixed(3);
        ctx.strokeStyle = 'rgba(' + c + ',' + wa + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.len, p.y - 3);
        ctx.stroke();
        continue;
      }
      if (p.kind === 'maple') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.fillStyle = 'rgba(' + c + ',' + (p.alpha * Math.min(1, k * 2)).toFixed(3) + ')';
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 1.45, p.size * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,40,0,' + (p.alpha * 0.5 * k).toFixed(3) + ')';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-p.size * 1.3, 0);
        ctx.lineTo(p.size * 1.3, 0);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      var tw = p.kind === 'spark' ? (0.7 + 0.3 * Math.sin(p.life * 3 + p.x)) : 1;
      var a = p.alpha * Math.min(1, k * 2) * tw;
      if (p.kind === 'sakura') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.fillStyle = 'rgba(' + c + ',' + a.toFixed(3) + ')';
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 1.25, p.size * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 245, 248, ' + (a * 0.65).toFixed(3) + ')';
        ctx.beginPath();
        ctx.ellipse(-p.size * 0.3, -p.size * 0.12, p.size * 0.5, p.size * 0.26, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }
      ctx.fillStyle = 'rgba(' + c + ',' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------------- 粒子 ----------------
  function burst(midi, color, power) {
    var k = state.keyMap[midi];
    if (!k) return;
    var cx = k.x + k.w / 2;
    var cy = state.hitY + 2;
    var count = Math.round(10 + 14 * power);
    for (var i = 0; i < count; i++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.7;
      var sp = 50 + Math.random() * 280 * (0.5 + power);
      state.particles.push({
        x: cx + (Math.random() - 0.5) * 6,
        y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 30,
        life: 0,
        max: 0.45 + Math.random() * 0.55,
        size: 1.2 + Math.random() * 2.8,
        color: color
      });
    }
    state.waves.push({ x: cx, y: cy, life: 0, max: 0.42, color: color });
    state.hitPulse = Math.min(1, state.hitPulse + 0.25);
    if (state.particles.length > 1000) {
      state.particles.splice(0, state.particles.length - 1000);
    }
  }

  // 音符下落时持续撒出小火花（拖尾）
  function emitNoteTrails(t, dt) {
    var vz = state.view.vzoom || 1; if (!isFinite(vz) || vz <= 0) vz = 1;
    var pps = state.pxPerSec * state.speed * vz;
    var start = lowerBound(state.notes, t - 1.0);
    var ps = state.particles;
    var np = state.look.np || {};
    if (np.on === false) return;
    var npMul = [0.35, 1, 1.8, 2.6][np.count | 0] || 1;
    var npCap = [280, 700, 1050, 1500][np.count | 0] || 700;
    for (var i = start; i < state.notes.length; i++) {
      var n = state.notes[i];
      if (n.start > t + 2.4) break;
      if (n.end < t - 0.05) continue;
      var k = state.keyMap[n.midi];
      if (!k) continue;
      if (Math.random() > dt * npMul * (state.pedalOn ? (state.lowQ ? 10 : 20) : (state.lowQ ? 7 : 14))) continue;
      var y = state.hitY - (n.start - t) * pps;
      var yTop = state.hitY - (n.end - t) * pps;
      if (np.region === 'whole') y = Math.min(y, yTop) + Math.random() * Math.max(2, Math.abs(y - yTop));
      else if (np.region === 'head') y = Math.min(y, yTop) + Math.random() * 3;
      if (y < -12 || y > state.hitY + 6) continue;
      var npCol = (handOf(n) === 'L' ? np.lc : np.rc);
      ps.push({
        x: k.x + Math.random() * k.w,
        y: y + Math.random() * 3,
        vx: (Math.random() - 0.5) * 24,
        vy: -14 - Math.random() * 54,
        life: 0,
        max: 0.3 + Math.random() * 0.5,
        size: 1.4 + Math.random() * 2.0,
        color: npCol ? (NP_HEX[npCol] || noteColor(n)) : noteColor(n),
        soft: true,
        grav: -12
      });
    }
    if (ps.length > npCap) ps.splice(0, ps.length - npCap);
  }

  function updateParticles(dt) {
    var ps = state.particles;
    for (var i = ps.length - 1; i >= 0; i--) {
      var p = ps[i];
      p.life += dt;
      if (p.life >= p.max) { ps.splice(i, 1); continue; }
      p.vy += (p.grav !== undefined ? p.grav : 980) * dt;
      p.vx *= Math.max(0, 1 - 2.2 * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.vr) p.rot += p.vr * dt;
    }
    var ws = state.waves;
    for (var j = ws.length - 1; j >= 0; j--) {
      ws[j].life += dt;
      if (ws[j].life >= ws[j].max) ws.splice(j, 1);
    }
  }

  function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var i, p;
    for (i = 0; i < state.particles.length; i++) {
      p = state.particles[i];
      var a = 1 - p.life / p.max;
      var r = p.size * (0.4 + 0.6 * a);
      if (p.kind === 'mist') {
        var mp = p.life / p.max;
        var mrad = p.size * (1 + 1.8 * mp);
        var mg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, mrad);
        mg.addColorStop(0, hexToRgba(p.color, 0.22 * (1 - mp)));
        mg.addColorStop(1, hexToRgba(p.color, 0));
        ctx.fillStyle = mg;
        ctx.beginPath(); ctx.arc(p.x, p.y, mrad, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      if (p.kind === 'wake') {
        ctx.globalAlpha = a * 0.55;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * 0.7;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.vx * 0.012, p.y + (p.len || 12) * a);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      if (p.kind === 'drop') {
        ctx.globalAlpha = a * 0.8;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = a * 0.95;
        ctx.fillStyle = '#eaf9ff';
        ctx.beginPath(); ctx.arc(p.x - r * 0.28, p.y - r * 0.28, r * 0.34, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      if (p.kind === 'leaf') {
        ctx.globalAlpha = a * 0.95;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 1.4, p.size * 0.66, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(90,30,0,0.55)';
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(-p.size * 1.2, 0); ctx.lineTo(p.size * 1.2, 0); ctx.stroke();
        ctx.restore();
        continue;
      }
      if (p.kind === 'shard') {
        ctx.globalAlpha = a;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(0.6, p.size * 0.7);
        ctx.beginPath(); ctx.moveTo(-p.len / 2, 0); ctx.lineTo(p.len / 2, 0); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(-p.len / 4, 0); ctx.lineTo(p.len / 4, 0); ctx.stroke();
        ctx.restore();
        continue;
      }
      if (p.kind === 'petal') {
        ctx.globalAlpha = a * 0.95;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 1.3, p.size * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }
      if (p.kind === 'ember') {
        ctx.globalAlpha = a * 0.9;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = a * 0.8;
        ctx.fillStyle = '#fff6d8';
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.42, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      if (p.kind === 'star') {
        ctx.globalAlpha = a * (0.55 + 0.45 * Math.sin(p.life * 18 + p.x));
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      ctx.globalAlpha = a * (p.soft ? 0.6 : 0.9);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (i = 0; i < state.waves.length; i++) {
      var wv = state.waves[i];
      var k = wv.life / wv.max;
      ctx.globalAlpha = (1 - k) * 0.55;
      ctx.strokeStyle = wv.color;
      ctx.lineWidth = 2.5 * (1 - k) + 0.5;
      ctx.beginPath();
      if (wv.ripple) {
        var rr = 6 + (wv.maxR || 90) * k;
        ctx.ellipse(wv.x, wv.y, rr, rr * 0.3, 0, 0, Math.PI * 2);
      } else {
        ctx.arc(wv.x, wv.y, 8 + 90 * k, Math.PI, Math.PI * 2);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------- 绘制 ----------------
  // 单轨：按音高映射到连续色相；多轨：按轨道取固定色
  function noteHue(n) {
    if (state.tracks > 1) return null;
    return (n.midi * 30 + 200) % 360;
  }

  var GRADIENTS = {
    red:    { light: '#ffe9ee', base: '#ff3d5a', deep: '#8f0022' },
    blue:   { light: '#e6f4ff', base: '#2f9bff', deep: '#003a8f' },
    gold:   { light: '#fff7dc', base: '#ffc83d', deep: '#8a5a00' },
    purple: { light: '#f4e8ff', base: '#a45bff', deep: '#4b008f' },
    teal:   { light: '#e2fffa', base: '#1fd6b4', deep: '#005c4b' },
    pink:   { light: '#ffeafa', base: '#ff5fb0', deep: '#8f0050' },
    orange: { light: '#fff0e0', base: '#ff8a2b', deep: '#8f3a00' },
    green:  { light: '#eaffea', base: '#3ddc84', deep: '#0a6b3a' },
    cyan:   { light: '#e0fbff', base: '#22d3ee', deep: '#006b7a' },
    magenta:{ light: '#ffe6ff', base: '#ff4dff', deep: '#8f008f' },
    white:  { light: '#ffffff', base: '#e8eefc', deep: '#8f9bb8' },
    maple:  { light: '#ffe9c9', base: '#ff7a1a', deep: '#7a1e00' },
    cyber:  { light: '#d9fbff', base: '#00e5ff', deep: '#5b00b8' },
    lime:   { light: '#f0ffe0', base: '#7ee787', deep: '#1f5c2e' },
    ice:    { light: '#eafaff', base: '#7fd8ff', deep: '#2f6fae' },
    sunset: { light: '#fff0e6', base: '#ff8a5c', deep: '#a63a2f' },
    pear:   { light: '#f2f8d8', base: '#9BB344', deep: '#43521a' },
    azure:  { light: '#e2f8fb', base: '#41B5C2', deep: '#124a52' }
  };

  var GLOWS = {
    white: '#ffffff', gold: '#ffd166', blue: '#5eb8ff', teal: '#4de8d0',
    purple: '#b07bff', pink: '#ff7fc4', red: '#ff5a6a', green: '#4ade80', orange: '#ff9a3d'
  };
  var NP_HEX = { white: '#ffffff', gold: '#ffd166', blue: '#5eb8ff', teal: '#4de8d0', purple: '#b07bff', pink: '#ff7fc4', red: '#ff5a6a', green: '#4ade80', orange: '#ff9a3d', lime: '#c8f04a', pear: '#9BB344', azure: '#41B5C2' };

  var HAND = {
    L: { light: '#ffe8e8', base: '#e63946', deep: '#7a0c14' },
    R: { light: '#fff7d6', base: '#f4c542', deep: '#8a6408' }
  };
  function handOf(n) { return n.hand || (n.midi < 60 ? 'L' : 'R'); }
  function handTheme(side) {
    var key = side === 'L' ? state.look.leftColor : state.look.rightColor;
    return GRADIENTS[key] || (side === 'L' ? HAND.L : HAND.R);
  }
  var GRAD_KEYS = null;
  function randomTheme(n) {
    if (!GRAD_KEYS) GRAD_KEYS = Object.keys(GRADIENTS);
    if (!n._rt) n._rt = GRADIENTS[GRAD_KEYS[(Math.random() * GRAD_KEYS.length) | 0]];
    return n._rt;
  }
  var THEME_PAIR = { lime: 'pear', ice: 'azure', sunset: 'pink', pear: 'lime', azure: 'ice' };
  function themeOf(n) {
    var grad = state.look.gradient;
    if (THEME_PAIR[grad] && handOf(n) === 'L') return GRADIENTS[THEME_PAIR[grad]];
    return GRADIENTS[grad] || randomTheme(n);
  }
  function noteColor(n) {
    if (state.look.gradient === 'hands') return handTheme(handOf(n)).base;
    return themeOf(n).base;
  }

  function mixHex(hex, other, amount) {
    function rgb(str) {
      str = str.replace('#', '');
      return [parseInt(str.slice(0, 2), 16), parseInt(str.slice(2, 4), 16), parseInt(str.slice(4, 6), 16)];
    }
    var a = rgb(hex), b = rgb(other), out = [];
    for (var i = 0; i < 3; i++) out.push(Math.round(a[i] + (b[i] - a[i]) * amount));
    return 'rgb(' + out.join(',') + ')';
  }

  function noteGradient(n, top, bottom) {
    if (!isFinite(top)) top = 0;
    if (!isFinite(bottom)) bottom = top + 1;
    var g = ctx.createLinearGradient(0, top, 0, Math.max(bottom, top + 1));
    if (state.look.gradient === 'hands') {
      var hh = handTheme(handOf(n));
      g.addColorStop(0, mixHex(hh.light, hh.base, 0.30));
      g.addColorStop(0.5, hh.base);
      g.addColorStop(1, hh.deep);
      return g;
    }
    var th = themeOf(n);
    if (th) {
      g.addColorStop(0, mixHex(th.light, th.base, 0.32));
      g.addColorStop(0.5, th.base);
      g.addColorStop(1, th.deep);
      return g;
    }
    var h = noteHue(n);
    if (h === null) {
      var c = COLORS[n.track % COLORS.length];
      g.addColorStop(0, mixHex(c, '#ffffff', 0.6));
      g.addColorStop(0.55, c);
      g.addColorStop(1, mixHex(c, '#000000', 0.38));
    } else {
      g.addColorStop(0, 'hsl(' + h.toFixed(1) + ', 95%, 82%)');
      g.addColorStop(0.55, 'hsl(' + h.toFixed(1) + ', 88%, 63%)');
      g.addColorStop(1, 'hsl(' + ((h + 18) % 360).toFixed(1) + ', 82%, 46%)');
    }
    return g;
  }

  function pedalAt(t) {
    var ps = state.pedals;
    for (var i = 0; i < ps.length; i++) {
      if (t < ps[i].start) break;
      if (t < ps[i].end) return true;
    }
    return false;
  }

  // ---- 外观设置（形状 / 命中特效） ----
  var LOOK_KEY = 'midiPiano.look.v1';
  function loadLook() {
    try {
      var raw = localStorage.getItem(LOOK_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o && typeof o.shape === 'string') state.look.shape = o.shape;
      if (o && typeof o.fx === 'string') state.look.fx = o.fx;
      if (o && typeof o.gradient === 'string') {
        if (o.gradient === 'hands') state.look.gradient = 'hands';
        else if (o.gradient === 'random' || GRADIENTS[o.gradient]) state.look.gradient = 'random';
      }
      if (o && typeof o.pedal === 'boolean') state.look.pedal = o.pedal;
      if (o && typeof o.topbar === 'boolean') state.look.topbar = o.topbar;
      if (o && typeof o.amb === 'string' && ['none', 'spark', 'calm', 'snow', 'rain', 'sakura', 'maple', 'cyber', 'wind'].indexOf(o.amb) >= 0) state.look.amb = o.amb;
      if (o && typeof o.ambDensity === 'number') state.look.ambDensity = Math.max(0, Math.min(3, Math.round(o.ambDensity)));
      if (o && typeof o.barlines === 'boolean') state.look.barlines = o.barlines;
      if (o && typeof o.fullscreen === 'boolean') state.look.fullscreen = o.fullscreen;
      if (o && typeof o.sidebar === 'boolean') state.look.sidebar = o.sidebar;
      if (o && typeof o.leftColor === 'string' && GRADIENTS[o.leftColor]) state.look.leftColor = o.leftColor;
      if (o && typeof o.rightColor === 'string' && GRADIENTS[o.rightColor]) state.look.rightColor = o.rightColor;
      if (o && typeof o.dyn === 'boolean') state.look.dyn = o.dyn;
      if (o && typeof o.freeMove === 'boolean') state.look.freeMove = o.freeMove;
      if (o && typeof o.glow === 'string' && (o.glow === 'none' || GLOWS[o.glow])) state.look.glow = o.glow;
      if (o && typeof o.glowL === 'string' && (o.glowL === 'none' || GLOWS[o.glowL])) state.look.glowL = o.glowL;
      if (o && typeof o.glowR === 'string' && (o.glowR === 'none' || GLOWS[o.glowR])) state.look.glowR = o.glowR;
      if (o && typeof o.glowLevel === 'number') state.look.glowLevel = Math.max(0, Math.min(3, Math.round(o.glowLevel)));
      if (o && typeof o.lineColor === 'string' && (o.lineColor === 'none' || GLOWS[o.lineColor])) state.look.lineColor = o.lineColor;
      if (o && typeof o.guiAlpha === 'number') state.look.guiAlpha = Math.max(35, Math.min(100, Math.round(o.guiAlpha)));
      if (o && typeof o.guiColor === 'string' && GUI_HEX[o.guiColor]) state.look.guiColor = o.guiColor;
      if (o && o.rec && typeof o.rec === 'object') {
        if (typeof o.rec.on === 'boolean') state.look.rec.on = o.rec.on;
        if (typeof o.rec.fade === 'number') state.look.rec.fade = Math.max(0.3, Math.min(4, o.rec.fade));
        if (typeof o.rec.title === 'boolean') state.look.rec.title = o.rec.title;
        if (typeof o.rec.style === 'string' && /^(classic|fade|scale)$/.test(o.rec.style)) state.look.rec.style = o.rec.style;
        if (typeof o.rec.fx === 'string' && /^(none|swords|flame|prism|neon|ink)$/.test(o.rec.fx)) state.look.rec.fx = o.rec.fx;
      }
      if (o && o.ext && typeof o.ext === 'object') {
        if (typeof o.ext.on === 'boolean') state.look.ext.on = o.ext.on;
        if (typeof o.ext.lines === 'number') state.look.ext.lines = Math.max(1, Math.min(8, Math.round(o.ext.lines)));
        if (typeof o.ext.alpha === 'number') state.look.ext.alpha = Math.max(10, Math.min(100, Math.round(o.ext.alpha)));
        if (typeof o.ext.mpl === 'number') state.look.ext.mpl = Math.max(0, Math.min(12, Math.round(o.ext.mpl)));
        if (typeof o.ext.xoff === 'number') state.look.ext.xoff = Math.max(-200, Math.min(200, Math.round(o.ext.xoff)));
        if (typeof o.ext.yoff === 'number') state.look.ext.yoff = Math.max(-120, Math.min(120, Math.round(o.ext.yoff)));
        if (typeof o.ext.lineShift === 'number') state.look.ext.lineShift = Math.round(o.ext.lineShift);
      }
      if (typeof o.linePower === 'number') state.look.linePower = Math.max(0, Math.min(3, Math.round(o.linePower)));
      if (typeof o.mistOn === 'boolean') state.look.mistOn = o.mistOn;
      if (typeof o.mistPower === 'number') state.look.mistPower = Math.max(0, Math.min(3, Math.round(o.mistPower)));
      if (typeof o.mistLife === 'number') state.look.mistLife = Math.max(0.5, Math.min(2, o.mistLife));
      if (typeof o.collapsed === 'boolean') state.look.collapsed = o.collapsed;
      if (o && o.np && typeof o.np === 'object') {
        var npv = o.np;
        if (typeof npv.on === 'boolean') state.look.np.on = npv.on;
        if (npv.region === 'tail' || npv.region === 'whole' || npv.region === 'head') state.look.np.region = npv.region;
        if (typeof npv.count === 'number') state.look.np.count = Math.max(0, Math.min(3, Math.round(npv.count)));
        if (typeof npv.lc === 'string' && (!npv.lc || NP_HEX[npv.lc])) state.look.np.lc = npv.lc;
        if (typeof npv.rc === 'string' && (!npv.rc || NP_HEX[npv.rc])) state.look.np.rc = npv.rc;
      }
      if (o && typeof o.mistColor === 'string' && (o.mistColor === 'none' || GLOWS[o.mistColor])) state.look.mistColor = o.mistColor;
      if (o && typeof o.kbLen === 'number') state.look.kbLen = Math.max(0, Math.min(100, Math.round(o.kbLen)));
      if (o && typeof o.bgBlur === 'number') state.look.bgBlur = Math.max(0, Math.min(20, Math.round(o.bgBlur)));
      if (o && typeof o.perfAuto === 'boolean') state.look.perfAuto = o.perfAuto;
      if (o && o.score && typeof o.score === 'object') {
        var sc = o.score;
        if (typeof sc.on === 'boolean') state.look.score.on = sc.on;
        if (typeof sc.glow === 'boolean') state.look.score.glow = sc.glow;
        if (typeof sc.color === 'string') state.look.score.color = sc.color;
        if (typeof sc.pos === 'number') state.look.score.pos = Math.max(-40, Math.min(80, sc.pos));
        if (typeof sc.size === 'number') state.look.score.size = Math.max(0.6, Math.min(1.8, sc.size));
        if (typeof sc.bgAlpha === 'number') state.look.score.bgAlpha = Math.max(0, Math.min(1, sc.bgAlpha));
        if (typeof sc.glowLevel === 'number') state.look.score.glowLevel = Math.max(0, Math.min(3, Math.round(sc.glowLevel)));
      }
      if (o && typeof o.fps === 'boolean') state.look.fps = o.fps;
      if (o && typeof o.stats === 'boolean') state.look.stats = o.stats;
      if (o && typeof o.tab === 'string' && ['shape', 'fx', 'func', 'debug'].indexOf(o.tab) >= 0) state.look.tab = o.tab;
    } catch (e) { /* 忽略损坏的本地设置 */ }
  }
  function saveLook() {
    try { localStorage.setItem(LOOK_KEY, JSON.stringify(state.look)); } catch (e) { /* 无痕模式 */ }
  }
  var GUI_HEX = { navy: '14,20,38', black: '8,10,16', purple: '30,18,54', teal: '10,36,44', pink: '44,18,36', gold: '40,32,16' };
  var LOG = [];
  function logLine(s) { try { LOG.push(new Date().toTimeString().slice(0, 8) + ' ' + s); if (LOG.length > 300) LOG.shift(); } catch (e) { } }
  window.addEventListener('error', function (e) { logLine('ERR ' + (e.message || '') + ' @' + (e.filename || '') + ':' + (e.lineno || 0)); });
  window.addEventListener('unhandledrejection', function (e) { logLine('REJ ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason))); });

  function bpmAt(t) {
    var segs = state.tempos || [];
    if (!segs.length) return 120;
    var lo = 0, hi = segs.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (segs[mid].sec <= t + 1e-6) lo = mid; else hi = mid - 1; }
    return Math.round(60000000 / (segs[lo].us || 500000));
  }
  var bpmTimer = 0;
  function showBpmBubble() {
    var el = document.getElementById('bpmBubble');
    if (!el) return;
    var t = (typeof songTime === 'function') ? songTime() : 0;
    var k = document.getElementById('songKey');
    el.textContent = 'BPM ' + bpmAt(t) + (k && k.textContent ? ' · ' + k.textContent : '');
    el.classList.remove('hidden');
    clearTimeout(bpmTimer);
    bpmTimer = setTimeout(function () { el.classList.add('hidden'); }, 3000);
  }

  var chromeTimer = 0, chromeOff = false;
  function chromeHidden() { return chromeOff; }
  function chromeHide() { chromeOff = true; document.body.classList.add('chrome-off'); }
  function chromeShow() {
    if (chromeOff) { chromeOff = false; document.body.classList.remove('chrome-off'); }
    clearTimeout(chromeTimer);
    if (state.playing && !state.home) chromeTimer = setTimeout(chromeHide, 3000);
  }
  function chromeStay() { clearTimeout(chromeTimer); chromeOff = false; document.body.classList.remove('chrome-off'); }

  function applyGui() {
    var root = document.documentElement;
    root.style.setProperty('--gui-rgb', GUI_HEX[state.look.guiColor] || GUI_HEX.navy);
    root.style.setProperty('--gui-a', (state.look.guiAlpha / 100).toFixed(2));
  }

  document.addEventListener('pointerdown', function () {
    if (state.home) return;
    if (chromeOff) chromeShow();
  }, true);

  function applyLookUI() {
    applyGui();
    var shapes = document.querySelectorAll('#shapeOpts .opt');
    for (var i = 0; i < shapes.length; i++) shapes[i].classList.toggle('active', shapes[i].getAttribute('data-shape') === state.look.shape);
    var fxs = document.querySelectorAll('#fxOpts .opt');
    for (var j = 0; j < fxs.length; j++) fxs[j].classList.toggle('active', fxs[j].getAttribute('data-fx') === state.look.fx);
    var grads = document.querySelectorAll('#gradOpts .opt');
    for (var g = 0; g < grads.length; g++) grads[g].classList.toggle('active', grads[g].getAttribute('data-grad') === state.look.gradient);
    var peds = document.querySelectorAll('#pedalOpts .opt');
    for (var p = 0; p < peds.length; p++) peds[p].classList.toggle('active', (peds[p].getAttribute('data-pedal') === 'on') === !!state.look.pedal);
    var ambs = document.querySelectorAll('#ambOpts .opt');
    for (var a = 0; a < ambs.length; a++) ambs[a].classList.toggle('active', ambs[a].getAttribute('data-amb') === state.look.amb);
    var pmi = $('pedalMix');
    if (pmi) pmi.addEventListener('input', function () {
      state.look.pedalMix = Math.max(0, Math.min(100, +pmi.value || 0));
      var v = $('pedalMixVal'); if (v) v.textContent = state.look.pedalMix + '%';
      saveLook();
    });
    var npcs = $('npCount');
    if (npcs) npcs.addEventListener('input', function () {
      state.look.np.count = Math.max(0, Math.min(3, +npcs.value || 0));
      var v = $('npCountVal'); if (v) v.textContent = ['少量', '正常', '略多', '非常多'][state.look.np.count];
      saveLook();
    });
    var ad = $('ambDensity');
    if (ad) ad.value = String(Math.max(0, Math.min(3, state.look.ambDensity | 0)));
    var sc2 = state.look.score;
    var sOn = document.querySelectorAll('#scoreColorOpts .opt');
    for (var si = 0; si < sOn.length; si++) sOn[si].classList.toggle('active', sOn[si].getAttribute('data-scolor') === sc2.color);
    var sp = $('scorePos'); if (sp) sp.value = String(sc2.pos);
    var spv = $('scorePosVal'); if (spv) spv.textContent = String(sc2.pos);
    var szv = $('scoreSizeVal'); if (szv) szv.textContent = Math.round(sc2.size * 100) + '%';
    var sl = $('scoreGlowLevel'); if (sl) sl.value = String(sc2.glowLevel);
    var sb = $('scoreBg'); if (sb) sb.value = String(Math.round((sc2.bgAlpha == null ? 0.72 : sc2.bgAlpha) * 100));
    var sbv = $('scoreBgVal'); if (sbv) sbv.textContent = Math.round((sc2.bgAlpha == null ? 0.72 : sc2.bgAlpha) * 100) + '%';
    var bb = $('bgBlur'); if (bb) bb.value = String(state.look.bgBlur | 0);
    var bbv = $('bgBlurVal'); if (bbv) bbv.textContent = (state.look.bgBlur | 0) + '%';
    var pfo = $('perfOpts'); if (pfo) pfo.querySelectorAll('.opt').forEach(function (b) { b.classList.toggle('active', (b.getAttribute('data-perf') === 'on') === !!state.look.perfAuto); });
    var sOns = document.querySelectorAll('[data-score]');
    for (var so = 0; so < sOns.length; so++) sOns[so].classList.toggle('active', (sOns[so].getAttribute('data-score') === 'on') === !!sc2.on);
    var sGl = document.querySelectorAll('[data-sglow]');
    for (var sg = 0; sg < sGl.length; sg++) sGl[sg].classList.toggle('active', (sGl[sg].getAttribute('data-sglow') === 'on') === !!sc2.glow);
    var adv = $('ambDensityVal');
    if (adv) adv.textContent = ['少量', '正常', '略多', '非常多'][Math.max(0, Math.min(3, state.look.ambDensity | 0))];
    var sides = document.querySelectorAll('#sidebarOpts .opt');
    for (var sd = 0; sd < sides.length; sd++) sides[sd].classList.toggle('active', (sides[sd].getAttribute('data-sidebar') === 'on') === !!state.look.sidebar);
    var bars = document.querySelectorAll('#barOpts .opt');
    for (var bb = 0; bb < bars.length; bb++) bars[bb].classList.toggle('active', (bars[bb].getAttribute('data-bar') === 'on') === !!state.look.barlines);
    var fulls = document.querySelectorAll('#fullOpts .opt');
    for (var ff = 0; ff < fulls.length; ff++) fulls[ff].classList.toggle('active', (fulls[ff].getAttribute('data-full') === 'on') === !!state.look.fullscreen);
    var lcs = document.querySelectorAll('#lcOpts .opt');
    for (var lc = 0; lc < lcs.length; lc++) lcs[lc].classList.toggle('active', lcs[lc].getAttribute('data-lcolor') === state.look.leftColor);
    var rcs = document.querySelectorAll('#rcOpts .opt');
    for (var rc = 0; rc < rcs.length; rc++) rcs[rc].classList.toggle('active', rcs[rc].getAttribute('data-rcolor') === state.look.rightColor);
    var dyns = document.querySelectorAll('#dynOpts .opt');
    for (var dy = 0; dy < dyns.length; dy++) dyns[dy].classList.toggle('active', (dyns[dy].getAttribute('data-dyn') === 'on') === !!state.look.dyn);
    var mvs = document.querySelectorAll('#mvOpts .opt');
    for (var mv = 0; mv < mvs.length; mv++) mvs[mv].classList.toggle('active', (mvs[mv].getAttribute('data-move') === 'on') === !!state.look.freeMove);
    var gll = document.querySelectorAll('#glowLOpts .opt');
    for (var gl = 0; gl < gll.length; gl++) gll[gl].classList.toggle('active', gll[gl].getAttribute('data-glowl') === state.look.glowL);
    var glr = document.querySelectorAll('#glowROpts .opt');
    for (var gr = 0; gr < glr.length; gr++) glr[gr].classList.toggle('active', glr[gr].getAttribute('data-glowr') === state.look.glowR);
    var rOn = document.querySelectorAll('#recOnOpts .opt');
    for (var ro = 0; ro < rOn.length; ro++) rOn[ro].classList.toggle('active', (rOn[ro].getAttribute('data-rec') === 'on') === !!state.look.rec.on);
    var rT = document.querySelectorAll('#recTitleOpts .opt');
    for (var rt = 0; rt < rT.length; rt++) rT[rt].classList.toggle('active', (rT[rt].getAttribute('data-rectitle') === 'on') === !!state.look.rec.title);
    var rF = document.querySelectorAll('#recFxOpts .opt');
    for (var rfx = 0; rfx < rF.length; rfx++) rF[rfx].classList.toggle('active', rF[rfx].getAttribute('data-recfx') === state.look.rec.fx);
    var rS = document.querySelectorAll('#recStyleOpts .opt');
    for (var rs = 0; rs < rS.length; rs++) rS[rs].classList.toggle('active', rS[rs].getAttribute('data-recstyle') === state.look.rec.style);
    var rf = $('recFade'); if (rf) rf.value = String(Math.round(state.look.rec.fade * 10));
    var rfv = $('recFadeVal'); if (rfv) rfv.textContent = state.look.rec.fade.toFixed(1) + 's';
    var exOn = document.querySelectorAll('#extOnOpts .opt');
    for (var eo = 0; eo < exOn.length; eo++) exOn[eo].classList.toggle('active', (exOn[eo].getAttribute('data-ext') === 'on') === !!state.look.ext.on);
    var exL = $('extLines'); if (exL) exL.value = String(state.look.ext.lines);
    var exLv = $('extLinesVal'); if (exLv) exLv.textContent = String(state.look.ext.lines);
    var exA = $('extAlpha'); if (exA) exA.value = String(state.look.ext.alpha);
    var exM = $('extMpl'); if (exM) exM.value = String(state.look.ext.mpl || 0);
    var exMv = $('extMplVal'); if (exMv) exMv.textContent = (state.look.ext.mpl | 0) > 0 ? (state.look.ext.mpl + ' 小节') : '自动';
    var exX = $('extX'); if (exX) exX.value = String(state.look.ext.xoff | 0);
    var exXv = $('extXVal'); if (exXv) exXv.textContent = String(state.look.ext.xoff | 0);
    var exY = $('extY'); if (exY) exY.value = String(state.look.ext.yoff | 0);
    var exYv = $('extYVal'); if (exYv) exYv.textContent = String(state.look.ext.yoff | 0);
    var exAv = $('extAlphaVal'); if (exAv) exAv.textContent = state.look.ext.alpha + '%';
    var ga = $('guiAlpha');
    if (ga) ga.value = String(state.look.guiAlpha | 0);
    var gco = document.querySelectorAll('#guiColorOpts .opt');
    for (var gci = 0; gci < gco.length; gci++) gco[gci].classList.toggle('active', gco[gci].getAttribute('data-guicolor') === state.look.guiColor);
    var gvl = $('glowLevel');
    if (gvl) gvl.value = String(state.look.glowLevel | 0);
    var gvv = $('glowLevelVal');
    if (gvv) gvv.textContent = ['Low', 'Medium', 'High', 'Max'][Math.max(0, Math.min(3, state.look.glowLevel | 0))];
    var pmm = $('pedalMix'); if (pmm) pmm.value = String(state.look.pedalMix | 0);
    var pmv = $('pedalMixVal'); if (pmv) pmv.textContent = (state.look.pedalMix | 0) + '%';
    var npo = document.querySelectorAll('#npOnOpts .opt');
    for (var no = 0; no < npo.length; no++) npo[no].classList.toggle('active', (npo[no].getAttribute('data-np') === 'on') === !!state.look.np.on);
    var npr = document.querySelectorAll('#npRegionOpts .opt');
    for (var nr = 0; nr < npr.length; nr++) npr[nr].classList.toggle('active', npr[nr].getAttribute('data-npr') === state.look.np.region);
    var npl = document.querySelectorAll('#npLOpts .opt');
    for (var nl = 0; nl < npl.length; nl++) npl[nl].classList.toggle('active', npl[nl].getAttribute('data-npc') === state.look.np.lc);
    var nprr = document.querySelectorAll('#npROpts .opt');
    for (var nq = 0; nq < nprr.length; nq++) nprr[nq].classList.toggle('active', nprr[nq].getAttribute('data-npc') === state.look.np.rc);
    var npc = $('npCount'); if (npc) npc.value = String(state.look.np.count | 0);
    var npv2 = $('npCountVal'); if (npv2) npv2.textContent = ['少量', '正常', '略多', '非常多'][Math.max(0, Math.min(3, state.look.np.count | 0))];
    var lns = document.querySelectorAll('#lineOpts .opt');
    for (var ln = 0; ln < lns.length; ln++) lns[ln].classList.toggle('active', lns[ln].getAttribute('data-line') === state.look.lineColor);
    var lls = document.querySelectorAll('#lineLevelOpts [data-linelevel]'); for (var li = 0; li < lls.length; li++) lls[li].classList.toggle('active', +lls[li].getAttribute('data-linelevel') === state.look.linePower);
    var mos = document.querySelectorAll('#mistOnOpts [data-miston]'); for (var mi = 0; mi < mos.length; mi++) mos[mi].classList.toggle('active', (mos[mi].getAttribute('data-miston') === 'on') === !!state.look.mistOn);
    var mls = document.querySelectorAll('#mistLevelOpts [data-mistlevel]'); for (var mj = 0; mj < mls.length; mj++) mls[mj].classList.toggle('active', +mls[mj].getAttribute('data-mistlevel') === state.look.mistPower);
    var mlf = $('mistLife'); if (mlf) mlf.value = String(state.look.mistLife); var mlv = $('mistLifeVal'); if (mlv) mlv.textContent = state.look.mistLife.toFixed(1) + 's';
    var mss = document.querySelectorAll('#mistOpts .opt');
    for (var ms = 0; ms < mss.length; ms++) mss[ms].classList.toggle('active', mss[ms].getAttribute('data-mist') === state.look.mistColor);
    var kl = $('kbLen');
    if (kl) kl.value = String(state.look.kbLen);
    var klv = $('kbLenVal');
    if (klv) klv.textContent = state.look.kbLen + '%';
    var fpss = document.querySelectorAll('#fpsOpts .opt');
    for (var fp = 0; fp < fpss.length; fp++) fpss[fp].classList.toggle('active', (fpss[fp].getAttribute('data-fps') === 'on') === !!state.look.fps);
    var sts = document.querySelectorAll('#statsOpts .opt');
    for (var st = 0; st < sts.length; st++) sts[st].classList.toggle('active', (sts[st].getAttribute('data-stats') === 'on') === !!state.look.stats);
    applyDebug();
    applyTab(state.look.tab);
    applyTopbar();
    applySidebar();
    applyFullscreen();
    updatePedalChip();
  }

  function applySidebar() {
    if (!state.look.sidebar) setControlsHidden(true);
    else if (!state.playing) setControlsHidden(false);
  }

  function applyFullscreen() {
    if (document.body) document.body.classList.toggle('full', !!state.look.fullscreen);
    try {
      if (window.AndroidHost && window.AndroidHost.setFullscreen) {
        window.AndroidHost.setFullscreen(!!state.look.fullscreen);
      }
    } catch (e) { /* 浏览器环境没有原生桥 */ }
  }

  function applyTopbar() {
    var bar = document.getElementById('topbar');
    if (bar) bar.classList.toggle('hide', !state.look.topbar);
    var opts = document.querySelectorAll('#topbarOpts .opt');
    for (var i = 0; i < opts.length; i++) {
      opts[i].classList.toggle('active', (opts[i].getAttribute('data-topbar') === 'on') === !!state.look.topbar);
    }
  }

  function updatePedalChip() {
    var el = $('pedal');
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.toggle('dim', !state.look.pedal);
    el.classList.toggle('active', !!(state.look.pedal && state.pedalOn));
    el.title = !state.look.pedal
      ? '延音踏板已关闭（点按开启）'
      : '延音踏板（点按关闭）';
    el.style.cursor = 'pointer';
  }
  function applyTab(name) {
    var tabs = document.querySelectorAll('#sheetTabs .tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === name);
    var panes = document.querySelectorAll('#sheet .sheet-pane');
    for (var j = 0; j < panes.length; j++) panes[j].classList.toggle('active', panes[j].getAttribute('data-pane') === name);
  }

  function loadDemo() {
    if (!window.DEMO_MIDI_B64) return false;
    try {
      var parsed = MidiParser.parseMidi(b64ToBytes(window.DEMO_MIDI_B64));
      loadParsed(parsed, '示例曲目');
      $('songTitle').textContent = '示例 · ' + (parsed.name || '夜空琶音');
      return true;
    } catch (e) { return false; }
  }

  function hideHome() {
    state.home = false;
    var el = $('home');
    if (el) el.classList.add('hidden');
    applySidebar();
    applyCollapse();
  }

  function showHome() {
    if (state.playing) pause();
    state.freePlay = false;
    state.freeBars.length = 0;
    state.home = true;
    applyCollapse();
    var el = $('home');
    if (el) el.classList.remove('hidden');
    var fh = $('freeHint');
    if (fh) fh.classList.add('hidden');
    setControlsHidden(true);
    if (!state.notes.length) {
      $('songTitle').textContent = 'MIDI 钢琴';
      $('songMeta').textContent = '选择一种方式开始';
    }
  }

  function exitApp() {
    try {
      if (window.AndroidHost && window.AndroidHost.exitApp) { window.AndroidHost.exitApp(); return; }
    } catch (e) { /* 浏览器环境 */ }
    try { window.close(); } catch (e) { /* ignore */ }
    toast('请按系统返回键退出');
  }

  function viewX(x) {
    var w = window.innerWidth;
    return (x - w / 2) * state.view.zoom + w / 2 - state.view.pan;
  }
  function viewW(v) { return v * state.view.zoom; }
  function baseX(x) {
    var w = window.innerWidth;
    return (x + state.view.pan - w / 2) / state.view.zoom + w / 2;
  }
  function keyAtX(x) {
    var bx = baseX(x), key = null;
    for (var i = 0; i < state.keys.length; i++) {
      var k = state.keys[i];
      if (bx < k.x || bx > k.x + k.w) continue;
      if (k.black) return k;
      if (!key) key = k;
    }
    return key;
  }
  function clampView() {
    state.view.pan = 0;
    if (state.view.zoom < 1) state.view.zoom = 1;
    if (state.view.zoom > 3) state.view.zoom = 3;
    var w = window.innerWidth, z = state.view.zoom;
    var lim = w * (z - 1) / 2 + 24;
    state.view.pan = Math.max(-lim, Math.min(lim, state.view.pan));
  }
  function resetZoom() {
    state.view.zoom = 1;
    state.view.pan = 0;
    state.view.vzoom = 1;
    toast('画面已重置为 100%');
  }
  function applyDebug() {
    var box = $('debugBox');
    if (!box) return;
    box.classList.toggle('hidden', !(state.look.fps || state.look.stats));
  }
  function updateDebugBox() {
    if (!state.look.fps && !state.look.stats) return;
    var box = $('debugBox');
    if (!box) return;
    var lines = [];
    if (state.look.fps) lines.push('FPS ' + state.fps);
    if (state.look.stats) {
      lines.push('音符 ' + state.notes.length + ' / 粒子 ' + state.particles.length);
      lines.push('缩放 ' + Math.round(state.view.zoom * 100) + '% · 平移 ' + Math.round(state.view.pan) + 'px');
      lines.push('模式 ' + (state.freePlay ? '自由弹奏' : '播放') + ' · ' + (state.gesture.mode || '-'));
    }
    box.textContent = lines.join('\n');
  }
  function strikeKey(key, vel) {
    ensureAudio();
    if (audio.ctx) scheduleVoice(key.midi, audio.ctx.currentTime + 0.006, 0.85, vel, false,
      state.look.dyn ? Math.pow(vel, 2.0) : vel);
    state.freePressed[key.midi] = performance.now();
    var side = key.midi < 60 ? 'L' : 'R';
    var th = handTheme(side);
    state.freeBars.push({ x: key.x + key.w * 0.07, w: key.w * 0.86, len: 0, max: 70 + 300 * vel, life: 0, ttl: 0.85, color: th.base, light: th.light });
  }
  function freeStrike(x, y) {
    if (y < state.hitY - 28) return null;
    var key = keyAtX(x);
    if (!key) return null;
    var vel = clamp(0.5 + (y - state.hitY) / Math.max(1, state.kbH) * 0.55, 0.35, 1);
    strikeKey(key, vel);
    return key.midi;
  }

  function updateFreeBars(dt) {
    for (var i = state.freeBars.length - 1; i >= 0; i--) {
      var b = state.freeBars[i];
      b.life += dt;
      if (b.life >= b.ttl) state.freeBars.splice(i, 1);
    }
  }

  function drawFreeBars() {
    for (var i = 0; i < state.freeBars.length; i++) {
      var b = state.freeBars[i];
      var p = Math.min(1, b.life / b.ttl);
      var len = b.max * (1 - Math.pow(1 - p, 2));
      var alpha = 1 - p;
      var top = state.hitY - len;
      var g = ctx.createLinearGradient(0, top, 0, state.hitY);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.35, b.light);
      g.addColorStop(1, b.color);
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = g;
      var bx = viewX(b.x), bw = viewW(b.w);
      roundRect(ctx, bx, top, bw, Math.max(4, len), Math.min(6, bw / 2));
      ctx.fill();
      ctx.globalAlpha = alpha * 0.22;
      ctx.fillStyle = b.color;
      roundRect(ctx, bx - 2, top, bw + 4, Math.max(4, len), Math.min(8, bw / 2 + 2));
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function openSheet() {
    $('sheet').classList.remove('hidden');
    $('sheetBack').classList.remove('hidden');
    bumpControls();
  }
  function closeSheet() {
    $('sheet').classList.add('hidden');
    $('sheetBack').classList.add('hidden');
  }

  function notePath(x, y, w, h, shape) {
    ctx.beginPath();
    if (shape === 'rounded') {
      roundRect(ctx, x, y, w, h, Math.max(1, Math.min(3, w * 0.2)));
    } else if (shape === 'diamond') {
      var cx = x + w / 2, cy = y + h / 2;
      ctx.moveTo(cx, y);
      ctx.lineTo(x + w, cy);
      ctx.lineTo(cx, y + h);
      ctx.lineTo(x, cy);
      ctx.closePath();
    } else if (shape === 'orb') {
      ctx.ellipse(x + w / 2, y + h / 2, Math.max(1.5, w / 2), Math.max(2, h / 2), 0, 0, Math.PI * 2);
    } else if (shape === 'beam') {
      roundRect(ctx, x + w * 0.24, y, Math.max(2, w * 0.52), h, Math.max(1, w * 0.26));
    } else {
      roundRect(ctx, x, y, w, h, Math.max(1, Math.min(w / 2, h / 2)));
    }
  }

  // ---- 命中特效：水花 / 火花 / 星尘 ----
  function splash(midi, color, power) {
    var k = state.keyMap[midi];
    if (!k) return;
    var cx = k.x + k.w / 2, cy = state.hitY + 2;
    var count = Math.round(14 + 12 * power);
    for (var i = 0; i < count; i++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6;
      var sp = 70 + Math.random() * 260 * (0.45 + power);
      state.particles.push({
        kind: 'drop',
        x: cx + (Math.random() - 0.5) * 8,
        y: cy,
        vx: Math.cos(a) * sp * 0.55,
        vy: Math.sin(a) * sp - 40,
        life: 0,
        max: 0.5 + Math.random() * 0.45,
        size: 1.6 + Math.random() * 2.4,
        color: color,
        grav: 980,
        soft: false
      });
    }
    var wakes = Math.round(6 + 6 * power);
    for (var wv = 0; wv < wakes; wv++) {
      state.particles.push({
        kind: 'wake', x: cx + (Math.random() - 0.5) * 26, y: cy - 2,
        vx: (Math.random() - 0.5) * 26, vy: -150 - Math.random() * 210,
        len: 10 + Math.random() * 18, life: 0, max: 0.4 + Math.random() * 0.4,
        size: 1.6 + Math.random() * 1.6, color: color, grav: 520, soft: false
      });
    }
    for (var r = 0; r < 2; r++) {
      state.waves.push({
        x: cx, y: cy, life: 0, max: 0.45 + r * 0.28,
        color: color, ripple: true, maxR: 58 + r * 62
      });
    }
    state.hitPulse = Math.min(1, state.hitPulse + 0.22);
    if (state.particles.length > 1200) state.particles.splice(0, state.particles.length - 1200);
  }

  function stardust(midi, color, power) {
    var k = state.keyMap[midi];
    if (!k) return;
    var cx = k.x + k.w / 2, cy = state.hitY - 2;
    var count = Math.round(6 + 10 * power);
    for (var i = 0; i < count; i++) {
      state.particles.push({
        kind: 'star',
        x: cx + (Math.random() - 0.5) * 14,
        y: cy,
        vx: (Math.random() - 0.5) * 70,
        vy: -30 - Math.random() * 110,
        life: 0,
        max: 0.6 + Math.random() * 0.7,
        size: 0.8 + Math.random() * 1.8,
        color: Math.random() < 0.6 ? '#ffe9a8' : color,
        grav: 60,
        soft: true
      });
    }
    state.hitPulse = Math.min(1, state.hitPulse + 0.12);
  }

  function flame(midi, color, power) {
    var k = state.keyMap[midi];
    if (!k) return;
    var cx = k.x + k.w / 2, cy = state.hitY + 2;
    var palette = ['#ffd166', '#ff9f1c', '#ff6b35', '#fff3b0'];
    var count = Math.round(9 + 11 * power);
    for (var i = 0; i < count; i++) {
      state.particles.push({
        kind: 'ember',
        x: cx + (Math.random() - 0.5) * 10,
        y: cy + Math.random() * 3,
        vx: (Math.random() - 0.5) * 95,
        vy: -55 - Math.random() * 175,
        life: 0,
        max: 0.3 + Math.random() * 0.5,
        size: 1.1 + Math.random() * 2.0,
        color: palette[i % palette.length],
        grav: -35,
        soft: true
      });
    }
    state.hitPulse = Math.min(1, state.hitPulse + 0.18);
  }

  function mapleHit(midi, color, power) {
    var k = state.keyMap[midi];
    if (!k) return;
    var cx = k.x + k.w / 2, cy = state.hitY - 2;
    var count = Math.round(9 + 9 * power);
    var pal = ['#ffb347', '#ff7a1a', '#d9480f', '#ffd9a0'];
    for (var i = 0; i < count; i++) {
      state.particles.push({
        kind: 'leaf',
        x: cx + (Math.random() - 0.5) * 12,
        y: cy,
        vx: (Math.random() - 0.5) * 210,
        vy: -50 - Math.random() * 150,
        life: 0,
        max: 0.9 + Math.random() * 0.7,
        size: 2.2 + Math.random() * 2.2,
        color: pal[(Math.random() * pal.length) | 0],
        grav: 250,
        rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 7,
        soft: false
      });
    }
    state.hitPulse = Math.min(1, state.hitPulse + 0.15);
  }

  function cyberHit(midi, color, power) {
    var k = state.keyMap[midi];
    if (!k) return;
    var cx = k.x + k.w / 2, cy = state.hitY - 2;
    var count = Math.round(10 + 10 * power);
    var pal = ['#00e5ff', '#ff3df2', '#b388ff', '#ffffff'];
    for (var i = 0; i < count; i++) {
      state.particles.push({
        kind: 'shard',
        x: cx + (Math.random() - 0.5) * 10,
        y: cy,
        vx: (Math.random() - 0.5) * 300,
        vy: -40 - Math.random() * 190,
        life: 0,
        max: 0.5 + Math.random() * 0.5,
        size: 1.3 + Math.random() * 1.4,
        len: 8 + Math.random() * 14,
        color: pal[(Math.random() * pal.length) | 0],
        grav: 120,
        rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 10,
        soft: false
      });
    }
    state.hitPulse = Math.min(1, state.hitPulse + 0.15);
  }

  function sakuraHit(midi, color, power) {
    var k = state.keyMap[midi];
    if (!k) return;
    var cx = k.x + k.w / 2, cy = state.hitY - 2;
    var count = Math.round(9 + 11 * power);
    for (var i = 0; i < count; i++) {
      state.particles.push({
        kind: 'petal',
        x: cx + (Math.random() - 0.5) * 12,
        y: cy,
        vx: (Math.random() - 0.5) * 150,
        vy: -55 - Math.random() * 150,
        life: 0,
        max: 0.9 + Math.random() * 0.65,
        size: 2.0 + Math.random() * 2.2,
        color: Math.random() < 0.5 ? '#ffd1e0' : '#ff9dbd',
        grav: 230,
        rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 6,
        soft: false
      });
    }
    state.hitPulse = Math.min(1, state.hitPulse + 0.14);
  }

  function hitEffect(n) {
    var fx = state.look.fx;
    if (fx === 'none') { state.hitPulse = Math.min(1, state.hitPulse + 0.06); return; }
    var c = noteColor(n);
    if (fx === 'spark') burst(n.midi, c, n.velocity);
    else if (fx === 'flame') flame(n.midi, c, n.velocity);
    else if (fx === 'sakura') sakuraHit(n.midi, c, n.velocity);
    else if (fx === 'maple') mapleHit(n.midi, c, n.velocity);
    else if (fx === 'cyber') cyberHit(n.midi, c, n.velocity);
    else if (fx === 'stardust') stardust(n.midi, c, n.velocity);
    else splash(n.midi, c, n.velocity);
  }

  function drawNotes(t) {
    var w = window.innerWidth;
    var hitY = state.hitY;
    var vz = state.view.vzoom || 1; if (!isFinite(vz) || vz <= 0) vz = 1;
    var pps = state.pxPerSec * state.speed * vz;
    var windowSec = hitY / pps + 0.2;
    var notes = state.notes;
    var i = lowerBound(notes, t - 12);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, hitY);
    ctx.clip();

    if (state.keyMarks && state.keyMarks.length) {
      for (var kmi = 0; kmi < state.keyMarks.length; kmi++) {
        var km = state.keyMarks[kmi];
        var ky2 = hitY - (km.time - t) * pps;
        if (ky2 < -30 || ky2 > hitY + 2) continue;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 209, 102, 0.5)';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(0, ky2); ctx.lineTo(w, ky2); ctx.stroke();
        ctx.fillStyle = 'rgba(255, 225, 150, 0.92)';
        ctx.font = '600 11px sans-serif';
        ctx.fillText(km.label, 10, ky2 + 14);
        ctx.restore();
      }
    }
    if (state.look.barlines && state.bars && state.bars.length) {
      ctx.strokeStyle = 'rgba(160, 200, 255, 0.13)';
      ctx.lineWidth = 1;
      for (var bi = 0; bi < state.bars.length; bi++) {
        var bt = state.bars[bi];
        if (bt < t - 1) continue;
        var by = hitY - (bt - t) * pps;
        if (by < -2) break;
        if (by > hitY) continue;
        ctx.beginPath();
        ctx.moveTo(0, by + 0.5);
        ctx.lineTo(w, by + 0.5);
        ctx.stroke();
      }
    }

    for (; i < notes.length; i++) {
      var n = notes[i];
      if (n.start > t + windowSec) break;
      if (n.end < t - 0.5) continue;
      var k = state.keyMap[n.midi];
      if (!k) continue;
      var geo = noteGeom(k);
      // 音符的下沿（start）先到命中线，上沿（end）后到；end 越晚位置越高
      var top = hitY - (n.end - t) * pps;
      var bottom = hitY - (n.start - t) * pps;
      var hgt = bottom - top;
      var minH = n.glass ? 9 : 5;
      if (hgt < minH) hgt = minH;
      if (bottom < -10 || top > hitY) continue;

      var color = n.glass ? '#ffffff' : noteColor(n);
      var active = t >= n.start && t <= n.end;
      // shadowBlur 在移动端每帧都很贵，用一层半透明轮廓代替外发光
      if (active || state.pedalOn) {
        ctx.globalAlpha = active ? 0.30 : 0.15;
        ctx.fillStyle = color;
        notePath(geo.x - 2, top - 2, geo.w + 4, hgt + 4, state.look.shape);
        ctx.fill();
      }
      ctx.globalAlpha = active ? 1 : 0.9;
      var gcol = handOf(n) === 'L' ? state.look.glowL : state.look.glowR;
      if ((!gcol || gcol === 'none') && state.look.glow && state.look.glow !== 'none') gcol = state.look.glow;
      var glowOn = !!gcol && gcol !== 'none';
      notePath(geo.x, top, geo.w, hgt, state.look.shape);
      ctx.fillStyle = hgt < 30 ? color : noteGradient(n, top, bottom);
      var heavy = state.notes.length > 2200 && !active;
      if (glowOn && !heavy) {
        ctx.shadowColor = hexToRgba(GLOWS[gcol] || '#ffffff', 0.9);
        ctx.shadowBlur = state.lowQ ? 0 : [6, 10, 14, 20][Math.max(0, Math.min(3, state.look.glowLevel | 0))];
      } else if (!state.lowQ) {
        ctx.shadowColor = hexToRgba(color, 0.82);
        ctx.shadowBlur = 14;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'rgba(0,0,0,0)';

      // 顶部高光 + 底部亮边，让渐变有层次
      if (hgt > 12) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      roundRect(ctx, geo.x + 1, top + 1, Math.max(1, geo.w - 2), Math.min(2.5, hgt * 0.25), 1.2);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = color;
      roundRect(ctx, geo.x + 1, bottom - Math.min(3, hgt * 0.3), Math.max(1, geo.w - 2), Math.min(2, hgt * 0.2), 1);
      ctx.fill();
      ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  var kbCache = null, kbCacheW = 0, kbCacheH = 0;

  function buildKbCache() {
    var w = window.innerWidth, h = window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    kbCache = document.createElement('canvas');
    kbCache.width = Math.max(1, Math.floor(w * dpr));
    kbCache.height = Math.max(1, Math.floor(h * dpr));
    var c = kbCache.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    var hitY = state.hitY, kbH = state.kbH;
    var i;
    for (i = 0; i < state.keys.length; i++) {
      var k = state.keys[i];
      if (k.black) continue;
      c.beginPath();
      roundRect(c, k.x + 0.5, hitY, k.w - 1, kbH, Math.min(5, k.w / 4));
      var wg = c.createLinearGradient(0, hitY, 0, h);
      wg.addColorStop(0, '#f2f6ff');
      wg.addColorStop(1, '#c9d3e6');
      c.fillStyle = wg;
      c.fill();
      c.strokeStyle = 'rgba(8, 12, 24, 0.85)';
      c.lineWidth = 1;
      c.stroke();
    }
    for (i = 0; i < state.keys.length; i++) {
      var b = state.keys[i];
      if (!b.black) continue;
      c.beginPath();
      roundRect(c, b.x, hitY, b.w, kbH * 0.62, Math.min(4, b.w / 3));
      var bg = c.createLinearGradient(0, hitY, 0, hitY + kbH * 0.62);
      bg.addColorStop(0, '#1b2338');
      bg.addColorStop(1, '#070b16');
      c.fillStyle = bg;
      c.fill();
      c.strokeStyle = 'rgba(0, 0, 0, 0.9)';
      c.stroke();
    }
    c.fillStyle = 'rgba(40, 50, 70, 0.75)';
    c.font = '9px system-ui, sans-serif';
    c.textAlign = 'center';
    for (i = 0; i < state.keys.length; i++) {
      var ck = state.keys[i];
      if (ck.black || ck.midi % 12 !== 0) continue;
      c.fillText('C' + (Math.floor(ck.midi / 12) - 1), ck.x + ck.w / 2, h - 6);
    }
    kbCacheW = w;
    kbCacheH = h;
  }

  function drawFreeKeyboard(pressed) {
    var w = window.innerWidth, h = window.innerHeight;
    var hitY = state.hitY, kbH = state.kbH;
    var i, k, x, kw;
    for (i = 0; i < state.keys.length; i++) {
      k = state.keys[i];
      if (k.black) continue;
      x = viewX(k.x); kw = viewW(k.w);
      if (x + kw < -2 || x > w + 2) continue;
      var wg = ctx.createLinearGradient(0, hitY, 0, h);
      wg.addColorStop(0, '#f2f6ff');
      wg.addColorStop(1, '#c9d3e6');
      ctx.beginPath();
      roundRect(ctx, x + 0.5, hitY, Math.max(1, kw - 1), kbH, Math.min(5, kw / 4));
      ctx.fillStyle = wg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(8,12,24,0.85)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    for (i = 0; i < state.keys.length; i++) {
      k = state.keys[i];
      if (!k.black) continue;
      x = viewX(k.x); kw = viewW(k.w);
      if (x + kw < -2 || x > w + 2) continue;
      var bg = ctx.createLinearGradient(0, hitY, 0, hitY + kbH * 0.62);
      bg.addColorStop(0, '#1b2338');
      bg.addColorStop(1, '#070b16');
      ctx.beginPath();
      roundRect(ctx, x, hitY, kw, kbH * 0.62, Math.min(4, kw / 3));
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.stroke();
    }
    for (i = 0; i < state.keys.length; i++) {
      k = state.keys[i];
      var down = pressed[k.midi];
      if (!down) continue;
      x = viewX(k.x); kw = viewW(k.w);
      if (x + kw < -2 || x > w + 2) continue;
      if (k.black) {
        ctx.beginPath();
        roundRect(ctx, x, hitY, kw, kbH * 0.62, Math.min(4, kw / 3));
        ctx.fillStyle = down;
        ctx.fill();
      } else {
        var pg = ctx.createLinearGradient(0, hitY, 0, h);
        pg.addColorStop(0, down);
        pg.addColorStop(1, '#ffffff');
        ctx.beginPath();
        roundRect(ctx, x + 0.5, hitY, Math.max(1, kw - 1), kbH, Math.min(5, kw / 4));
        ctx.fillStyle = pg;
        ctx.fill();
      }
      var grad = ctx.createLinearGradient(0, hitY - 70, 0, hitY);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, down);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = grad;
      ctx.fillRect(x + 1, hitY - 70, Math.max(1, kw - 2), 70);
      ctx.globalAlpha = 1;
    }
  }

  function drawKeyboard(t) {
    var w = window.innerWidth, h = window.innerHeight;
    var kbH = state.kbH, hitY = state.hitY;
    var whiteW = w / 52;
    var pressed = {};
    var i, n;
    var vz = state.view.vzoom || 1; if (!isFinite(vz) || vz <= 0) vz = 1;
    var pps = state.pxPerSec * state.speed * vz;
    var windowSec = hitY / pps + 0.2;
    var start = lowerBound(state.notes, t - 12);
    for (i = start; i < state.notes.length; i++) {
      n = state.notes[i];
      if (n.start > t + windowSec) break;
      if (t >= n.start && t <= n.end) {
        pressed[n.midi] = noteColor(n);
      }
    }

    var nowMs = performance.now();
    for (var fk in state.freePressed) {
      if (nowMs - state.freePressed[fk] < 280) {
        var fnum = +fk;
        if (!pressed[fnum]) pressed[fnum] = handTheme(fnum < 60 ? 'L' : 'R').base;
      }
    }

    if (state.freePlay) { drawFreeKeyboard(pressed); return; }

    // 静态键盘缓存：白键/黑键/音名每帧重画 52+36 个渐变太贵
    if (!kbCache || kbCacheW !== w || kbCacheH !== h) buildKbCache();
    ctx.drawImage(kbCache, 0, 0, w, h);

    // 只重绘按下的键
    for (i = 0; i < state.keys.length; i++) {
      var k = state.keys[i];
      if (k.black) continue;
      var down = pressed[k.midi];
      if (!down) continue;
      ctx.beginPath();
      roundRect(ctx, k.x + 0.5, hitY, k.w - 1, kbH, Math.min(5, k.w / 4));
      var pg = ctx.createLinearGradient(0, hitY, 0, h);
      pg.addColorStop(0, down);
      pg.addColorStop(1, '#ffffff');
      ctx.fillStyle = pg;
      ctx.fill();
    }
    for (i = 0; i < state.keys.length; i++) {
      var b = state.keys[i];
      if (!b.black) continue;
      var bd = pressed[b.midi];
      if (!bd) continue;
      ctx.beginPath();
      roundRect(ctx, b.x, hitY, b.w, kbH * 0.62, Math.min(4, b.w / 3));
      ctx.fillStyle = bd;
      ctx.fill();
    }

    // 按下时的竖向光柱
    for (i = 0; i < state.keys.length; i++) {
      var pk = state.keys[i];
      if (!pressed[pk.midi]) continue;
      var grad = ctx.createLinearGradient(0, hitY - 70, 0, hitY);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, pressed[pk.midi]);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = grad;
      ctx.fillRect(pk.x + 1, hitY - 70, pk.w - 2, 70);
      ctx.globalAlpha = 1;
    }

    // 命中线
    var pulse = 0.55 + 0.45 * state.hitPulse;
    if (state.pedalOn) {
      var pg2 = ctx.createLinearGradient(0, hitY - 28, 0, hitY);
      pg2.addColorStop(0, 'rgba(255,209,102,0)');
      pg2.addColorStop(1, 'rgba(255,209,102,0.20)');
      ctx.fillStyle = pg2;
      ctx.fillRect(0, hitY - 28, w, 28);
    }
    var rgbLine = state.pedalOn ? '255, 209, 102' : '76, 201, 240';
    var lg = ctx.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, 'rgba(' + rgbLine + ', 0)');
    lg.addColorStop(0.5, 'rgba(' + rgbLine + ', ' + (0.75 * pulse) + ')');
    lg.addColorStop(1, 'rgba(' + rgbLine + ', 0)');
    ctx.strokeStyle = lg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, hitY + 0.5);
    ctx.lineTo(w, hitY + 0.5);
    ctx.stroke();
    state.hitPulse = Math.max(0, state.hitPulse - 0.03);
  }

  function drawStageFx(t) {
    var w = window.innerWidth, hitY = state.hitY;
    var mist = state.look.mistColor, line = state.look.lineColor;
    if (mist && mist !== 'none' && GLOWS[mist]) {
      var mh = 84;
      var g = ctx.createLinearGradient(0, hitY - mh, 0, hitY + 4);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.55, hexToRgba(GLOWS[mist], 0.16));
      g.addColorStop(1, hexToRgba(GLOWS[mist], 0.02));
      ctx.fillStyle = g;
      ctx.fillRect(0, hitY - mh, w, mh + 4);
      for (var i = 0; i < 3; i++) {
        var cx = (w * (i + 0.5) / 3 + Math.sin(t * 0.5 + i * 2.1) * 40) % w;
        var rr = 60 + i * 22;
        var rg = ctx.createRadialGradient(cx, hitY - 18, 4, cx, hitY - 18, rr);
        rg.addColorStop(0, hexToRgba(GLOWS[mist], 0.18));
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(cx, hitY - 18, rr, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (line && line !== 'none' && GLOWS[line]) {
      var c = GLOWS[line];
      var pw = state.look.linePower || 0, eh = 72 + pw * 56;
      var eg = ctx.createLinearGradient(0, hitY - eh, 0, hitY + 2);
      eg.addColorStop(0, 'rgba(0,0,0,0)');
      eg.addColorStop(0.5, hexToRgba(c, 0.14 + pw * 0.08));
      eg.addColorStop(1, hexToRgba(c, 0.30 + pw * 0.13));
      ctx.fillStyle = eg; ctx.fillRect(0, hitY - eh, w, eh + 2);
      ctx.save();
      ctx.shadowColor = c;
      ctx.shadowBlur = 30;
      ctx.strokeStyle = c;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(0, hitY - 1);
      ctx.lineTo(w, hitY - 1);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(0, hitY - 1);
      ctx.lineTo(w, hitY - 1);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------------- 乐谱 ----------------
  var SCORE_COLORS = { white: '#ffffff', gold: '#ffcf5c', blue: '#7fb6ff', teal: '#5ce6d8', purple: '#b98bff',
    pink: '#ff8fc4', red: '#ff6b7a', green: '#5ee08a', orange: '#ff9a3d', rose: '#ff9fc0' };
  var scoreBuf = null, scoreBufCtx = null, scoreBufAt = 0, scoreBufKey = '';
  function drawExternalScore(t) {
    try { drawExternalScoreInner(t); } catch (e) { logLine('EXT ' + (e && e.message ? e.message : e)); }
  }
  function drawExternalScoreInner(t) {
    var ex = state.look.ext || {}; var imgs = state.ext.imgs || [];
    if (!imgs.length) return;
    var vw = window.innerWidth, x = 4, y = (state.look.score.pos || 20), w = vw - 8, h = 160 * (state.look.score.size || 0.9);
    var dur = Math.max(0.1, state.duration || 1);
    var lines = Math.max(1, state.ext.lines | 0), total = imgs.length * lines;
    var starts = state.bars && state.bars.length ? state.bars : null;
    var line;
    var mpl = state.look.ext.mpl | 0;
    if (mpl > 0 && starts) {
      var lo = 0, hi = starts.length - 1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (starts[mid] <= t + 1e-6) lo = mid; else hi = mid - 1; }
      line = Math.floor(lo / mpl) + (state.look.ext.lineShift | 0);
    } else if (starts) {
      var per = Math.max(1, Math.ceil(starts.length / total));
      var lo2 = 0, hi2 = starts.length - 1;
      while (lo2 < hi2) { var md = (lo2 + hi2 + 1) >> 1; if (starts[md] <= t + 1e-6) lo2 = md; else hi2 = md - 1; }
      line = Math.floor(lo2 / per) + (state.look.ext.lineShift | 0);
    } else {
      line = Math.floor((t / dur) * total) + (state.look.ext.lineShift | 0);
    }
    line = Math.min(total - 1, Math.max(0, line));
    var page = Math.min(imgs.length - 1, Math.floor(line / lines)), within = line % lines;
    var img = imgs[page]; if (!img || !img.width) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.globalAlpha = (state.look.ext.alpha || 85) / 100;
    var sc = w / img.width, dh = img.height * sc;
    var rowH = dh / lines;
    var off = y + h / 2 - (within + 0.5) * rowH;
    ctx.fillStyle = 'rgba(3,5,12,.72)'; ctx.fillRect(x, y, w, h);
    ctx.drawImage(img, x, off, w, dh);
    ctx.globalAlpha = 1;
    var hy = off + within * rowH;
    ctx.fillStyle = 'rgba(88,200,255,.16)'; ctx.fillRect(x, hy, w, rowH);
    ctx.strokeStyle = 'rgba(120,220,255,.85)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x, hy); ctx.lineTo(x + w, hy); ctx.stroke();
    ctx.fillStyle = 'rgba(160,220,255,.9)'; ctx.font = '11px system-ui';
    ctx.fillText('第 ' + (line + 1) + ' / ' + total + ' 行 · 第 ' + (page + 1) + ' 页', x + 6, y + h - 6);
    ctx.restore();
  }

  function drawScoreOverlay(t) {
    if (state.look.ext && state.look.ext.on && state.ext.imgs && state.ext.imgs.length) { drawExternalScore(t); return; }
    if (!state.score || !state.look.score.on || !window.MusicXML) return;
    var s = state.look.score;
    var vw = window.innerWidth, vh = window.innerHeight;
    var dpr2 = Math.min(window.devicePixelRatio || 1, 2);
    if (!scoreBuf) {
      scoreBuf = document.createElement('canvas');
      scoreBufCtx = scoreBuf.getContext('2d');
    }
    if (scoreBuf.width !== Math.floor(vw * dpr2) || scoreBuf.height !== Math.floor(vh * dpr2)) {
      scoreBuf.width = Math.floor(vw * dpr2); scoreBuf.height = Math.floor(vh * dpr2); scoreBufKey = '';
    }
    var key2 = [s.color, s.size, s.pos, s.glow, s.glowLevel, s.bgAlpha, vw, vh].join('|');
    var now2 = performance.now();
    var gap2 = state.lowQ ? 66 : 33;
    if (key2 !== scoreBufKey || now2 - scoreBufAt > gap2) {
      scoreBufCtx.setTransform(dpr2, 0, 0, dpr2, 0, 0);
      scoreBufCtx.clearRect(0, 0, vw, vh);
      MusicXML.drawScore(scoreBufCtx, state.score, {
        x: 4, y: s.pos, w: vw - 8, h: 160 * s.size,
        color: SCORE_COLORS[s.color] || '#ffffff',
        glow: !!s.glow, glowBlur: [4, 10, 16, 24][s.glowLevel] || 10,
        size: s.size, windowSec: 12, bgAlpha: s.bgAlpha == null ? 0.72 : s.bgAlpha
      }, { time: scoreTimeAt(t) });
      scoreBufAt = now2; scoreBufKey = key2;
    }
    ctx.drawImage(scoreBuf, 0, 0, vw, vh);
    return;
    MusicXML.drawScore(ctx, state.score, {
      x: 4, y: s.pos, w: window.innerWidth - 8, h: 160 * s.size,
      color: SCORE_COLORS[s.color] || '#ffffff',
      glow: !!s.glow, glowBlur: [4, 10, 16, 24][s.glowLevel] || 10,
      size: s.size, windowSec: 12, bgAlpha: s.bgAlpha == null ? 0.72 : s.bgAlpha
    }, { time: t });
  }
  // 按反复记号展开乐谱，生成可播放时间轴
  function buildScorePerformance(sc) {
    var ms = sc.measures || [], n = ms.length;
    if (!n) return null;
    function idxAtTime(tt, useEnd) {
      for (var i = 0; i < n; i++) if (Math.abs((useEnd ? ms[i].end : ms[i].start) - tt) < 0.03) return i;
      return -1;
    }
    var fwd = {}, back = {};
    (sc.repeats || []).forEach(function (r) {
      var i = idxAtTime(r.at, r.dir === 'back');
      if (i < 0) return;
      if (r.dir === 'fwd') fwd[i] = true; else back[i] = true;
    });
    var endings = (sc.endings || []).map(function (e) {
      return { start: e.start, end: e.end, label: String(e.label || '1') };
    });
    function fwdBefore(i) { for (var k = i; k >= 0; k--) if (fwd[k]) return k; return 0; }
    var dyns = (sc.dynamics || []).slice().sort(function (a, b) { return a.time - b.time; });
    function dynAt(tt) {
      var g = 1, lastDyn = null;
      for (var di = 0; di < dyns.length; di++) { if (dyns[di].time <= tt + 0.001) { g = dyns[di].gain; lastDyn = dyns[di]; } else break; }
      if (lastDyn && lastDyn.label === 'fp' && tt > lastDyn.time + 0.15) g *= 0.35;
      var ws = sc.wedges || [];
      for (var wi2 = 0; wi2 < ws.length; wi2++) {
        var wg2 = ws[wi2];
        if (tt >= wg2.start && tt <= wg2.end) {
          var pr = (tt - wg2.start) / Math.max(0.05, wg2.end - wg2.start);
          g *= wg2.type === 'crescendo' ? (1 + pr * 0.55) : (1 - pr * 0.45);
        }
      }
      return g;
    }
    var order = [], passes = {}, guard = 0;
    var doneDC = false, doneDS = false, doneCoda = false, inCoda = false;
    var segnoIdx = -1, codaIdx = -1;
    function measureAt(tt) {
      for (var qm = 0; qm < ms.length; qm++) if (tt >= ms[qm].start - 0.02 && tt < ms[qm].end - 0.001) return qm;
      return -1;
    }
    (sc.directions || []).forEach(function (d) {
      if (d.sym === 'segno') segnoIdx = measureAt(d.time);
      if (d.sym === 'coda') codaIdx = measureAt(d.time);
    });
    var i = 0;
    while (i < n && guard++ < 20000) {
      var m = ms[i], skip = false;
      for (var e = 0; e < endings.length; e++) {
        var en = endings[e];
        if (m.start >= en.start - 0.02 && m.start < en.end - 0.02) {
          var key = fwdBefore(i);
          var pass = passes[key] || 0;
          if (en.label === '1' && pass > 0) skip = true;
          if (en.label !== '1' && pass === 0) skip = true;
        }
      }
      var jump = -1;
      (sc.directions || []).forEach(function (d) {
        if (d.sym || d.time < m.start - 0.02 || d.time >= m.end - 0.001) return;
        var tx = d.text;
        if (/D\.?\s*S\.?/i.test(tx) && !doneDS && !inCoda && segnoIdx >= 0) { doneDS = true; jump = segnoIdx; }
        else if (/D\.?\s*C\.?/i.test(tx) && !doneDC && !inCoda) { doneDC = true; jump = 0; }
        else if (/To\s+Coda/i.test(tx) && !doneCoda && codaIdx >= 0 && (doneDS || doneDC)) { doneCoda = true; inCoda = true; jump = codaIdx; }
        else if (/Fine/i.test(tx) && (doneDC || doneDS)) jump = n;
      });
      if (jump >= 0) { i = jump; if (i >= n) break; continue; }
      if (!skip) order.push(i);
      if (!skip && back[i]) {
        var f = fwdBefore(i), p = passes[f] || 0;
        if (p < 1) { passes[f] = p + 1; i = f; continue; }
      }
      i++;
    }
    if (!order.length) order = [0];
    var segments = [], notes = [], cur = 0;
    order.forEach(function (mi) {
      var mm = ms[mi], len = Math.max(0.05, mm.end - mm.start);
      segments.push({ p0: cur, p1: cur + len, s0: mm.start, s1: mm.end });
      var arpBase = null, arpIdx = 0;
      (sc.notes || []).forEach(function (nn) {
        if (nn.rest || nn.start < mm.start - 0.01 || nn.start >= mm.end - 0.001) return;
        var arts = nn.arts || {};
        if (nn.start !== arpBase) { arpBase = nn.start; arpIdx = 0; }
        var st0 = cur + (nn.start - mm.start) + (arts.arpeggio ? arpIdx * 0.045 : 0);
        if (nn.graces && nn.graces.length) {
          for (var gi = 0; gi < nn.graces.length; gi++) {
            var gr = nn.graces[gi];
            var gs0 = Math.max(0, st0 - (nn.graces.length - gi) * 0.085);
            notes.push({ midi: gr.midi + (nn.ottava || 0), start: gs0, dur: 0.07, end: gs0 + 0.07,
              velocity: Math.max(0.05, Math.min(1.2, 0.42 * dynAt(nn.start))), vol: 1, channel: 0, track: 0, grace: true });
          }
        }
        arpIdx++;
        var dur0 = Math.min(nn.dur || 0.2, len);
        if (arts.staccato) dur0 *= 0.45;
        var dg = dynAt(nn.start);
        var vel0 = Math.max(0.05, Math.min(1.25, (arts.accent ? 0.98 : 0.72) * dg));
        notes.push({ midi: nn.midi + (nn.ottava || 0), start: st0, dur: dur0, end: st0 + dur0,
          velocity: vel0, vol: 1, channel: 0, track: 0, tieStop: !!nn.tieStop, art: arts, hand: nn.staff === 2 ? 'L' : 'R',
          glissTo: (arts.gliss === 'start' && nn.glissTo) ? { midi: nn.glissTo.midi, start: nn.glissTo.start, dur: nn.glissTo.dur } : null });
      });
      cur += len;
    });
    notes.sort(function (a, b) { return a.start - b.start; });
    var glissRun = [];
    notes.forEach(function (gn) {
      if (!gn.glissTo) return;
      var gs = gn.start, ge = Math.max(gs + 0.08, gn.glissTo.start);
      var hi = Math.max(gn.midi, gn.glissTo.midi), lo = Math.min(gn.midi, gn.glissTo.midi);
      var steps = Math.max(6, Math.min(24, hi - lo + 1));
      for (var gi2 = 1; gi2 < steps; gi2++) {
        var f2 = gi2 / steps;
        var gst = gs + (ge - gs) * f2 * 0.92;
        glissRun.push({ midi: Math.round(hi + (lo - hi) * f2), start: gst, dur: 0.15, end: gst + 0.15,
          velocity: 0.42, vol: 1, channel: 0, track: 0, hand: gn.hand, glass: true });
      }
    });
    if (glissRun.length) notes = notes.concat(glissRun);
    notes.sort(function (a, b) { return a.start - b.start; });
    // 延音线合并：tie 的后续音不重新起音，只延长前一个音的时值
    var lastByMidi = {};
    for (var ni = 0; ni < notes.length; ni++) {
      var ev = notes[ni];
      var prev = lastByMidi[ev.midi];
      if (ev.tieStop && prev && Math.abs(ev.start - prev.end) < 0.08) {
        prev.end = Math.max(prev.end, ev.end);
        prev.dur = prev.end - prev.start;
        ev._drop = true;
        continue;
      }
      lastByMidi[ev.midi] = ev;
    }
    notes = notes.filter(function (e) { return !e._drop; });
    return { notes: notes, duration: cur, segments: segments, keys: sc.keys, clefs: sc.clefs, measures: sc.measures, repeats: sc.repeats, endings: sc.endings, directions: sc.directions, dynamics: sc.dynamics, wedges: sc.wedges };
  }

  function orderInfo(perf) {
    return perf.segments.length + ' 段（已按反复展开）';
  }

  function scoreTimeAt(t) {
    var segs = state.scoreSegments;
    if (!segs || !segs.length) return t;
    for (var i = 0; i < segs.length; i++) {
      if (t >= segs[i].p0 && t <= segs[i].p1) return segs[i].s0 + (t - segs[i].p0);
    }
    var last = segs[segs.length - 1];
    return t < last.p0 ? last.s0 : last.s1;
  }

  function keyNameOf(sc) {
    var f = Math.max(-7, Math.min(7, (sc && sc.keyFifths) | 0));
    var minor = sc && sc.keyMode === 'minor';
    var MAJ = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', '0': 'C', '1': 'G', '2': 'D', '3': 'A', '4': 'E', '5': 'B', '6': 'F#', '7': 'C#' };
    var MIN = { '-7': 'Ab', '-6': 'Eb', '-5': 'Bb', '-4': 'F', '-3': 'C', '-2': 'G', '-1': 'D', '0': 'A', '1': 'E', '2': 'B', '3': 'F#', '4': 'C#', '5': 'G#', '6': 'D#', '7': 'A#' };
    var nm = (minor ? MIN : MAJ)[String(f)];
    return nm ? nm + (minor ? ' 小调' : ' 大调') : '';
  }

  async function loadScoreFile(file) {
    var buf = await file.arrayBuffer();
    try { addLib(file.name, buf); } catch (e) {}
    var xml;
    if (/\.mxl$/i.test(file.name)) xml = await MusicXML.unzipMXL(buf);
    else xml = new TextDecoder('utf-8').decode(buf);
    var sc = MusicXML.parseXML(xml);
    if (!sc.notes.length) throw new Error('没有解析到音符');
    var perf = buildScorePerformance(sc);
    if (perf && perf.notes.length) {
      var parsed = { notes: perf.notes, duration: perf.duration, name: sc.title || '乐谱', trackCount: 1, pedals: [], bars: [],
        key: { label: keyNameOf(sc), source: 'meta' }, keys: sc.keys };
      state.score = sc;
      state.scoreSegments = perf.segments;
      loadParsed(parsed, sc.title || file.name);
      var metaEl = $('songMeta');
      if (metaEl) metaEl.textContent = sc.notes.length + ' 个音符 · ' + fmtTime(perf.duration) + ' · 力度 ' + ((sc.dynamics || []).length) + ' · 乐谱';
      state.look.score.on = true;
      saveLook(); applyLookUI();
      toast('乐谱已载入 · ' + orderInfo(perf) + ' · 力度 ' + ((sc.dynamics || []).length) + (sc.title ? ' · ' + sc.title : ''));
    } else {
      state.score = sc; saveLook(); applyLookUI();
      toast('乐谱已载入（无音符可播放）');
    }
  }

  function draw(t, dt) {
    var w = window.innerWidth, h = window.innerHeight;
    drawBackground(t);
    drawNotes(t);
    drawStageFx(t);
    updateParticles(dt);
    drawParticles();
    drawKeyboard(t);
    drawFreeBars();
    // 轻微暗角
    var vg = ctx.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.35, w / 2, h * 0.5, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    drawScoreOverlay(t);
  }

  // ---------------- 帧循环 ----------------
  function frame(ts) {
    var now = ts / 1000;
    var dt = state.lastFrame ? Math.min(0.05, now - state.lastFrame) : 0.016;
    state.lastFrame = now;

    var t = songTime();
    if (state.keyMarks && state.keyMarks.length) {
      var ck = '';
      for (var ki2 = 0; ki2 < state.keyMarks.length; ki2++) { if (state.keyMarks[ki2].time <= t + 0.001) ck = state.keyMarks[ki2].label; else break; }
      if (ck && ck !== state.curKey) { state.curKey = ck; var skEl = $('songKey'); if (skEl) skEl.textContent = ck; }
    }
    state.fpsFrames++;
    state.fpsAcc += dt;
    if (state.fpsAcc >= 0.5) {
      state.fps = Math.round(state.fpsFrames / state.fpsAcc);
      if (state.look.perfAuto) {
        if (state.fps < 38) state.lowQ = true;
        else if (state.fps > 52) state.lowQ = false;
      } else state.lowQ = false;
      state.fpsFrames = 0;
      state.fpsAcc = 0;
    }
    state.dbgAcc += dt;
    if (state.dbgAcc >= 0.25) {
      state.dbgAcc = 0;
      updateDebugBox();
    }
    updateAmbience(dt);
    updateFreeBars(dt);
    var pedalNow = !!state.look.pedal;
    if (pedalNow !== state.pedalOn) {
      state.pedalOn = pedalNow;
      updatePedalChip();
      if (audio.wet) {
        audio.wet.gain.setTargetAtTime(pedalNow ? (0.10 + state.look.pedalMix / 100 * 0.55) : 0.12, audio.ctx.currentTime, 0.10);
      }
    }
    if (state.playing) {
      state.position = Math.min(t, state.duration);
      var spawned = 0;
      while (state.spawnCursor < state.notes.length && state.notes[state.spawnCursor].start <= t && spawned < 8) {
        var n = state.notes[state.spawnCursor];
        if (n.start >= state.prevT - 0.001) {
          hitEffect(n);
          spawned++;
        }
        state.spawnCursor++;
      }
      state.prevT = t;
      emitNoteTrails(t, dt);
    if (state.look.mistOn && state.look.mistColor !== 'none' && GLOWS[state.look.mistColor]) {
      var mistC = GLOWS[state.look.mistColor];
      state.mistAcc = (state.mistAcc || 0) + dt * (6 + state.look.mistPower * 10);
      var mstart = lowerBound(state.notes, t - 0.25), mend = lowerBound(state.notes, t + 0.05);
      for (var mn = mstart; mn < mend; mn++) {
        var nn = state.notes[mn];
        var nend = (state.look.pedal && nn.soundEnd) ? nn.soundEnd : nn.end;
        if (t < nn.start || t > nend + 0.05) continue;
        while (state.mistAcc >= 1) {
          state.mistAcc -= 1;
          var kk = state.keyMap[nn.midi];
          if (!kk) continue;
          var kx = kk.x + kk.w * 0.5;
          if (state.particles.length < 1200) state.particles.push({ kind: 'mist', x: kx + (Math.random() - 0.5) * 22, y: state.hitY - 4,
            vx: (Math.random() - 0.5) * 26, vy: -28 - Math.random() * 48, life: 0,
            max: state.look.mistLife, size: 7 + Math.random() * 13, color: mistC, grav: -4 });
        }
      }
    }
      if (t >= state.duration + 0.45) {
        state.playing = false;
        state.position = state.duration;
        stopScheduler();
        stopAllVoices();
        updatePlayButton();
      }
      updateTransport(state.position);
    }

    draw(t, dt);
    requestAnimationFrame(frame);
  }

  // ---------------- 界面 ----------------
  var hideTimer = 0;

  function setControlsHidden(hidden) {
    var el = document.getElementById('controls');
    if (!el) return;
    var hide = !!hidden || !state.look.sidebar;
    el.classList.toggle('hide', hide);
    var tab = document.getElementById('sideTab');
    if (tab) tab.classList.toggle('show', hide);
  }

  function bumpControls() {
    clearTimeout(hideTimer);
    if (!state.look.sidebar) { setControlsHidden(true); return; }
    setControlsHidden(false);
    if (state.playing) {
      hideTimer = setTimeout(function () { setControlsHidden(true); }, 1000);
    }
  }

  var holdStart = 0;
  function extendHide(ms) {
    clearTimeout(hideTimer);
    if (!state.look.sidebar) { setControlsHidden(true); return; }
    setControlsHidden(false);
    if (state.playing) hideTimer = setTimeout(function () { setControlsHidden(true); }, ms);
  }
  function bindHold() {
    var cv = document.getElementById('stage');
    if (!cv) return;
    cv.addEventListener('pointerdown', function () { holdStart = Date.now(); }, true);
    cv.addEventListener('pointerup', function () {
      if (!holdStart) return;
      var held = Date.now() - holdStart; holdStart = 0;
      var extra = Math.min(3000, Math.max(0, held - 250));
      extendHide(1000 + extra);
    }, true);
    cv.addEventListener('pointercancel', function () { holdStart = 0; }, true);
  }

  function updatePlayButton() {
    var btn = $('btnPlay');
    btn.textContent = state.playing ? '❚❚' : '▶';
    btn.classList.toggle('playing', state.playing);
    btn.setAttribute('aria-label', state.playing ? '暂停' : '播放');
  }

  function updateTransport(t) {
    if (!state.dragging) {
      var seek = $('seek');
      var v = state.duration > 0 ? Math.round(t / state.duration * 1000) : 0;
      seek.value = String(v);
    }
    $('timeNow').textContent = fmtTime(t);
    $('timeTotal').textContent = fmtTime(state.duration);
  }

  var KEY_MAJ = { '-7':'Cb','-6':'Gb','-5':'Db','-4':'Ab','-3':'Eb','-2':'Bb','-1':'F','0':'C','1':'G','2':'D','3':'A','4':'E','5':'B','6':'F#','7':'C#' };
  var KEY_MIN = { '-7':'Ab','-6':'Eb','-5':'Bb','-4':'F','-3':'C','-2':'G','-1':'D','0':'A','1':'E','2':'B','3':'F#','4':'C#','5':'G#','6':'D#','7':'A#' };
  function keyLabelFor(fifths, mode) {
    var f = Math.max(-7, Math.min(7, fifths | 0));
    var minor = mode === 'minor';
    var n = (minor ? KEY_MIN : KEY_MAJ)[String(f)] || 'C';
    return n + (minor ? ' 小调' : ' 大调');
  }
  function loadParsed(parsed, fallbackName) {
    pause();
    state.notes = parsed.notes;
    state.keyMarks = []; state.curKey = '';
    if (parsed.keys && parsed.keys.length) { for (var qk = 0; qk < parsed.keys.length; qk++) state.keyMarks.push({ time: parsed.keys[qk].time, label: keyLabelFor(parsed.keys[qk].fifths, parsed.keys[qk].mode) }); }
    else if (parsed.key && parsed.key.label) state.keyMarks.push({ time: 0, label: parsed.key.label });
    // 左右手：多轨按各轨平均音高分组，单轨按 C4 分界
    var tSum = {}, tCnt = {};
    for (var hi0 = 0; hi0 < parsed.notes.length; hi0++) {
      var nn0 = parsed.notes[hi0];
      tSum[nn0.track] = (tSum[nn0.track] || 0) + nn0.midi;
      tCnt[nn0.track] = (tCnt[nn0.track] || 0) + 1;
    }
    var trs = Object.keys(tSum).sort(function (a, b) { return (tSum[a] / tCnt[a]) - (tSum[b] / tCnt[b]); });
    if (trs.length > 1) {
      var half = Math.ceil(trs.length / 2);
      var handByTrack = {};
      for (var ti = 0; ti < trs.length; ti++) handByTrack[trs[ti]] = ti < half ? 'L' : 'R';
      for (var hi1 = 0; hi1 < parsed.notes.length; hi1++) if (!parsed.notes[hi1].hand) parsed.notes[hi1].hand = handByTrack[parsed.notes[hi1].track] || 'L';
    } else {
      for (var hi2 = 0; hi2 < parsed.notes.length; hi2++) if (!parsed.notes[hi2].hand) parsed.notes[hi2].hand = parsed.notes[hi2].midi < 60 ? 'L' : 'R';
    }
    state.duration = parsed.duration;
    state.tracks = parsed.trackCount;
    state.pedals = parsed.pedals || [];
    state.keyLabel = parsed.key ? parsed.key.label : '';
    state.pedalOn = false;
    state.bars = parsed.bars || [];
    state.title = (fallbackName && fallbackName.trim()) || (parsed.name && parsed.name.trim()) || '未命名';
    state.position = 0;
    state.prevT = 0;
    state.spawnCursor = 0;
    state.schedIndex = 0;
    state.particles.length = 0;
    state.waves.length = 0;
    state.playing = false;
    $('songTitle').textContent = state.title;
    $('songMeta').textContent = parsed.notes.length + ' 个音符 · ' + fmtTime(parsed.duration) + ' · ' + parsed.trackCount + ' 轨';
    var keyEl = $('songKey');
    if (keyEl) {
      var estimated = parsed.key && parsed.key.source === 'estimated';
      keyEl.textContent = state.keyLabel ? (state.keyLabel + (estimated ? ' · 推测' : '')) : '调式未知';
      keyEl.classList.toggle('dim', !state.keyLabel);
    }
    if (state.look.pedal) {
      for (var ni = 0; ni < state.notes.length; ni++) {
        var nn = state.notes[ni];
        nn.soundEnd = Math.max(nn.soundEnd || nn.end, nn.end + 0.05 + (state.look.pedalMix / 100) * 1.15);
      }
    }
    updatePedalChip();
    $('timeTotal').textContent = fmtTime(state.duration);
    updateTransport(0);
    updatePlayButton();
  }

  function loadMidiBuffer(buf, name) {
    try {
      var parsed = MidiParser.parseMidi(buf);
    state.tempos = parsed.tempos || [];
      loadParsed(parsed, name.replace(/\.(mid|midi)$/i, ''));
      toast('已加载：' + parsed.notes.length + ' 个音符');
    } catch (e) {
      toast('解析失败：' + e.message);
    }
  }

  function pickBackground(file) {
    var rd0 = new FileReader();
    rd0.onload = function () { openCrop(rd0.result); };
    rd0.readAsDataURL(file);
  }
  function openCrop(dataUrl) {
    var old = document.getElementById('cropOv'); if (old) old.remove();
    var ov = document.createElement('div'); ov.id = 'cropOv';
    ov.style.cssText = 'position:fixed;inset:0;z-index:70;background:#000';
    var land0 = false;
    var cv = document.createElement('canvas'); cv.style.cssText = 'position:absolute;left:0;right:0;top:0;bottom:76px;width:100%;display:block;touch-action:none';
    var bar = document.createElement('div'); bar.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:76px;display:flex;gap:10px;padding:10px;box-sizing:border-box;background:#0b1120;z-index:71';
    var cancel = document.createElement('button'); cancel.textContent = '取消';
    var ok = document.createElement('button'); ok.textContent = '确定';
    [cancel, ok].forEach(function (b) { b.style.cssText = 'flex:1;padding:12px;border-radius:10px;border:1px solid #2c4468;background:#16233a;color:#dce9ff'; });
    bar.appendChild(cancel); bar.appendChild(ok); ov.appendChild(cv); ov.appendChild(bar); document.body.appendChild(ov);
    var img = new Image(), scale = 1, ox = 0, oy = 0, drag = null, pinch = null;
    function frameBox(w, h) {
      var land = w > h, fw, fh;
      if (land) { fh = h * 0.78; fw = fh * 16 / 9; if (fw > w * 0.86) { fw = w * 0.86; fh = fw * 9 / 16; } }
      else { fw = w * 0.82; fh = fw * 16 / 9; if (fh > h * 0.82) { fh = h * 0.82; fw = fh * 9 / 16; } }
      return { fw: fw, fh: fh, fx: (w - fw) / 2, fy: (h - fh) / 2 };
    }
    function clampCrop() {
      if (!img.width) return;
      var w = cv.clientWidth, h = cv.clientHeight, f = frameBox(w, h);
      var base = Math.max(w / img.width, h / img.height);
      var minS = Math.max(f.fw / (img.width * base), f.fh / (img.height * base), 0.6);
      if (scale < minS) scale = minS;
      var dw = img.width * base * scale, dh = img.height * base * scale;
      var oxmin = f.fx - (w - dw) / 2, oxmax = f.fx + f.fw - (w - dw) / 2 - dw;
      var oymin = f.fy - (h - dh) / 2, oymax = f.fy + f.fh - (h - dh) / 2 - dh;
      ox = Math.max(oxmin, Math.min(oxmax, ox));
      oy = Math.max(oymin, Math.min(oymax, oy));
    }
    function zoomTo(ns) {
      var old = scale; ns = Math.max(0.6, Math.min(4, ns));
      if (!img.width) { scale = ns; return; }
      ox = ox * ns / old; oy = oy * ns / old;
      scale = ns; clampCrop();
    }
    function layout() { var w = cv.clientWidth, h = cv.clientHeight; cv.width = w * 2; cv.height = h * 2; cv.style.height = h + 'px'; }
    function draw() {
      var w = cv.clientWidth, h = cv.clientHeight, c = cv.getContext('2d');
      c.setTransform(2, 0, 0, 2, 0, 0); c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
      if (img.width) {
        var base = Math.max(w / img.width, h / img.height);
        var dw = img.width * base * scale, dh = img.height * base * scale;
        c.drawImage(img, (w - dw) / 2 + ox, (h - dh) / 2 + oy, dw, dh);
      }
      land0 = w > h;
      var f = frameBox(w, h), fw = f.fw, fh = f.fh, fx = f.fx, fy = f.fy;
      c.fillStyle = 'rgba(0,0,0,.58)';
      c.fillRect(0, 0, w, fy); c.fillRect(0, fy + fh, w, h - fy - fh);
      c.fillRect(0, fy, fx, fh); c.fillRect(fx + fw, fy, w - fx - fw, fh);
      c.strokeStyle = '#7ee0c0'; c.lineWidth = 2; c.strokeRect(fx, fy, fw, fh);
    }
    img.onload = function () { layout(); draw(); };
    img.src = dataUrl;
    window.addEventListener('resize', function () { layout(); draw(); });
    cv.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, ox: ox, oy: oy }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', function (e) { if (drag) { ox = drag.ox + (e.clientX - drag.x); oy = drag.oy + (e.clientY - drag.y); clampCrop(); draw(); } });
    cv.addEventListener('pointerup', function () { drag = null; });
    cv.addEventListener('wheel', function (e) { e.preventDefault(); zoomTo(scale * (e.deltaY < 0 ? 1.08 : 0.92)); draw(); }, { passive: false });
    cv.addEventListener('touchmove', function (e) { if (e.touches.length === 2) { var dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY, d = Math.sqrt(dx * dx + dy * dy); if (pinch) { zoomTo(scale * d / Math.max(1, pinch)); draw(); } pinch = d; e.preventDefault(); } }, { passive: false });
    cv.addEventListener('touchend', function () { pinch = null; });
    cancel.onclick = function () { ov.remove(); };
    ok.onclick = function () {
      var w = cv.clientWidth, h = cv.clientHeight;
      var base = Math.max(w / img.width, h / img.height);
      var dw = img.width * base * scale, dh = img.height * base * scale;
      var dx = (w - dw) / 2 + ox, dy = (h - dh) / 2 + oy;
      land0 = w > h;
      var f = frameBox(w, h), fw = f.fw, fh = f.fh, fx = f.fx, fy = f.fy;
      var out = document.createElement('canvas'); out.width = land0 ? 1280 : 720; out.height = land0 ? 720 : 1280;
      var sx = (fx - dx) / (dw / img.width), sy = (fy - dy) / (dh / img.height);
      var sw = fw / (dw / img.width), sh = fh / (dh / img.height);
      out.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
      var url = out.toDataURL('image/jpeg', 0.85);
      var im2 = new Image();
      im2.onload = function () {
        state.bg = im2; bgCache = null;
        try { localStorage.setItem('midiPiano.bg', url); localStorage.removeItem('midiPiano.bg.path'); } catch (e) { }
        toast('背景已更换'); ov.remove();
      };
      im2.src = url;
    };
    return;
  }
  function pickBackgroundLegacy(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1600;
        var sc = Math.min(1, max / Math.max(img.width, img.height));
        var cw = Math.max(1, Math.round(img.width * sc));
        var ch = Math.max(1, Math.round(img.height * sc));
        var tmp = document.createElement('canvas');
        tmp.width = cw; tmp.height = ch;
        tmp.getContext('2d').drawImage(img, 0, 0, cw, ch);
        var url = tmp.toDataURL('image/jpeg', 0.85);
        var im2 = new Image();
        im2.onload = function () {
          state.bg = im2; bgCache = null;
          try { localStorage.setItem('midiPiano.bg', url); localStorage.removeItem('midiPiano.bg.sys'); } catch (e) { /* 空间不足 */ }
          toast('背景已更换');
        };
        im2.src = url;
      };
      img.onerror = function () { toast('这张图片读不出来'); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }


  var SYS_BGS = [
    { id: 'black', name: '纯黑' }, { id: 'gray', name: '纯灰' },
    { id: 's1', name: '樱花 1', img: 'bg/sakura1.jpg' }, { id: 's2', name: '樱花 2', img: 'bg/sakura2.jpg' },
    { id: 's3', name: '樱花 3', img: 'bg/sakura3.jpg' }, { id: 's4', name: '樱花 4', img: 'bg/sakura4.jpg' },
    { id: 's5', name: '樱花 5', img: 'bg/sakura5.jpg' }, { id: 's6', name: '樱花 6', img: 'bg/sakura6.jpg' },
    { id: 's7', name: '樱花 7', img: 'bg/sakura7.jpg' }, { id: 's8', name: '樱花 8', img: 'bg/sakura8.jpg' },
    { id: 's9', name: '樱花 9', img: 'bg/sakura9.jpg' },
    { id: 'a1', name: '二次元 1', img: 'bg/anime1.jpg' },
    { id: 'a2', name: '二次元 2', img: 'bg/anime2.jpg' },
    { id: 'a3', name: '二次元 3', img: 'bg/anime3.jpg' },
    { id: 'a4', name: '二次元 4', img: 'bg/anime4.jpg' },
    { id: 'a5', name: '二次元 5', img: 'bg/anime5.jpg' },
    { id: 'a6', name: '二次元 6', img: 'bg/anime6.jpg' },
    { id: 'a7', name: '二次元 7', img: 'bg/anime7.jpg' },
    { id: 'a8', name: '二次元 8', img: 'bg/anime8.jpg' },
    { id: 'a9', name: '二次元 9', img: 'bg/anime9.jpg' },
    { id: 'a10', name: '二次元 10', img: 'bg/anime10.jpg' },
    { id: 'a11', name: '二次元 11', img: 'bg/anime11.jpg' },
    { id: 'a12', name: '二次元 12', img: 'bg/anime12.jpg' },
    { id: 'a13', name: '二次元 13', img: 'bg/anime13.jpg' },
    { id: 'a14', name: '二次元 14', img: 'bg/anime14.jpg' },
    { id: 'a15', name: '二次元 15', img: 'bg/anime15.jpg' },
    { id: 'a16', name: '二次元 16', img: 'bg/anime16.jpg' },
    { id: 'a17', name: '二次元 17', img: 'bg/anime17.jpg' },
    { id: 'a18', name: '二次元 18', img: 'bg/anime18.jpg' },
    { id: 'a19', name: '二次元 19', img: 'bg/anime19.jpg' },
    { id: 'a20', name: '二次元 20', img: 'bg/anime20.jpg' },
    { id: 'a21', name: '二次元 21', img: 'bg/anime21.jpg' },
    { id: 'a22', name: '二次元 22', img: 'bg/anime22.jpg' },
    { id: 'a23', name: '二次元 23', img: 'bg/anime23.jpg' },
    { id: 'a24', name: '二次元 24', img: 'bg/anime24.jpg' },
    { id: 'a25', name: '二次元 25', img: 'bg/anime25.jpg' },
    { id: 'a26', name: '二次元 26', img: 'bg/anime26.jpg' },
    { id: 'a27', name: '二次元 27', img: 'bg/anime27.jpg' },
    { id: 'a28', name: '二次元 28', img: 'bg/anime28.jpg' },
    { id: 'a29', name: '二次元 29', img: 'bg/anime29.jpg' },
    { id: 'a30', name: '二次元 30', img: 'bg/anime30.jpg' },
    { id: 'a31', name: '二次元 31', img: 'bg/anime31.jpg' }
  ];
  function buildSystemBg(id) {
    var c = document.createElement('canvas'); c.width = 720; c.height = 1280;
    var g = c.getContext('2d');
    if (id === 'black') { g.fillStyle = '#000'; g.fillRect(0, 0, 720, 1280); }
    else if (id === 'gray') { g.fillStyle = '#3a3a3a'; g.fillRect(0, 0, 720, 1280); }
    else if (id === 'sakura') {
      var gr = g.createLinearGradient(0, 0, 0, 1280); gr.addColorStop(0, '#2a1424'); gr.addColorStop(1, '#0c0710');
      g.fillStyle = gr; g.fillRect(0, 0, 720, 1280);
      for (var i = 0; i < 220; i++) {
        var x = Math.random() * 720, y = Math.random() * 1280, r = 2 + Math.random() * 5;
        g.fillStyle = 'rgba(255,' + (140 + Math.random() * 80) + ',' + (170 + Math.random() * 60) + ',' + (0.25 + Math.random() * 0.5) + ')';
        g.beginPath(); g.ellipse(x, y, r, r * 0.6, Math.random() * 3, 0, Math.PI * 2); g.fill();
      }
    } else if (id === 'night' || id === 'aurora' || id === 'cyber') {
      var g2 = g.createLinearGradient(0, 0, 0, 1280);
      if (id === 'night') { g2.addColorStop(0, '#0a1430'); g2.addColorStop(1, '#03060f'); }
      else if (id === 'aurora') { g2.addColorStop(0, '#04121c'); g2.addColorStop(0.5, '#0b2436'); g2.addColorStop(1, '#05070f'); }
      else { g2.addColorStop(0, '#12021f'); g2.addColorStop(1, '#02040a'); }
      g.fillStyle = g2; g.fillRect(0, 0, 720, 1280);
      for (var j = 0; j < 120; j++) { g.fillStyle = 'rgba(255,255,255,' + (0.1 + Math.random() * 0.6) + ')'; g.fillRect(Math.random() * 720, Math.random() * 700, 1.5, 1.5); }
      if (id === 'aurora') {
        for (var k = 0; k < 5; k++) {
          var gg = g.createRadialGradient(120 + k * 130, 260 + (k % 2) * 160, 10, 120 + k * 130, 260, 300);
          gg.addColorStop(0, 'rgba(80,255,200,0.16)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gg; g.fillRect(0, 0, 720, 1280);
        }
      }
      if (id === 'cyber') {
        for (var m = 0; m < 26; m++) { g.strokeStyle = m % 2 ? 'rgba(255,61,242,0.18)' : 'rgba(0,229,255,0.18)'; g.beginPath(); g.moveTo(0, m * 52); g.lineTo(720, m * 52 + 40); g.stroke(); }
      }
    } else if (id === 'forest' || id === 'dusk' || id === 'snow' || id === 'sea') {
      var g3 = g.createLinearGradient(0, 0, 0, 1280);
      if (id === 'forest') { g3.addColorStop(0, '#0a1a12'); g3.addColorStop(1, '#030806'); }
      else if (id === 'dusk') { g3.addColorStop(0, '#2a1430'); g3.addColorStop(0.6, '#7a2a3a'); g3.addColorStop(1, '#10060c'); }
      else if (id === 'snow') { g3.addColorStop(0, '#1b2a3a'); g3.addColorStop(1, '#05080d'); }
      else { g3.addColorStop(0, '#0a2230'); g3.addColorStop(1, '#02070b'); }
      g.fillStyle = g3; g.fillRect(0, 0, 720, 1280);
      if (id === 'snow' || id === 'dusk') { for (var n = 0; n < 180; n++) { g.fillStyle = 'rgba(255,255,255,' + (0.08 + Math.random() * 0.5) + ')'; var rr = 0.8 + Math.random() * 2.2; g.beginPath(); g.arc(Math.random() * 720, Math.random() * 1280, rr, 0, 7); g.fill(); } }
      if (id === 'sea') { for (var q = 0; q < 18; q++) { g.strokeStyle = 'rgba(120,200,255,0.06)'; g.beginPath(); g.moveTo(0, 700 + q * 26); g.bezierCurveTo(240, 690 + q * 26, 480, 710 + q * 26, 720, 700 + q * 26); g.stroke(); } }
    }
    return c.toDataURL('image/jpeg', 0.82);
  }
  function applySystemBg(id) {
    if (!confirm('图标来源于网络，B站图文等，侵权必删')) return;
    var ent = null;
    for (var ei = 0; ei < SYS_BGS.length; ei++) if (SYS_BGS[ei].id === id) ent = SYS_BGS[ei];
    if (ent && ent.img) {
      var im0 = new Image();
      im0.onload = function () {
        state.bg = im0; bgCache = null;
        try { localStorage.setItem('midiPiano.bg.path', ent.img); localStorage.removeItem('midiPiano.bg'); localStorage.removeItem('midiPiano.bg.sys'); } catch (e) { /* ignore */ }
        toast('背景已更换');
      };
      im0.onerror = function () { toast('背景图读取失败'); };
      im0.src = ent.img;
      return;
    }
    try {
      var url = buildSystemBg(id);
      var im = new Image();
      im.onload = function () {
        state.bg = im; bgCache = null;
        try { localStorage.setItem('midiPiano.bg', url); localStorage.setItem('midiPiano.bg.sys', id); } catch (e) { /* ignore */ }
        toast('背景已更换');
      };
      im.src = url;
    } catch (e) { toast('切换失败'); }
  }
  function showBgMenu() {
    var old = document.getElementById('bgMenu'); if (old) old.remove();
    var ov = document.createElement('div'); ov.id = 'bgMenu';
    ov.style.cssText = 'position:fixed;inset:0;z-index:60;background:rgba(2,4,10,.86);display:flex;align-items:center;justify-content:center;padding:14px';
    var box = document.createElement('div');
    box.style.cssText = 'width:min(520px,96vw);max-height:86vh;overflow:auto;background:#0d1526;border:1px solid #263a5c;border-radius:18px;padding:14px;color:#e6efff;box-sizing:border-box';
    var cats = [{ id: 'pure', name: '纯色' }, { id: 'sakura', name: '樱花' }, { id: 'anime', name: '二次元' }];
    var html = '<div style="font-size:15px;font-weight:700;margin-bottom:10px">背景</div><div style="display:flex;gap:8px;margin-bottom:10px">';
    for (var ci = 0; ci < cats.length; ci++) html += '<button data-cat="' + cats[ci].id + '" class="bgTab" style="flex:1;padding:9px;border-radius:10px;border:1px solid #2c4468;background:#101b2f;color:#cfe0ff;font-size:12px">' + cats[ci].name + '</button>';
    html += '</div><div id="bgGrid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">';
    for (var i = 0; i < SYS_BGS.length; i++) {
      var it = SYS_BGS[i], cat = it.img ? (it.id.charAt(0) === 'a' ? 'anime' : 'sakura') : 'pure';
      var bg = it.img ? 'background-image:url(' + it.img + ');background-size:cover;background-position:center' : 'background:' + (it.id === 'black' ? '#000' : '#3a3a3a');
      html += '<button data-sys="' + it.id + '" data-cat="' + cat + '" style="position:relative;height:78px;border-radius:10px;border:1px solid #2c4468;overflow:hidden;padding:0;' + bg + '"><span style="position:absolute;left:0;right:0;bottom:0;padding:3px;font-size:11px;color:#fff;background:rgba(0,0,0,.55)">' + it.name + '</span></button>';
    }
    html += '</div><div style="display:flex;gap:8px;margin-top:12px"><button id="bgUseFile" style="flex:1;padding:11px;border-radius:11px;border:1px solid #2c4468;background:#16233a;color:#dce9ff">导入图片</button><button id="bgClose" style="flex:1;padding:11px;border-radius:11px;border:1px solid #2c4468;background:#0e1727;color:#9fb4d8">取消</button></div>';
    box.innerHTML = html; ov.appendChild(box); document.body.appendChild(ov);
    var items = box.querySelectorAll('[data-sys]');
    var tabs = box.querySelectorAll('.bgTab');
    function filter(cat) {
      for (var k = 0; k < items.length; k++) items[k].style.display = (items[k].getAttribute('data-cat') === cat) ? 'block' : 'none';
      for (var t = 0; t < tabs.length; t++) {
        var on = tabs[t].getAttribute('data-cat') === cat;
        tabs[t].style.background = on ? '#24385c' : '#101b2f';
        tabs[t].style.borderColor = on ? '#5b8bd6' : '#2c4468';
      }
    }
    for (var t2 = 0; t2 < tabs.length; t2++) tabs[t2].onclick = function () { filter(this.getAttribute('data-cat')); };
    for (var q = 0; q < items.length; q++) items[q].onclick = function () { applySystemBg(this.getAttribute('data-sys')); ov.remove(); };
    document.getElementById('bgUseFile').onclick = function () { ov.remove(); $('bgFile').click(); };
    document.getElementById('bgClose').onclick = function () { ov.remove(); };
    filter('pure');
  }

  function restoreBackground() {
    try {
      var bp = localStorage.getItem('midiPiano.bg.path');
      if (bp) {
        var im9 = new Image();
        im9.onload = function () { state.bg = im9; bgCache = null; };
        im9.src = bp;
        return;
      }
      var url = localStorage.getItem('midiPiano.bg');
      if (!url) return;
      var img = new Image();
      img.onload = function () { state.bg = img; bgCache = null; };
      img.src = url;
    } catch (e) { /* ignore */ }
  }


  // ---------------- 顶栏收起 / 文件库 ----------------
  function applyCollapse() {
    var tb = $('topbar'), op = $('topOpen');
    if (tb) tb.classList.toggle('top-hidden', !!state.look.collapsed);
    if (op) op.classList.toggle('show', !!state.look.collapsed && !state.home);
  }
  var LIB_KEY = 'midiPiano.lib';
  var libKind = 'all';
  function getLib() { try { return JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); } catch (e) { return []; } }
  function setLib(v) { try { localStorage.setItem(LIB_KEY, JSON.stringify(v)); } catch (e) { toast('文件库已满，未能保存'); } }
  function bufToB64(buf) { var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  function b64ToArray(s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function addLib(name, buf) {
    if (!/\.(mid|midi|mxl|musicxml|xml)$/i.test(name)) return;
    try {
      var b = bufToB64(buf);
      if (b.length > 2000000) return;
      var lib = getLib();
      lib = lib.filter(function (e) { return e.name !== name || e.data !== b; });
      lib.unshift({ id: 'f' + Date.now(), name: name, kind: /\.(mid|midi)$/i.test(name) ? 'midi' : 'xml', data: b, ts: Date.now() });
      if (lib.length > 8) lib.length = 8;
      setLib(lib);
    } catch (e) {}
  }
  function openLib(kind) { libKind = kind || 'all'; renderLib(); var l = $('lib'); if (l) l.classList.remove('hidden'); }
  function closeLib() { var l = $('lib'); if (l) l.classList.add('hidden'); }
  function renderLib() {
    var list = $('libList'); if (!list) return;
    var lib = getLib().filter(function (e) { return libKind === 'all' || e.kind === libKind; });
    list.innerHTML = '';
    if (!lib.length) { var em = document.createElement('div'); em.className = 'lib-empty'; em.textContent = '还没有文件，点下面导入一个'; list.appendChild(em); return; }
    lib.forEach(function (e) {
      var b = document.createElement('button'); b.className = 'lib-item';
      var d = new Date(e.ts); b.innerHTML = '<b>' + e.name.replace(/</g, '&lt;') + '</b><small>' + (e.kind === 'midi' ? 'MIDI' : 'MusicXML') + ' · ' + d.toLocaleDateString() + '</small>';
      var del = document.createElement('span'); del.className = 'lib-del'; del.textContent = '✕'; del.setAttribute('role', 'button');
      del.onclick = function (ev) { ev.stopPropagation(); setLib(getLib().filter(function (x) { return x.id !== e.id; })); renderLib(); };
      b.appendChild(del);

      b.onclick = function () {
        var buf = b64ToArray(e.data).buffer;
        closeLib();
        if (e.kind === 'midi') loadMidiBuffer(buf, e.name);
        else loadScoreFile(new File([buf], e.name));
      };
      list.appendChild(b);
    });
  }
  function bindLib() {
    var hm = $('homeLibMidi'), hx = $('homeLibXml');
    if (hm) hm.addEventListener('click', function () { openLib('midi'); });
    if (hx) hx.addEventListener('click', function () { openLib('xml'); });
    var lc = $('libClose'); if (lc) lc.addEventListener('click', closeLib);
    var im = $('libImportMidi'); if (im) im.addEventListener('click', function () { closeLib(); $('midiFile').click(); });
    var ix = $('libImportXml'); if (ix) ix.addEventListener('click', function () { closeLib(); $('btnScore').click(); });
    var tc = $('topCollapse'); if (tc) tc.addEventListener('click', function () { state.look.collapsed = true; saveLook(); applyCollapse(); });
    var to = $('topOpen'); if (to) to.addEventListener('click', function () { state.look.collapsed = false; saveLook(); applyCollapse(); });
  }
  function exportLog() {
    var lines = ['MIDI Piano 3.49 log', 'time: ' + new Date().toString(), 'ua: ' + navigator.userAgent, 'screen: ' + screen.width + 'x' + screen.height + ' dpr=' + (window.devicePixelRatio || 1), 'notes: ' + (state.notes ? state.notes.length : 0), '--- errors/logs ---'].concat(LOG).join('\n');
    var ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;z-index:80;background:rgba(2,4,10,.94);padding:12px;box-sizing:border-box;display:flex;flex-direction:column;gap:8px';
    var bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px';
    var t1 = document.createElement('b'); t1.textContent = '运行日志'; t1.style.cssText = 'flex:1;color:#dfeaff';
    var cp = document.createElement('button'); cp.textContent = '复制'; cp.style.cssText = 'padding:8px 12px;border-radius:9px;background:#16233c;color:#dbe8ff;border:1px solid #2b3d63';
    var cl = document.createElement('button'); cl.textContent = '关闭'; cl.style.cssText = cp.style.cssText;
    bar.appendChild(t1); bar.appendChild(cp); bar.appendChild(cl);
    var ta = document.createElement('textarea'); ta.value = lines; ta.style.cssText = 'flex:1;background:#0a1020;color:#cfe0ff;border:1px solid #22304d;border-radius:9px;padding:9px;font:12px monospace';
    ov.appendChild(bar); ov.appendChild(ta); document.body.appendChild(ov);
    cl.onclick = function () { ov.remove(); };
    cp.onclick = function () { ta.select(); try { document.execCommand('copy'); } catch (e) { } if (navigator.clipboard) navigator.clipboard.writeText(lines); };
  }

  function bindUI() {
    var exI = $('extImport'), exF = $('extFile');
    if (exI && exF) exI.addEventListener('click', function () { exF.click(); });
    function pdfToImages(buf) {
      if (!window.pdfjsLib) { toast('PDF 组件未加载'); return; }
      var task = pdfjsLib.getDocument({ data: new Uint8Array(buf) });
      task.promise.then(function (pdf) {
        var total = pdf.numPages, done = 0;
        function next(p) {
          if (p > total) { toast('PDF 已导入 ' + total + ' 页'); draw(); return; }
          pdf.getPage(p).then(function (page) {
            var vp = page.getViewport({ scale: 1 });
            var sc = Math.min(2.2, 1600 / vp.width);
            var v2 = page.getViewport({ scale: sc });
            var cv = document.createElement('canvas'); cv.width = v2.width; cv.height = v2.height;
            page.render({ canvasContext: cv.getContext('2d'), viewport: v2 }).promise.then(function () {
              var im = new Image();
              im.onload = function () { state.ext.imgs.push(im); next(p + 1); };
              im.src = cv.toDataURL('image/jpeg', 0.85);
            });
          }).catch(function (e) { logLine('PDF page ' + p + ': ' + (e && e.message ? e.message : e)); next(p + 1); });
        }
        next(1);
        toast('正在导入 PDF（' + total + ' 页）');
      }).catch(function (e) { toast('PDF 解析失败：' + (e && e.message ? e.message : e)); logLine('PDF: ' + (e && e.message ? e.message : e)); });
    }
    if (exF) exF.addEventListener('change', function () {
      var fs = Array.prototype.slice.call(this.files || []);
      var left = fs.length;
      if (!left) return;
      fs.forEach(function (f) {
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          var rp = new FileReader(); rp.onload = function () { pdfToImages(rp.result); }; rp.readAsArrayBuffer(f); return;
        }
        if (!/^image\//.test(f.type || '') && !/\.(png|jpe?g|webp|bmp)$/i.test(f.name)) { toast('不支持的格式：' + f.name); return; }
        var rd = new FileReader();
        rd.onload = function () {
          var im = new Image();
          im.onload = function () { state.ext.imgs.push(im); if (--left === 0) { toast('已导入 ' + state.ext.imgs.length + ' 张谱面'); draw(); } };
          im.src = rd.result;
        };
        rd.readAsDataURL(f);
      });
      this.value = '';
    });
    var exC = $('extClear'); if (exC) exC.addEventListener('click', function () { state.ext.imgs.length = 0; toast('已清除谱面图片'); draw(); });
    var exM = $('extMpl'); if (exM) exM.addEventListener('input', function () { state.look.ext.mpl = Math.max(0, Math.min(12, +this.value || 0)); var v = $('extMplVal'); if (v) v.textContent = state.look.ext.mpl > 0 ? (state.look.ext.mpl + ' 小节') : '自动'; saveLook(); draw(); });
    var exX = $('extX'); if (exX) exX.addEventListener('input', function () { state.look.ext.xoff = Math.max(-200, Math.min(200, +this.value || 0)); var v = $('extXVal'); if (v) v.textContent = String(state.look.ext.xoff); saveLook(); draw(); });
    var exY = $('extY'); if (exY) exY.addEventListener('input', function () { state.look.ext.yoff = Math.max(-120, Math.min(120, +this.value || 0)); var v = $('extYVal'); if (v) v.textContent = String(state.look.ext.yoff); saveLook(); draw(); });
    var exAp = $('extApply'); if (exAp) exAp.addEventListener('click', function () {
      var starts = state.bars || [];
      if (!starts.length) { toast('MIDI 没有小节信息'); return; }
      var t = songTime(), lo = 0, hi = starts.length - 1;
      while (lo < hi) { var md = (lo + hi + 1) >> 1; if (starts[md] <= t + 1e-6) lo = md; else hi = md - 1; }
      var mpl = state.look.ext.mpl | 0; if (mpl <= 0) { toast('先把每行小节数设成固定值'); return; }
      state.look.ext.lineShift = -Math.floor(lo / mpl);
      saveLook(); toast('已按当前播放位置对齐'); draw();
    });
    var exLs = $('extLines'); if (exLs) exLs.addEventListener('input', function () { state.look.ext.lines = Math.max(1, Math.min(8, +this.value || 4)); var v = $('extLinesVal'); if (v) v.textContent = String(state.look.ext.lines); saveLook(); draw(); });
    var exAs = $('extAlpha'); if (exAs) exAs.addEventListener('input', function () { state.look.ext.alpha = Math.max(20, Math.min(100, +this.value || 85)); var v = $('extAlphaVal'); if (v) v.textContent = state.look.ext.alpha + '%'; saveLook(); draw(); });
    var rf = $('recFade'); if (rf) rf.addEventListener('input', function () { state.look.rec.fade = Math.max(0.3, Math.min(4, (+this.value || 10) / 10)); var v = $('recFadeVal'); if (v) v.textContent = state.look.rec.fade.toFixed(1) + 's'; saveLook(); });
    var lg = $('logExport'); if (lg) lg.addEventListener('click', exportLog);
    $('btnMidi').addEventListener('click', function () { $('midiFile').click(); });
    $('btnBg').addEventListener('click', function () { showBgMenu(); });
    bindHold();
    $('btnLook').addEventListener('click', openSheet);
    $('sideTab').addEventListener('click', function () {
      state.look.sidebar = true;
      saveLook();
      applyLookUI();
      bumpControls();
    });
    $('sheetClose').addEventListener('click', closeSheet);
    $('sheetBack').addEventListener('click', closeSheet);
    var tabsEls = document.querySelectorAll('#sheetTabs .tab');
    for (var ti = 0; ti < tabsEls.length; ti++) {
      tabsEls[ti].addEventListener('click', function (ev) {
        state.look.tab = ev.currentTarget.getAttribute('data-tab');
        saveLook();
        applyTab(state.look.tab);
      });
    }
    $('homePlay').addEventListener('click', function () {
      hideHome();
      state.freePlay = false;
      var fh = $('freeHint'); if (fh) fh.classList.add('hidden');
      if (!state.notes.length) loadDemo();
      seekTo(0);
      play();
    });
    $('homeFree').addEventListener('click', function () {
      hideHome();
      if (state.playing) pause();
      state.freePlay = true;
      state.notes = [];
      state.freeBars.length = 0;
      state.freePressed = {};
      state.view.zoom = 1;
      state.view.pan = 0;
      setControlsHidden(true);
      var fh = $('freeHint'); if (fh) { fh.classList.remove('hidden'); var ft = $('freeHintText'); if (ft) ft.textContent = '双指缩放 / 上下拉伸 · 滑动琴键刮奏'; }
      $('songTitle').textContent = '自由弹奏';
      $('songMeta').textContent = '点击下方琴键发声';
    });
    $('homeSettings').addEventListener('click', openSheet);
    $('homeExit').addEventListener('click', exitApp);
    var optButtons = document.querySelectorAll('#sheet .opt');
    for (var oi = 0; oi < optButtons.length; oi++) {
      optButtons[oi].addEventListener('click', function (ev) {
        var b = ev.currentTarget;
        if (b.hasAttribute('data-shape')) state.look.shape = b.getAttribute('data-shape');
        if (b.hasAttribute('data-fx')) state.look.fx = b.getAttribute('data-fx');
        if (b.hasAttribute('data-grad')) state.look.gradient = b.getAttribute('data-grad');
        if (b.hasAttribute('data-pedal')) {
          state.look.pedal = b.getAttribute('data-pedal') === 'on';
          if (!state.look.pedal) state.pedalOn = false;
        }
        if (b.hasAttribute('data-topbar')) state.look.topbar = b.getAttribute('data-topbar') === 'on';
        if (b.hasAttribute('data-amb')) {
          state.look.amb = b.getAttribute('data-amb');
          state.ambParts.length = 0;
        }
        if (b.hasAttribute('data-sidebar')) state.look.sidebar = b.getAttribute('data-sidebar') === 'on';
        if (b.hasAttribute('data-bar')) state.look.barlines = b.getAttribute('data-bar') === 'on';
        if (b.hasAttribute('data-full')) state.look.fullscreen = b.getAttribute('data-full') === 'on';
        if (b.hasAttribute('data-lcolor')) state.look.leftColor = b.getAttribute('data-lcolor');
        if (b.hasAttribute('data-rcolor')) state.look.rightColor = b.getAttribute('data-rcolor');
        if (b.hasAttribute('data-dyn')) state.look.dyn = b.getAttribute('data-dyn') === 'on';
        if (b.hasAttribute('data-move')) state.look.freeMove = b.getAttribute('data-move') === 'on';
        if (b.hasAttribute('data-glow')) state.look.glow = b.getAttribute('data-glow');
        if (b.hasAttribute('data-glowl')) state.look.glowL = b.getAttribute('data-glowl');
        if (b.hasAttribute('data-glowr')) state.look.glowR = b.getAttribute('data-glowr');
        if (b.hasAttribute('data-np')) state.look.np.on = b.getAttribute('data-np') === 'on';
        if (b.hasAttribute('data-npr')) state.look.np.region = b.getAttribute('data-npr');
        if (b.hasAttribute('data-npc')) { var nside = b.getAttribute('data-side'); if (nside === 'l') state.look.np.lc = b.getAttribute('data-npc'); else state.look.np.rc = b.getAttribute('data-npc'); }
        if (b.hasAttribute('data-line')) state.look.lineColor = b.getAttribute('data-line');
        if (b.hasAttribute('data-guicolor')) state.look.guiColor = b.getAttribute('data-guicolor');
        if (b.hasAttribute('data-ext')) state.look.ext.on = b.getAttribute('data-ext') === 'on';
        if (b.hasAttribute('data-rec')) state.look.rec.on = b.getAttribute('data-rec') === 'on';
        if (b.hasAttribute('data-rectitle')) state.look.rec.title = b.getAttribute('data-rectitle') === 'on';
        if (b.hasAttribute('data-recstyle')) state.look.rec.style = b.getAttribute('data-recstyle');
        if (b.hasAttribute('data-recfx')) state.look.rec.fx = b.getAttribute('data-recfx');
        if (b.hasAttribute('data-line')) applyGui();
        if (b.hasAttribute('data-mist')) state.look.mistColor = b.getAttribute('data-mist');
        if (b.hasAttribute('data-linelevel')) state.look.linePower = Math.max(0, Math.min(3, +b.getAttribute('data-linelevel') || 0));
        if (b.hasAttribute('data-miston')) state.look.mistOn = b.getAttribute('data-miston') === 'on';
        if (b.hasAttribute('data-mistlevel')) state.look.mistPower = Math.max(0, Math.min(3, +b.getAttribute('data-mistlevel') || 0));
        if (b.hasAttribute('data-fps')) state.look.fps = b.getAttribute('data-fps') === 'on';
        if (b.hasAttribute('data-stats')) state.look.stats = b.getAttribute('data-stats') === 'on';
        if (b.hasAttribute('data-home')) {
          saveLook();
          closeSheet();
          showHome();
          return;
        }
        saveLook();
        applyLookUI();
        applyGui();
      });
    }
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeSheet();
    });
    var zr = $('zoomReset');
    if (zr) zr.addEventListener('click', function () { resetZoom(); saveLook(); });
    var ra = $('resetAll');
    if (ra) ra.addEventListener('click', function () {
      try { localStorage.removeItem(LOOK_KEY); localStorage.removeItem('midiPiano.bg'); } catch (e) {}
      toast('已恢复默认设置');
      setTimeout(function () { location.reload(); }, 500);
    });
    var gaEl = $('guiAlpha');
    if (gaEl) gaEl.addEventListener('input', function () { state.look.guiAlpha = +this.value; applyGui(); saveLook(); });
    var adEl = $('ambDensity');
    if (adEl) {
      adEl.addEventListener('input', function () {
        state.look.ambDensity = Math.max(0, Math.min(3, parseInt(adEl.value, 10) || 0));
        var lbl = $('ambDensityVal');
        if (lbl) lbl.textContent = ['少量', '正常', '略多', '非常多'][state.look.ambDensity];
        saveLook();
      });
    }
    var mlf = $('mistLife');
    if (mlf) mlf.addEventListener('input', function () {
      state.look.mistLife = Math.max(0.5, Math.min(2, parseFloat(mlf.value) || 1.2));
      var mlb = $('mistLifeVal'); if (mlb) mlb.textContent = state.look.mistLife.toFixed(1) + 's';
      saveLook();
    });
    var glvEl = $('glowLevel');
    if (glvEl) {
      glvEl.addEventListener('input', function () {
        state.look.glowLevel = Math.max(0, Math.min(3, parseInt(glvEl.value, 10) || 0));
        var lbl = $('glowLevelVal');
        if (lbl) lbl.textContent = ['Low', 'Medium', 'High', 'Max'][state.look.glowLevel];
        saveLook();
      });
    }
    var kbEl = $('kbLen');
    if (kbEl) {
      kbEl.addEventListener('input', function () {
        state.look.kbLen = Math.max(0, Math.min(100, parseInt(kbEl.value, 10) || 0));
        var lbl = $('kbLenVal');
        if (lbl) lbl.textContent = state.look.kbLen + '%';
        layout();
        clampView();
        saveLook();
      });
    }
    $('btnPlay').addEventListener('click', togglePlay);
    $('pedal').addEventListener('click', function () {
      state.look.pedal = !state.look.pedal;
      if (!state.look.pedal) state.pedalOn = false;
      saveLook();
      applyLookUI();
      updatePedalChip();
    });

    $('midiFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { addLib(f.name, reader.result); loadMidiBuffer(reader.result, f.name); };
      reader.onerror = function () { toast('读取文件失败'); };
      reader.readAsArrayBuffer(f);
      e.target.value = '';
    });

    $('bgFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) { if (confirm('图标来源于网络，B站图文等，侵权必删')) pickBackground(f); else e.target.value = ''; }
      e.target.value = '';
    });

    var seek = $('seek');
    seek.addEventListener('pointerdown', function () { state.dragging = true; });
    seek.addEventListener('input', function () {
      var t = state.duration * (Number(seek.value) / 1000);
      $('timeNow').textContent = fmtTime(t);
    });
    seek.addEventListener('change', function () {
      state.dragging = false;
      seekTo(state.duration * (Number(seek.value) / 1000));
    });
    seek.addEventListener('pointerup', function () { state.dragging = false; });

    var speed = $('speed');
    speed.addEventListener('input', function () {
      var v = Number(speed.value);
      var pos = songTime();
      state.speed = v;
      $('speedVal').textContent = v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + '×';
      if (state.playing && audio.ctx) {
        state.startCtx = audio.ctx.currentTime - pos / state.speed;
        stopAllVoices();
        state.schedIndex = lowerBound(state.notes, pos);
        state.prevT = pos;
        state.spawnCursor = lowerBound(state.notes, pos);
      }
    });

    var vol = $('vol');
    vol.addEventListener('input', function () {
      state.volume = Number(vol.value);
      if (audio.master) audio.master.gain.value = state.volume;
    });

    canvas.addEventListener('pointerdown', function (e) {
      var g = state.gesture;
      g.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var pid = Object.keys(g.pointers);
      if (pid.length === 2) {
        e.preventDefault();
        var pa = g.pointers[pid[0]], pb = g.pointers[pid[1]];
        g.mode = 'pinchV';
        g.startDy = Math.abs(pa.y - pb.y) || 1;
        g.startDx = Math.abs(pa.x - pb.x) || 1;
        g.startVzoom = state.view.vzoom || 1;
        g.startZoom = state.view.zoom;
        return;
      }
      if (!state.freePlay) {
        if (state.playing) bumpControls();
        return;
      }
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      var ids = Object.keys(g.pointers);
      if (ids.length === 2 && state.look.freeMove) {
        var a = g.pointers[ids[0]], b = g.pointers[ids[1]];
        g.mode = 'pinch';
        g.startDist = Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)) || 1;
        g.startZoom = state.view.zoom;
        g.startDy = Math.abs(a.y - b.y) || 1;
        g.startDx = Math.abs(a.x - b.x) || 1;
        g.startVzoom = state.view.vzoom || 1;
        g.startPan = state.view.pan;
        g.startMid = (a.x + b.x) / 2;
      } else if (state.look.freeMove && e.clientY < state.hitY - 30) {
        g.mode = 'pan';
        g.startX = e.clientX;
        g.startPan = state.view.pan;
      } else {
        g.mode = 'play';
        g.lastMidi = freeStrike(e.clientX, e.clientY);
      }
    });
    canvas.addEventListener('pointermove', function (e) {
      var g = state.gesture;
      if (!g.pointers[e.pointerId]) return;
      g.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (g.mode === 'pinchV') {
        var pids = Object.keys(g.pointers);
        if (pids.length < 2) return;
        var qa = g.pointers[pids[0]], qb = g.pointers[pids[1]];
        var ddx2 = Math.abs(qa.x - qb.x) || 1, ddy2 = Math.abs(qa.y - qb.y) || 1;
        state.view.vzoom = Math.max(0.45, Math.min(5, g.startVzoom * ddy2 / g.startDy));
        if (state.freePlay && state.look.freeMove) {
          var rzz = ddx2 / g.startDx;
          if (Math.abs(rzz - 1) > 0.02) state.view.zoom = Math.max(1, Math.min(3, g.startZoom * rzz));
        }
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (!state.freePlay) return;
      if (e.cancelable) e.preventDefault();
      if (g.mode === 'pinch') {
        var ids = Object.keys(g.pointers);
        if (ids.length < 2) return;
        var a = g.pointers[ids[0]], b = g.pointers[ids[1]];
        var ddx = Math.abs(a.x - b.x) || 1, ddy = Math.abs(a.y - b.y) || 1;
        var rz = ddx / g.startDx, rv = ddy / g.startDy;
        if (Math.abs(rv - 1) > Math.abs(rz - 1)) {
          state.view.vzoom = Math.max(0.45, Math.min(5, g.startVzoom * rv));
        } else {
          state.view.zoom = Math.max(1, Math.min(3, g.startZoom * rz));
          state.view.pan = g.startPan - ((a.x + b.x) / 2 - g.startMid);
        }
        clampView();
      } else if (g.mode === 'pan') {
        state.view.pan = g.startPan - (e.clientX - g.startX);
        clampView();
      } else if (g.mode === 'play') {
        if (e.clientY < state.hitY - 36) return;
        var key = keyAtX(e.clientX);
        if (!key || key.midi === g.lastMidi) return;
        g.lastMidi = key.midi;
        var vel = clamp(0.5 + (e.clientY - state.hitY) / Math.max(1, state.kbH) * 0.55, 0.35, 1);
        strikeKey(key, vel);
      }
    });
    function endFreePointer(e) {
      var g = state.gesture;
      delete g.pointers[e.pointerId];
      if (!Object.keys(g.pointers).length) { g.mode = null; g.lastMidi = null; }
    }
    canvas.addEventListener('pointerup', endFreePointer);
    canvas.addEventListener('pointercancel', endFreePointer);
    // 控制条内的操作会重置隐藏计时
    document.getElementById('controls').addEventListener('pointerdown', function () {
      bumpControls();
    });

    window.addEventListener('resize', function () { resize(); });
    window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && state.playing) pause();
    });
  }

  function initStars() {
    state.stars = [];
    for (var i = 0; i < 80; i++) {
      state.stars.push({
        x: Math.random(), y: Math.random(),
        r: 0.4 + Math.random() * 1.6,
        v: -(2 + Math.random() * 10),
        a: 0.25 + Math.random() * 0.55,
        p: Math.random() * 6.28
      });
    }
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
  }

  function bindScoreUI() {
    var bs = $('btnScore'), sf = $('scoreFile');
    if (bs && sf) {
      bs.addEventListener('click', function () { sf.click(); });
      sf.addEventListener('change', function () {
        if (sf.files && sf.files[0]) loadScoreFile(sf.files[0]).catch(function (e) { toast('乐谱导入失败：' + e.message); });
        sf.value = '';
      });
    }
    var fh = $('freeHintClose');
    if (fh) fh.addEventListener('click', function (e) { e.stopPropagation(); var h = $('freeHint'); if (h) h.classList.add('hidden'); });
    var sheet = $('sheet');
    if (sheet) sheet.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.opt') : null;
      if (!b) return;
      var v, s = state.look.score;
      if ((v = b.getAttribute('data-score'))) s.on = v === 'on';
      else if ((v = b.getAttribute('data-sglow'))) s.glow = v === 'on';
      else if ((v = b.getAttribute('data-scolor'))) s.color = v;
      else if ((v = b.getAttribute('data-ssize'))) s.size = Math.max(0.6, Math.min(1.8, s.size + (v === '+' ? 0.1 : -0.1)));
      else return;
      saveLook(); applyLookUI();
    });
    var pos = $('scorePos');
    if (pos) pos.addEventListener('input', function () { state.look.score.pos = parseInt(pos.value, 10) || 0; saveLook(); applyLookUI(); });
    var scBg = $('scoreBg');
    if (scBg) scBg.addEventListener('input', function () {
      state.look.score.bgAlpha = Math.max(0, Math.min(1, parseFloat(scBg.value) / 100));
      var v = $('scoreBgVal'); if (v) v.textContent = Math.round(state.look.score.bgAlpha * 100) + '%';
      saveLook();
    });
    var bgb = $('bgBlur');
    if (bgb) bgb.addEventListener('input', function () {
      state.look.bgBlur = Math.max(0, Math.min(20, parseInt(bgb.value, 10) || 0));
      var v2 = $('bgBlurVal'); if (v2) v2.textContent = state.look.bgBlur + '%';
      bgCache = null; saveLook();
    });
    var gl = $('scoreGlowLevel');
    if (gl) gl.addEventListener('input', function () { state.look.score.glowLevel = parseInt(gl.value, 10) || 0; saveLook(); });
  }


  // ---------------- 使用教学 ----------------
  var tutIdx = 0;
  var TUT = [
    { t: '欢迎来到 MIDI 钢琴', b: '这里可以把 MIDI 或 MuseScore 的 MXL 乐谱变成会发光的瀑布流钢琴。<br><br>首页有四个入口：<b>开始播放</b>、<b>自由弹奏</b>、<b>设置</b>、<b>退出</b>。' },
    { t: '开始播放 / 自由弹奏', b: '开始播放会载入内置示例曲，跟着音符走。<br>自由弹奏是点琴键发声、音符条向上飞。<br><br>播放和自由弹奏都支持<b>双指上下拉</b>来加长/缩短音符条，自由弹奏里左右拉还能缩放键盘。' },
    { t: '特效类', b: '设置 → 特效类：<ul><li>命中特效：水花 / 火花 / 火焰 / 樱花 / 枫叶 / 赛博 / 星尘</li><li>音符泛光：9 种颜色 + 强度</li><li>左右手轨道颜色、随机或渐变配色</li><li>背景氛围与粒子数量</li><li>乐谱颜色、泛光、位置、大小、背景透明度</li></ul>' },
    { t: '功能类', b: '功能类里有：<ul><li>延音踏板开关</li><li>强弱音符识别（让 ppp/f 真正影响音量）</li><li>播放器侧栏、上方工具栏显隐</li><li>返回开始界面</li></ul>' },
    { t: '调试类', b: '调试类一般不用动：<ul><li>小节线</li><li>全屏（适配横屏刘海）</li><li>性能模式：卡顿时自动降低画质，平时关掉保持满画质</li><li>FPS / 运行信息</li></ul>' },
    { t: '导入一份 MXL 试试', b: '点「乐谱」按钮选一个 .mxl / .musicxml / .xml 文件，谱面会出现在瀑布流上方。<br><br>没有文件也没关系，可以直接用内置的《夜的钢琴曲五》。', actions: 'score' },
    { t: '乐谱功能', b: '谱面会跟随播放，支持反复、D.C./D.S./Segno/Coda/Fine、8va/8vb、延音线、倚音、连音、力度与渐强渐弱。<br><br>谱面的颜色、泛光、位置、大小、透明度都在「特效类」里调。' }
  ];
  function renderTut() {
    var st = TUT[tutIdx];
    var step = $('tutStep'); if (step) step.textContent = (tutIdx + 1) + ' / ' + TUT.length;
    var ti = $('tutTitle'); if (ti) ti.textContent = st.t;
    var bd = $('tutBody'); if (bd) bd.innerHTML = st.b;
    var ac = $('tutActions'); if (ac) {
      ac.innerHTML = '';
      if (st.actions === 'score') {
        var b1 = document.createElement('button'); b1.className = 'opt'; b1.textContent = '导入 MXL 文件';
        b1.onclick = function () { document.body.classList.remove('tut-on'); $('tutorial').classList.add('hidden'); var bi = $('btnScore'); if (bi) bi.click(); };
        var b2 = document.createElement('button'); b2.className = 'opt'; b2.textContent = '用内置示例';
        b2.onclick = loadBuiltinScore;
        ac.appendChild(b1); ac.appendChild(b2);
      }
    }
    var pv = $('tutPrev'); if (pv) { pv.disabled = tutIdx === 0; pv.classList.toggle('disabled', tutIdx === 0); }
    var nx = $('tutNext'); if (nx) nx.textContent = tutIdx === TUT.length - 1 ? '完成' : '下一步';
  }
  function showTutorial() { tutIdx = 0; renderTut(); document.body.classList.add('tut-on'); var t = $('tutorial'); if (t) t.classList.remove('hidden'); }
  function closeTutorial() { document.body.classList.remove('tut-on'); var t = $('tutorial'); if (t) t.classList.add('hidden'); }
  async function loadBuiltinScore() {
    try {
      if (!window.DEMO_MXL_XML) throw new Error('内置乐谱未加载');
      var f = new File([window.DEMO_MXL_XML], '夜的钢琴曲五.musicxml', { type: 'text/xml' });
      await loadScoreFile(f);
      closeTutorial();
      tutIdx = TUT.length - 1; renderTut();
      var t = $('tutorial'); if (t) t.classList.remove('hidden');
      toast('已载入内置乐谱《夜的钢琴曲五》');
    } catch (err) { toast('内置乐谱载入失败：' + (err && err.message ? err.message : err)); }
  }
  function bindTutorial() {
    var ht = $('homeTutorial'); if (ht) ht.addEventListener('click', showTutorial);
    var tc = $('tutClose'); if (tc) tc.addEventListener('click', closeTutorial);
    var tp = $('tutPrev'); if (tp) tp.addEventListener('click', function () { if (tutIdx > 0) { tutIdx--; renderTut(); } });
    var tn = $('tutNext'); if (tn) tn.addEventListener('click', function () { if (tutIdx < TUT.length - 1) { tutIdx++; renderTut(); } else closeTutorial(); });
  }

  function wrapSections() {
    document.querySelectorAll('.sheet-pane').forEach(function (pane) {
      var nodes = Array.prototype.slice.call(pane.childNodes);
      var box = null;
      nodes.forEach(function (node) {
        if (node.nodeType === 1 && node.classList.contains('sheet-label')) {
          box = document.createElement('div'); box.className = 'sec-box';
          node.classList.remove('sheet-label'); node.classList.add('sec-head');
          box.appendChild(node); pane.insertBefore(box, node.nextSibling);
        } else if (box && (node.nodeType !== 1 || (node.nodeType === 1))) {
          box.appendChild(node);
        }
      });
    });
  }

  function start() {
    wrapSections();
    (function initPdfWorker() {
      if (!window.pdfjsLib) return;
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'vendor/pdf.worker.min.js', true);
        xhr.responseType = 'text';
        xhr.onload = function () {
          if (xhr.responseText && (xhr.status === 200 || xhr.status === 0)) {
            try { pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([xhr.responseText], { type: 'application/javascript' })); } catch (e2) { }
          }
        };
        xhr.send();
      } catch (e) { }
    })();
    resize();
    initStars();
    restoreBackground();
    loadLook();
    bindUI();
    bindScoreUI();
    bindTutorial();
    bindLib();
    applyCollapse();
    applyLookUI();
    try { if (ensureAudio()) { /* 预解码钢琴采样 */ } } catch (e) { /* 无音频环境 */ }
    updateTransport(0);
    updatePlayButton();

    loadDemo();
    showHome();
    requestAnimationFrame(frame);
  }

  window.addEventListener('error', function (ev) {
    toast('出错了：' + (ev.message || '未知错误'));
  });

  start();
})();
