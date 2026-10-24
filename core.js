(function () {
  'use strict';
  var V = '8.5.5';

  // Log Ringkas Satu Baris untuk Core Feature
  function log(msg) {
    console.log('[FanKunHUB Core] ' + msg);
  }

  /* ---------- 1. Safe Preboot (Injeksi Game) ---------- */
  (function preboot() {
    try {
      if (!/\/jogo|game\.html/.test(location.pathname)) return;
      if (window.G || window.HUDO || window.GAME_READY) return;
      if (window.__pbBoot) return;
      window.__pbBoot = 1;
      
      if (document.readyState === 'complete') return;

      function xget(u, accept) {
        var x = new XMLHttpRequest();
        x.open('GET', u, false);
        try { x.setRequestHeader('Accept', accept); } catch (e) {}
        x.send(null);
        if (x.status !== 200 || !x.responseText) throw new Error('xhr ' + x.status);
        return x.responseText;
      }

      var html = xget(location.href, 'text/html,*/*');
      if (html.indexOf('/static/game/bundle.js') < 0) return;
      var bm = /src="([^"]*\/static\/game\/bundle\.js[^"]*)"/.exec(html);
      if (!bm) return;
      var bsrc = xget(new URL(bm[1], location.href).href, '*/*');
      var gate = /const Ui="localhost"===location\.hostname\|\|"127\.0\.0\.1"===location\.hostname\|\|"\[::1\]"===location\.hostname,/;
      if (!gate.test(bsrc)) return;
      bsrc = bsrc.replace(gate, 'const Ui=!0,');

      var parsed = new DOMParser().parseFromString(html, 'text/html');
      var scripts = [].slice.call(parsed.querySelectorAll('script')).map(function (s) {
        return { src: s.getAttribute('src'), text: s.textContent, type: s.getAttribute('type') || '' };
      });
      if (!scripts.length) return;
      [].slice.call(parsed.querySelectorAll('script')).forEach(function (s) { if (s.parentNode) s.parentNode.removeChild(s); });
      var dt = parsed.doctype ? '<!doctype ' + parsed.doctype.name + '>' : '<!doctype html>';
      var clean = dt + parsed.documentElement.outerHTML;

      var burl = '';
      try { burl = URL.createObjectURL(new Blob([bsrc], { type: 'text/javascript' })); } catch (e1) {}

      try {
        if (document.referrer.indexOf('android-app://') === 0 ||
            matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches)
          document.cookie = 'pbapp=1; max-age=31536000; path=/; secure; samesite=lax';
      } catch (e4) {}

      try {
        document.open();
        document.write(clean);
        document.close();
      } catch (e2) {
        location.reload();
        return;
      }

      var i = 0;
      function next() {
        while (i < scripts.length) {
          var s = scripts[i++];
          try {
            var t = (s.type || '').toLowerCase();
            if (t && t.indexOf('javascript') < 0 && t.indexOf('ecmascript') < 0) continue;
            var el = document.createElement('script');
            var head = document.head || document.documentElement;
            if (s.src) {
              var abs;
              try { abs = new URL(s.src, location.href).href; } catch (eU) { abs = s.src; }
              if (/\/static\/game\/bundle\.js(\?|$)/.test(abs)) abs = burl || '';
              if (abs) {
                el.src = abs;
                el.async = false;
                var done = false;
                var fin = function () { if (done) return; done = true; clearTimeout(to); next(); };
                var to = setTimeout(fin, 20000);
                el.onload = el.onerror = fin;
                head.appendChild(el);
                return;
              }
              el.textContent = bsrc;
              head.appendChild(el);
              continue;
            }
            el.textContent = s.text;
            head.appendChild(el);
          } catch (eL) {}
        }
      }
      next();
    } catch (e) {}
  })();

  /* ---------- 2. Config & Core Variables ---------- */
  var P = { cone: 0.45, reach: 150, autoFire: 0, gain: 0.9, headR: 0.11, mode: 'near', bias: 0.35 };
  var O = { sens: 0.5, fov: 70, invert: false };
  var G = null, aimOn = true, fireHeld = 0, holding = false;
  var lastPick = null, st = { v: V, aim: true, G: false, bots: 0, enemies: 0, lock: 0, err: 0, fire: 0, dist: 0 };

  function game() {
    try {
      var g = window.G;
      if (g && g.P && g.P.s && g.camera && g.bots) return g;
    } catch (e) {}
    return null;
  }

  /* ---------- 3. Math & Head Tracking ---------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function wpos(b, out) { var e = b.matrixWorld.elements; out.x = e[12]; out.y = e[13]; out.z = e[14]; return out; }
  var A = { x: 0, y: 0, z: 0 }, B = { x: 0, y: 0, z: 0 };

  function headPoint(p) {
    var by = p.c && p.c.byName; if (!by) return null;
    var h = by.Head || by.head || null, g = by.Bone_HeadGearAttach || null;
    if (!h && !g) return null;
    if (h && g) {
      wpos(h, A); wpos(g, B);
      A.x = (A.x + B.x) * .5; A.y = (A.y + B.y) * .5; A.z = (A.z + B.z) * .5;
    } else wpos(h || g, A);
    return A;
  }

  /* ---------- 4. Input & Touch Handling ---------- */
  function move(dx, dy) {
    var ev;
    try { ev = new MouseEvent('mousemove', { bubbles: true, cancelable: true, movementX: dx, movementY: dy }); }
    catch (e) { ev = new MouseEvent('mousemove', { bubbles: true, cancelable: true }); }
    if (ev.movementX !== dx) { try { Object.defineProperty(ev, 'movementX', { value: dx }); } catch (e) {} }
    if (ev.movementY !== dy) { try { Object.defineProperty(ev, 'movementY', { value: dy }); } catch (e) {} }
    (document.body || document.documentElement).dispatchEvent(ev);
  }
  function up() { try { (document.body || document.documentElement).dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })); } catch (e) {} holding = false; }

  var fireIds = new Set();
  function inZone(t) { return t.clientX > innerWidth * 0.50 && t.clientY > innerHeight * 0.45; }
  function syncFire() { fireHeld = fireIds.size; st.fire = fireHeld; }
  addEventListener('touchstart', function (e) {
    for (var i = 0; i < e.changedTouches.length; i++) { var t = e.changedTouches[i]; if (inZone(t)) fireIds.add(t.identifier); }
    syncFire();
  }, true);
  addEventListener('touchmove', function (e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (inZone(t)) fireIds.add(t.identifier); else fireIds.delete(t.identifier);
    }
    syncFire();
  }, true);
  function touchEnd(e) {
    for (var i = 0; i < e.changedTouches.length; i++) fireIds.delete(e.changedTouches[i].identifier);
    syncFire();
  }
  addEventListener('touchend', touchEnd, true);
  addEventListener('touchcancel', touchEnd, true);

  /* ---------- 5. Main Tick Loop (Aim Assist) ---------- */
  var F = { x: 0, y: 0, z: 0 }, C = { x: 0, y: 0, z: 0 };
  function tick() {
    requestAnimationFrame(tick);
    if (!G) { G = game(); if (!G) return; st.G = true; }
    var g = G, self = g.P.s, cam = g.camera;
    if (!self || self.dead) { if (holding) up(); lastPick = null; st.lock = 0; return; }

    var now = performance.now(), m = cam.matrixWorld.elements;
    C.x = m[12]; C.y = m[13]; C.z = m[14];
    var yaw = +self.yaw || 0, pitch = +self.pitch || 0;
    var cp = Math.cos(pitch);
    F.x = -Math.sin(yaw) * cp; F.y = Math.sin(pitch); F.z = -Math.cos(yaw) * cp;

    var best = null, bestP = null, bestA = 1e9, bestD = 1e9, myTeam = self.team, list = g.bots, n = 0, en = 0;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || !p.obj || !p.c) continue;
      n++;
      if (p.team === myTeam) continue;
      if (p.dead || !(p.hp > 0)) continue;
      if (p.obj.visible === false) continue;
      if (p === self) continue;
      var hp = headPoint(p); if (!hp) continue;
      var dx = hp.x - C.x, dy = hp.y - C.y, dz = hp.z - C.z;
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 2 || d > P.reach) continue;
      en++;
      var ey = wrap(Math.atan2(-dx, -dz) - yaw);
      var ep = Math.asin(clamp(dy / d, -1, 1)) - pitch;
      var a = Math.sqrt(ey * ey + ep * ep);
      if (a > P.cone) continue;
      var better = (P.mode === 'angle') ? (a < bestA) : (d < bestD - P.bias || (d <= bestD + P.bias && a < bestA));
      if (better) { bestA = a; bestD = d; best = p; bestP = { x: hp.x, y: hp.y, z: hp.z }; }
    }
    st.bots = n; st.enemies = en;
    if (!best || !aimOn) { lastPick = null; st.lock = 0; if (holding) up(); return; }

    var t = O.sens * (cam.fov / O.fov) * 0.005;
    if (!(t > 0)) return;
    var ey2 = wrap(Math.atan2(-(bestP.x - C.x), -(bestP.z - C.z)) - yaw);
    var d2 = Math.hypot(bestP.x - C.x, bestP.y - C.y, bestP.z - C.z);
    var ep2 = Math.asin(clamp((bestP.y - C.y) / d2, -1, 1)) - pitch;
    var px = clamp(-ey2 / t * P.gain, -220, 220);
    var py = clamp((O.invert ? 1 : -1) * ep2 / t * P.gain, -220, 220);
    if (Math.abs(px) + Math.abs(py) > 0.5) move(px, py);
    st.lock = 1; lastPick = best;
  }

  /* ---------- 6. ESP DOM (Musuh Saja) ---------- */
  var E = { on: 1, wrap: null, host: null, hostAt: 0, slots: [], last: 0 };
  function eInit() {
    if (E.wrap && E.wrap.parentNode) return true;
    var host = document.body || document.documentElement;
    if (!host) return false;
    var w = document.createElement('div');
    w.setAttribute('data-pb', '1');
    w.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:2147483000';
    host.appendChild(w);
    E.wrap = w; E.slots = [];
    return true;
  }
  function eSlot(i) {
    var s = E.slots[i];
    if (s) return s;
    var box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:0;top:0;box-sizing:border-box;border:1px solid rgba(0,255,120,.9);border-radius:1px;display:none;will-change:transform';
    var hb = document.createElement('div');
    hb.style.cssText = 'position:absolute;left:-1px;top:-5px;width:calc(100% + 2px);height:3px;background:rgba(0,0,0,.55)';
    var hf = document.createElement('div');
    hf.style.cssText = 'position:absolute;left:0;top:0;height:100%;width:100%;background:#37d76a';
    hb.appendChild(hf);
    var tx = document.createElement('div');
    tx.style.cssText = 'position:absolute;right:0;top:-15px;font:10px/12px Tahoma,sans-serif;color:#c9ffd8;text-shadow:0 1px 2px #000;white-space:nowrap';
    box.appendChild(hb); box.appendChild(tx);
    E.wrap.appendChild(box);
    s = { box: box, hp: hf, tx: tx };
    E.slots[i] = s;
    return s;
  }
  function eClear() {
    for (var i = 0; i < E.slots.length; i++) E.slots[i].box.style.display = 'none';
  }
  function eHost() {
    var now = performance.now();
    if (E.host && E.host.parentNode && now - E.hostAt < 400) return E.host;
    E.hostAt = now;
    var best = null, ba = 0, cs = document.getElementsByTagName('canvas');
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (c.getAttribute('data-pb')) continue;
      var r = c.getBoundingClientRect(), a = r.width * r.height;
      if (a > ba) { ba = a; best = c; }
    }
    E.host = best || null;
    return E.host;
  }
  function eProj(cam, r, x, y, z) {
    if (!E.v) { try { E.v = cam.position.clone(); } catch (e) { return null; } }
    var d = E.v.set(x, y, z).project(cam);
    if (!(d.z > -1 && d.z < 1)) return null;
    return { x: r.left + (d.x * 0.5 + 0.5) * r.width, y: r.top + (-d.y * 0.5 + 0.5) * r.height };
  }
  function eDraw(g) {
    var cam = g.camera, list = g.bots, self = g.P && g.P.s;
    if (!list || !cam || !self || self.dead) { eClear(); return; }
    var host = eHost();
    if (!host) { eClear(); return; }
    var r = host.getBoundingClientRect();
    if (!(r.width > 0)) { eClear(); return; }
    var me = cam.matrixWorld && cam.matrixWorld.elements;
    var cx = me ? me[12] : 0, cy = me ? me[13] : 0, cz = me ? me[14] : 0;
    var my = self.team, idx = 0;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || !p.obj || !p.c || p === self) continue;
      if (p.team === my) continue;
      if (p.dead || !(p.hp > 0)) continue;
      var hp = headPoint(p); if (!hp) continue;
      var mm = p.obj.matrixWorld && p.obj.matrixWorld.elements; if (!mm) continue;
      var a = eProj(cam, r, hp.x, hp.y, hp.z), b = eProj(cam, r, mm[12], mm[13], mm[14]);
      if (!a || !b) continue;
      var bh = b.y - a.y;
      if (!(bh > 6)) continue;
      var bw = bh * 0.42; if (bw > 400) bw = 400;
      var s = eSlot(idx++);
      s.box.style.display = 'block';
      s.box.style.transform = 'translate3d(' + (a.x - bw / 2).toFixed(1) + 'px,' + a.y.toFixed(1) + 'px,0)';
      s.box.style.width = bw.toFixed(1) + 'px';
      s.box.style.height = bh.toFixed(1) + 'px';
      var mxh = p.maxHp > 0 ? p.maxHp : 100;
      var f = Math.max(0, Math.min(1, (p.hp || 0) / mxh));
      s.hp.style.width = (f * 100).toFixed(0) + '%';
      var dx = hp.x - cx, dy = hp.y - cy, dz = hp.z - cz;
      s.tx.textContent = Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz)) + 'm';
    }
    for (; idx < E.slots.length; idx++) E.slots[idx].box.style.display = 'none';
  }
  function eFrame() {
    requestAnimationFrame(eFrame);
    var g = G || game();
    if (g) { try { wbPatch(); } catch (e) {} try { ammoTick(); } catch (e) {} }
    if (!E.on) return;
    var t = performance.now();
    if (t - E.last < 33) return;
    E.last = t;
    if (!eInit()) return;
    if (!g) { eClear(); return; }
    try { eDraw(g); } catch (err) { eClear(); }
  }

  /* ---------- 7. Fitur Cheat Inti (Wallbang, Ammo, No Recoil) ---------- */
  var WB = 200;
  function wbPatch() {
    var g = G || game(); var L = g && g.bots;
    if (!L || !L.length) return;
    for (var i = 0; i < L.length; i++) {
      var b = L[i];
      if (!b || b.__wb || typeof b.hitTest !== 'function') continue;
      b.__wb = 1;
      (function (b, f) {
        b.hitTest = function (o, d, m) {
          var r = (WB > 100 && typeof m === 'number') ? WB : m;
          try { return f.call(this, o, d, r); } catch (e) { return null; }
        };
      })(b, b.hitTest);
    }
  }

  function ammoTick() {
    var g = G || game(); if (!g || !g.P) return;
    var p = g.P;
    try { if (typeof p.ammo === 'number' && p.ammo !== 999) p.ammo = 999; } catch (e) {}
    try { if (typeof p.reserve === 'number' && p.reserve !== 999) p.reserve = 999; } catch (e) {}
  }

  function nrecTick() {
    requestAnimationFrame(nrecTick);
    try {
      var g = G || game(); if (!g || !g.P) return;
      var p = g.P, r = p.rec;
      if (r) { r.v = 0; r.A = 0; r.t = 0; r.T = 0; }
      if (p.kick) p.kick = 0;
    } catch (e) {}
  }

  /* ---------- 8. UI FanKunHUB PBWEB & Log Toggles ---------- */
  function uiBuild() {
    if (document.getElementById('fankun-ui')) return;

    var p = document.createElement('div');
    p.id = 'fankun-ui';
    p.setAttribute('data-pb', '1');
    p.style.cssText = 'position:fixed;right:20px;top:100px;width:170px;background:#121a16f5;border:1px solid #37d76a55;border-radius:8px;z-index:2147483600;padding:8px;color:#fff;font:11px Tahoma,sans-serif;box-shadow:0 4px 15px #0008;user-select:none;touch-action:none;';

    var header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #37d76a33;padding-bottom:4px;margin-bottom:6px;cursor:move;';
    
    var title = document.createElement('div');
    title.textContent = 'FanKunHUB PBWEB';
    title.style.cssText = 'font:bold 11px Tahoma,sans-serif;color:#37d76a;';
    
    var minBtn = document.createElement('div');
    minBtn.textContent = '-';
    minBtn.style.cssText = 'background:#2a3a32;color:#37d76a;width:18px;height:18px;border-radius:4px;text-align:center;font-weight:bold;cursor:pointer;line-height:16px;';
    
    header.appendChild(title);
    header.appendChild(minBtn);
    p.appendChild(header);

    var bodyContent = document.createElement('div');
    bodyContent.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

    function makeBtn(text, getOn, toggleFn) {
      var b = document.createElement('div');
      b.style.cssText = 'padding:6px;background:' + (getOn() ? '#37d76a33' : '#2a3a32') + ';border:1px solid #37d76a55;border-radius:4px;cursor:pointer;text-align:center;font-weight:bold;';
      b.textContent = text + ': ' + (getOn() ? 'ON' : 'OFF');
      b.onclick = function(e) {
        e.stopPropagation();
        var st = toggleFn();
        b.textContent = text + ': ' + (st ? 'ON' : 'OFF');
        b.style.background = st ? '#37d76a33' : '#2a3a32';
        log('Fitur ' + text + ' diubah ke ' + (st ? 'ON' : 'OFF'));
      };
      return b;
    }

    bodyContent.appendChild(makeBtn('Aim Assist', function(){return aimOn;}, function(){aimOn=!aimOn; return aimOn;}));
    bodyContent.appendChild(makeBtn('ESP Box', function(){return E.on;}, function(){E.on = E.on ? 0 : 1; if(!E.on) eClear(); return E.on;}));
    bodyContent.appendChild(makeBtn('Wallbang', function(){return WB > 100;}, function(){WB = WB > 100 ? 0 : 200; return WB > 100;}));
    var stat = document.createElement('div');
    stat.style.cssText = 'font-size:10px;color:#aaa;text-align:center;padding-top:2px;';
    bodyContent.appendChild(stat);
    setInterval(function () {
      stat.textContent = game() ? ('Game OK | musuh: ' + st.enemies) : 'Game belum terdeteksi';
      stat.style.color = game() ? '#37d76a' : '#ffb74d';
    }, 500);
    p.appendChild(bodyContent);

    var isMinim = false;
    minBtn.onclick = function(e) {
      e.stopPropagation();
      isMinim = !isMinim;
      bodyContent.style.display = isMinim ? 'none' : 'flex';
      minBtn.textContent = isMinim ? '+' : '-';
    };

    var isDragging = false, startX, startY, initialX, initialY;
    header.onpointerdown = function(e) {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialX = p.offsetLeft;
      initialY = p.offsetTop;
      header.setPointerCapture(e.pointerId);
    };
    header.onpointermove = function(e) {
      if (!isDragging) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      p.style.left = (initialX + dx) + 'px';
      p.style.top = (initialY + dy) + 'px';
      p.style.right = 'auto';
    };
    header.onpointerup = function(e) {
      isDragging = false;
      try { header.releasePointerCapture(e.pointerId); } catch(err){}
    };

    window.addEventListener('keydown', function(e) {
      if (e.key === 'Insert') {
        p.style.display = p.style.display === 'none' ? 'block' : 'none';
      }
    });

    (document.body || document.documentElement).appendChild(p);
    log('Fitur UI FanKunHUB Berhasil Muncul!');
  }

  log('Core initialized successfully.');
  try { requestAnimationFrame(eFrame); } catch (e) {}
  requestAnimationFrame(nrecTick);
  requestAnimationFrame(tick);

  function startUI() {
    try { uiBuild(); } catch (e) { console.error('[FanKunHUB] uiBuild', e); }
  }
  if (document.body) startUI();
  else document.addEventListener('DOMContentLoaded', startUI, { once: true });

  // pasang ulang UI kalau dihapus oleh halaman
  setInterval(function () {
    if (document.body && !document.getElementById('fankun-ui')) startUI();
  }, 2000);

})();
