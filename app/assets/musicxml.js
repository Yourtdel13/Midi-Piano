/* 轻量 MusicXML / MXL 解析与乐谱绘制（无依赖） */
(function (global) {
  'use strict';

  var STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  var SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var ACC = { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': '##' };
  var PLAYED = '#58c8ff';

  function elName(e) { return (e && (e.localName || e.tagName) || '').toLowerCase(); }
  function txt(el, tag) {
    var n = el.getElementsByTagName(tag);
    return n && n.length ? n[0].textContent.trim() : '';
  }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }

  function parseXML(xml) {
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML 解析失败');
    var part = doc.getElementsByTagName('part')[0];
    if (!part) throw new Error('没有找到 part');
    var measuresEl = part.getElementsByTagName('measure');
    var notes = [], measures = [], repeats = [], endings = [], directions = [], ottavas = [], clefs = [], dynamics = [], wedges = [];
    var divisions = 1, tempo = 120, beats = 4, beatType = 4, keyFifths = 0, keyMode = 'major';
    var t = 0, tempoMap = [{ d: 0, bpm: tempo }], lastStart = 0;
    var openOttava = null, openEnding = null, openWedge = null;
    var tieStarts = [], slurStarts = {}, pendingGrace = [], gStarts = [], keys = [];

    function secAt(d) {
      var sec = 0, prevD = 0, bpm = tempoMap[0].bpm;
      for (var i = 0; i < tempoMap.length; i++) {
        var seg = tempoMap[i];
        if (seg.d > d) break;
        sec += (seg.d - prevD) / divisions * (60 / bpm);
        prevD = seg.d; bpm = seg.bpm;
      }
      return sec + (d - prevD) / divisions * (60 / bpm);
    }

    for (var mi = 0; mi < measuresEl.length; mi++) {
      var m = measuresEl[mi];
      var mStart = t;
      var ch = m.children;
      for (var ci = 0; ci < ch.length; ci++) {
        var el = ch[ci], tag = el.tagName;
        if (tag === 'attributes') {
          var dEl = el.getElementsByTagName('divisions')[0];
          if (dEl) divisions = Math.max(1, parseInt(dEl.textContent, 10) || 1);
          var kEl = el.getElementsByTagName('key')[0];
          if (kEl) { keyFifths = parseInt(txt(kEl, 'fifths') || '0', 10) || 0; keyMode = txt(kEl, 'mode') || 'major'; }
            if (kEl) { var qf = keyFifths, qm = keyMode, qlast = keys[keys.length-1]; if (!qlast || qlast.fifths !== qf || qlast.mode !== qm) keys.push({ time: secAt(mStart), fifths: qf, mode: qm }); }
          var tEl = el.getElementsByTagName('time')[0];
          if (tEl) { beats = parseInt(txt(tEl, 'beats') || '4', 10) || 4; beatType = parseInt(txt(tEl, 'beat-type') || '4', 10) || 4; }
          var clEls = el.getElementsByTagName('clef');
          for (var cli = 0; cli < clEls.length; cli++) {
            var cEl = clEls[cli];
            clefs.push({ time: secAt(mStart), staff: parseInt(cEl.getAttribute('number') || '1', 10) || 1,
              sign: (txt(cEl, 'sign') || 'G').toUpperCase(), line: parseInt(txt(cEl, 'line') || '2', 10) || 2 });
          }
        } else if (tag === 'direction') {
          var snd = el.getElementsByTagName('sound')[0];
          if (snd && snd.getAttribute('tempo')) tempoMap.push({ d: t, bpm: num(snd.getAttribute('tempo'), 120) });
          var words = el.getElementsByTagName('words')[0];
          if (words && words.textContent.trim()) directions.push({ time: secAt(t), text: words.textContent.trim() });
          if (el.getElementsByTagName('segno').length) directions.push({ time: secAt(t), sym: 'segno' });
          if (el.getElementsByTagName('coda').length) directions.push({ time: secAt(t), sym: 'coda' });
          var dynEl = el.getElementsByTagName('dynamics')[0];
          if (dynEl) {
            var dmk = '';
            for (var dci = 0; dci < dynEl.childNodes.length; dci++) { var dcn = dynEl.childNodes[dci]; if (dcn.nodeType === 1) { dmk = elName(dcn); break; } }
            var DMAP = { ppp: .2, pp: .3, p: .42, mp: .55, mf: .68, f: .8, ff: .9, fff: 1, fp: .95, sf: .95, sfz: .95, rfz: .9 };
            if (DMAP[dmk]) dynamics.push({ time: secAt(t), gain: DMAP[dmk], label: dmk });
          }
          if (snd) {
            var dv = parseFloat(snd.getAttribute('dynamics') || '');
            var dupDyn = false;
            for (var dqi = 0; dqi < dynamics.length; dqi++) if (Math.abs(dynamics[dqi].time - secAt(t)) < 0.02) { dupDyn = true; break; }
            if (!isNaN(dv) && !dupDyn) {
              var dg0 = Math.max(0.08, Math.min(1.3, dv / 100));
              var lbl = dg0 >= 1.02 ? 'fff' : dg0 >= .93 ? 'ff' : dg0 >= .82 ? 'f' : dg0 >= .7 ? 'mf' : dg0 >= .58 ? 'mp' : dg0 >= .45 ? 'p' : dg0 >= .32 ? 'pp' : 'ppp';
              dynamics.push({ time: secAt(t), gain: dg0, label: lbl });
            }
            if (snd.getAttribute('segno')) directions.push({ time: secAt(t), sym: 'segno' });
            if (snd.getAttribute('coda')) directions.push({ time: secAt(t), sym: 'coda' });
            if (snd.getAttribute('dalsegno')) directions.push({ time: secAt(t), text: 'D.S.' });
            if (snd.getAttribute('dacapo')) directions.push({ time: secAt(t), text: 'D.C.' });
            if (snd.getAttribute('tocoda')) directions.push({ time: secAt(t), text: 'To Coda' });
            if (snd.getAttribute('fine')) directions.push({ time: secAt(t), text: 'Fine' });
          }
          var wd = el.getElementsByTagName('wedge')[0];
          if (wd) {
            var wt = wd.getAttribute('type');
            if (wt === 'crescendo' || wt === 'diminuendo') openWedge = { time: secAt(t), type: wt };
            else if (wt === 'stop' && openWedge) { wedges.push({ start: openWedge.time, end: secAt(t), type: openWedge.type }); openWedge = null; }
          }
          var os = el.getElementsByTagName('octave-shift')[0];
          if (os) {
            var typ = os.getAttribute('type');
            var dirEl = el.parentNode && el.parentNode.parentNode ? el.parentNode.parentNode : el;
            var osStaff = parseInt(txt(el, 'staff') || txt(dirEl, 'staff') || '0', 10) || 0;
            if (typ === 'stop') {
              if (openOttava) { ottavas.push({ start: openOttava.time, end: secAt(t), dir: openOttava.dir, staff: openOttava.staff, size: 8 }); openOttava = null; }
            } else {
              var osY = parseFloat(os.getAttribute('default-y') || 'NaN');
              var osDir = isNaN(osY) ? (typ === 'down' ? 'down' : 'up') : (osY >= 0 ? 'up' : 'down');
              openOttava = { time: secAt(t), dir: osDir, staff: osStaff, y: osY };
            }
          }
        } else if (tag === 'sound') {
          if (el.getAttribute('tempo')) tempoMap.push({ d: t, bpm: num(el.getAttribute('tempo'), 120) });
        } else if (tag === 'backup') {
          t -= parseInt(txt(el, 'duration') || '0', 10) || 0;
        } else if (tag === 'forward') {
          t += parseInt(txt(el, 'duration') || '0', 10) || 0;
        } else if (tag === 'barline') {
          var rep = el.getElementsByTagName('repeat')[0];
          if (rep) {
            if (rep.getAttribute('direction') === 'forward') repeats.push({ at: secAt(mStart), dir: 'fwd' });
            else if (rep.getAttribute('direction') === 'backward') repeats.push({ at: secAt(t), dir: 'back' });
          }
          var end = el.getElementsByTagName('ending')[0];
          if (end) {
            var et = end.getAttribute('type');
            if (et === 'start') openEnding = { start: mStart, label: end.getAttribute('number') || '1' };
            else if (openEnding) { endings.push({ start: secAt(openEnding.start), end: secAt(t), label: openEnding.label }); openEnding = null; }
          }
        } else if (tag === 'note') {
          var dur = parseInt(txt(el, 'duration') || '0', 10) || 0;
          var isRest = !!el.getElementsByTagName('rest').length;
          var isChord = !!el.getElementsByTagName('chord').length;
          var startD = isChord ? lastStart : t;
        var nDyn = el.getElementsByTagName('dynamics')[0];
        if (nDyn && !isChord) {
          var nmk = '';
          for (var ndi = 0; ndi < nDyn.childNodes.length; ndi++) { var ndn = nDyn.childNodes[ndi]; if (ndn.nodeType === 1) { nmk = elName(ndn); break; } }
          var ND = { ppp: .2, pp: .3, p: .42, mp: .55, mf: .68, f: .8, ff: .9, fff: 1, fp: .95, sf: .95, sfz: .95, rfz: .9 };
          if (ND[nmk]) dynamics.push({ time: secAt(startD), gain: ND[nmk], label: nmk, staff: 1 });
        }
          var type = txt(el, 'type');
          var dots = el.getElementsByTagName('dot').length;
          var isGrace = !!el.getElementsByTagName('grace').length;
          var staffEl0 = el.getElementsByTagName('staff')[0];
          var staff0 = staffEl0 ? (parseInt(staffEl0.textContent, 10) || 1) : 1;
          if (isRest) {
            notes.push({ rest: true, start: secAt(startD), dur: Math.max(0.02, secAt(startD + dur) - secAt(startD)),
              type: type, dots: dots, staff: staff0, voice: parseInt(txt(el, 'voice') || '1', 10) || 1, measure: mi });
            if (!isChord && !isGrace) { lastStart = t; t += dur; }
            continue;
          }
          if (!isRest) {
            var p = el.getElementsByTagName('pitch')[0];
            if (p) {
              var step = txt(p, 'step').toUpperCase();
              var oct = parseInt(txt(p, 'octave') || '4', 10);
              var alter = parseInt(txt(p, 'alter') || '0', 10) || 0;
              var staffEl = el.getElementsByTagName('staff')[0];
              var staff = staffEl ? (parseInt(staffEl.textContent, 10) || 1) : (oct < 4 ? 2 : 1);
              var voice = parseInt(txt(el, 'voice') || '1', 10) || 1;
              var arts = {};
              var nt = el.getElementsByTagName('notations')[0];
              if (nt) {
                if (nt.getElementsByTagName('accent').length || nt.getElementsByTagName('strong-accent').length) arts.accent = true;
                if (nt.getElementsByTagName('staccato').length) arts.staccato = true;
                if (nt.getElementsByTagName('trill-mark').length) arts.trill = true;
                if (nt.getElementsByTagName('arpeggiate').length) arts.arpeggio = true;
                var gl = nt.getElementsByTagName('glissando')[0] || nt.getElementsByTagName('slide')[0];
                if (gl) arts.gliss = (gl.getAttribute('type') === 'start') ? 'start' : 'stop';
              }
              var accEl = el.getElementsByTagName('accidental')[0];
              var accTxt = accEl ? accEl.textContent.trim() : '';
              var beams = [];
              var bEls = el.getElementsByTagName('beam');
              for (var bi = 0; bi < bEls.length; bi++) beams.push({ n: parseInt(bEls[bi].getAttribute('number') || '1', 10), s: bEls[bi].textContent.trim() });
              var stemTxt = txt(el, 'stem');
              var tmEl = el.getElementsByTagName('time-modification')[0];
              var tupAct = tmEl ? parseInt(txt(tmEl, 'actual-notes') || '0', 10) : 0;
              var tupNor = tmEl ? parseInt(txt(tmEl, 'normal-notes') || '0', 10) : 0;
              var n = {
                stem: stemTxt, step: step, octave: oct, alter: alter, staff: staff, voice: voice, type: type, dots: dots,
                grace: isGrace, slash: isGrace && (el.getAttribute('slash') === 'yes'), beams: beams, acc: accTxt, arts: arts,
                midi: (oct + 1) * 12 + (SEMI[step] | 0) + alter,
                start: secAt(startD), dur: Math.max(0.02, secAt(startD + dur) - secAt(startD)),
                measure: mi, diatonic: oct * 7 + (STEP[step] | 0), tuplet: tupAct > tupNor ? tupAct : 0
              };
              if (isGrace) { (pendingGrace || (pendingGrace = [])).push(n); }
              else { if (pendingGrace && pendingGrace.length) { n.graces = pendingGrace; pendingGrace = []; } notes.push(n); }
              if (el.getElementsByTagName('tie').length) {
                var tieTypes = [];
                var tt = el.getElementsByTagName('tie');
                for (var ti = 0; ti < tt.length; ti++) tieTypes.push(tt[ti].getAttribute('type'));
                if (tieTypes.indexOf('start') >= 0) { n.tieStart = true; tieStarts.push(n); }
                if (tieTypes.indexOf('stop') >= 0) { n.tieStop = true;
                  for (var ts = tieStarts.length - 1; ts >= 0; ts--) {
                    if (tieStarts[ts].midi === n.midi && tieStarts[ts].staff === n.staff) { tieStarts[ts].tieTo = n; tieStarts.splice(ts, 1); break; }
                  }
                }
              }
              var sl = el.getElementsByTagName('slur');
              for (var si = 0; si < sl.length; si++) {
                var st = sl[si].getAttribute('type'), sn = sl[si].getAttribute('number') || '1';
                if (st === 'start') slurStarts[sn] = n;
                else if (st === 'stop' && slurStarts[sn]) { slurStarts[sn].slurTo = n; delete slurStarts[sn]; }
              }
            }
          }
          if (!isChord && !isGrace) { lastStart = t; t += dur; }
        }
      }
      measures.push({ start: secAt(mStart), end: secAt(t), index: mi });
      if (openEnding && mi === measuresEl.length - 1) { endings.push({ start: secAt(openEnding.start), end: secAt(t), label: openEnding.label }); openEnding = null; }
    }
    if (openOttava) ottavas.push({ start: openOttava.time, end: secAt(t), dir: openOttava.dir, staff: openOttava.staff || 0, size: 8 });
    for (var oi2 = 0; oi2 < ottavas.length; oi2++) {
      if (ottavas[oi2].staff) continue;
      var cnt = { 1: 0, 2: 0 };
      for (var nj2 = 0; nj2 < notes.length; nj2++) {
        var nt2 = notes[nj2];
        if (nt2.rest || nt2.start < ottavas[oi2].start - 0.05 || nt2.start > ottavas[oi2].end) continue;
        cnt[nt2.staff === 2 ? 2 : 1]++;
      }
      ottavas[oi2].staff = cnt[2] > cnt[1] ? 2 : 1;
    }
    for (var no2 = 0; no2 < notes.length; no2++) {
      var nn2 = notes[no2];
      nn2.ottava = 0;
      nn2.drawOct = 0;
      for (var oo2 = 0; oo2 < ottavas.length; oo2++) {
        var ov2 = ottavas[oo2];
        if (nn2.rest) continue;
        if (nn2.staff !== ov2.staff) continue;
        if (nn2.start < ov2.start - 0.05 || nn2.start > ov2.end) continue;
        nn2.drawOct += (ov2.dir === 'down' ? 7 : -7);
      }
    }

    notes.sort(function (a, b) { return a.start - b.start; });
    var glStack = [];
    for (var gq = 0; gq < notes.length; gq++) {
      var gn = notes[gq];
      if (!gn.arts) continue;
      if (gn.arts.gliss === 'start') glStack.push(gn);
      else if (gn.arts.gliss === 'stop' && glStack.length) { glStack.pop().glissTo = gn; }
    }

    for (var k = 0; k < measures.length; k++) {
      if (measures[k].end <= measures[k].start) measures[k].end = measures[k].start + 0.01;
    }
    var title = '';
    var work = doc.getElementsByTagName('work-title')[0];
    var move = doc.getElementsByTagName('movement-title')[0];
    title = (work && work.textContent.trim()) || (move && move.textContent.trim()) || '';
    return {
      notes: notes, measures: measures, repeats: repeats, endings: endings, directions: directions, ottavas: ottavas, wedges: wedges, dynamics: dynamics,
      title: title, beats: beats, beatType: beatType, keyFifths: keyFifths, keyMode: keyMode, clefs: clefs, keys: keys,
      duration: measures.length ? measures[measures.length - 1].end : 0
    };
  }

  // ---------- ZIP (MXL) ----------
  function u16(d, o) { return d[o] | (d[o + 1] << 8); }
  function u32(d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0; }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('设备不支持 MXL 解压，请导入 .musicxml');
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzipMXL(buf) {
    var d = new Uint8Array(buf), eocd = -1, i;
    for (i = d.length - 22; i >= 0 && i > d.length - 66000; i--) if (u32(d, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('不是有效的 MXL 文件');
    var count = u16(d, eocd + 10), cdOff = u32(d, eocd + 16), p = cdOff, best = null;
    for (var n = 0; n < count; n++) {
      if (u32(d, p) !== 0x02014b50) break;
      var method = u16(d, p + 10), csize = u32(d, p + 20);
      var nlen = u16(d, p + 28), elen = u16(d, p + 30), clen = u16(d, p + 32), lho = u32(d, p + 42);
      var name = '';
      for (var c = 0; c < nlen; c++) name += String.fromCharCode(d[p + 46 + c]);
      if (/\.(xml|musicxml)$/i.test(name) && !/META-INF/i.test(name)) {
        var lname = u16(d, lho + 26), lextra = u16(d, lho + 28), dataOff = lho + 30 + lname + lextra;
        best = { method: method, raw: d.subarray(dataOff, dataOff + csize), name: name };
        if (/score/i.test(name)) break;
      }
      p += 46 + nlen + elen + clen;
    }
    if (!best) throw new Error('MXL 内没有找到 score XML');
    var out = best.method === 0 ? best.raw : await inflateRaw(best.raw);
    return new TextDecoder('utf-8').decode(out);
  }

  // ---------- 绘制 ----------
  var GLYPH_G = '\uD834\uDD1E';
  var GLYPH_F = '\uD834\uDD22';

  function drawArts(ctx, x, y, up, gap, size, arts, color, cy0, cy1) {
    var side = up ? -1 : 1;
    var ay = y + side * gap * 2.5;
    ctx.save();
    ctx.fillStyle = color; ctx.strokeStyle = color; ctx.shadowBlur = 0; ctx.globalAlpha = 0.95;
    if (arts.accent) {
      ctx.font = 'bold ' + (gap * 1.9) + 'px system-ui, sans-serif';
      ctx.fillText('>', x - gap * 0.5, y + (up ? -gap * 0.55 : gap * 1.25));
    }
    if (arts.staccato) {
      ctx.beginPath(); ctx.arc(x, y + gap * 0.95, Math.max(1, gap * 0.24), 0, Math.PI * 2); ctx.fill();
    }
    if (arts.trill) {
      ctx.font = 'italic bold ' + (gap * 1.5) + 'px serif';
      ctx.fillText('tr', x - gap * 0.45, ay - gap * 0.1);
      ctx.lineWidth = Math.max(1, size);
      ctx.beginPath();
      for (var i = 0; i <= 10; i++) {
        var wx = x + gap * 0.9 + i * gap * 0.22, wy = ay - gap * 0.4 + (i % 2 ? gap * 0.18 : -gap * 0.18);
        if (i === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
      }
      ctx.stroke();
    }
    if (arts.arpeggio) {
      var yTopA = (cy0 != null ? cy0 : y - gap * 1.6) - gap * 0.25;
      var yBotA = (cy1 != null ? cy1 : y + gap * 0.4) + gap * 0.25;
      var nz = Math.max(4, Math.round((yBotA - yTopA) / (gap * 0.34)));
      ctx.lineWidth = Math.max(1, 1.3 * size);
      ctx.beginPath();
      for (var a = 0; a <= nz; a++) {
        var ax2 = x - gap * 1.8 + (a % 2 ? gap * 0.28 : -gap * 0.28), ay2 = yBotA + a * (yTopA - yBotA) / nz;
        if (a === 0) ctx.moveTo(ax2, ay2); else ctx.lineTo(ax2, ay2);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawQuarterRest(ctx, x, y, gap, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.2, gap * 0.24);
    ctx.beginPath();
    ctx.moveTo(x - gap * 0.28, y - gap * 0.9);
    ctx.quadraticCurveTo(x + gap * 0.45, y - gap * 0.5, x - gap * 0.05, y + gap * 0.05);
    ctx.quadraticCurveTo(x - gap * 0.5, y + gap * 0.45, x + gap * 0.32, y + gap * 0.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + gap * 0.42, y + gap * 0.85, gap * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawScore(ctx, score, opts, view) {
    var w = opts.w, y0 = opts.y, x0 = opts.x;
    var color = opts.color || '#ffffff';
    var size = opts.size || 1;
    var gap = Math.max(4, 7 * size);
    var staffH = gap * 4;
    var top1 = y0;
    var top2 = y0 + staffH + gap * 3.2 + 16 * size;
    var leftPad = 30 * size, rightPad = 12 * size;
    var t = view.time;

    ctx.save();
    ctx.fillStyle = 'rgba(3,5,12,' + (opts.bgAlpha == null ? 0.72 : opts.bgAlpha) + ')';
    ctx.fillRect(x0, y0 - gap * 2.6, w, (top2 + staffH) - y0 + gap * 3.4);
    ctx.shadowColor = color; ctx.shadowBlur = 0;

    // 五线
    ctx.strokeStyle = color;
    for (var s = 0; s < 2; s++) {
      var top = s === 0 ? top1 : top2;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      for (var i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(x0 + leftPad, top + i * gap);
        ctx.lineTo(x0 + w - rightPad, top + i * gap);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = color;
      ctx.font = (gap * 4.1) + 'px serif';
      ctx.textAlign = 'left';
      ctx.fillText(s === 0 ? GLYPH_G : GLYPH_F, x0 + 4 * size, top + gap * 3.45);
      if (score.keyFifths) {
        var sx = x0 + leftPad * 0.55, cnt = Math.abs(score.keyFifths);
        var sharpPos = [0.5, 2.0, 0.0, 1.5, 3.0, 1.0, 2.5], flatPos = [1.5, 0.5, 2.5, 1.5, 3.5, 2.5, 0.5];
        ctx.font = 'bold ' + (gap * 2.0) + 'px serif';
        ctx.fillStyle = color; ctx.globalAlpha = 0.9;
        for (var ki = 0; ki < cnt; ki++) {
          var ky = top + gap * (score.keyFifths > 0 ? sharpPos[ki] : flatPos[ki]);
          ctx.fillText(score.keyFifths > 0 ? '\u266F' : '\u266D', sx + ki * gap * 0.62, ky + gap * 0.7);
        }
        ctx.globalAlpha = 1;
      }
    }

    var ms = score.measures, dur = score.duration || 1;
    var winStart = 0, winEnd = dur;
    if (opts.windowSec && dur > opts.windowSec) {
      winStart = Math.max(0, Math.min(dur - opts.windowSec, t - opts.windowSec * 0.25));
      winEnd = winStart + opts.windowSec;
    }
    var plotW = w - leftPad - rightPad;
    function xOf(tt) { return x0 + leftPad + (tt - winStart) / Math.max(0.001, winEnd - winStart) * plotW; }

    // 小节内的转调调号（按 MXL 的 <key> 变化）
    if (score.keys && score.keys.length) {
      for (var kk2 = 0; kk2 < score.keys.length; kk2++) {
        var kk = score.keys[kk2];
        if (kk2 === 0 || !inWin(kk.time) || kk.time <= 0.001) continue;
        var kx = xOf(kk.time) + gap * 0.12;
        var kcnt = Math.abs(kk.fifths | 0), ksharp = (kk.fifths | 0) > 0;
        ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(xOf(kk.time), top1); ctx.lineTo(xOf(kk.time), top2 + staffH); ctx.stroke(); ctx.restore();
        var pk = score.keys[kk2 - 1] || { fifths: 0 };
        var pcnt = Math.abs(pk.fifths | 0), psharp = (pk.fifths | 0) > 0;
        for (var st3 = 0; st3 < 2; st3++) {
          var ktop = st3 === 0 ? top1 : top2;
          ctx.fillStyle = color; ctx.globalAlpha = 0.9;
          ctx.font = '600 ' + (gap * 1.9).toFixed(1) + 'px serif';
          var kxo = kx;
          if ((pk.fifths | 0) !== (kk.fifths | 0) && pcnt > 0) {
            for (var pi3 = 0; pi3 < pcnt; pi3++) {
              var pyy = ktop + gap * (psharp ? sharpPos[pi3] : flatPos[pi3]);
              ctx.fillText('\u266E', kxo + pi3 * gap * 0.55, pyy + gap * 0.7);
            }
            kxo += pcnt * gap * 0.55 + gap * 0.18;
          }
          for (var ki3 = 0; ki3 < kcnt; ki3++) {
            var kyy = ktop + gap * (ksharp ? sharpPos[ki3] : flatPos[ki3]);
            ctx.fillText(ksharp ? '\u266F' : '\u266D', kxo + ki3 * gap * 0.55, kyy + gap * 0.7);
          }
        }
      }
    }
    function bottomRef(staff, time) {
      var sign = 'G', line = 2;
      var cs = score.clefs || [];
      for (var qi = 0; qi < cs.length; qi++) {
        if (cs[qi].staff === staff && cs[qi].time <= time + 0.001) { sign = cs[qi].sign; line = cs[qi].line; }
      }
      var base = sign === 'F' ? 24 : (sign === 'C' ? 28 : 32);
      return base - (line - 1) * 2;
    }
    function yOf(n) {
      var top = n.staff === 2 ? top2 : top1;
      return top + staffH - ((n.diatonic + (n.drawOct || 0)) - bottomRef(n.staff, n.start)) * (gap / 2);
    }
    function inWin(tt) { return tt >= winStart - 0.15 && tt <= winEnd; }

    // 小节线 + 反复
    for (var b = 0; b < ms.length; b++) {
      if (!inWin(ms[b].start)) continue;
      var bx = xOf(ms[b].start) - gap * 0.55;
      ctx.globalAlpha = 0.3; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bx, top1); ctx.lineTo(bx, top2 + staffH); ctx.stroke();
    }
    for (var r = 0; r < score.repeats.length; r++) {
      var rp = score.repeats[r];
      if (!inWin(rp.at)) continue;
      var rx = xOf(rp.at);
      ctx.globalAlpha = 0.9; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(rx, top1); ctx.lineTo(rx, top2 + staffH); ctx.stroke();
      ctx.fillStyle = color;
      for (var dq = 0; dq < 2; dq++) {
        ctx.beginPath();
        ctx.arc(rx + (rp.dir === 'fwd' ? 4 * size : -4 * size), top1 + staffH * 0.38 + dq * gap * 1.3, 1.5 * size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 1. 2. 3. 房子
    for (var e = 0; e < score.endings.length; e++) {
      var en = score.endings[e];
      if (!inWin(en.start)) continue;
      var ex1 = xOf(en.start), ex2 = xOf(en.end);
      var ey = top1 - gap * 0.9;
      ctx.globalAlpha = 0.8; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(ex1, ey); ctx.lineTo(ex2, ey); ctx.lineTo(ex2, ey + gap * 0.8);
      ctx.stroke();
      ctx.font = (gap * 1.5) + 'px system-ui, sans-serif';
      ctx.fillStyle = color;
      ctx.fillText(en.label + '.', ex1 + 3, ey - 2);
    }

    // 渐强 / 渐弱（发夹记号，按时间拉伸）
    for (var wi = 0; wi < (score.wedges || []).length; wi++) {
      var wg = score.wedges[wi];
      var wx1 = xOf(wg.start), wx2 = Math.max(wx1 + gap * 2.2, xOf(wg.end));
      if (wx2 < -20 || wx1 > w + 20) continue;
      var wy = (top1 + staffH + top2) / 2 + gap * 0.2, wh = gap * 0.55;
      ctx.save(); ctx.globalAlpha = 0.85; ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, size * 0.9);
      ctx.beginPath();
      if (wg.type === 'crescendo') { ctx.moveTo(wx1, wy - wh); ctx.lineTo(wx2, wy); ctx.lineTo(wx1, wy + wh); }
      else { ctx.moveTo(wx1, wy); ctx.lineTo(wx2, wy - wh); ctx.moveTo(wx1, wy); ctx.lineTo(wx2, wy + wh); }
      ctx.stroke(); ctx.restore();
    }

    // 力度记号
    for (var dy = 0; dy < (score.dynamics || []).length; dy++) {
      var dn = score.dynamics[dy];
      if (!inWin(dn.time)) continue;
      var dnx = xOf(dn.time);
      ctx.save(); ctx.globalAlpha = 0.95; ctx.fillStyle = color;
      ctx.font = 'italic 700 ' + (gap * 1.6) + 'px serif';
      ctx.fillText(dn.label || 'f', dnx + 2, (top1 + staffH + top2) / 2 + gap * 1.2);
      ctx.restore();
    }

    // 文字指示（D.C. / D.S. / To Coda）
    for (var d = 0; d < score.directions.length; d++) {
      var dr = score.directions[d];
      if (!inWin(dr.time)) continue;
      var dx = xOf(dr.time);
      ctx.globalAlpha = 0.85; ctx.fillStyle = color;
      ctx.font = 'bold ' + (gap * 1.5) + 'px system-ui, sans-serif';
      if (!dr.sym && /^Fine$/i.test(dr.text || '')) { ctx.font = 'italic ' + (gap * 1.5) + 'px serif'; ctx.fillText('Fine', dx + 2, top1 - gap * 0.6); continue; }
      if (dr.sym === 'segno') { drawSegno(ctx, dx, top1 - gap * 0.9, gap * 1.2, color); ctx.font = 'bold ' + (gap * 1.1) + 'px system-ui, sans-serif'; ctx.fillText('Segno', dx + gap * 1.8, top1 - gap * 0.9 + gap * 0.4); }
      else if (dr.sym === 'coda') { drawCoda(ctx, dx, top1 - gap * 0.9, gap * 1.2, color); ctx.font = 'bold ' + (gap * 1.1) + 'px system-ui, sans-serif'; ctx.fillText('Coda', dx + gap * 1.8, top1 - gap * 0.9 + gap * 0.4); }
      else ctx.fillText(dr.text, dx + 2, top1 - gap * 0.6);
    }

    // 音符 / 休止 / 倚音
    var heads = [], restHeads = [];
    for (var k = 0; k < score.notes.length; k++) {
      var nn = score.notes[k];
      if (nn.start > winEnd + 0.4) break;
      if (!inWin(nn.start)) continue;
      var shift = 0; // 8va/8vb 只影响发声，谱面保持原谱写法
      if (nn.rest) {
        restHeads.push({ n: nn, x: xOf(nn.start), top: (nn.staff === 2 ? top2 : top1) });
      } else {
        heads.push({ n: nn, x: xOf(nn.start), y: yOf(nn) - shift * (gap / 2), shift: shift });
      }
    }

    // 休止符
    for (var rh = 0; rh < restHeads.length; rh++) {
      var rr = restHeads[rh], rn = rr.n;
      var playedR = rn.start <= t + 0.001;
      var rc = playedR ? PLAYED : color;
      var rt = rn.type || 'quarter';
      var midY = rr.top + staffH * 0.5;
      ctx.fillStyle = rc; ctx.strokeStyle = rc; ctx.globalAlpha = 0.9; ctx.shadowBlur = 0;
      if (rt === 'whole' || rt === 'half') {
        var rw = gap * 1.15, rhh = gap * 0.55;
        var ry = rt === 'whole' ? rr.top + gap * 0.85 : midY - rhh;
        ctx.fillRect(rr.x - rw / 2, ry, rw, rhh);
      } else {
        drawQuarterRest(ctx, rr.x, midY, gap, rc);
        var hooks = rt === 'eighth' ? 1 : rt === '16th' ? 2 : rt === '32nd' ? 3 : rt === '64th' ? 4 : 0;
        ctx.lineWidth = Math.max(1, 1.1 * size);
        for (var hk = 0; hk < hooks; hk++) {
          ctx.beginPath();
          ctx.arc(rr.x + gap * 0.5, midY - gap * (0.75 + hk * 0.5), gap * 0.4, -0.5, 2.1);
          ctx.stroke();
        }
      }
      for (var rd = 0; rd < (rn.dots || 0); rd++) {
        ctx.beginPath(); ctx.arc(rr.x + gap * 0.95 + rd * gap * 0.45, midY, Math.max(1, gap * 0.11), 0, Math.PI * 2); ctx.fill();
      }
    }

    // 连音组：每组只标一次数字
    var tupEnds = {};
    var tupSorted = score.notes.slice().sort(function (a, b) { return a.start - b.start; });
    for (var tq = 0; tq < tupSorted.length; tq++) {
      var tn = tupSorted[tq];
      if (!tn.tuplet) continue;
      var tk = tn.staff + '|' + tn.voice;
      if (!(tn.start < (tupEnds[tk] || 0) - 0.001)) {
        tn._tupFirst = true;
        tupEnds[tk] = tn.start + Math.max(0.05, tn.dur) * tn.tuplet + 0.02;
      }
    }
    // 符头/符干与连桁分组
    var groups = [];
    for (var q = 0; q < heads.length; q++) {
      var h = heads[q], nh = h.n;
      var type = nh.type || 'quarter';
      h.hollow = type === 'whole' || type === 'half';
      h.flags = type === 'eighth' ? 1 : type === '16th' ? 2 : type === '32nd' ? 3 : type === '64th' ? 4 : 0;
      h.r = Math.max(2.4, 3.4 * size);
      h.beamed = false;
    }
    // 和弦统一符干方向
    var cMap = {};
    for (var qi = 0; qi < heads.length; qi++) {
      var hc = heads[qi];
      var ck = hc.n.start.toFixed(3) + '|' + hc.n.staff + '|' + hc.n.voice;
      (cMap[ck] || (cMap[ck] = [])).push(hc);
    }
    for (var ck3 in cMap) {
      var carr = cMap[ck3], cy0 = 1e9, cy1 = -1e9;
      for (var ci3 = 0; ci3 < carr.length; ci3++) { if (carr[ci3].y < cy0) cy0 = carr[ci3].y; if (carr[ci3].y > cy1) cy1 = carr[ci3].y; }
      for (var ci4 = 0; ci4 < carr.length; ci4++) { carr[ci4]._chordY0 = cy0; carr[ci4]._chordY1 = cy1; }
    }
    for (var ck2 in cMap) {
      var arr = cMap[ck2], upDir = null, sumY = 0;
      for (var ai = 0; ai < arr.length; ai++) {
        var st = arr[ai].n.stem;
        if (st === 'up') upDir = true; else if (st === 'down') upDir = false;
        sumY += arr[ai].y;
      }
      if (upDir === null) {
        var midY = (arr[0].n.staff === 2 ? top2 : top1) + staffH * 0.5;
        upDir = (sumY / arr.length) > midY;
      }
      var yTop = Infinity, yBot = -Infinity;
      for (var ak = 0; ak < arr.length; ak++) { yTop = Math.min(yTop, arr[ak].y); yBot = Math.max(yBot, arr[ak].y); }
      for (var af = 0; af < arr.length; af++) if (Math.abs(arr[af].y - yBot) < 0.01) { arr[af]._artDraw = true; break; }
      var sharedY = upDir ? yTop - gap * 3.2 : yBot + gap * 3.2;
      for (var ak = 0; ak < arr.length; ak++) {
        var hh = arr[ak]; hh.up = upDir;
        hh.stemX = hh.x + (upDir ? hh.r * 0.82 : -hh.r * 0.82);
        hh.stemY = sharedY;
      }
    }
    // 优先用 MusicXML 的 beam 标记分组
    var hasBeamTags = false;
    for (var qb = 0; qb < heads.length; qb++) if (heads[qb].n.beams && heads[qb].n.beams.length) { hasBeamTags = true; break; }
    if (hasBeamTags) {
      var curBy = {};
      for (var qc = 0; qc < heads.length; qc++) {
        var hb = heads[qc], b1 = null, bs = hb.n.beams || [];
        for (var bi2 = 0; bi2 < bs.length; bi2++) if (bs[bi2].n === 1) b1 = bs[bi2];
        if (!b1) continue;
        var bk = hb.n.staff + '|m' + hb.n.measure + '|v' + hb.n.voice;
        if (b1.s === 'begin') { curBy[bk] = { notes: [hb] }; groups.push(curBy[bk]); hb.beamed = true; }
        else if (b1.s === 'continue' && curBy[bk]) { curBy[bk].notes.push(hb); hb.beamed = true; }
        else if (b1.s === 'end' && curBy[bk]) { curBy[bk].notes.push(hb); hb.beamed = true; curBy[bk] = null; }
      }
    } else {
      var curGroup = null, lastBeamStart = -1, lastBeamKey = '';
      for (var qd = 0; qd < heads.length; qd++) {
        var hd = heads[qd], nd = hd.n;
        if (hd.flags > 0) {
          var mm = score.measures[nd.measure] || { start: 0, end: 1 };
          var bts = score.beats || 4;
          var beatLen = Math.max(0.01, (mm.end - mm.start) / bts);
          var span = beatLen * (bts % 3 === 0 ? 1.5 : 2);
          var key = nd.measure + '|' + nd.staff + '|' + nd.voice + '|' + Math.floor((nd.start - mm.start) / span);
          if (curGroup && key === lastBeamKey && (nd.start - lastBeamStart) < span * 0.95) { curGroup.notes.push(hd); hd.beamed = true; }
          else { curGroup = { notes: [hd] }; groups.push(curGroup); hd.beamed = true; }
          lastBeamKey = key; lastBeamStart = nd.start;
        } else { curGroup = null; lastBeamKey = ''; }
      }
    }

    for (var gg = 0; gg < groups.length; gg++) {
      if (groups[gg].notes.length < 2) { groups[gg].notes.forEach(function (x) { x.beamed = false; }); continue; }
      var gs = groups[gg].notes, gf = gs[0], gl = gs[gs.length - 1];
      var uni = [], lastSt = -1;
      for (var gu = 0; gu < gs.length; gu++) { var stv = Math.round(gs[gu].n.start * 1000); if (stv !== lastSt) { uni.push(gs[gu]); lastSt = stv; } }
      if (uni.length >= 2) { gf = uni[0]; gl = uni[uni.length - 1]; }
      var stTopG = (gs[0].n.staff === 2 ? top2 : top1);
      var avgYg = 0; for (var aug = 0; aug < uni.length; aug++) avgYg += uni[aug].y; avgYg /= Math.max(1, uni.length);
      if (gs[0].n.staff === 2 && avgYg < stTopG + staffH * 0.42) {
        for (var fg2 = 0; fg2 < gs.length; fg2++) {
          var hg2 = gs[fg2]; hg2.up = false;
          hg2.stemY = (hg2._chordY1 != null ? hg2._chordY1 : hg2.y) + gap * 3.2;
        }
      }
      var yA = gf.stemY, yB = gl.stemY;
      var maxSlope = gap * 2.2;
      if (Math.abs(yB - yA) > maxSlope) { yB = yA + (yB > yA ? maxSlope : -maxSlope); }
      var dx = Math.max(1, gl.stemX - gf.stemX);
      groups[gg].y0 = yA; groups[gg].y1 = yB; groups[gg].dx = dx;
      for (var gq = 0; gq < gs.length; gq++) {
        gs[gq].stemY = yA + (gs[gq].stemX - gf.stemX) * (yB - yA) / dx;
      }
    }

    // 倚音
    for (var gq = 0; gq < heads.length; gq++) {
      var gh = heads[gq];
      if (!gh.n.graces) continue;
      for (var gi0 = 0; gi0 < gh.n.graces.length; gi0++) {
        var gn = gh.n.graces[gi0];
        var gx = gh.x - gap * (1.5 + gi0 * 1.1), gy = gh.y - gap * 0.5;
        var gr = Math.max(1.8, 2.4 * size);
        var gPlayed = gh.n.start <= t + 0.001;
        ctx.fillStyle = gPlayed ? PLAYED : color; ctx.strokeStyle = gPlayed ? PLAYED : color;
        ctx.globalAlpha = 0.9; ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.ellipse(gx, gy, gr, gr * 0.7, -0.3, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = Math.max(1, 0.9 * size);
        ctx.beginPath(); ctx.moveTo(gx + gr * 0.8, gy); ctx.lineTo(gx + gr * 0.8, gy - gap * 2.1); ctx.stroke();
        if (gn.slash) { ctx.beginPath(); ctx.moveTo(gx - gr * 1.2, gy + gap * 0.75); ctx.lineTo(gx + gr * 2.0, gy - gap * 0.9); ctx.stroke(); }
      }
    }

    // 符头 + 符干
    for (var q2 = 0; q2 < heads.length; q2++) {
      var h2 = heads[q2], n2 = h2.n;
      var played = n2.start <= t + 0.001;
      var near = Math.abs(n2.start - t) < 2.2;
      var headColor = played ? PLAYED : color;
      var r = h2.r;
      ctx.fillStyle = headColor; ctx.strokeStyle = headColor;
      ctx.shadowBlur = (opts.glow && (near || played)) ? (opts.glowBlur || 10) : 0;
      ctx.shadowColor = played ? PLAYED : headColor;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.ellipse(h2.x, h2.y, r, r * 0.72, -0.32, 0, Math.PI * 2);
      if (h2.hollow) { ctx.lineWidth = Math.max(1, 1.4 * size); ctx.stroke(); } else ctx.fill();

      if (n2.type !== 'whole') {
        ctx.lineWidth = Math.max(1.4, 1.75 * size);
        ctx.beginPath(); ctx.moveTo(h2.stemX, h2.y); ctx.lineTo(h2.stemX, h2.stemY); ctx.stroke();
        var flags = h2.beamed ? 0 : h2.flags;
        for (var f = 0; f < flags; f++) {
          ctx.beginPath();
          ctx.moveTo(h2.stemX, h2.stemY + (h2.up ? f * gap * 0.66 : -f * gap * 0.66));
          ctx.quadraticCurveTo(h2.stemX + r * 2.1, h2.stemY + (h2.up ? gap * 0.5 : -gap * 0.5) + (h2.up ? f * gap * 0.66 : -f * gap * 0.66),
            h2.stemX + r * 1.5, h2.stemY + (h2.up ? gap * 0.9 : -gap * 0.9) + (h2.up ? f * gap * 0.66 : -f * gap * 0.66));
          ctx.stroke();
        }
      }
      for (var dq2 = 0; dq2 < (n2.dots || 0); dq2++) {
        ctx.beginPath(); ctx.arc(h2.x + r * 2.2 + dq2 * r * 1.1, h2.y, Math.max(1, r * 0.28), 0, Math.PI * 2); ctx.fill();
      }
      var at = (n2.acc || '').toLowerCase(), accSym = '';
      if (at === 'sharp') accSym = 'sharp';
      else if (at === 'flat') accSym = 'flat';
      else if (at === 'natural') accSym = 'natural';
      else if (at === 'double-sharp' || at === 'sharp-sharp') accSym = 'double';
      else if (at === 'flat-flat' || at === 'double-flat') accSym = 'doubleflat';
      if (accSym) {
        ctx.globalAlpha = 0.98;
        ctx.font = 'bold ' + (gap * 2.15) + 'px serif';
        ctx.shadowColor = headColor; ctx.shadowBlur = 2;
        var ax = h2.x - r * 4.6;
        var yy = h2.y + gap * 0.7;
        if (accSym === 'double') { ctx.fillText('\u266F', ax - gap * 0.5, yy); ctx.fillText('\u266F', ax + gap * 0.2, yy); }
        else if (accSym === 'doubleflat') { ctx.fillText('\u266D', ax - gap * 0.5, yy); ctx.fillText('\u266D', ax + gap * 0.2, yy); }
        else if (accSym === 'sharp') ctx.fillText('\u266F', ax, yy);
        else if (accSym === 'flat') ctx.fillText('\u266D', ax, yy);
        else ctx.fillText('\u266E', ax, yy);
        ctx.shadowBlur = 0;
      }
      if (n2.tuplet && n2._tupFirst && !(n2.beams && n2.beams.length)) {
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = headColor;
        ctx.font = '700 ' + (9.5 * size).toFixed(1) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(n2.tuplet), h2.x + (h2.up ? -gap * 0.9 : gap * 0.9), h2.y + (h2.up ? -gap * 1.0 : gap * 2.4));
        ctx.restore();
      }
      if (n2.arts && (n2.arts.arpeggio ? h2._artDraw : true)) drawArts(ctx, h2.x, h2.y, h2.up, gap, size, n2.arts, headColor, h2._chordY0, h2._chordY1);

      // 上加/下加线
      var stTop = n2.staff === 2 ? top2 : top1, stBot = stTop + staffH;
      ctx.save(); ctx.strokeStyle = headColor; ctx.lineWidth = Math.max(1, size * 0.9); ctx.globalAlpha = 0.9;
      if (h2.y < stTop - gap * 0.35) {
        for (var ly = stTop - gap; ly >= h2.y - 0.2; ly -= gap) {
          ctx.beginPath(); ctx.moveTo(h2.x - gap * 0.62, ly); ctx.lineTo(h2.x + gap * 0.62, ly); ctx.stroke();
        }
      } else if (h2.y > stBot + gap * 0.35) {
        for (var ly2 = stBot + gap; ly2 <= h2.y + 0.2; ly2 += gap) {
          ctx.beginPath(); ctx.moveTo(h2.x - gap * 0.62, ly2); ctx.lineTo(h2.x + gap * 0.62, ly2); ctx.stroke();
        }
      }
      ctx.restore();
      n2._px = h2.x; n2._py = h2.y;
    }

    // 连桁
    for (var gidx = 0; gidx < groups.length; gidx++) {
      var g = groups[gidx];
      if (g.notes.length < 2) continue;
      var up2 = g.notes[0].up;
      var gx0 = g.notes[0].stemX, gy0 = g.y0, gx1 = g.notes[g.notes.length - 1].stemX, gy1 = g.y1;
      function beamY(x) { return gy0 + (x - gx0) * (gy1 - gy0) / Math.max(1, gx1 - gx0); }
      ctx.strokeStyle = g.notes[0].n.start <= t ? PLAYED : color;
      ctx.globalAlpha = 0.95; ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(2, 3.4 * size);
      ctx.beginPath();
      ctx.moveTo(gx0, gy0);
      ctx.lineTo(gx1, gy1);
      ctx.stroke();
      for (var tg = 0; tg < g.notes.length; tg++) {
        var tn2 = g.notes[tg];
        if (!tn2.n.tuplet || !tn2.n._tupFirst) continue;
        var tby = beamY(tn2.stemX) + (up2 ? -gap * 1.05 : gap * 1.6);
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = g.notes[0].n.start <= t ? PLAYED : color;
        ctx.font = '700 ' + (9.5 * size).toFixed(1) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(tn2.n.tuplet), tn2.stemX, tby);
        ctx.restore();
      }
      for (var lv = 2; lv <= 4; lv++) {
        ctx.lineWidth = Math.max(1.8, 3.1 * size);
        for (var pi = 0; pi < g.notes.length - 1; pi++) {
          var ga = g.notes[pi], gbv = g.notes[pi + 1];
          if (ga.flags < lv || gbv.flags < lv) continue;
          var oyA = beamY(ga.stemX) + (up2 ? 1 : -1) * (gap * 0.55 * (lv - 1));
          var oyB = beamY(gbv.stemX) + (up2 ? 1 : -1) * (gap * 0.55 * (lv - 1));
          ctx.beginPath(); ctx.moveTo(ga.stemX, oyA); ctx.lineTo(gbv.stemX, oyB); ctx.stroke();
        }
      }
    }

    // 8va / 8vb
    for (var o = 0; o < score.ottavas.length; o++) {
      var ot = score.ottavas[o];
      if (!inWin(ot.start)) continue;
      var ox1 = xOf(ot.start), ox2 = xOf(ot.end);
      var oTop = (ot.staff === 2 ? top2 : top1);
      var oAbove = ot.dir === 'up';
      if (ot.y === 0 || ot.y) oAbove = ot.y >= 0;
      var oy = oAbove ? oTop - gap * 1.6 : oTop + staffH + gap * 1.6;
      ctx.globalAlpha = 0.65; ctx.lineWidth = 1.1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(ox1, oy); ctx.lineTo(ox2, oy);
      ctx.lineTo(ox1, oy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = 'italic ' + (gap * 1.4) + 'px system-ui, sans-serif';
      ctx.fillStyle = color; ctx.globalAlpha = 0.85;
      ctx.fillText(oAbove ? '8va' : '8vb', ox1 + 2, oAbove ? oy - 3 : oy + gap * 1.5);
    }

    // 延音线 / 圆滑线
    for (var ti = 0; ti < score.notes.length; ti++) {
      var a = score.notes[ti];
      if (!a.tieTo || !inWin(a.start) || !inWin(a.tieTo.start)) continue;
      var bb = a.tieTo;
      if (!bb._px) continue;
      var active = t >= a.start - 0.02;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = active ? PLAYED : color;
      ctx.globalAlpha = active ? 0.95 : 0.7;
      ctx.lineWidth = Math.max(1.2, 1.5 * size);
      var mx = (a._px + bb._px) / 2, my = Math.min(a._py, bb._py) - gap * 1.6;
      ctx.beginPath();
      ctx.moveTo(a._px, a._py - 3);
      ctx.quadraticCurveTo(mx, my, bb._px, bb._py - 3);
      ctx.stroke();
      if (active && opts.glow) { ctx.shadowColor = PLAYED; ctx.shadowBlur = (opts.glowBlur || 10) * 0.7; ctx.stroke(); ctx.shadowBlur = 0; }
    }
    for (var si2 = 0; si2 < score.notes.length; si2++) {
      var sa = score.notes[si2];
      if (!sa.slurTo || !inWin(sa.start) || !inWin(sa.slurTo.start)) continue;
      var sb = sa.slurTo;
      if (!sb._px) continue;
      var smx = (sa._px + sb._px) / 2, smy = Math.max(sa._py, sb._py) + gap * 1.8;
      ctx.globalAlpha = 0.55; ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, 1.2 * size);
      ctx.beginPath();
      ctx.moveTo(sa._px, sa._py + 3);
      ctx.quadraticCurveTo(smx, smy, sb._px, sb._py + 3);
      ctx.stroke();
    }

    // 刮奏 / 滑音
    for (var gk = 0; gk < score.notes.length; gk++) {
      var ga2 = score.notes[gk];
      if (!ga2.glissTo || !inWin(ga2.start) || !inWin(ga2.glissTo.start)) continue;
      if (!ga2._px || !ga2.glissTo._px) continue;
      var gb2 = ga2.glissTo;
      var gAct = t >= ga2.start - 0.02;
      ctx.strokeStyle = gAct ? PLAYED : color;
      ctx.globalAlpha = gAct ? 0.95 : 0.7;
      ctx.shadowBlur = gAct && opts.glow ? (opts.glowBlur || 10) * 0.7 : 0;
      ctx.lineWidth = Math.max(1, 1.4 * size);
      ctx.beginPath();
      var gx0 = ga2._px + 3, gy0 = ga2._py + (gb2._py > ga2._py ? 4 : -4);
      var gx1 = gb2._px - 3, gy1 = gb2._py + (gb2._py > ga2._py ? -4 : 4);
      var gn2 = 12;
      var gdx = gx1 - gx0, gdy = gy1 - gy0, glen = Math.max(1, Math.sqrt(gdx * gdx + gdy * gdy));
      var gnx = -gdy / glen, gny = gdx / glen;
      ctx.moveTo(gx0, gy0);
      for (var gs2 = 1; gs2 <= gn2; gs2++) {
        var gpf = gs2 / gn2, gw2 = gs2 % 2 ? 2.4 : -2.4;
        ctx.lineTo(gx0 + gdx * gpf + gnx * gw2, gy0 + gdy * gpf + gny * gw2);
      }
      ctx.stroke();
      ctx.save();
      ctx.globalAlpha = gAct ? 0.95 : 0.65;
      ctx.fillStyle = gAct ? PLAYED : color;
      ctx.font = 'italic ' + Math.max(9, gap * 1.15).toFixed(1) + 'px serif';
      ctx.fillText('glass.', (gx0 + gx1) / 2 + 4, (gy0 + gy1) / 2 - 6);
      ctx.restore();
      ctx.shadowBlur = 0;
    }

    // 播放竖杆（加粗 + 发光 + 顶部箭头）
    ctx.shadowBlur = 0;
    var px = xOf(t);
    var pg = ctx.createLinearGradient(px - 2, 0, px + 2, 0);
    pg.addColorStop(0, 'rgba(120,220,255,0)');
    pg.addColorStop(0.5, 'rgba(150,230,255,0.9)');
    pg.addColorStop(1, 'rgba(120,220,255,0)');
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = pg;
    ctx.fillRect(px - 2.5, top1 - 8, 5, (top2 + staffH) - top1 + 16);
    ctx.strokeStyle = '#9fe8ff';
    ctx.lineWidth = 2.6;
    ctx.shadowColor = '#7fd8ff'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(px, top1 - 6); ctx.lineTo(px, top2 + staffH + 6); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#bfefff';
    ctx.beginPath();
    ctx.moveTo(px, top1 - 12); ctx.lineTo(px - 5, top1 - 4); ctx.lineTo(px + 5, top1 - 4);
    ctx.closePath(); ctx.fill();

    ctx.restore();
    return { top1: top1, top2: top2, gap: gap, xOf: xOf };
  }

  function drawSegno(ctx, x, y, s, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, s * 0.15);
    ctx.beginPath();
    ctx.moveTo(x - s * 0.5, y + s * 0.5);
    ctx.quadraticCurveTo(x + s * 0.5, y + s * 0.8, x + s * 0.15, y);
    ctx.quadraticCurveTo(x - s * 0.2, y - s * 0.9, x + s * 0.4, y - s * 0.5);
    ctx.stroke();
    ctx.restore();
  }
  function drawCoda(ctx, x, y, s, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, s * 0.15);
    ctx.beginPath(); ctx.arc(x, y, s * 0.55, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - s * 0.85, y); ctx.lineTo(x + s * 0.85, y);
    ctx.moveTo(x, y - s * 0.85); ctx.lineTo(x, y + s * 0.85);
    ctx.stroke();
    ctx.restore();
  }

  global.MusicXML = { parseXML: parseXML, unzipMXL: unzipMXL, drawScore: drawScore };
})(window);
