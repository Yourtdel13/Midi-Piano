/*
 * 轻量 MIDI 解析器（无依赖）
 * - 支持 format 0/1，多轨合并
 * - 支持 tempo 变化（µs/quarter）、running status、note on/off
 * - 跳过通道 10（打击乐）与 88 键范围外的音符
 * - 返回每个音符的绝对秒数：{ midi, start, end, dur, velocity, track }
 */
(function (root) {
  'use strict';

  function decodeText(arr) {
    try {
      if (typeof TextDecoder !== 'undefined') {
        return new TextDecoder('utf-8').decode(new Uint8Array(arr));
      }
    } catch (e) { /* 退化为 latin-1 */ }
    var out = '';
    for (var i = 0; i < arr.length; i++) out += String.fromCharCode(arr[i]);
    return out;
  }

  function parseMidi(buffer) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var pos = 0;

    function u8() {
      if (pos >= bytes.length) throw new Error('MIDI 文件不完整');
      return dv.getUint8(pos++);
    }
    function u16() { var v = dv.getUint16(pos); pos += 2; return v; }
    function u32() { var v = dv.getUint32(pos); pos += 4; return v; }
    function str(n) {
      var s = '';
      for (var i = 0; i < n; i++) s += String.fromCharCode(u8());
      return s;
    }
    function vlq() {
      var v = 0, b, n = 0;
      do {
        b = u8();
        v = (v << 7) | (b & 0x7f);
        if (++n > 4) throw new Error('MIDI 变长整数异常');
      } while (b & 0x80);
      return v;
    }

    if (str(4) !== 'MThd') throw new Error('不是 MIDI 文件（缺少 MThd 头）');
    var headerLen = u32();
    u16();                 // format
    u16();                 // 声明的轨道数（可能不准）
    var division = u16();
    pos = 8 + headerLen;   // 跳过扩展头

    var smpte = !!(division & 0x8000);
    var ticksPerQuarter = 480;
    var ticksPerSecond = 0;
    if (smpte) {
      var fps = 256 - (division >> 8);
      var ticksPerFrame = division & 0xff;
      ticksPerSecond = fps * ticksPerFrame;
    } else if (division > 0) {
      ticksPerQuarter = division;
    }

    var rawNotes = [];
    var tempos = [];
    var timeSigs = [];
    var pedalEvents = [];
    var chVol = {}, chExp = {};
    var keySig = null, keyEvents = [];
    var trackName = '';
    var parsedTracks = 0;

    while (pos + 8 <= bytes.length) {
      var id = str(4);
      var len = u32();
      if (id !== 'MTrk') { pos += len; continue; }
      var end = pos + len;
      if (end > bytes.length) end = bytes.length;
      var trackIndex = parsedTracks++;

      var tick = 0;
      var running = 0;
      var open = {};

      while (pos < end) {
        tick += vlq();
        var status = dv.getUint8(pos);
        if (status & 0x80) {
          pos++;
          if (status < 0xF0) running = status;
        } else {
          if (!running) throw new Error('MIDI 运行状态缺失');
          status = running;
        }

        var hi = status & 0xF0;
        var ch = status & 0x0F;

        if (status === 0xFF) {
          var type = u8();
          var mlen = vlq();
          if (type === 0x51 && mlen === 3) {
            var us = (dv.getUint8(pos) << 16) | (dv.getUint8(pos + 1) << 8) | dv.getUint8(pos + 2);
            tempos.push({ tick: tick, us: us });
          } else if (type === 0x59 && mlen === 2) {
            keySig = { sf: dv.getInt8(pos), mi: dv.getUint8(pos + 1) };
            keyEvents.push({ tick: tick, sf: keySig.sf, mi: keySig.mi, tr: trackIndex });
          } else if (type === 0x58 && mlen >= 2) {
            timeSigs.push({
              tick: tick,
              num: dv.getUint8(pos),
              den: 1 << dv.getUint8(pos + 1)
            });
          } else if (type === 0x03 && !trackName && mlen > 0 && mlen < 120) {
            var nameBytes = [];
            for (var i = 0; i < mlen; i++) nameBytes.push(dv.getUint8(pos + i));
            trackName = decodeText(nameBytes).trim();
          } else if (type === 0x2F) {
            pos += mlen;
            break;
          }
          pos += mlen;
        } else if (status === 0xF0 || status === 0xF7) {
          pos += vlq();
        } else if (status >= 0xF1 && status <= 0xF6) {
          pos += (status === 0xF2 ? 2 : 1);
        } else if (hi === 0x90) {
          var noteOn = u8(), velOn = u8(), keyOn = noteOn * 16 + ch;
          if (velOn > 0) {
            if (ch !== 9 && noteOn >= 21 && noteOn <= 108) {
              var prev = open[keyOn];
              if (prev) prev.endTick = tick;
              var n = {
                midi: noteOn,
                velocity: velOn / 127,
                channel: ch,
                startTick: tick,
                endTick: -1,
                vol: (chVol[ch] == null ? 1 : chVol[ch]) * (chExp[ch] == null ? 1 : chExp[ch]),
                track: trackIndex
              };
              open[keyOn] = n;
              rawNotes.push(n);
            }
          } else {
            var off = open[keyOn];
            if (off) { off.endTick = tick; delete open[keyOn]; }
          }
        } else if (hi === 0x80) {
          var noteOff = u8();
          u8();
          var keyOff = noteOff * 16 + ch;
          var off2 = open[keyOff];
          if (off2) { off2.endTick = tick; delete open[keyOff]; }
        } else if (hi === 0xC0 || hi === 0xD0) {
          pos += 1;
        } else if (hi === 0xB0) {
          var ccNum = u8(), ccVal = u8();
          if (ccNum === 64) pedalEvents.push({ tick: tick, ch: ch, down: ccVal >= 64 });
          else if (ccNum === 7) chVol[ch] = ccVal / 127;
          else if (ccNum === 11) chExp[ch] = ccVal / 127;
        } else if (hi === 0xA0 || hi === 0xE0) {
          pos += 2;
        } else {
          pos += 1; // 未知状态，避免死循环
        }
      }

      pos = end;
      for (var k in open) {
        if (open[k].endTick < tick) open[k].endTick = tick;
      }
    }

    if (!rawNotes.length) throw new Error('这个 MIDI 里没有可播放的音符');

    // 构建 tempo 分段表（默认 120 BPM）
    tempos.sort(function (a, b) { return a.tick - b.tick; });
    var segs = [{ tick: 0, sec: 0, us: 500000 }];
    for (var t = 0; t < tempos.length; t++) {
      var ev = tempos[t];
      var last = segs[segs.length - 1];
      if (ev.tick < last.tick) continue;
      segs.push({
        tick: ev.tick,
        sec: last.sec + (ev.tick - last.tick) * last.us / 1e6 / ticksPerQuarter,
        us: ev.us
      });
    }

    function tickToSec(tk) {
      if (smpte && ticksPerSecond > 0) return tk / ticksPerSecond;
      var lo = 0, hi2 = segs.length - 1;
      while (lo < hi2) {
        var mid = (lo + hi2 + 1) >> 1;
        if (segs[mid].tick <= tk) lo = mid;
        else hi2 = mid - 1;
      }
      var s = segs[lo];
      return s.sec + (tk - s.tick) * s.us / 1e6 / ticksPerQuarter;
    }

    var notes = [];
    var duration = 0;
    for (var j = 0; j < rawNotes.length; j++) {
      var rn = rawNotes[j];
      if (rn.endTick < rn.startTick) rn.endTick = rn.startTick + ticksPerQuarter / 8;
      var start = tickToSec(rn.startTick);
      var endSec = tickToSec(rn.endTick);
      if (endSec < start + 0.05) endSec = start + 0.05;
      notes.push({
        midi: rn.midi,
        start: start,
        end: endSec,
        soundEnd: endSec,
        dur: endSec - start,
        velocity: rn.velocity,
        channel: rn.channel,
        track: rn.track
      });
      if (endSec > duration) duration = endSec;
    }

    notes.sort(function (a, b) { return a.start - b.start || a.midi - b.midi; });

    // ---- 延音踏板（CC64）：踏板踩下期间松开的键延音到踏板抬起 ----
    var pedalByCh = {};
    pedalEvents.sort(function (a, b) { return a.tick - b.tick; });
    var pedalIntervals = {};
    for (var pe = 0; pe < pedalEvents.length; pe++) {
      var ev2 = pedalEvents[pe];
      var chHold = pedalByCh[ev2.ch];
      if (ev2.down) {
        if (!chHold) pedalByCh[ev2.ch] = { start: tickToSec(ev2.tick) };
      } else if (chHold) {
        (pedalIntervals[ev2.ch] = pedalIntervals[ev2.ch] || []).push({
          start: chHold.start,
          end: tickToSec(ev2.tick)
        });
        delete pedalByCh[ev2.ch];
      }
    }
    for (var chLeft in pedalByCh) {
      (pedalIntervals[chLeft] = pedalIntervals[chLeft] || []).push({
        start: pedalByCh[chLeft].start,
        end: duration + 0.35
      });
    }

    var allPedals = [];
    for (var pch in pedalIntervals) allPedals = allPedals.concat(pedalIntervals[pch]);
    allPedals.sort(function (a, b) { return a.start - b.start; });
    var mergedPedals = [];
    for (var mp = 0; mp < allPedals.length; mp++) {
      var curP = allPedals[mp];
      var lastP = mergedPedals[mergedPedals.length - 1];
      if (lastP && curP.start <= lastP.end + 0.02) {
        lastP.end = Math.max(lastP.end, curP.end);
      } else {
        mergedPedals.push({ start: curP.start, end: curP.end });
      }
    }

    for (var pn = 0; pn < notes.length; pn++) {
      var nn = notes[pn];
      var ints = mergedPedals;
      for (var ii = 0; ii < ints.length; ii++) {
        var iv = ints[ii];
        if (iv.start <= nn.end + 0.12 && nn.end <= iv.end + 1e-4) {
          // 视觉上仍按琴键松开画，声音延音到踏板抬起
          if (iv.end > nn.soundEnd + 1e-4) {
            nn.soundEnd = iv.end;
            if (iv.end > duration) duration = iv.end;
          }
          break;
        }
      }
    }

    // ---- 调式：优先调号 meta，没有就按音高分布推测 ----
    function keyFromSignature(sf, mi) {
      var major = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F',
        '0': 'C', '1': 'G', '2': 'D', '3': 'A', '4': 'E', '5': 'B', '6': 'F#', '7': 'C#' };
      var minor = { '-7': 'Ab', '-6': 'Eb', '-5': 'Bb', '-4': 'F', '-3': 'C', '-2': 'G', '-1': 'D',
        '0': 'A', '1': 'E', '2': 'B', '3': 'F#', '4': 'C#', '5': 'G#', '6': 'D#', '7': 'A#' };
      var tonic = (mi ? minor : major)[String(sf)] || 'C';
      return {
        tonic: tonic,
        mode: mi ? 'minor' : 'major',
        label: tonic + (mi ? ' 小调' : ' 大调'),
        source: 'meta'
      };
    }

    function estimateKey(ns) {
      var hist = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (var hi3 = 0; hi3 < ns.length; hi3++) {
        hist[ns[hi3].midi % 12] += Math.max(0.05, ns[hi3].end - ns[hi3].start);
      }
      var names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      var majorP = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
      var minorP = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
      function corr(profile, rot) {
        var n2 = 12, sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
        for (var d3 = 0; d3 < n2; d3++) {
          var x = profile[d3], y = hist[(d3 + rot) % 12];
          sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y;
        }
        var den = Math.sqrt((n2 * sxx - sx * sx) * (n2 * syy - sy * sy));
        return den ? (n2 * sxy - sx * sy) / den : 0;
      }
      var best = { score: -2, rot: 0, minor: false };
      for (var r2 = 0; r2 < 12; r2++) {
        var cm = corr(majorP, r2);
        var cn = corr(minorP, r2);
        if (cm > best.score) best = { score: cm, rot: r2, minor: false };
        if (cn > best.score) best = { score: cn, rot: r2, minor: true };
      }
      return {
        tonic: names[best.rot],
        mode: best.minor ? 'minor' : 'major',
        label: names[best.rot] + (best.minor ? ' 小调' : ' 大调'),
        source: 'estimated',
        confidence: Math.max(0, Math.min(1, best.score))
      };
    }

    var keys = [];
    (function () {
      var seen = {};
      var refTrack = null;
      for (var kr = 0; kr < keyEvents.length; kr++) {
        if (keyEvents[kr].tick === 0 && (refTrack === null || keyEvents[kr].tr < refTrack)) refTrack = keyEvents[kr].tr;
      }
      for (var ke = 0; ke < keyEvents.length; ke++) {
        var ev3 = keyEvents[ke];
        if (refTrack !== null && ev3.tr !== refTrack) continue;
        var tm = tickToSec(ev3.tick);
        var kk = tm.toFixed(3) + '|' + ev3.sf + '|' + ev3.mi;
        if (seen[kk]) continue;
        seen[kk] = 1;
        keys.push({ time: tm, fifths: ev3.sf, mode: ev3.mi === 1 ? 'minor' : 'major' });
      }
      keys.sort(function (a, b) { return a.time - b.time; });
    })();
    var key = keySig ? keyFromSignature(keySig.sf, keySig.mi) : estimateKey(notes);

    // ---- 小节线：按拍号 meta 计算每小节起始秒数 ----
    var bars = [];
    var sigs = timeSigs.length ? timeSigs.slice() : [{ tick: 0, num: 4, den: 4 }];
    sigs.sort(function (a, b) { return a.tick - b.tick; });
    if (sigs[0].tick > 0) sigs.unshift({ tick: 0, num: sigs[0].num, den: sigs[0].den });
    var maxSec = duration + 0.6;
    for (var si = 0; si < sigs.length && bars.length < 4000; si++) {
      var sg = sigs[si];
      var nextTick = si + 1 < sigs.length ? sigs[si + 1].tick : Infinity;
      var measureTicks = sg.num * (4 * ticksPerQuarter / sg.den);
      if (!(measureTicks > 0)) continue;
      var tk = sg.tick;
      while (tk < nextTick && bars.length < 4000) {
        var barSec = tickToSec(tk);
        if (barSec > maxSec) break;
        bars.push(barSec);
        tk += measureTicks;
      }
    }

    var trackSet = {};
    for (var q = 0; q < notes.length; q++) trackSet[notes[q].track] = true;

    return {
      notes: notes,
      duration: duration,
      name: trackName,
      trackCount: Object.keys(trackSet).length,
      ticksPerQuarter: ticksPerQuarter,
      pedals: mergedPedals,
      keys: keys,
      key: key,
      bars: bars
    };
  }

  var api = { parseMidi: parseMidi };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MidiParser = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
