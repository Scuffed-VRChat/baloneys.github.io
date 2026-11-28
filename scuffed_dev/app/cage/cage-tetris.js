// scuffed_dev/app/cage/cage-tetris.js: Cage Escape, the scuffed_dev app's Easter egg. On the bottom bar tap
// Inbox, Inbox, Board, Board, Announce, More, Announce, More, Images, Images, Images (app.js cageCode) and this loads.
// The story run: you against a sleepy "Nikola Tesla" CPU, with all skulls except Mirror.
// Winning it unlocks Cage Escape in More (custom games: race Tesla or solo, any skulls) and the Vault in Settings.
//
// The game is the site's own Tetris (/tetris.js), not a rewrite. These sections are copied from it unchanged:
//   Rules (pieces, SRS kicks, timing, game types, the 25 skulls), the Player engine (moves, locking, power-ups,
//   garbage), the CPU opponent (placement search), and the block / power-icon / mini-piece drawing helpers.
// Copied from tetris.js on 2026-11-28. If the site's rules change, copy those sections across again; everything
// after "Cage Escape: everything below is new" is this mode's own loop, renderer, pad and screens.
(function () {
  'use strict';
  /* ---------- from tetris.js: Rules ---------- */
  var COLS = 10, ROWS = 20, CELL = 28, SIDE = 4;   // side panels are 4 cells wide
  var GARBAGE = 8, CELL_POWER = 9;                  // board: 1-7 pieces, 8 garbage, 9+ power-up blocks

  var BASE = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]]
  };
  var TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  var TYPE_ID = { I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 };

  function rotateCW(m) {
    var n = m.length, out = [];
    for (var y = 0; y < n; y++) { out.push([]); for (var x = 0; x < n; x++) out[y][x] = m[n - 1 - x][y]; }
    return out;
  }

  // All four SRS rotation states, precomputed.
  var SHAPES = {};
  TYPES.forEach(function (t) {
    var s = [BASE[t]];
    for (var i = 1; i < 4; i++) s.push(rotateCW(s[i - 1]));
    SHAPES[t] = s;
  });

  // SRS wall kicks, (x, y) with y pointing up as in the guideline tables.
  var KICKS = {
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
  };
  var KICKS_I = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
  };

  // Neon purple → blue palettes (bottom of the well → top).
  var PALETTES = [
    { name: 'Violet', bottom: '#1c0638', top: '#c77dff' },
    { name: 'Ultraviolet', bottom: '#24063f', top: '#a020ff' },
    { name: 'Indigo', bottom: '#140b4a', top: '#7c6cff' },
    { name: 'Plasma', bottom: '#2a0a52', top: '#4cc9ff' },
    { name: 'Cobalt', bottom: '#06123f', top: '#3d8bff' }
  ];

  var HEX_RE = /^#[0-9a-f]{6}$/i;

  function customPalette(hex, bottom) {
    hex = HEX_RE.test(hex || '') ? hex : '#9d00ff';
    return { name: 'Custom', bottom: HEX_RE.test(bottom || '') ? bottom : mix('#07040c', hex, 0.3), top: hex };
  }

  function safePalette(p) {
    return p && HEX_RE.test(p.bottom || '') && HEX_RE.test(p.top || '') ? { bottom: p.bottom, top: p.top } : PALETTES[0];
  }

  // Versus rounds deal everyone a random colour (bright top, deep bottom, one hue) so boards are easy to tell apart.
  function randomPalette() {
    return customPalette(hsvHex(Math.random() * 360, 0.55 + Math.random() * 0.3, 1));
  }

  var LINE_POINTS = [0, 100, 300, 500, 800];
  var ATTACK = [0, 0, 1, 2, 4];
  var LOCK_DELAY = 0.5, MAX_RESETS = 15;
  var DAS = 0.15, ARR = 0.04, SOFT_RATE = 0.035;

  // Website timing: first clear arms 12 seconds; each clear adds 2 seconds to the refill
  // window up to 30 seconds. A Tetris grants 35 seconds. Non-clearing pieces do not break it.
  var STREAK = { WINDOW: 12, STEP: 2, MAX: 30, TETRIS: 35, MIN: 2, STRONG: 5, FIRE: 10, BORDER: 20, LIGHTNING: 50, CAP: 1000 };
  var reducedEffects = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Power-ups (blocks that ride on pieces; fire when their row clears).
  var PU = { NONE: 0, STREAK: 1, BOMB: 2, SLOW: 3, DOUBLE: 4, FREEZE: 5, SHELL: 6, CURSE: 7, SKULL: 8, QUAKE: 9, STAR_BOMB: 10 };
  var POWER_CHANCE = 0.12;
  var SLOW_SECONDS = 10, SLOW_FACTOR = 2.5, DOUBLE_SECONDS = 15, STREAK_POWER_MAX = 50;
  var FREEZE_SECONDS = 3.5, HASTE_SECONDS = 8, HASTE_FACTOR = 3, SHELL_LINES = 3, QUAKE_ROWS = 2, STAR_JUNK = 6;

  // Game types (solo; versus always plays Marathon rules) and versus rules.
  var GT = { MARATHON: 'marathon', SPRINT: 'sprint', ULTRA: 'ultra', DIG: 'dig', SURVIVAL: 'survival' };
  var GT_INFO = {
    marathon: 'Marathon: the classic, speeds up every 10 lines',
    sprint: 'Sprint 40: clear 40 lines as fast as you can',
    ultra: 'Ultra 2:00: the best score you can make in two minutes',
    dig: 'Dig: clear 10 rows of garbage as fast as you can',
    survival: 'Survival: garbage rises from below, faster and faster'
  };
  var SPRINT_LINES = 40, ULTRA_SECONDS = 120, DIG_ROWS = 10, ELIM_INTERVAL = 180;
  var STORM_INTERVAL = 20, FUSE_SECONDS = 15, HEAVY_LEVELS = 4, CRUISE_LEVEL = 8, HAIR_LOCK = 0.1;

  // The 24 skulls, in the same order as the VRChat world (icons: tetris-skulls.png, made by the world's
  // Tools/skull_icons.py). Hard skulls raise the score multiplier, easy ones lower it.
  var SKULLS = [
    { id: 'relaxed', name: 'Relaxing', cat: 'mod', eff: -0.5, body: 'Drop speed never rises, all game long.' },
    { id: 'secondWind', name: 'Second Wind', cat: 'mod', eff: -0.5, body: 'Your first solo top-out wipes the top of the well instead of ending the game.' },
    { id: 'softLanding', name: 'Soft Landing', cat: 'mod', eff: -0.25, body: 'Pieces wait twice as long before they lock, so you can slide them into place.' },
    { id: 'luckyI', name: 'Lucky I', cat: 'mod', eff: -0.25, body: 'Every bag of pieces holds two I pieces instead of one.' },
    { id: 'cruise', name: 'Cruise Control', cat: 'mod', eff: -0.25, body: 'The drop speed stops rising at level 8. Scoring still climbs.' },
    { id: 'noGhost', name: 'No Ghost', cat: 'mod', eff: 0.25, body: 'No landing preview under your piece.' },
    { id: 'noHold', name: 'No Hold', cat: 'mod', eff: 0.25, body: 'The hold slot is disabled.' },
    { id: 'blind', name: 'Blind', cat: 'mod', eff: 0.5, body: 'The NEXT pieces are hidden.' },
    { id: 'heavy', name: 'Heavy', cat: 'mod', eff: 0.5, body: 'Pieces fall as if you were four levels higher.' },
    { id: 'hairTrigger', name: 'Hair Trigger', cat: 'mod', eff: 0.5, body: 'Pieces lock almost the moment they land. No last-second slides.' },
    { id: 'mirror', name: 'Mirror', cat: 'mod', eff: 0.5, body: 'Left and right are swapped.' },
    { id: 'fuse', name: 'Fuse', cat: 'mod', eff: 0.5, body: 'Go 15 seconds without clearing a line and a garbage row rises.' },
    { id: 'storm', name: 'Thunderstorm', cat: 'mod', eff: 0.75, body: 'A garbage row rises from below every 20 seconds.' },
    { id: 'lightsOut', name: 'Lights Out', cat: 'mod', eff: 1, body: 'Your stack fades into the dark a moment after every lock. Remember where things are.' },
    { id: 'birthday', name: 'Birthday Party', cat: 'mod', eff: 0, body: 'Block Birthday Party: clearing a Tetris bursts into confetti and a playful chime. Purely for fun.' },
    { id: 'pStreak', name: 'Long Streak', cat: 'power', kind: PU.STREAK, eff: -0.1, body: 'Drops with pieces. Clear its line to double your streak timer.' },
    { id: 'pSlow', name: 'Slow Time', cat: 'power', kind: PU.SLOW, eff: -0.25, body: 'Drops with pieces. Clear its line and pieces fall 2.5x slower for 10 seconds.' },
    { id: 'pDouble', name: 'Double Score', cat: 'power', kind: PU.DOUBLE, eff: -0.1, body: 'Drops with pieces. Clear its line for double points for 15 seconds.' },
    { id: 'pQuake', name: 'Quake', cat: 'power', kind: PU.QUAKE, eff: -0.25, body: 'Drops with pieces. Clear its line and the bottom two rows drop out.' },
    { id: 'pBomb', name: 'Bomb', cat: 'power', kind: PU.BOMB, eff: 0.25, body: 'Drops with pieces. Its blast clears its row and its whole column, tearing up your stack.' },
    { id: 'pStarBomb', name: 'Star Bomb', cat: 'power', kind: PU.STAR_BOMB, eff: 0.5, body: 'Drops with pieces. When its line clears it scatters six junk blocks over your stack.' },
    { id: 'pFreeze', name: 'Freeze', cat: 'attack', kind: PU.FREEZE, eff: 0, body: 'Versus only. Clear its line to freeze a random opponent for 3.5 seconds.' },
    { id: 'pShell', name: 'Blue Shell', cat: 'attack', kind: PU.SHELL, eff: 0, body: 'Versus only. Clear its line to hit the leader with 3 garbage rows.' },
    { id: 'pCurse', name: 'Curse', cat: 'attack', kind: PU.CURSE, eff: 0, body: 'Versus only. Plants a skull in an opponent\'s next piece; when it lands they get Haste.' },
    // Website-only (not in the VRChat world yet), so it sits at the end of the icon strip.
    { id: 'noStreaks', name: 'Snuffed Out', cat: 'mod', eff: 0, body: 'Streaks never start: no streak timer, fire, outlines or streak badge. A calm, clean board.' }
  ];
  var SKULL_BY_ID = {};
  SKULLS.forEach(function (s, i) { s.index = i; SKULL_BY_ID[s.id] = s; });

  function cleanSkulls(list) {
    var seen = {};
    return (Array.isArray(list) ? list : []).filter(function (id) {
      if (!SKULL_BY_ID[id] || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  function multiplierOf(skulls) {
    var m = 1;
    skulls.forEach(function (id) { m += SKULL_BY_ID[id].eff; });
    return Math.max(0.25, Math.round(m * 100) / 100);
  }

  function effText(e) {
    if (Math.abs(e) < 0.001) return '±0×';
    return (e > 0 ? '+' : '−') + Math.round(Math.abs(e) * 100) / 100 + '×';
  }

  function gravity(level) {
    return Math.max(0.02, Math.pow(0.8 - (level - 1) * 0.007, level - 1));
  }

  function mix(a, b, t) {
    var pa = [1, 3, 5].map(function (i) { return parseInt(a.substr(i, 2), 16); });
    var pb = [1, 3, 5].map(function (i) { return parseInt(b.substr(i, 2), 16); });
    return '#' + pa.map(function (v, i) { return Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0'); }).join('');
  }

  function hsvHex(h, s, v) {
    var f = function (n) {
      var k = (n + h / 60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return '#' + [f(5), f(3), f(1)].map(function (x) { return Math.round(x * 255).toString(16).padStart(2, '0'); }).join('');
  }

  // Fire colour by streak (mirrors the VRChat board shader): 10x red → 18x violet → white-hot, then from 20x the
  // rainbow R O Y G B V up to 29x, and a very light purple from 30x.
  function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function fireSpectrum(clears) {
    var c;
    if (clears >= 30) return [0.86, 0.76, 1];
    if (clears >= STREAK.BORDER) {
      var t = (clears - STREAK.BORDER) / 9 * 5;
      c = lerp3([1, 0.12, 0.08], [1, 0.5, 0.05], clamp01(t));
      c = lerp3(c, [1, 0.9, 0.12], clamp01(t - 1));
      c = lerp3(c, [0.2, 0.95, 0.3], clamp01(t - 2));
      c = lerp3(c, [0.2, 0.5, 1], clamp01(t - 3));
      return lerp3(c, [0.62, 0.2, 1], clamp01(t - 4));
    }
    var k = Math.max(0, Math.min(5, (clears - 10) * 0.5));
    c = lerp3([1, 0.1, 0.02], [1, 0.42, 0.02], clamp01(k));
    c = lerp3(c, [1, 0.86, 0.12], clamp01(k - 1));
    c = lerp3(c, [0.18, 0.45, 1], clamp01(k - 2));
    c = lerp3(c, [0.66, 0.14, 1], clamp01(k - 3));
    return lerp3(c, [0.96, 0.92, 1], clamp01(k - 4));
  }
  function rgb(c, a) { return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + (a == null ? 1 : a) + ')'; }
  /* =================================================================
     Player
     ================================================================= */

  function Player(opts) {
    this.id = opts.id;
    this.name = opts.name;
    this.palette = safePalette(opts.palette);
    this.avatar = opts.avatar || null;
    this.local = opts.local;          // controlled on this device
    this.controls = opts.controls;    // key map for local players
    this.lives = opts.lives;
    this.versus = !!opts.versus;
    this.gameType = this.versus ? GT.MARATHON : (opts.gameType || GT.MARATHON);
    this.skulls = cleanSkulls(opts.skulls);
    var f = {};
    this.skulls.forEach(function (id) { f[id] = true; });
    this.f = f;
    this.powerKinds = this.skulls.map(function (id) { return SKULL_BY_ID[id]; })
      .filter(function (s) { return s.kind && (s.cat !== 'attack' || opts.versus); })
      .map(function (s) { return s.kind; });
    this.multiplier = multiplierOf(this.skulls);
    this.reset(true);
  }

  Player.prototype.reset = function (full) {
    this.board = [];
    for (var r = 0; r < ROWS; r++) this.board.push(new Array(COLS).fill(0));
    this.bag = [];
    this.queue = [];
    this.hold = null;
    this.holdPower = null;
    this.canHold = true;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.fall = 0;
    this.combo = -1;
    this.b2b = false;
    this.incoming = 0;
    this.flash = 0;
    this.slow = 0; this.double = 0; this.frozen = 0; this.haste = 0;
    this.pendingCurses = 0;
    this.streak = 0; this.streakLines = 0; this.streakLeft = 0;
    this.lockedAt = 0;
    this.fx = [];        // power glows and confetti: { cells, kind, t }
    this.junk = null;    // star bomb fly-in
    if (full) {
      this.score = 0;
      this.lines = 0;
      this.level = 1;
      this.alive = true;
      this.losses = 0;
      this.elapsed = 0;
      this.stormClock = 0; this.survivalClock = 0; this.fuseClock = 0;
      this.secondWindUsed = false;
      this.finish = null;
      this.eliminated = false;
      if (this.gameType === GT.DIG) this.fillDig();
    }
    this.fillQueue();
    this.spawn();
  };

  Player.prototype.fillQueue = function () {
    while (this.queue.length < 6) {
      if (!this.bag.length) {
        this.bag = TYPES.slice();
        if (this.f.luckyI) this.bag.push('I'); // Lucky I: two I pieces per bag
        for (var i = this.bag.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var t = this.bag[i]; this.bag[i] = this.bag[j]; this.bag[j] = t;
        }
      }
      this.queue.push(this.bag.pop());
    }
  };

  Player.prototype.spawn = function (type, power) {
    var fromQueue = !type;
    type = type || this.queue.shift();
    this.fillQueue();
    var size = SHAPES[type][0].length;
    this.piece = { type: type, rot: 0, x: Math.floor((COLS - size) / 2), y: type === 'I' ? -1 : 0, power: 0, powerCell: 0 };
    if (power) { this.piece.power = power.kind; this.piece.powerCell = power.cell; }
    else if (fromQueue && this.pendingCurses > 0) {
      this.pendingCurses--;
      this.piece.power = PU.SKULL; this.piece.powerCell = Math.floor(Math.random() * 4);
    } else if (fromQueue && this.powerKinds.length && Math.random() < POWER_CHANCE) {
      this.piece.power = this.powerKinds[Math.floor(Math.random() * this.powerKinds.length)];
      this.piece.powerCell = Math.floor(Math.random() * 4);
    }
    this.lockTimer = 0;
    this.lockResets = 0;
    this.fall = 0;
    if (this.collides(this.piece.x, this.piece.y, 0)) {
      this.piece.y -= 1;
      if (this.collides(this.piece.x, this.piece.y, 0)) return false;
    }
    return true;
  };

  Player.prototype.cells = function (x, y, rot, type) {
    var m = SHAPES[type || this.piece.type][rot], out = [];
    for (var r = 0; r < m.length; r++) for (var c = 0; c < m.length; c++) if (m[r][c]) out.push([x + c, y + r]);
    return out;
  };

  Player.prototype.collides = function (x, y, rot) {
    var cs = this.cells(x, y, rot);
    for (var i = 0; i < cs.length; i++) {
      var cx = cs[i][0], cy = cs[i][1];
      if (cx < 0 || cx >= COLS || cy >= ROWS) return true;
      if (cy >= 0 && this.board[cy][cx]) return true;
    }
    return false;
  };

  Player.prototype.grounded = function () { return this.collides(this.piece.x, this.piece.y + 1, this.piece.rot); };

  Player.prototype.touched = function () {
    // Moving or rotating on the ground resets lock delay, up to a limit.
    if (this.grounded() && this.lockResets < MAX_RESETS) { this.lockTimer = 0; this.lockResets++; }
  };

  Player.prototype.lockDelay = function () {
    if (this.f.hairTrigger) return HAIR_LOCK;
    return this.f.softLanding ? LOCK_DELAY * 2 : LOCK_DELAY;
  };

  Player.prototype.gravityLevel = function () {
    var lvl = this.f.relaxed ? 1 : (this.f.heavy ? this.level + HEAVY_LEVELS : this.level);
    return this.f.cruise ? Math.min(lvl, CRUISE_LEVEL) : lvl;
  };

  Player.prototype.move = function (dx) {
    if (this.f.mirror) dx = -dx; // Mirror skull: left and right swapped for every input
    if (!this.collides(this.piece.x + dx, this.piece.y, this.piece.rot)) {
      this.piece.x += dx;
      this.touched();
      return true;
    }
    return false;
  };

  Player.prototype.rotate = function (dir) {
    var p = this.piece;
    if (p.type === 'O') return;
    var to = (p.rot + dir + 4) % 4;
    var table = p.type === 'I' ? KICKS_I : KICKS;
    var kicks = table[p.rot + '>' + to];
    for (var i = 0; i < kicks.length; i++) {
      var nx = p.x + kicks[i][0], ny = p.y - kicks[i][1];
      if (!this.collides(nx, ny, to)) {
        p.x = nx; p.y = ny; p.rot = to;
        this.touched();
        G.Sound.beep(700, 0.03, 'square', 0.025);
        return;
      }
    }
  };

  Player.prototype.softDrop = function () {
    if (!this.grounded()) { this.piece.y++; this.score += 1; this.fall = 0; return true; }
    return false;
  };

  Player.prototype.ghostY = function () {
    var y = this.piece.y;
    while (!this.collides(this.piece.x, y + 1, this.piece.rot)) y++;
    return y;
  };

  Player.prototype.hardDrop = function () {
    var gy = this.ghostY();
    this.score += (gy - this.piece.y) * 2;
    this.piece.y = gy;
    return this.lock();
  };

  Player.prototype.holdPiece = function () {
    if (!this.canHold || this.f.noHold) return;
    var cur = this.piece.type, curPower = this.piece.power ? { kind: this.piece.power, cell: this.piece.powerCell } : null;
    if (this.hold) {
      var h = this.hold, hp = this.holdPower;
      this.hold = cur; this.holdPower = curPower;
      this.spawn(h, hp);
    } else {
      this.hold = cur; this.holdPower = curPower;
      this.spawn();
    }
    this.canHold = false;
    G.Sound.beep(520, 0.04, 'triangle', 0.03);
  };

  // Returns { cleared, attack, toppedOut, tetris, levelUp, out: { freeze, shell, curse } }
  Player.prototype.lock = function () {
    var id = TYPE_ID[this.piece.type];
    var self = this, piece = this.piece;
    var above = false;
    this.cells(piece.x, piece.y, piece.rot).forEach(function (c, i) {
      if (c[1] < 0) { above = true; return; }
      if (piece.power === PU.SKULL && i === piece.powerCell) self.board[c[1]][c[0]] = GARBAGE;
      else self.board[c[1]][c[0]] = piece.power && i === piece.powerCell ? CELL_POWER + piece.power - 1 : id;
    });
    this.lockedAt = performance.now();

    // Power-ups fire when their row clears.
    var full = [], powers = [];
    for (var r = 0; r < ROWS; r++) {
      if (!this.board[r].every(function (v) { return v; })) continue;
      full.push(r);
      for (var c = 0; c < COLS; c++) {
        var v = this.board[r][c];
        if (v >= CELL_POWER) powers.push({ kind: v - CELL_POWER + 1, row: r, col: c });
      }
    }
    var fullSet = {};
    full.forEach(function (row) { fullSet[row] = true; });
    var bombs = 0, boosts = 0, quakes = 0, stars = 0, out = { freeze: 0, shell: 0, curse: 0 };
    var fxCells = [];
    powers.forEach(function (p) {
      if (p.kind === PU.BOMB) {
        bombs++;
        for (var rr = 0; rr < ROWS; rr++) { if (!fullSet[rr]) self.board[rr][p.col] = 0; fxCells.push([rr, p.col]); }
      } else if (p.kind === PU.STREAK) boosts++;
      else if (p.kind === PU.QUAKE) quakes++;
      else if (p.kind === PU.STAR_BOMB) stars++;
      else if (p.kind === PU.SLOW) self.slow = SLOW_SECONDS;
      else if (p.kind === PU.DOUBLE) self.double = DOUBLE_SECONDS;
      else if (p.kind === PU.FREEZE) out.freeze++;
      else if (p.kind === PU.SHELL) out.shell++;
      else if (p.kind === PU.CURSE) out.curse++;
      for (var cc = 0; cc < COLS; cc++) fxCells.push([p.row, cc]);
    });
    var now = performance.now();
    if (powers.length) this.fx.push({ cells: fxCells, kind: powers[0].kind, t: now });
    if (this.f.birthday && full.length === 4) {
      var conf = [];
      full.forEach(function (row) { for (var cx = 0; cx < COLS; cx++) conf.push([row, cx]); });
      this.fx.push({ cells: conf, kind: 'confetti', t: now });
    }

    var rowsCleared = 0;
    for (r = ROWS - 1; r >= 0; r--) {
      if (this.board[r].every(function (v) { return v; })) {
        this.board.splice(r, 1);
        this.board.unshift(new Array(COLS).fill(0));
        rowsCleared++;
        r++;
      }
    }
    var cleared = rowsCleared + bombs;
    var wasB2b = this.b2b;
    for (var q = 0; q < quakes * QUAKE_ROWS; q++) { this.board.pop(); this.board.unshift(new Array(COLS).fill(0)); cleared++; }
    if (stars) {
      var star = powers.filter(function (p) { return p.kind === PU.STAR_BOMB; })[0];
      this.scatterJunk(stars * STAR_JUNK, star.row, star.col);
    }

    var attack = 0, tetris = rowsCleared === 4, levelUp = false;
    if (cleared) {
      this.combo++;
      var pts = LINE_POINTS[Math.min(4, cleared)] * this.level;
      if (this.double > 0) pts *= 2;
      pts = Math.round(pts * this.multiplier);
      if (tetris && this.b2b) pts = Math.floor(pts * 1.5);
      pts += 50 * Math.max(0, this.combo) * this.level;
      this.score += pts;
      attack = ATTACK[Math.min(4, cleared)] + (tetris && this.b2b ? 1 : 0) + Math.floor(Math.max(0, this.combo) / 2);
      this.b2b = tetris;
      this.lines += cleared;
      var before = this.level;
      this.level = Math.floor(this.lines / 10) + 1;
      levelUp = this.level > before;
      this.flash = 0.25;
      this.fuseClock = 0;
      // Outgoing attack cancels garbage that's waiting for us first.
      var cancel = Math.min(attack, this.incoming);
      this.incoming -= cancel;
      attack -= cancel;
      G.Sound.beep(tetris ? 988 : 660 + Math.min(4, cleared) * 60, tetris ? 0.3 : 0.12, 'triangle', 0.06);
      if (tetris && this.f.birthday) [0, 90, 180, 290].forEach(function (delay, i) {
        setTimeout(function () { G.Sound.beep([740, 988, 1175, 1568][i], 0.13, i === 3 ? 'triangle' : 'square', 0.045); }, delay);
      });
      this.recordStreak(cleared);
      if (!reducedEffects && full.length) this.fx.push({ kind: 'clear', rows: full.slice(), tetris: tetris, streak: this.streak, t: now });
      for (var b = 0; b < boosts; b++) this.streakLeft = Math.min(STREAK_POWER_MAX, this.streakLeft * 2);
    } else {
      this.combo = -1;
      if (this.incoming) this.addGarbage(this.incoming);
      this.incoming = 0;
      G.Sound.beep(160, 0.03, 'square', 0.02);
    }
    if (piece.power === PU.SKULL) this.haste = HASTE_SECONDS; // the curse lands on us

    this.canHold = true;
    var ok = this.spawn() && !above;
    if (this.f.lightsOut) this.lightsLines = (this.lightsLines || 0) + cleared;
    var empty = this.board.every(function (row) { return row.every(function (v) { return !v; }); });
    var fired = powers.map(function (p) { return p.kind === PU.BOMB ? 'bomb' : p.kind === PU.STAR_BOMB ? 'starbomb' : p.kind === PU.QUAKE ? 'quake' : ''; });
    return { cleared: cleared, attack: attack, toppedOut: !ok, tetris: tetris, levelUp: levelUp, out: out,
      clearedPowers: powers.map(function(p){return p.kind;}), b2b: tetris && wasB2b, perfect: cleared > 0 && empty, powers: fired };
  };

  Player.prototype.recordStreak = function (cleared) {
    if (this.f.noStreaks) return;
    if (this.streakLeft <= 0) { this.streak = 0; this.streakLines = 0; }
    this.streak = Math.min(STREAK.CAP, this.streak + (cleared >= 4 ? 8 : 1));
    this.streakLines += cleared;
    var win = cleared >= 4 ? STREAK.TETRIS : Math.min(STREAK.MAX, STREAK.WINDOW + STREAK.STEP * (this.streak - 1));
    this.streakLeft = Math.max(this.streakLeft, win);
  };

  Player.prototype.heatTier = function () {
    if (this.streakLeft <= 0 || this.streak < STREAK.MIN) return 0;
    return this.streak >= STREAK.FIRE ? 3 : this.streak >= STREAK.STRONG ? 2 : 1;
  };

  // Star Bomb: junk lands on top of random columns; each one flies in from the bomb (drawn by drawJunk).
  Player.prototype.scatterJunk = function (n, fromRow, fromCol) {
    var land = [];
    for (var i = 0; i < n; i++) {
      var c = Math.floor(Math.random() * COLS), top = ROWS;
      for (var r = 0; r < ROWS; r++) if (this.board[r][c]) { top = r; break; }
      if (top - 1 < 3) continue;
      this.board[top - 1][c] = GARBAGE;
      land.push([top - 1, c]);
    }
    if (land.length) this.junk = { from: [fromRow, fromCol], land: land, t: performance.now() };
  };

  Player.prototype.addGarbage = function (n) {
    var hole = Math.floor(Math.random() * COLS);
    for (var i = 0; i < n; i++) {
      this.board.shift();
      var row = new Array(COLS).fill(GARBAGE);
      row[hole] = 0;
      this.board.push(row);
    }
    if (this.piece && this.collides(this.piece.x, this.piece.y, this.piece.rot)) this.piece.y = Math.max(-2, this.piece.y - n);
  };

  // One garbage row from below (Thunderstorm, Fuse, Survival). Returns true if it topped us out.
  Player.prototype.riseGarbage = function () {
    var topBlocked = this.board[0].some(function (v) { return v; });
    this.addGarbage(1);
    return topBlocked || !!(this.piece && this.collides(this.piece.x, this.piece.y, this.piece.rot));
  };

  Player.prototype.fillDig = function () {
    var last = -1;
    for (var r = ROWS - DIG_ROWS; r < ROWS; r++) {
      var hole = Math.floor(Math.random() * COLS);
      if (hole === last) hole = (hole + 1 + Math.floor(Math.random() * (COLS - 1))) % COLS;
      last = hole;
      for (var c = 0; c < COLS; c++) this.board[r][c] = c === hole ? 0 : GARBAGE;
    }
  };

  Player.prototype.garbageRows = function () {
    return this.board.filter(function (row) { return row.indexOf(GARBAGE) !== -1; }).length;
  };

  // Compact state for online sync (one base-36 character per cell: power blocks go above 9).
  Player.prototype.pack = function () {
    return {
      b: this.board.map(function (r) { return r.map(function (v) { return v.toString(36); }).join(''); }).join(''),
      p: this.piece ? [this.piece.type, this.piece.rot, this.piece.x, this.piece.y, this.piece.power, this.piece.powerCell] : null,
      h: this.hold,
      q: this.queue.slice(0, 5),
      s: this.score, l: this.lines, v: this.level, lv: this.lives, lo: this.losses, a: this.alive, i: this.incoming,
      pal: [this.palette.bottom, this.palette.top],
      k: [this.streak, Math.round(this.streakLeft * 10), Math.round(this.slow * 10), Math.round(this.double * 10),
        Math.round(this.frozen * 10), Math.round(this.haste * 10)],
      e: this.eliminated ? 1 : 0
    };
  };

  Player.prototype.unpack = function (d) {
    if (!d || typeof d.b !== 'string' || d.b.length !== COLS * ROWS) return;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) this.board[r][c] = parseInt(d.b[r * COLS + c], 36) || 0;
    this.piece = d.p && SHAPES[d.p[0]] ? { type: d.p[0], rot: d.p[1] & 3, x: +d.p[2], y: +d.p[3], power: +d.p[4] || 0, powerCell: +d.p[5] || 0 } : null;
    this.hold = SHAPES[d.h] ? d.h : null;
    this.queue = (d.q || []).filter(function (t) { return SHAPES[t]; });
    this.score = +d.s || 0; this.lines = +d.l || 0; this.level = +d.v || 1;
    this.losses = +d.lo || 0; this.alive = d.a !== false; this.incoming = +d.i || 0;
    this.eliminated = !!d.e;
    if (Array.isArray(d.k)) {
      this.streak = +d.k[0] || 0; this.streakLeft = (+d.k[1] || 0) / 10; this.slow = (+d.k[2] || 0) / 10;
      this.double = (+d.k[3] || 0) / 10; this.frozen = (+d.k[4] || 0) / 10; this.haste = (+d.k[5] || 0) / 10;
    }
    if (Array.isArray(d.pal)) this.palette = safePalette({ bottom: d.pal[0], top: d.pal[1] });
  };
  /* =================================================================
     CPU opponents
     ================================================================= */

  // A placement-search bot. For the current piece (and the hold piece, from Normal up) it tries every rotation and
  // column, drops it, clears lines on a copy of the board and scores the result: Pierre Dellacherie's weights
  // (landing height, rows cleared, row and column transitions, holes, wells). Insane also looks one piece ahead.
  // It then plays the chosen placement with human-like timing: a pause to "think", then one input at a time.
  // Lower levels think slower, press slower, sometimes pick a worse spot and don't use hold.
  var Cpu = (function () {
    // Normal is tuned to an average player (about 40 pieces a minute, the odd misplacement, little hold use).
    // Ultra hard is the ceiling: quick and tidy, but still beatable.
    var LEVELS = {
      easy: { label: 'Easy', think: 1.1, step: 0.3, mistake: 0.38, noise: 2.2, hold: false, hard: false, look: false },
      normal: { label: 'Normal', think: 0.75, step: 0.2, mistake: 0.22, noise: 1.4, hold: false, hard: true, look: false },
      hard: { label: 'Hard', think: 0.48, step: 0.14, mistake: 0.15, noise: 1.0, hold: true, hard: true, look: false },
      ultra: { label: 'Ultra hard', think: 0.3, step: 0.1, mistake: 0.12, noise: 0.8, hold: true, hard: true, look: false }
    };
    function levelOf(key) { return key === 'insane' ? 'ultra' : (LEVELS[key] ? key : 'normal'); }
    var NO_KEYS = { left: [], right: [], soft: [], cw: [], ccw: [], hard: [], hold: [] };
    var NAMES = ['Blocky', 'Tess', 'Gridlock', 'Spin', 'Cobalt', 'Lunar'];

    function cellsOf(type, rot, x, y) {
      var m = SHAPES[type][rot], out = [];
      for (var r = 0; r < m.length; r++) for (var c = 0; c < m.length; c++) if (m[r][c]) out.push([x + c, y + r]);
      return out;
    }

    function fits(board, cells) {
      for (var i = 0; i < cells.length; i++) {
        var x = cells[i][0], y = cells[i][1];
        if (x < 0 || x >= COLS || y >= ROWS) return false;
        if (y >= 0 && board[y][x]) return false;
      }
      return true;
    }

    // Every reachable-from-above placement of a piece: { rot, x, y, board (after clears), cleared, cells }.
    function placements(board, type) {
      var out = [], rots = type === 'O' ? 1 : (type === 'I' || type === 'S' || type === 'Z' ? 2 : 4);
      for (var rot = 0; rot < rots; rot++) {
        for (var x = -2; x < COLS; x++) {
          var y = -2;
          if (!fits(board, cellsOf(type, rot, x, y))) continue;
          while (fits(board, cellsOf(type, rot, x, y + 1))) y++;
          var cells = cellsOf(type, rot, x, y);
          if (cells.some(function (c) { return c[1] < 0; })) continue;
          var b = board.map(function (row) { return row.slice(); });
          cells.forEach(function (c) { b[c[1]][c[0]] = 1; });
          var cleared = 0;
          for (var r = ROWS - 1; r >= 0; r--) {
            if (b[r].every(function (v) { return v; })) { b.splice(r, 1); b.unshift(new Array(COLS).fill(0)); cleared++; r++; }
          }
          out.push({ rot: rot, x: x, y: y, board: b, cleared: cleared, cells: cells });
        }
      }
      return out;
    }

    function score(pl) {
      var b = pl.board, rowT = 0, colT = 0, holes = 0, wells = 0, r, c;
      var land = 0;
      pl.cells.forEach(function (cell) { land += ROWS - cell[1]; });
      land /= pl.cells.length;
      for (r = 0; r < ROWS; r++) {
        var prev = 1;
        for (c = 0; c < COLS; c++) { var f = b[r][c] ? 1 : 0; if (f !== prev) rowT++; prev = f; }
        if (!prev) rowT++;
      }
      for (c = 0; c < COLS; c++) {
        var above = 0, seen = false;
        for (r = 0; r < ROWS; r++) {
          var v = b[r][c] ? 1 : 0;
          if (v !== above) colT++;
          above = v;
          if (v) seen = true; else if (seen) holes++;
        }
        if (!above) colT++;
        var depth = 0;
        for (r = 0; r < ROWS; r++) {
          var left = c === 0 || b[r][c - 1], right = c === COLS - 1 || b[r][c + 1];
          if (!b[r][c] && left && right) { depth++; wells += depth; } else depth = 0;
        }
      }
      return -4.5 * land + 3.42 * pl.cleared - 3.22 * rowT - 9.35 * colT - 7.9 * holes - 3.39 * wells;
    }

    // Best plan for this player now: { hold, rot, x }.
    function plan(p, lv) {
      var options = [];
      function consider(type, viaHold, nextType) {
        placements(p.board, type).forEach(function (pl) {
          var v = score(pl);
          if (lv.look && nextType) {
            var bestNext = -Infinity;
            placements(pl.board, nextType).forEach(function (n) { bestNext = Math.max(bestNext, score(n)); });
            if (bestNext > -Infinity) v = v * 0.5 + bestNext * 0.5;
          }
          if (lv.noise) v += (Math.random() - 0.5) * lv.noise * 10;
          options.push({ hold: viaHold, rot: pl.rot, x: pl.x, v: v });
        });
      }
      consider(p.piece.type, false, p.queue[0]);
      if (lv.hold && p.canHold && !p.f.noHold) {
        var alt = p.hold || p.queue[0];
        if (alt && alt !== p.piece.type) consider(alt, true, p.hold ? p.queue[0] : p.queue[1]);
      }
      if (!options.length) return { hold: false, rot: p.piece.rot, x: p.piece.x };
      options.sort(function (a, b) { return b.v - a.v; });
      var pick = 0;
      if (lv.mistake && Math.random() < lv.mistake) pick = Math.min(options.length - 1, 1 + Math.floor(Math.random() * 4));
      return options[pick];
    }

    function brain(level) {
      level = levelOf(level);
      var lv = LEVELS[level];
      return { level: level, lv: lv, plan: null, pieceKey: '', wait: lv.think };
    }

    // One input every lv.step seconds: hold, then rotate, then slide, then drop.
    // onLock: who handles a hard drop's result (default afterLock; the cinematic passes its own, as it runs no game).
    function tick(p, dt, onLock) {
      var b = p.cpu, lv = b.lv;
      if (!p.piece || p.frozen > 0) return;
      var key = p.lockedAt + ':' + p.piece.type + ':' + (p.hold || '');
      if (key !== b.pieceKey) { b.pieceKey = key; b.plan = null; b.wait = lv.think * (0.7 + Math.random() * 0.6); }
      b.wait -= dt;
      if (b.wait > 0) return;
      if (!b.plan) b.plan = plan(p, lv);
      var pl = b.plan;
      b.wait = lv.step * (0.75 + Math.random() * 0.5);
      if (pl.hold) { pl.hold = false; p.holdPiece(); b.pieceKey = p.lockedAt + ':' + p.piece.type + ':' + (p.hold || ''); return; }
      if (p.piece.rot !== pl.rot) {
        var cw = (pl.rot - p.piece.rot + 4) % 4;
        p.rotate(cw === 3 ? -1 : 1);
        if (p.piece.rot !== pl.rot && cw !== 3 && cw !== 1) return; // half-turn: keep rotating next step
        return;
      }
      var mirror = p.f.mirror ? -1 : 1; // Mirror skull flips the CPU's moves too, so it has to press the other way
      if (p.piece.x !== pl.x) {
        var dir = pl.x > p.piece.x ? 1 : -1;
        if (!p.move(dir * mirror)) b.plan = { hold: false, rot: p.piece.rot, x: p.piece.x }; // blocked: settle here
        return;
      }
      if (lv.hard) (onLock || afterLock)(p, p.hardDrop());
      else p.softDrop();
    }

    // A CPU's shown name: the player's choice (cleaned up), or a default, tagged with its difficulty.
    function name(level, i, custom) {
      var base = String(custom || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) || NAMES[i % NAMES.length];
      return base + ' · ' + LEVELS[levelOf(level)].label + ' CPU';
    }

    return { LEVELS: LEVELS, NO_KEYS: NO_KEYS, brain: brain, tick: tick, name: name, levelOf: levelOf, NAMES: NAMES };
  })();
  /* ---------- from tetris.js: drawing helpers ---------- */
  // 8x8 power-up icons (one row per number, leftmost pixel = bit 7), same as the VRChat board shader.
  var ICONS = {
    1: [126, 66, 36, 24, 24, 36, 90, 126], 2: [6, 8, 60, 126, 126, 126, 126, 60], 3: [24, 90, 60, 219, 219, 60, 90, 24],
    4: [24, 24, 255, 126, 60, 126, 102, 195], 5: [255, 129, 181, 153, 153, 173, 129, 255], 6: [24, 60, 90, 255, 189, 255, 66, 0],
    7: [60, 126, 219, 219, 126, 36, 60, 90], 8: [60, 126, 219, 219, 126, 36, 60, 90], 9: [0, 0, 0, 255, 0, 255, 189, 165],
    10: [8, 4, 60, 126, 106, 126, 126, 60]
  };
  var POWER_COLOUR = { 1: '#66f2ff', 2: '#ff9933', 3: '#9ecbff', 4: '#ffd640', 5: '#c7f7ff', 6: '#4d80ff', 7: '#b8ff4d', 8: '#b8ff4d', 9: '#d99a59', 10: '#ff5999' };

  function blockColor(p, row) {
    return mix(p.palette.bottom, p.palette.top, 1 - row / ROWS);
  }

  // Cache the two-colour vertical fill for each well row. A block has its own top-to-bottom gradient
  // while the board-wide palette still changes by row, matching the world's 0.65 block shading.
  function blockFill(p, row) {
    var key = p.palette.bottom + '/' + p.palette.top;
    if (p.ui.gradientKey !== key) {
      p.ui.gradientKey = key;
      p.ui.gradients = [];
      for (var r = 0; r < ROWS; r++) {
        var base = blockColor(p, r);
        var fill = p.ui.ctx.createLinearGradient(0, r * CELL + 1, 0, (r + 1) * CELL - 1);
        fill.addColorStop(0, mix(base, p.palette.top, 0.65));
        fill.addColorStop(1, mix(base, p.palette.bottom, 0.65));
        p.ui.gradients.push(fill);
      }
    }
    return p.ui.gradients[row];
  }

  function drawBlock(ctx, x, y, size, color, alpha) {
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x + 3, y + 3, size - 6, Math.max(2, size * 0.18));
    ctx.globalAlpha = 1;
  }

  function drawPowerIcon(ctx, x, y, size, kind, now) {
    var bomb = kind === PU.BOMB;
    ctx.fillStyle = bomb ? '#ff8c1f' : '#0f0c24';
    ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
    var bits = ICONS[kind] || ICONS[1], px = (size - 6) / 8;
    ctx.fillStyle = bomb ? '#140f1a' : POWER_COLOUR[kind];
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      if (bits[r] & (128 >> c)) ctx.fillRect(x + 3 + c * px, y + 3 + r * px, Math.ceil(px), Math.ceil(px));
    }
    var pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(now / 1000 * 6));
    ctx.strokeStyle = POWER_COLOUR[kind];
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    ctx.globalAlpha = 1;
  }

  function drawMini(ctx, type, cx, cy, size, color) {
    var m = SHAPES[type][0];
    var minR = 9, maxR = -1, minC = 9, maxC = -1;
    for (var r = 0; r < m.length; r++) for (var c = 0; c < m.length; c++) if (m[r][c]) {
      minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c);
    }
    var w = (maxC - minC + 1) * size, h = (maxR - minR + 1) * size;
    for (r = minR; r <= maxR; r++) for (c = minC; c <= maxC; c++) if (m[r][c]) {
      drawBlock(ctx, cx - w / 2 + (c - minC) * size, cy - h / 2 + (r - minR) * size, size, color);
    }
  }

  /* =================================================================
     Cage Escape: everything below is new for the app's Easter egg
     ================================================================= */

  var MUTE_KEY = 'scd-app-cage-mute', SETUP_KEY = 'scd-app-cage-setup';
  var DIR = '/scuffed_dev/app/cage/';
  var ALL_SKULLS = SKULLS.map(function (s) { return s.id; });

  // Story: the unlock run. All skulls except Mirror, first to 40 lines, Tesla on "Sleepy" so a steady player
  // wins: he thinks for two seconds a piece, misplaces almost half of them and suffers the same skulls.
  // You get 3 lives, Tesla gets 1 (in custom races too: the setup picks your lives only).
  var TESLA_LIVES = 1;
  var STORY = { mode: 'race', lines: 40, cpu: 'story', lives: 3, skulls: ALL_SKULLS.filter(function (id) { return id !== 'mirror'; }), story: true };
  Cpu.LEVELS.story = { label: 'Sleepy', think: 2.0, step: 0.4, mistake: 0.45, noise: 2.6, hold: false, hard: true, look: false };
  var CPU_CHOICES = [['story', 'Sleepy'], ['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['ultra', 'Ultra hard']];
  var GAME_TYPES = [[GT.SPRINT, 'Sprint 40'], [GT.MARATHON, 'Marathon'], [GT.ULTRA, 'Ultra 2:00'], [GT.DIG, 'Dig'], [GT.SURVIVAL, 'Survival']];

  /* ---------- sound: the site's G.Sound.beep, on WebAudio ---------- */

  var G = { Sound: { beep: beep } }, actx = null, muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* private mode */ }
  function beep(freq, dur, type, vol) {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = type || 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.03, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* no audio */ }
  }
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* fine */ } }
  function stored(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }

  /* ---------- state ---------- */

  // cfg: { mode: 'race' | 'solo', lines, cpu, lives, gameType (solo), skulls, story }
  var game = null, held = {}, raf = 0, last = 0, api = {}, ui = null, dpr = 1, cfg = STORY;

  function newGame() {
    var race = cfg.mode === 'race';
    var me = new Player({ id: 'you', name: 'You', palette: customPalette(api.accent || '#ff1f3d'), local: true, controls: {},
      lives: race ? cfg.lives : 1, versus: race, gameType: race ? GT.MARATHON : cfg.gameType, skulls: cfg.skulls });
    var tesla = null;
    if (race) {
      tesla = new Player({ id: 'tesla', name: 'Nikola Tesla', palette: { bottom: '#06123f', top: '#4cc9ff' }, local: true, controls: Cpu.NO_KEYS, lives: TESLA_LIVES, versus: true, skulls: cfg.skulls });
      tesla.cpu = Cpu.brain(cfg.cpu);
    }
    held = {};
    game = { players: tesla ? [me, tesla] : [me], me: me, tesla: tesla, race: race, paused: false, over: false, started: false, count: 3, t: 0, winner: null };
  }

  /* ---------- loop (ported from tetris.js: stepPlayer, afterLock, attacks, top-outs, solo endings) ---------- */

  function loop(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (game && !game.paused && !game.over) {
      if (!game.started) {
        var before = Math.ceil(game.count);
        game.count -= dt;
        if (Math.ceil(game.count) !== before && game.count > 0) beep(440, 0.09, 'square', 0.04);
        if (game.count <= 0) { game.started = true; beep(880, 0.25, 'triangle', 0.05); flashText('GO!'); }
      } else {
        game.t += dt;
        if (game.tesla && game.tesla.alive) Cpu.tick(game.tesla, dt);
        game.players.forEach(function (p) { if (p.alive && game && !game.over) stepPlayer(p, dt); });
      }
    }
    if (game && ui) {
      if (ui.scene) tickCutscene(dt);
      else render(now);
    }
    raf = requestAnimationFrame(loop);
  }

  function pressed(p, action) { return p === game.me ? held[action] || null : null; }

  function stepPlayer(p, dt) {
    p.elapsed += dt;
    p.slow = Math.max(0, p.slow - dt);
    p.double = Math.max(0, p.double - dt);
    p.haste = Math.max(0, p.haste - dt);
    if (p.streakLeft > 0) { p.streakLeft = Math.max(0, p.streakLeft - dt); if (!p.streakLeft) { p.streak = 0; p.streakLines = 0; } }
    if (p.f.storm) { p.stormClock += dt; if (p.stormClock >= STORM_INTERVAL) { p.stormClock -= STORM_INTERVAL; if (p.riseGarbage()) return toppedOut(p); } }
    if (p.f.fuse) { p.fuseClock += dt; if (p.fuseClock >= FUSE_SECONDS) { p.fuseClock = 0; if (p.riseGarbage()) return toppedOut(p); } }
    if (p.gameType === GT.SURVIVAL) {
      p.survivalClock += dt;
      var interval = Math.max(4, 10 - p.elapsed / 30);
      if (p.survivalClock >= interval) { p.survivalClock -= interval; if (p.riseGarbage()) return toppedOut(p); }
    }
    if (p.gameType === GT.ULTRA && p.elapsed >= ULTRA_SECONDS) { p.elapsed = ULTRA_SECONDS; p.finish = 'time'; return endSolo(p); }
    if (p.frozen > 0) { p.frozen = Math.max(0, p.frozen - dt); return; }

    ['left', 'right'].forEach(function (dir) {
      var h = pressed(p, dir);
      if (!h) return;
      h.t += dt;
      if (h.t >= DAS) {
        h.r = (h.r || 0) + dt;
        while (h.r >= ARR) { h.r -= ARR; p.move(dir === 'left' ? -1 : 1); }
      }
    });
    var soft = pressed(p, 'soft');
    if (soft) {
      soft.r = (soft.r || 0) + dt;
      while (soft.r >= SOFT_RATE) { soft.r -= SOFT_RATE; p.softDrop(); }
    }
    if (!p.piece) return;

    if (p.grounded()) {
      p.lockTimer += dt;
      if (p.lockTimer >= p.lockDelay()) afterLock(p, p.lock());
    } else {
      p.fall += dt;
      var g = gravity(p.gravityLevel());
      if (p.slow > 0) g *= SLOW_FACTOR;
      if (p.haste > 0) g /= HASTE_FACTOR;
      while (p.fall >= g) {
        p.fall -= g;
        if (!p.grounded()) p.piece.y++;
        else break;
      }
    }
    if (p.flash) p.flash = Math.max(0, p.flash - dt);
  }

  function afterLock(p, res) {
    if (!game || game.over) return;
    if (res.tetris) flashText(p === game.me ? 'TETRIS!' : 'Tesla: TETRIS', p !== game.me);
    if (res.cleared && p === game.tesla) zap();
    if (res.cleared && p === game.me && api.haptic) api.haptic(res.tetris ? [18, 40, 18] : 8);
    if (game.race) {
      if (res.attack) sendAttack(p, res.attack);
      sendPowerAttacks(p, res.out);
    }
    if (res.toppedOut) return toppedOut(p);
    if (game.race && p.lines >= cfg.lines) return finish(p);
    if (!p.versus && p.gameType === GT.SPRINT && p.lines >= SPRINT_LINES) { p.finish = 'sprint'; return endSolo(p); }
    if (!p.versus && p.gameType === GT.DIG && !p.garbageRows()) { p.finish = 'dig'; return endSolo(p); }
  }

  function other(p) { return p === game.me ? game.tesla : game.me; }

  function sendAttack(from, n, to) {
    var target = to || other(from);
    if (target && target.alive) target.incoming += n;
  }

  // Versus attack power-ups: Freeze and Curse hit the opponent, the Blue Shell hits whoever is ahead on lines.
  function sendPowerAttacks(from, out) {
    if (!out || !(out.freeze || out.shell || out.curse)) return;
    var t = other(from), i;
    if (!t || !t.alive) return;
    for (i = 0; i < out.freeze; i++) { t.frozen = FREEZE_SECONDS; if (t === game.me) held = {}; flashText(t === game.me ? 'FROZEN!' : 'Tesla frozen!', t !== game.me); }
    for (i = 0; i < out.curse; i++) t.pendingCurses++;
    for (i = 0; i < out.shell; i++) {
      var leader = game.me.lines >= game.tesla.lines ? game.me : game.tesla;
      sendAttack(from, SHELL_LINES, leader);
      flashText((leader === game.me ? 'You' : 'Tesla') + ' got Blue Shelled!', leader !== game.me);
    }
  }

  function toppedOut(p) {
    beep(140, 0.4, 'sawtooth', 0.06);
    p.streak = 0; p.streakLeft = 0;
    if (p === game.me && api.haptic) api.haptic([40, 60, 40]);
    if (!p.versus) {
      if (p.f.secondWind && !p.secondWindUsed) {
        // Second Wind (solo): the top of the well is wiped once and play carries on.
        p.secondWindUsed = true;
        for (var r = 0; r < 12; r++) p.board[r].fill(0);
        p.spawn();
        p.flash = 0.6;
        flashText('Second wind!');
        return;
      }
      p.finish = 'topout';
      return endSolo(p);
    }
    p.losses++;
    if (p.losses >= p.lives) {
      p.alive = false;
      p.piece = null;
      return finish(other(p));
    }
    p.reset(false);   // keeps lines: a top-out costs your stack and a life, not your progress
    flashText(p === game.me ? 'You lost a life' : 'Tesla lost a life', p !== game.me);
  }

  function celebrate() {
    beep(784, 0.15, 'triangle', 0.05);
    setTimeout(function () { beep(988, 0.15, 'triangle', 0.05); }, 140);
    setTimeout(function () { beep(1319, 0.35, 'triangle', 0.05); }, 280);
    if (ui) ui.prisonerWrap.classList.add('free');
  }

  function finish(winner) {
    game.over = true;
    game.winner = winner;
    held = {};
    var won = winner === game.me;
    if (won) {
      celebrate();
      if (api.onWin) api.onWin({ time: game.t, lines: game.me.lines, story: !!cfg.story });
    } else beep(196, 0.6, 'sawtooth', 0.05);
    setTimeout(function () { if (game && game.over) showResult(); }, won ? 1300 : 700);
  }

  function endSolo(p) {
    game.over = true;
    held = {};
    var good = p.finish === 'sprint' || p.finish === 'dig' || p.finish === 'time';
    if (good) celebrate(); else beep(196, 0.6, 'sawtooth', 0.05);
    setTimeout(function () { if (game && game.over) showResult(); }, good ? 1100 : 700);
  }

  /* ---------- input ---------- */

  function doAction(a) {
    var p = game && game.me;
    if (!p || !game.started || game.paused || game.over || !p.alive || !p.piece || p.frozen > 0) return;
    if (a === 'left') p.move(-1);
    else if (a === 'right') p.move(1);
    else if (a === 'soft') p.softDrop();
    else if (a === 'cw') p.rotate(1);
    else if (a === 'ccw') p.rotate(-1);
    else if (a === 'hard') afterLock(p, p.hardDrop());
    else if (a === 'hold') p.holdPiece();
  }
  function press(a) {
    if (a === 'menu') return toggleMenu();
    if (a === 'skulls') return showSkulls();
    if (held[a]) return;
    if (a === 'left' || a === 'right' || a === 'soft') held[a] = { t: 0, r: 0 };
    doAction(a);
  }
  function release(a) { delete held[a]; }

  var KEYS = { arrowleft: 'left', arrowright: 'right', arrowdown: 'soft', arrowup: 'hard', ' ': 'hard', x: 'cw', z: 'ccw', control: 'ccw',
    c: 'hold', shift: 'hold', escape: 'menu', p: 'menu', tab: 'skulls' };
  function onKey(e) {
    if (!game || e.target.closest && e.target.closest('input, textarea')) return;
    var a = KEYS[e.key === ' ' ? ' ' : String(e.key).toLowerCase()];
    if (!a) return;
    if (ui && ui.panel && a !== 'menu') return;   // menus take taps, not game keys
    e.preventDefault();
    if (e.type === 'keyup') return release(a);
    if (e.repeat) return;
    press(a);
  }

  // Touch pad: a diamond D-pad you can roll your thumb across (left / right move, down soft drops, up hard drops),
  // and Rotate, Drop and Hold climbing diagonally to the right. The Menu pill sits at the bottom between them.
  function bindPad(pad) {
    var dpad = pad.querySelector('.cg-dpad'), dirOf = {};
    function dirAt(e) {
      var r = dpad.getBoundingClientRect(), x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(x, y) < r.width * 0.12) return null;
      return Math.abs(x) > Math.abs(y) ? (x < 0 ? 'left' : 'right') : (y < 0 ? 'hard' : 'soft');
    }
    function setDir(id, d) {
      var was = dirOf[id];
      if (was === d) return;
      if (was) { release(was); dpad.classList.remove('d-' + was); }
      dirOf[id] = d;
      if (d) { dpad.classList.add('d-' + d); press(d); if (api.haptic) api.haptic(6); }
    }
    dpad.addEventListener('pointerdown', function (e) { e.preventDefault(); try { dpad.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } setDir(e.pointerId, dirAt(e)); });
    dpad.addEventListener('pointermove', function (e) { if (e.pointerId in dirOf) setDir(e.pointerId, dirAt(e)); });
    function upD(e) { if (!(e.pointerId in dirOf)) return; setDir(e.pointerId, null); delete dirOf[e.pointerId]; }
    dpad.addEventListener('pointerup', upD);
    dpad.addEventListener('pointercancel', upD);
    pad.querySelectorAll('[data-act]').forEach(function (b) {
      var a = b.getAttribute('data-act');
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); b.classList.add('down'); press(a); if (api.haptic) api.haptic(6); });
      function up() { b.classList.remove('down'); release(a); }
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    });
    pad.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  /* ---------- pixel art ---------- */

  // Portraits share the same 22x25 pixel grid so they work in the HUD and in the lab scene.
  var NIC = [
    '.........ooooo........',
    '......ooohhHooo.......',
    '....oohhHhhhhhhHo.....',
    '...oohhHhHhhhhhhho....',
    '...oohhhhHhhhhhhhhho..',
    '..oohhhHhhhhhHhhhhhho.',
    '..ooohhhHHhhHHhhhhho..',
    '..oohhhLLLMMLLhhhho...',
    '...ohhLLLMMMMMMLhhho..',
    '...ohhLLLMMMLMMSho....',
    '...ohMMMrrLLLrrMSho...',
    '...ohMrrrLLLLrrrMho...',
    '..oMSMwiMLLwiiMSho....',
    '..oMSMMMMMLLMMMMSo....',
    '...oSSMMMMMMSMMMSSo...',
    '...oDSMMMMSSSMMSSoo...',
    '....oDSSMSMMSSSSDoo...',
    '....oDSSSSmmmmSSDoo...',
    '.....oDDSSmmmSSDDoo...',
    '......ooDDSSSSDDoo....',
    '.......oDDDSSDDooo....',
    '.....oovvDDDDvvoo.....',
    '...ookQvvWDDWvvQkoo...',
    '..okQvkkvWtWvkvQkko...',
    '.okvkQvkkWtWkkQvkkko..'
  ];
  var NIC_PAL = { o: '#160c26', h: '#603153', H: '#dd7771', L: '#ffe9be', M: '#ffb28d', S: '#d26081', D: '#87406c', r: '#48203e', w: '#fff1d1', i: '#27557a', m: '#783153', k: '#34284c', v: '#6b3f70', Q: '#ed6b99', W: '#fef3dc', t: '#eb4e78' };

  var TESLA = [
    '.......ooooooo........',
    '.....ooohHhhooo.......',
    '....oohhHHhHhhho......',
    '...ohhhHHhhHhhhho.....',
    '...ohhhHhHhhhhhho.....',
    '...ohhhHLLLhhhhhho....',
    '...ohhLLLLLLLLhhho....',
    '...ohhLLLMLLLLhhho....',
    '...ohMLrrLMLrrMSho....',
    '...ohMMrwiMLiwrSho....',
    '...oSMMMMMLLMMSSho....',
    '....oSSMMMMMSSMSSo....',
    '....oSSMMMSSSMSSSo....',
    '....oSSMMrrrrMSSoo....',
    '.....oSMrrrrrrrSoo....',
    '.....oDSMMSSMMDDoo....',
    '......oDDSMMSSDDoo....',
    '.......ooDDSSDDooo....',
    '........ovDDDDSvoo....',
    '......oovvWDDWvvoo....',
    '....ookvkvWtWvkvkoo...',
    '...okkvQkkWtWkkQvkkoo.',
    '..okkvkkQWtWQkkvkkkko.',
    '..okkkQkkkkttkkkkkkkko',
    '..okkkkkkkkttkkkkkkkko'
  ];
  var TESLA_PAL = { o: '#0d1425', h: '#23213b', H: '#427a8b', L: '#eafadc', M: '#bce0be', S: '#739b9c', D: '#525878', r: '#23203b', w: '#fff5d8', i: '#304b69', k: '#172344', v: '#224c60', Q: '#399395', W: '#e7fff0', t: '#8d4cc0' };

  function pixelCanvas(map, pal, scale, pad) {
    pad = pad || 0;
    var w = map[0].length, hgt = map.length, c = document.createElement('canvas');
    c.width = (w + pad * 2) * scale; c.height = (hgt + pad * 2) * scale;
    var x = c.getContext('2d');
    map.forEach(function (row, y) {
      for (var i = 0; i < w; i++) { var col = pal[row[i]]; if (!col) continue; x.fillStyle = col; x.fillRect((i + pad) * scale, (y + pad) * scale, scale, scale); }
    });
    return c;
  }

  function cageCanvas(w, hgt, scale) {
    var c = document.createElement('canvas');
    c.width = w * scale;
    c.height = hgt * scale;
    var ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    function box(x, y, width, height, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, width, height);
    }

    // Set the inner bars behind the steel rim and keep the center of the face readable.
    [5, 11, 17, w - 6].forEach(function (x) {
      box(x + 1, 3, 1, hgt - 6, 'rgba(16, 26, 45, 0.65)');
      box(x, 3, 1, hgt - 6, 'rgba(132, 180, 199, 0.64)');
      box(x, 4, 1, 4, '#c3deea');
    });
    box(0, 2, 3, hgt - 4, '#20273b');
    box(w - 3, 2, 3, hgt - 4, '#20273b');
    box(1, 3, 1, hgt - 6, '#729ab3');
    box(w - 2, 3, 1, hgt - 6, '#52768e');
    [0, hgt - 4].forEach(function (y) {
      box(1, y, w - 2, 4, '#20273b');
      box(2, y + 1, w - 4, 1, '#a5c9d3');
      box(2, y + 2, w - 4, 1, '#52768e');
      box(3, y + 2, 1, 1, '#ffe5aa');
      box(w - 4, y + 2, 1, 1, '#ffe5aa');
    });
    return c;
  }

  function lockCanvas(scale) {
    return pixelCanvas([
      '.osso.', 'os..so', 'os..so', 'oyyyyo',
      'oYggyO', 'oYgkyO', 'oYgkyO', '.OOOO.'
    ], { o: '#302039', O: '#825232', s: '#9ec2d4', y: '#e0a352', Y: '#ffe69d', g: '#c58242', k: '#302039' }, scale);
  }

  /* ---------- Fullscreen prologue ---------- */

  var FILM_HEIGHT = 192;
  var FILM_END = 8.1;
  var FILM_SHOTS = [
    { id: 'lab', at: 0, description: 'Nic stands in front of Tesla’s coil.' },
    { id: 'blackout', at: 1.35, description: 'The lights go out.' },
    { id: 'sparks', at: 1.85, description: 'Sparks from the coil light the lab blue.' },
    { id: 'flash', at: 3.35, description: 'A flash engulfs Nic and the coil.' },
    { id: 'caged', at: 3.57, description: 'Nic grabs the bars of a locked cage.' },
    { id: 'tesla', at: 5.95, description: 'The camera pulls back to a grinning Tesla. Tesla says, “Cage Escape.”' }
  ];

  function characterImage(name, cls, map, palette) {
    var image = el('img', cls);
    image.alt = '';
    image.addEventListener('error', function () {
      image.src = pixelCanvas(map, palette, 3, 1).toDataURL();
    }, { once: true });
    image.src = DIR + 'art/' + name;
    return image;
  }

  function imageReady(image) { return image.complete && image.naturalWidth > 0; }

  function filmBox(ctx, x, y, w, hgt, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(hgt));
  }

  function filmBackdrop(width) {
    var canvas = el('canvas');
    canvas.width = width;
    canvas.height = FILM_HEIGHT;
    var ctx = canvas.getContext('2d');
    var mid = Math.floor(width / 2);
    function box(x, y, w, hgt, color) { filmBox(ctx, x, y, w, hgt, color); }
    box(0, 0, width, FILM_HEIGHT, '#20132f');
    box(0, 9, width, 3, '#623153');
    box(0, 12, width, 2, '#b64b7b');
    box(0, 15, width, 9, '#312342');
    for (var x = 5; x < width; x += 24) {
      box(x, 23, 1, 91, '#3b294a');
      box(x + 1, 24, 1, 91, '#25182f');
    }

    // Neon skyline behind the safety glass, left of the coil.
    var win = mid - 64;
    box(win, 36, 53, 54, '#110f26');
    box(win + 2, 38, 49, 50, '#8d366a');
    box(win + 3, 62, 47, 24, '#db657e');
    box(win + 3, 74, 47, 12, '#fb997e');
    box(win + 29, 55, 9, 12, '#ffbe9a');
    box(win + 27, 57, 13, 8, '#ffbe9a');
    for (var i = 0; i < 7; i++) {
      var roof = 69 + (i * 7 % 12);
      box(win + 3 + i * 7, roof, 7, 86 - roof, '#44294f');
      if (i % 2 === 0) box(win + 4 + i * 7, roof + 2, 1, 1, '#ffd4ae');
    }
    box(win + 25, 37, 1, 51, '#623246');
    box(win, 89, 53, 2, '#d86c99');

    // Breaker and conduit behind Tesla’s workbench.
    var panel = mid + 23;
    box(mid - 10, 27, 74, 2, '#624968');
    box(panel + 5, 29, 2, 24, '#624968');
    box(panel, 52, 20, 28, '#10152b');
    box(panel + 1, 53, 18, 25, '#33435a');
    box(panel + 3, 56, 14, 9, '#19233a');
    box(panel + 5, 58, 3, 2, '#72e5d7');
    box(panel + 11, 58, 2, 2, '#ff8f8c');
    box(panel + 4, 71, 11, 2, '#59627b');

    box(0, 112, width, 5, '#362342');
    box(0, 116, width, 1, '#844265');
    box(0, 117, width, FILM_HEIGHT - 117, '#251933');
    for (var row = 0; row < 7; row++) {
      for (var col = (row % 2) * 8 - 8; col < width; col += 16) {
        var y = 118 + row * 11;
        box(col, y, 15, 10, (row + col) % 3 ? '#492b4e' : '#3c284a');
        box(col + ((col + row * 3) & 7), y + 6, 1, 1, '#6c3c62');
      }
    }
    return canvas;
  }

  function shotAt(time) {
    for (var i = FILM_SHOTS.length - 1; i > 0; i--) {
      if (time >= FILM_SHOTS[i].at) return FILM_SHOTS[i];
    }
    return FILM_SHOTS[0];
  }

  function resizeCutscene() {
    var scene = ui.scene;
    if (!scene) return;
    var rect = scene.canvas.getBoundingClientRect();
    if (!rect.height) return;
    var width = Math.max(1, Math.round(FILM_HEIGHT * rect.width / rect.height));
    if (scene.backdrop && width === scene.canvas.width) return;
    scene.canvas.width = width;
    scene.canvas.height = FILM_HEIGHT;
    scene.ctx.imageSmoothingEnabled = false;
    scene.backdrop = filmBackdrop(width);
    scene.frame = -1;
  }

  function filmProp(ctx, image, frame, x, y, size) {
    if (imageReady(image)) ctx.drawImage(image, frame * 64, 0, 64, 64, Math.round(x), Math.round(y), size, size);
  }

  function filmPortrait(ctx, image, left, top, size) {
    if (imageReady(image)) ctx.drawImage(image, Math.round(left), Math.round(top), Math.round(size), Math.round(size));
  }

  function filmGlow(ctx, x, y, radius, color) {
    var glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, color);
    glow.addColorStop(1, 'transparent');
    filmBox(ctx, x - radius, y - radius, radius * 2, radius * 2, glow);
  }

  function filmArc(ctx, x, y, endX, endY, phase) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (var i = 1; i < 6; i++) {
      var f = i / 6;
      ctx.lineTo(Math.round(x + (endX - x) * f + Math.sin(i * 8 + phase) * 8), Math.round(y + (endY - y) * f));
    }
    ctx.lineTo(endX, endY);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#307af2';
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#b9faff';
    ctx.stroke();
  }

  function drawOpening(scene, shot) {
    var ctx = scene.ctx, width = scene.canvas.width, mid = width / 2;
    var coilSize = 130, coilY = 4;
    var nicSize = Math.min(width * 0.94, 111);
    var nicTop = 180 - nicSize;
    var frame = Math.floor(scene.time * 7);
    var charged = shot.id === 'sparks' || shot.id === 'flash';
    ctx.drawImage(scene.backdrop, 0, 0);

    // Crop out the idle sprite's stray sparks while the room lights are still on.
    ctx.save();
    ctx.beginPath();
    ctx.rect(mid - 20, coilY, 40, coilSize);
    ctx.clip();
    filmProp(ctx, scene.coil, 0, mid - coilSize / 2, coilY, coilSize);
    ctx.restore();

    filmPortrait(ctx, scene.nic, mid - nicSize / 2, nicTop, nicSize);
    if (shot.id === 'lab') return;

    filmBox(ctx, 0, 0, width, FILM_HEIGHT, '#030720e8');
    if (!charged) return;
    var strength = 0.37 + 0.09 * Math.sin(scene.time * 12);
    filmGlow(ctx, mid, 39, 99, 'rgba(54, 140, 255, ' + strength + ')');
    filmGlow(ctx, mid, 105, 78, 'rgba(45, 86, 237, 0.23)');
    ctx.save();
    ctx.filter = 'grayscale(1) sepia(1) hue-rotate(165deg) saturate(2.2) brightness(0.72)';
    filmProp(ctx, scene.coil, frame % 4, mid - coilSize / 2, coilY, coilSize);
    filmPortrait(ctx, scene.nic, mid - nicSize / 2, nicTop, nicSize);
    ctx.restore();

    filmArc(ctx, mid - 1, 30, mid - 13, 67, frame);
    filmArc(ctx, mid + 3, 32, mid + 13, nicTop + 24, frame + 7);
    if (shot.id === 'flash') {
      // One brief cyan exposure bridges the cut, without a white strobe.
      var peak = 1 - Math.abs((scene.time - shot.at) / 0.22 * 2 - 1);
      filmGlow(ctx, mid, 61, 116, 'rgba(174, 245, 255, ' + Math.max(0, peak) * 0.82 + ')');
      filmArc(ctx, mid, 30, mid, nicTop + 24, 12);
    }
  }

  function gripBar(ctx, x, y, scale, facing) {
    var half = 3.4 * scale;
    filmBox(ctx, x - half, y, half * 2, 7 * scale, '#491f42');
    filmBox(ctx, x - half + scale, y + scale, half * 2 - 2 * scale, 5 * scale, '#c76973');
    for (var finger = 0; finger < 3; finger++) {
      filmBox(ctx, x - half + scale + (facing ? scale : 0), y + (1 + finger * 1.5) * scale, half * 2 - 3 * scale, scale, '#ffb493');
    }
    filmBox(ctx, x + facing * half - scale, y + 4 * scale, 2 * scale, 3 * scale, '#ffce9e');
  }

  function drawCapture(scene) {
    var ctx = scene.ctx, width = scene.canvas.width;
    var pull = Math.max(0, Math.min(1, (scene.time - 4.88) / 1.04));
    pull = pull * pull * (3 - 2 * pull);
    var base = Math.min(1.38, width / 86);
    var zoom = base * (2.85 - 1.85 * pull);
    var x = width / 2 - 19 * base * pull;
    var y = 94 + 14 * pull;
    var left = x - 13 * zoom, top = y - 17 * zoom;
    var crop = 1 / (1 + 0.24 * (1 - pull));
    var roomWidth = width * crop, roomHeight = FILM_HEIGHT * crop;
    ctx.drawImage(scene.backdrop, (width - roomWidth) / 2, (FILM_HEIGHT - roomHeight) / 2, roomWidth, roomHeight,
      0, 0, width, FILM_HEIGHT);
    filmBox(ctx, 0, 0, width, FILM_HEIGHT, '#120a25aa');
    filmGlow(ctx, x, y, 79, 'rgba(81, 145, 241, 0.29)');

    // This shot starts on the bars and widens to fit Tesla in the same room.
    var teslaX = x + 40 * zoom + (1 - pull) * Math.max(0, width / 2 - 36);
    var teslaSize = 41 * zoom;
    if (teslaX - teslaSize / 2 < width) {
      filmGlow(ctx, teslaX, y + 1, 48, 'rgba(221, 61, 153, 0.34)');
      filmBox(ctx, teslaX - 18 * zoom, y + 15.5 * zoom, 38 * zoom, 2.4 * zoom, '#160e24');
      filmPortrait(ctx, scene.tesla, teslaX - teslaSize / 2, y - 24 * zoom, teslaSize);
    }
    filmPortrait(ctx, scene.nic, x - 12.5 * zoom, top + 7 * zoom, 25 * zoom);
    ctx.drawImage(scene.cage, Math.round(left), Math.round(top), Math.round(26 * zoom), Math.round(35 * zoom));
    gripBar(ctx, left + 5 * zoom, top + 20 * zoom, zoom, 1);
    gripBar(ctx, left + 20 * zoom, top + 20.5 * zoom, zoom, -1);
    ctx.drawImage(scene.lock, Math.round(x - 3 * zoom), Math.round(top + 27 * zoom), Math.round(6 * zoom), Math.round(8 * zoom));
  }

  function tickCutscene(dt) {
    var scene = ui.scene;
    if (!scene.backdrop || (!scene.still && document.hidden)) return;
    var assetState = [scene.nic, scene.tesla, scene.coil].map(function (image) {
      return imageReady(image) ? '1' : '0';
    }).join('');
    if (!scene.still) {
      if (assetState !== '111' && scene.wait < 0.75) scene.wait += dt;
      else scene.time += dt;
    }
    if (scene.time >= FILM_END) { finishCutscene(); return; }
    var shot = shotAt(scene.time);
    if (scene.shot !== shot) {
      scene.shot = shot;
      scene.panel.dataset.shot = shot.id;
      scene.summary.textContent = shot.description;
      scene.quote.hidden = shot.id !== 'tesla';
    }
    var frame = Math.floor(scene.time * 24);
    if (scene.frame === frame && scene.assetState === assetState) return;
    if (shot.id === 'caged' || shot.id === 'tesla') drawCapture(scene);
    else drawOpening(scene, shot);
    scene.frame = frame;
    scene.assetState = assetState;
  }

  function showCutscene() {
    closePanel();
    ui.root.classList.add('in-cutscene');
    var p = el('div', 'cg-panel cutscene');
    var film = el('canvas', 'cg-film');
    film.setAttribute('aria-hidden', 'true');
    p.appendChild(film);

    var summary = el('p', 'cg-film-summary');
    summary.setAttribute('aria-live', 'polite');
    summary.setAttribute('aria-atomic', 'true');
    p.appendChild(summary);
    var quote = el('div', 'cg-cinematic-quote');
    quote.setAttribute('aria-hidden', 'true');
    quote.appendChild(el('b', null, 'Tesla'));
    quote.appendChild(el('span', null, 'Cage Escape.'));
    quote.hidden = true;
    p.appendChild(quote);

    var still = reducedEffects || api.reduceMotion;
    var skip = btn(still ? 'Continue' : 'Skip intro', 'cg-film-skip', finishCutscene);
    p.appendChild(skip);
    ui.root.appendChild(p);
    ui.panel = p;
    var coil = new Image();
    coil.src = DIR + 'art/tesla-coil.png';
    ui.scene = {
      panel: p, canvas: film, ctx: film.getContext('2d'),
      nic: ui.nicFace, tesla: ui.teslaFace, coil: coil,
      cage: cageCanvas(26, 35, 1), lock: lockCanvas(1),
      time: still ? 6.5 : 0, wait: 0, still: still, summary: summary, quote: quote
    };
    resizeCutscene();
    tickCutscene(0);
    skip.focus({ preventScroll: true });
  }

  function finishCutscene() {
    if (!ui || !ui.scene) return;
    ui.scene = null;
    ui.root.classList.remove('in-cutscene');
    ui.root.classList.add('after-cutscene');
    layout();
    showIntro();
    ui.panel.querySelector('.cg-btn.primary').focus({ preventScroll: true });
  }

  /* ---------- drawing (ported from tetris.js drawPlayer, minus streak flames) ---------- */

  function fillFor(ctx, p, row, cell) {
    var key = p.palette.bottom + p.palette.top + cell;
    if (!p._fills || p._fillKey !== key || p._fillCtx !== ctx) {
      p._fillKey = key; p._fillCtx = ctx; p._fills = [];
      for (var r = 0; r < ROWS; r++) {
        var base = blockColor(p, r), g = ctx.createLinearGradient(0, r * cell + 1, 0, (r + 1) * cell - 1);
        g.addColorStop(0, mix(base, p.palette.top, 0.65));
        g.addColorStop(1, mix(base, p.palette.bottom, 0.65));
        p._fills.push(g);
      }
    }
    return p._fills[row];
  }

  function drawWell(ctx, p, cell, mini, now) {
    var W = COLS * cell, H = ROWS * cell, r, c;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(6, 4, 10, 0.72)';
    ctx.fillRect(0, 0, W, H);
    if (!mini) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
      ctx.lineWidth = 1;
      for (c = 1; c < COLS; c++) { ctx.beginPath(); ctx.moveTo(c * cell + 0.5, 0); ctx.lineTo(c * cell + 0.5, H); ctx.stroke(); }
      for (r = 1; r < ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * cell + 0.5); ctx.lineTo(W, r * cell + 0.5); ctx.stroke(); }
    }
    // Lights Out: the stack shows for a second after each lock, then fades into the dark.
    var vis = 1;
    if (p.f.lightsOut && p.alive && !game.over) vis = 1 - clamp01((now - p.lockedAt - 1000) / 900);
    if (vis > 0.01) for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
      var v = p.board[r][c];
      if (!v) continue;
      drawBlock(ctx, c * cell, r * cell, cell, v === GARBAGE ? '#3a3350' : fillFor(ctx, p, r, cell), vis);
      if (v >= CELL_POWER && vis > 0.5 && !mini) drawPowerIcon(ctx, c * cell, r * cell, cell, v - CELL_POWER + 1, now);
    }
    if (p.frozen > 0) { ctx.fillStyle = 'rgba(180, 230, 255, 0.28)'; ctx.fillRect(0, 0, W, H); }
    drawFx(ctx, p, cell, now);
    if (p.flash) { ctx.fillStyle = 'rgba(255, 255, 255,' + p.flash * 0.8 + ')'; ctx.fillRect(0, 0, W, H); }

    if (p.piece && p.alive && !p.f.noGhost) {
      var gy = p.ghostY();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'; ctx.lineWidth = 1.5;
      p.cells(p.piece.x, gy, p.piece.rot).forEach(function (q) { if (q[1] >= 0) ctx.strokeRect(q[0] * cell + 2.5, q[1] * cell + 2.5, cell - 5, cell - 5); });
    }
    if (p.piece && p.alive) {
      p.cells(p.piece.x, p.piece.y, p.piece.rot).forEach(function (q, i) {
        if (q[1] < 0) return;
        drawBlock(ctx, q[0] * cell, q[1] * cell, cell, fillFor(ctx, p, Math.max(0, q[1]), cell));
        if (p.piece.power && i === p.piece.powerCell && !mini) drawPowerIcon(ctx, q[0] * cell, q[1] * cell, cell, p.piece.power, now);
      });
    }
    if (p.incoming) { var mh = Math.min(ROWS, p.incoming) * cell; ctx.fillStyle = '#ff3355'; ctx.fillRect(0, H - mh, mini ? 2 : 4, mh); }
    ctx.strokeStyle = mini ? 'rgba(76, 201, 255, 0.55)' : 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    if (!p.alive) {
      ctx.fillStyle = 'rgba(5, 5, 5, 0.75)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ff9ac8'; ctx.textAlign = 'center';
      ctx.font = '800 ' + Math.round(cell * 1.1) + 'px "JetBrains Mono", monospace';
      ctx.fillText('OUT', W / 2, H / 2);
    }
  }

  // Power glows, Birthday Party confetti and a flash on cleared rows (tetris.js keeps these in p.fx).
  function drawFx(ctx, p, cell, now) {
    p.fx = p.fx.filter(function (f) { return now - f.t < 1100; });
    p.fx.forEach(function (f) {
      var k = (now - f.t) / 1000;
      if (f.kind === 'clear') {
        var a = Math.max(0, 0.6 - k * 2.2);
        if (a <= 0) return;
        ctx.fillStyle = f.tetris ? 'rgba(255, 240, 200,' + a + ')' : 'rgba(255, 255, 255,' + a + ')';
        f.rows.forEach(function (row) { ctx.fillRect(0, row * cell, COLS * cell, cell); });
      } else if (f.kind === 'confetti') {
        f.cells.forEach(function (q, i) {
          var hue = (i * 47) % 360, y = q[0] * cell + k * k * 300 + Math.sin(i + k * 9) * 6;
          ctx.fillStyle = 'hsla(' + hue + ', 90%, 65%,' + Math.max(0, 1 - k) + ')';
          ctx.fillRect(q[1] * cell + (i % 3) * cell / 3, y, cell / 4, cell / 4);
        });
      } else if (f.cells) {
        ctx.fillStyle = POWER_COLOUR[f.kind] || '#fff';
        ctx.globalAlpha = Math.max(0, 0.55 - k * 0.8);
        f.cells.forEach(function (q) { ctx.fillRect(q[1] * cell, q[0] * cell, cell, cell); });
        ctx.globalAlpha = 1;
      }
    });
  }

  function drawSide(p) {
    var hc = ui.holdCv, hx = hc.getContext('2d'), nc = ui.nextCv, nx = nc.getContext('2d'), s = ui.cell;
    hx.setTransform(dpr, 0, 0, dpr, 0, 0); nx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hx.clearRect(0, 0, hc.width, hc.height); nx.clearRect(0, 0, nc.width, nc.height);
    var w = hc.width / dpr;
    if (p.hold && !p.f.noHold) drawMini(hx, p.hold, w / 2, s * 1.3, s * 0.5, p.canHold ? blockColor(p, 6) : '#3a3350');
    if (!p.f.blind) p.queue.slice(0, 4).forEach(function (t, i) { drawMini(nx, t, w / 2, s * (1.3 + i * 2.1), s * (i ? 0.42 : 0.5), blockColor(p, 6 + i)); });
  }

  var shown = {};
  function setText(el, key, text) { if (shown[key] !== text) { shown[key] = text; el.textContent = text; } }
  function setBar(fill, key, frac) { var w = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%'; if (shown[key] !== w) { shown[key] = w; fill.style.width = w; } }
  function hearts(p) { return p.versus ? new Array(Math.max(0, p.lives - p.losses) + 1).join('♥') : ''; }

  function render(now) {
    var me = game.me, te = game.tesla;
    var mx = ui.wellCv.getContext('2d'); mx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWell(mx, me, ui.cell, false, now);
    if (te) { var tx = ui.teslaCv.getContext('2d'); tx.setTransform(dpr, 0, 0, dpr, 0, 0); drawWell(tx, te, ui.mini, true, now); }
    drawSide(me);
    var gt = me.gameType;
    setText(ui.timer, 'timer', !game.race && gt === GT.ULTRA ? clock(Math.max(0, ULTRA_SECONDS - game.t)) + ' left' : clock(game.t));
    if (game.race) {
      setText(ui.rowA.label, 'al', 'You'); setText(ui.rowA.n, 'an', Math.min(cfg.lines, me.lines) + '/' + cfg.lines); setBar(ui.rowA.fill, 'aw', me.lines / cfg.lines);
      setText(ui.rowA.lives, 'av', hearts(me));
      setText(ui.rowB.label, 'bl', 'Tesla'); setText(ui.rowB.n, 'bn', Math.min(cfg.lines, te.lines) + '/' + cfg.lines); setBar(ui.rowB.fill, 'bw', te.lines / cfg.lines);
      setText(ui.rowB.lives, 'bv', hearts(te));
      setText(ui.teslaLives, 'tv', hearts(te));
    } else {
      var goal = gt === GT.SPRINT ? me.lines / SPRINT_LINES : gt === GT.DIG ? 1 - me.garbageRows() / DIG_ROWS : gt === GT.ULTRA ? game.t / ULTRA_SECONDS : (me.lines % 10) / 10;
      setText(ui.rowA.label, 'al', gt === GT.SPRINT ? 'Lines' : gt === GT.DIG ? 'Dig' : gt === GT.ULTRA ? 'Time' : 'Lvl ' + me.level);
      setText(ui.rowA.n, 'an', gt === GT.SPRINT ? Math.min(SPRINT_LINES, me.lines) + '/' + SPRINT_LINES : gt === GT.DIG ? me.garbageRows() + ' left' : gt === GT.ULTRA ? Math.round(game.t / ULTRA_SECONDS * 100) + '%' : me.lines + ' lines');
      setBar(ui.rowA.fill, 'aw', goal);
      setText(ui.rowA.lives, 'av', '');
      setText(ui.rowB.label, 'bl', 'Score'); setText(ui.rowB.n, 'bn', String(me.score)); setBar(ui.rowB.fill, 'bw', 0);
      setText(ui.rowB.lives, 'bv', '×' + me.multiplier);
    }
    var st = [];
    if (me.frozen > 0) st.push('frozen ' + Math.ceil(me.frozen) + 's');
    if (me.haste > 0) st.push('haste ' + Math.ceil(me.haste) + 's');
    if (me.slow > 0) st.push('slow ' + Math.ceil(me.slow) + 's');
    if (me.double > 0) st.push('2× ' + Math.ceil(me.double) + 's');
    if (me.alive && game.started && me.f.fuse) st.push('fuse ' + Math.ceil(FUSE_SECONDS - me.fuseClock) + 's');
    if (me.alive && game.started && me.f.storm) st.push('storm ' + Math.ceil(STORM_INTERVAL - me.stormClock) + 's');
    setText(ui.status, 'status', st.join(' · '));
    var cd = !game.started && !game.paused ? String(Math.max(1, Math.ceil(game.count))) : '';
    setText(ui.count, 'count', cd);
    ui.count.classList.toggle('on', !!cd);
    if (te) ui.teslaFace.classList.toggle('zap', now - (ui.zapAt || 0) < 350);
    var free = ui.prisonerWrap.classList.contains('free');
    setText(ui.bubble, 'bubble', free ? 'FREE!' : !game.race ? 'GO GO GO!' : me.lines >= cfg.lines * 0.75 ? 'SO CLOSE!' : te.lines > me.lines + 5 ? 'HURRY!' : 'HELP!');
  }

  function clock(s) {
    var m = Math.floor(s / 60), r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
  }
  function zap() { if (ui) ui.zapAt = performance.now(); beep(1800, 0.05, 'sawtooth', 0.015); }

  var flashTimer = 0;
  function flashText(text, foe) {
    if (!ui) return;
    ui.flash.textContent = text;
    ui.flash.classList.toggle('foe', !!foe);
    ui.flash.classList.remove('on'); void ui.flash.offsetWidth; ui.flash.classList.add('on');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { if (ui) ui.flash.classList.remove('on'); }, 1100);
  }

  /* ---------- layout ---------- */

  // Focus view: your well in the middle with Hold on its left and Next on its right; the opponent's mini well sits
  // in the top-left corner beside the race bars, Nic's cage in the top-right.
  function layout() {
    if (!ui) return;
    dpr = Math.min(3, window.devicePixelRatio || 1);
    ui.root.classList.toggle('solo', !game || !game.race);
    var st = ui.stage, W = st.clientWidth, H = st.clientHeight - 4;
    // across: hold (2.4 cells) + well (10) + next (2.4), plus ~36px of gaps and padding
    var cell = Math.floor(Math.max(10, Math.min(H / ROWS, (W - 36) / 14.8)));
    ui.cell = cell;
    ui.mini = 5;
    function size(cv, w, hgt) { cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); cv.style.width = w + 'px'; cv.style.height = hgt + 'px'; }
    size(ui.wellCv, COLS * cell, ROWS * cell);
    size(ui.teslaCv, COLS * ui.mini, ROWS * ui.mini);
    size(ui.holdCv, Math.round(cell * 2.4), Math.round(cell * 2.6));
    size(ui.nextCv, Math.round(cell * 2.4), Math.round(cell * 8.6));
    ui.root.style.setProperty('--cell', cell + 'px');
    var me = game && game.me;
    ui.holdLbl.textContent = me && me.f.noHold ? 'NO HOLD' : 'HOLD';
    ui.nextLbl.textContent = me && me.f.blind ? 'BLIND' : 'NEXT';
  }

  /* ---------- screens: intro, setup, menu, skulls, result ---------- */

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, cls, fn) { var b = el('button', 'cg-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function skullIcon(s) { var i = el('span', 'cg-skull'); i.style.backgroundPosition = (s.index / (SKULLS.length - 1) * 100) + '% 0'; i.title = s.name; return i; }

  function panel(cls) {
    closePanel();
    var p = el('div', 'cg-panel ' + (cls || ''));
    var card = el('div', 'cg-card');
    p.appendChild(card);
    ui.root.appendChild(p);
    ui.panel = p;
    return card;
  }
  function closePanel() { if (ui && ui.panel) { ui.panel.remove(); ui.panel = null; } }
  function panelIs(name) { return !!(ui && ui.panel && ui.panel.classList.contains(name)); }

  function showIntro() {
    var c = panel('intro');
    c.appendChild(el('div', 'cg-kicker', 'scuffed_dev presents'));
    c.appendChild(el('h2', 'cg-title', 'CAGE ESCAPE'));
    c.appendChild(el('p', null, 'Nikola Tesla has locked Nicolas Cage in a cage. Clear ' + STORY.lines + ' lines before Tesla does to set him free.'));
    var sk = el('div', 'cg-skullrow');
    STORY.skulls.forEach(function (id) { sk.appendChild(skullIcon(SKULL_BY_ID[id])); });
    c.appendChild(sk);
    c.appendChild(el('p', 'cg-small', 'You both play with every skull except Mirror. You get ' + STORY.lives + ' lives, Tesla gets ' + TESLA_LIVES + '. He is half asleep, so keep stacking and you\'ll get there.'));
    c.appendChild(el('p', 'cg-small', fine() ? 'Keys: ← → move · ↓ soft drop · ↑ / Space hard drop · Z / X rotate · C hold · Esc menu · Tab skulls'
      : 'D-pad moves (↑ hard drops, ↓ soft drops) · the big button rotates · Drop · Hold · Menu pauses'));
    var row = el('div', 'cg-row');
    row.appendChild(btn('Back to app', '', function () { close(); }));
    row.appendChild(btn('Free Nic', 'primary', function () { closePanel(); begin(STORY); }));
    c.appendChild(row);
  }

  // Custom game (once Cage Escape is unlocked): race Tesla or play solo, with any skulls. Remembered per phone.
  function showSetup() {
    var s = stored(SETUP_KEY) || {};
    var pick = {
      mode: s.mode === 'solo' ? 'solo' : 'race',
      lines: [20, 40, 60, 100].indexOf(s.lines) >= 0 ? s.lines : 40,
      cpu: Cpu.LEVELS[s.cpu] ? s.cpu : 'story',
      lives: [1, 3, 5].indexOf(s.lives) >= 0 ? s.lives : 3,
      gameType: GAME_TYPES.some(function (g) { return g[0] === s.gameType; }) ? s.gameType : GT.SPRINT,
      skulls: cleanSkulls(Array.isArray(s.skulls) ? s.skulls : STORY.skulls)
    };
    var c = panel('setup');
    c.appendChild(el('div', 'cg-kicker', 'Custom game'));
    c.appendChild(el('h2', 'cg-title sm', 'CAGE ESCAPE'));
    var body = el('div', 'cg-setup');
    c.appendChild(body);
    function chips(label, list, value, set) {
      body.appendChild(el('div', 'cg-lbl', label));
      var row = el('div', 'cg-chips');
      list.forEach(function (o) {
        var b = el('button', 'cg-chip' + (o[0] === value ? ' on' : ''), o[1]);
        b.type = 'button';
        b.addEventListener('click', function () { set(o[0]); draw(); });
        row.appendChild(b);
      });
      body.appendChild(row);
    }
    function draw() {
      body.textContent = '';
      chips('Mode', [['race', 'Race Tesla'], ['solo', 'Solo']], pick.mode, function (v) { pick.mode = v; });
      if (pick.mode === 'race') {
        chips('First to', [[20, '20 lines'], [40, '40'], [60, '60'], [100, '100']], pick.lines, function (v) { pick.lines = v; });
        chips('Tesla', CPU_CHOICES, pick.cpu, function (v) { pick.cpu = v; });
        chips('Your lives (Tesla has 1)', [[1, '1'], [3, '3'], [5, '5']], pick.lives, function (v) { pick.lives = v; });
      } else {
        chips('Game', GAME_TYPES, pick.gameType, function (v) { pick.gameType = v; });
        body.appendChild(el('p', 'cg-small left', GT_INFO[pick.gameType]));
      }
      var head = el('div', 'cg-lbl split');
      head.appendChild(el('span', null, 'Skulls · ' + pick.skulls.length + ' on · score ×' + multiplierOf(pick.skulls)));
      var quick = el('span', 'cg-quick');
      quick.appendChild(btn('All', 'mini', function () { pick.skulls = ALL_SKULLS.slice(); draw(); }));
      quick.appendChild(btn('None', 'mini', function () { pick.skulls = []; draw(); }));
      head.appendChild(quick);
      body.appendChild(head);
      var grid = el('div', 'cg-skgrid');
      SKULLS.forEach(function (sk) {
        var on = pick.skulls.indexOf(sk.id) >= 0;
        var t = el('button', 'cg-skt' + (on ? ' on' : '') + (sk.cat === 'attack' && pick.mode === 'solo' ? ' na' : ''));
        t.type = 'button';
        t.title = sk.body;
        t.appendChild(skullIcon(sk));
        t.appendChild(el('span', null, sk.name));
        t.addEventListener('click', function () {
          if (on) pick.skulls = pick.skulls.filter(function (id) { return id !== sk.id; }); else pick.skulls.push(sk.id);
          pick.skulls = cleanSkulls(pick.skulls);
          draw();
        });
        grid.appendChild(t);
      });
      body.appendChild(grid);
      body.appendChild(el('p', 'cg-small left', pick.mode === 'solo' ? 'Freeze, Blue Shell and Curse only do something against Tesla, so they sit out solo games. The in-game Skulls list explains every skull you pick.' : 'Tesla plays with the same skulls you pick. The in-game Skulls list explains every one.'));
    }
    draw();
    var row = el('div', 'cg-row');
    row.appendChild(btn('Back to app', '', function () { close(); }));
    row.appendChild(btn('Start', 'primary', function () {
      store(SETUP_KEY, pick);
      closePanel();
      begin({ mode: pick.mode, lines: pick.lines, cpu: pick.cpu, lives: pick.lives, gameType: pick.gameType, skulls: pick.skulls.slice(), story: false });
    }));
    c.appendChild(row);
  }

  function begin(config) {
    cfg = config;
    newGame();
    shown = {};
    ui.prisonerWrap.classList.remove('free');
    layout();
  }

  // The Menu (bottom pill, Esc, or the app's top bar buttons): pauses, and gets you back to the app.
  function toggleMenu() {
    if (!game || !ui) return;
    if (panelIs('menu')) { closePanel(); if (!game.over) game.paused = false; return; }
    if (ui.scene) { finishCutscene(); return; }
    if (ui.panel) return;   // intro, setup and results have their own buttons
    if (!game.over) { game.paused = true; held = {}; }
    var c = panel('menu');
    c.appendChild(el('h2', 'cg-title sm', 'PAUSED'));
    if (game.started) c.appendChild(el('p', 'cg-small', clock(game.t) + (game.race ? ' · you ' + game.me.lines + '/' + cfg.lines + ' · Tesla ' + game.tesla.lines + '/' + cfg.lines : ' · ' + game.me.lines + ' lines · ' + game.me.score + ' pts')));
    var col = el('div', 'cg-col');
    col.appendChild(btn('Resume', 'primary', toggleMenu));
    col.appendChild(btn('Skulls', '', function () { showSkulls(); }));
    col.appendChild(btn('Restart', '', function () { closePanel(); begin(cfg); }));
    if (api.custom) col.appendChild(btn('New game setup', '', function () { showSetup(); }));
    var snd = btn(muted ? 'Sound: off' : 'Sound: on', '', function () {
      muted = !muted; try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* fine */ }
      snd.textContent = muted ? 'Sound: off' : 'Sound: on';
    });
    col.appendChild(snd);
    col.appendChild(btn('Back to scuffed_dev', 'danger', function () { close(); }));
    c.appendChild(col);
  }

  function showSkulls() {
    if (!ui || panelIs('skulls')) return;
    if (ui.panel && !panelIs('menu')) return;
    if (game && !game.over) { game.paused = true; held = {}; }
    var c = panel('skulls');
    var on = game ? game.me.skulls : [];
    c.appendChild(el('h2', 'cg-title sm', on.length + ' SKULL' + (on.length === 1 ? '' : 'S') + ' ON'));
    var list = el('div', 'cg-skulls');
    SKULLS.filter(function (s) { return on.indexOf(s.id) >= 0; }).forEach(function (s) {
      var row = el('div', 'cg-sk');
      row.appendChild(skullIcon(s));
      var t = el('div');
      t.appendChild(el('b', null, s.name));
      t.appendChild(el('span', null, s.body));
      row.appendChild(t);
      list.appendChild(row);
    });
    if (!on.length) list.appendChild(el('p', 'cg-small', 'No skulls this game: classic rules.'));
    c.appendChild(list);
    c.appendChild(btn('Back to the game', 'primary', function () { closePanel(); if (game && !game.over) game.paused = false; }));
  }

  function showResult() {
    var me = game.me, c, row = el('div', 'cg-row');
    if (game.race) {
      var won = game.winner === me;
      c = panel(won ? 'win' : 'lose');
      c.appendChild(el('h2', 'cg-title sm', won ? 'NIC IS FREE!' : 'TESLA WINS'));
      c.appendChild(el('p', null, won ? 'You cleared ' + cfg.lines + ' lines in ' + clock(game.t) + ' and broke Nicolas Cage out.'
        : me.alive ? 'Tesla cleared ' + cfg.lines + ' lines first (you had ' + me.lines + '). Nic stays caged.' : 'You ran out of lives. Nic stays caged.'));
      if (won && cfg.story && !api.custom) c.appendChild(el('p', 'cg-small', 'Cage Escape is unlocked: find it in More, and see your reward in Settings.'));
      row.appendChild(btn('Play again', won ? '' : 'primary', function () { closePanel(); begin(cfg); }));
      if (won && cfg.story && !api.custom) row.appendChild(btn('See your reward', 'primary', function () { close(false, api.onReward); }));
      else row.appendChild(btn(api.custom ? 'Setup' : 'Back to app', '', function () { if (api.custom) showSetup(); else close(); }));
    } else {
      var f = me.finish, good = f === 'sprint' || f === 'dig' || f === 'time';
      c = panel(good ? 'win' : 'lose');
      var name = (GAME_TYPES.filter(function (g) { return g[0] === me.gameType; })[0] || [0, 'Game'])[1];
      c.appendChild(el('h2', 'cg-title sm', f === 'sprint' || f === 'dig' ? clock(game.t) : f === 'time' ? 'TIME!' : 'TOPPED OUT'));
      c.appendChild(el('p', null, name + ' · ' + me.lines + ' lines · ' + me.score + ' pts' + (me.skulls.length ? ' · ×' + me.multiplier : '') + (f === 'topout' ? ' · ' + clock(game.t) : '')));
      row.appendChild(btn('Play again', 'primary', function () { closePanel(); begin(cfg); }));
      row.appendChild(btn(api.custom ? 'Setup' : 'Back to app', '', function () { if (api.custom) showSetup(); else close(); }));
    }
    c.appendChild(row);
    c.appendChild(btn('Back to scuffed_dev', 'ghost', function () { close(); }));
  }

  function fine() { return !(window.matchMedia && matchMedia('(pointer: coarse)').matches); }

  /* ---------- open / close ---------- */

  function svg(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; }

  function build() {
    var root = el('div', 'cage' + (fine() ? ' fine' : ' touch'));
    if (reducedEffects || api.reduceMotion) root.classList.add('cg-reduced');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Cage Escape');
    var bg = el('div', 'cg-bg'); bg.style.backgroundImage = 'url("' + (api.image || DIR + 'cage.jpg') + '")';
    root.appendChild(bg);
    root.appendChild(el('div', 'cg-glass'));

    // top strip: opponent (top left) | title, timer, race | Nic in his cage (top right)
    var top = el('div', 'cg-top');
    var opp = el('div', 'cg-opp');
    var teslaCv = el('canvas', 'mini');
    var tag = el('div', 'cg-tag');
    var face = characterImage('nikola-tesla.png', 'face', TESLA, TESLA_PAL);
    tag.appendChild(face); tag.appendChild(el('b', null, 'Tesla'));
    var teslaLives = el('span', 'lives', '');
    tag.appendChild(teslaLives);
    opp.appendChild(teslaCv); opp.appendChild(tag);
    top.appendChild(opp);
    var info = el('div', 'cg-info');
    var head = el('div', 'cg-head');
    head.appendChild(el('b', 'cg-name', 'CAGE ESCAPE'));
    var timer = el('span', 'cg-timer', '0:00.0');
    head.appendChild(timer);
    info.appendChild(head);
    function raceRow(cls) {
      var r = el('div', 'cg-race ' + cls), label = el('span', 'who', ''), bar = el('span', 'cg-bar'), fill = el('i'), n = el('span', 'n', ''), lives = el('span', 'lives', '');
      bar.appendChild(fill); r.appendChild(label); r.appendChild(bar); r.appendChild(n); r.appendChild(lives);
      info.appendChild(r);
      return { label: label, fill: fill, n: n, lives: lives };
    }
    var rowA = raceRow('me'), rowB = raceRow('te');
    var status = el('div', 'cg-status');
    info.appendChild(status);
    top.appendChild(info);
    var pw = el('div', 'cg-prisoner');
    var scale = 3;
    var nic = characterImage('nic-cage.png', 'nic', NIC, NIC_PAL);
    var cage = cageCanvas(NIC[0].length + 4, NIC.length + 4, scale); cage.className = 'bars';
    var lock = lockCanvas(scale); lock.className = 'lock';
    var bubble = el('span', 'cg-bubble', 'HELP!');
    pw.appendChild(nic); pw.appendChild(cage); pw.appendChild(lock); pw.appendChild(bubble);
    top.appendChild(pw);
    root.appendChild(top);

    // the stage: hold | your well | next
    var stage = el('div', 'cg-stage');
    var hold = el('div', 'cg-side'), holdLbl = el('span', 'lbl', 'HOLD'), holdCv = el('canvas');
    hold.appendChild(holdLbl); hold.appendChild(holdCv);
    var center = el('div', 'cg-wellbox');
    var wellCv = el('canvas', 'well');
    center.appendChild(wellCv);
    var count = el('div', 'cg-count'), flash = el('div', 'cg-flash');
    center.appendChild(count); center.appendChild(flash);
    var next = el('div', 'cg-side'), nextLbl = el('span', 'lbl', 'NEXT'), nextCv = el('canvas');
    next.appendChild(nextLbl); next.appendChild(nextCv);
    stage.appendChild(hold); stage.appendChild(center); stage.appendChild(next);
    root.appendChild(stage);

    // the pad, raised clear of the phone's swipe-home gesture, with the Menu pill at the bottom between the controls
    var pad = el('div', 'cg-pad');
    pad.innerHTML =
      '<div class="cg-dpad" aria-label="D-pad">' +
      '<i class="u">' + svg('M12 5v10M7 9l5-5l5 5M6 19h12') + '</i>' +
      '<i class="d">' + svg('M7 10l5 5l5-5') + '</i>' +
      '<i class="lf">' + svg('M14 7l-5 5l5 5') + '</i>' +
      '<i class="rt">' + svg('M10 7l5 5l-5 5') + '</i></div>' +
      '<div class="cg-acts">' +
      '<button type="button" class="cg-key hold" data-act="hold" aria-label="Hold">' + svg('M4 9h16v10H4zM8 5h8M12 12v4M10 14h4') + '<small>hold</small></button>' +
      '<button type="button" class="cg-key drop" data-act="hard" aria-label="Hard drop">' + svg('M12 4v11M7 10l5 5l5-5M5 20h14') + '<small>drop</small></button>' +
      '<button type="button" class="cg-key rot" data-act="cw" aria-label="Rotate">' + svg('M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5') + '<small>rotate</small></button></div>' +
      '<button type="button" class="cg-pill cg-menu" data-act="menu">' + svg('M4 7h16M4 12h16M4 17h16') + 'MENU</button>';
    root.appendChild(pad);
    root.appendChild(el('div', 'cg-keys', 'Esc menu · Tab skulls'));

    document.body.appendChild(root);
    ui = { root: root, stage: stage, wellCv: wellCv, teslaCv: teslaCv, holdCv: holdCv, nextCv: nextCv, holdLbl: holdLbl, nextLbl: nextLbl,
      timer: timer, rowA: rowA, rowB: rowB, status: status, teslaLives: teslaLives,
      count: count, flash: flash, prisonerWrap: pw, bubble: bubble, teslaFace: face, nicFace: nic, panel: null };
    bindPad(pad);
  }

  function onResize() { if (ui && ui.scene) resizeCutscene(); else layout(); }
  function onHide() { if (document.hidden && game && game.started && !game.over && !game.paused) toggleMenu(); }
  function onBlur() { held = {}; if (game && game.started && !game.over && !game.paused && !ui.panel) toggleMenu(); }
  function onPop() { close(true); }

  // opts: { custom (true = the setup screen; false = the story run), accent, image, haptic, reduceMotion, onWin, onReward, onOpen, onClose }
  function open(opts) {
    if (ui) return;
    api = opts || {};
    build();
    cfg = STORY;
    newGame();
    game.paused = true;      // the intro / setup is up; nothing runs until Start
    layout();
    if (api.custom) showSetup(); else showCutscene();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHide);
    // Android Back closes the game: one history entry stands for it
    history.pushState({ cage: 1 }, '', location.hash);
    window.addEventListener('popstate', onPop);
    last = performance.now();
    raf = requestAnimationFrame(loop);
    if (api.onOpen) api.onOpen();
  }

  // then: runs once the game's history entry is gone (so a page change it makes isn't undone by the late Back)
  function close(viaBack, then) {
    if (!ui) return;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('popstate', onPop);
    ui.root.classList.add('out');
    var r = ui.root, a = api;
    setTimeout(function () { r.remove(); }, 260);
    ui = null; game = null; held = {};
    function done() { if (a.onClose) a.onClose(); if (typeof then === 'function') then(); }
    if (viaBack !== true && history.state && history.state.cage) {
      var landed = false;
      var land = function () { if (landed) return; landed = true; window.removeEventListener('popstate', land); done(); };
      window.addEventListener('popstate', land);
      setTimeout(land, 600);
      history.back();
    } else done();
  }

  // state(): a read-only summary for checking a run (tests, debugging); null when the game isn't open
  function state() {
    if (!game) return null;
    function sum(p) { return p && { lines: p.lines, losses: p.losses, alive: p.alive, incoming: p.incoming, frozen: p.frozen > 0, skulls: p.skulls.length, x: p.piece ? p.piece.x : null, type: p.piece ? p.piece.type : null, score: p.score, finish: p.finish || null, gameType: p.gameType }; }
    return { started: game.started, paused: game.paused, over: game.over, t: game.t, race: game.race, winner: game.winner ? game.winner.id : null, me: sum(game.me), tesla: sum(game.tesla), cell: ui && ui.cell, panel: ui && ui.panel ? ui.panel.className : null };
  }

  window.CageTetris = { open: open, close: close, state: state, menu: toggleMenu, isOpen: function () { return !!ui; } };
})();
