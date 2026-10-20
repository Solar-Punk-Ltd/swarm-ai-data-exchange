/*!
 * BuyerAgentAnim v2: the buyer agent's story for the "Your buyer agent is working." card.
 *
 * Two characters from the Solar Punk film "Swarm Verified Reviews 01", standing still on one line:
 * your agent on the left, the seller agent on the right. Everything that happens travels along
 * one lane between them (the payment goes right, the item comes back left). No text: the card
 * around it says what is happening. Nothing moves across a face, nothing overlaps.
 *
 * No dependencies. Driven by the app's real steps:
 *
 *   const anim = BuyerAgentAnim.mount(document.getElementById('agent-anim'));
 *   anim.setStep('created');   // Buyer agent created
 *   anim.setStep('funded');    // Wallet funded
 *   anim.setStep('started');   // Agent started          (the three play as one scene: your agent comes online)
 *   anim.setStep('discover');  // Seller agent discovered, active ("Looking up the seller on-chain")
 *   anim.setStep('purchase');  // Purchase initiated     (loops for as long as the payment takes)
 *   anim.setStep('finalize');  // Purchase finalized
 *   anim.setStep('download');  // Downloading purchased item
 *   anim.setStep('done');      // all steps complete
 *   anim.setStep('error');     // something failed (any later step clears it)
 *   anim.destroy();
 *
 * Scenes never skip: if the app jumps ahead, each scene in between still plays for its minimum
 * time, so the story reads in order. A scene that has played keeps looping until the next step
 * arrives, so a long wait never looks frozen. prefers-reduced-motion stops the idle motion.
 */
(function (global) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var W = 440,
    H = 270;

  var SCENES = [
    { id: 'boot', min: 3.0 },
    { id: 'search', min: 2.6 },
    { id: 'found', min: 1.4 },
    { id: 'pay', min: 2.4 },
    { id: 'deliver', min: 1.8 },
    { id: 'download', min: 2.2 },
    { id: 'done', min: 0 },
  ];
  var STEP_TO_SCENE = {
    created: 'boot',
    funded: 'boot',
    started: 'boot',
    discover: 'search',
    discovered: 'found',
    purchase: 'pay',
    finalize: 'deliver',
    download: 'download',
    done: 'done',
  };
  var IDX = {};
  SCENES.forEach(function (s, i) {
    IDX[s.id] = i;
  });

  var C = {
    ink: '#F3EFEE',
    silver: '#A7A9B4',
    muted: '#6E7180',
    dim: '#3A3C48',
    line: 'rgba(214,220,238,0.4)',
    orange: '#F58A14',
    green: '#2FD07F',
    red: '#E5484D',
    teal: '#38C6D9',
  };
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  var SANS = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";

  function clamp(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }
  function ease(t) {
    t = clamp(t);
    return t * t * (3 - 2 * t);
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function pop(t) {
    t = clamp(t);
    if (t <= 0) return 0;
    return 1 + Math.sin(t * Math.PI * 1.2) * 0.12 * (1 - t) - Math.pow(1 - t, 3);
  }
  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function set(n, attrs) {
    for (var k in attrs) n.setAttribute(k, attrs[k]);
  }
  function hexRGB(h) {
    var n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(h, k) {
    var c = hexRGB(h).map(function (v) {
      return Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
    });
    return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  }
  function rgba(h, a) {
    var c = hexRGB(h);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  /* ── your agent (the film's house robot): round head, visor, two eyes, antenna, core ── */
  function makeAgent(p, U) {
    var g = el('g', {}, p);
    el('ellipse', { cx: 0, cy: 100, rx: 44, ry: 6, fill: 'url(#' + U + '-shadow)' }, g);
    var halo = el('circle', { cx: 0, cy: 10, r: 100, fill: 'url(#' + U + '-halo)' }, g);
    var bob = el('g', {}, g);
    el(
      'path',
      {
        d: 'M -30 44 C -30 36 30 36 30 44 L 24 84 C 22 92 -22 92 -24 84 Z',
        fill: 'url(#' + U + '-aBody)',
        stroke: C.line,
        'stroke-width': 1.3,
      },
      bob,
    );
    var ring = el(
      'circle',
      { cx: 0, cy: 63, r: 10, fill: 'none', 'stroke-width': 2, opacity: 0 },
      bob,
    );
    var core = el('circle', { cx: 0, cy: 63, r: 7, filter: 'url(#' + U + '-glow)' }, bob);
    var hands = [-1, 1].map(function () {
      return el(
        'circle',
        { r: 10, fill: 'url(#' + U + '-aBody)', stroke: C.line, 'stroke-width': 1.3 },
        bob,
      );
    });
    el(
      'line',
      {
        x1: 0,
        y1: -49,
        x2: 0,
        y2: -65,
        stroke: '#4A4858',
        'stroke-width': 3.6,
        'stroke-linecap': 'round',
      },
      bob,
    );
    var tip = el('circle', { cx: 0, cy: -68, r: 5.5, filter: 'url(#' + U + '-glow)' }, bob);
    [-1, 1].forEach(function (sd) {
      el(
        'rect',
        {
          x: sd * 51 - 5,
          y: -14,
          width: 10,
          height: 28,
          rx: 5,
          fill: '#1C1B24',
          stroke: C.line,
          'stroke-width': 1.2,
        },
        bob,
      );
    });
    el('circle', { cx: 0, cy: 0, r: 50, fill: 'url(#' + U + '-aHead)' }, bob);
    el(
      'circle',
      { cx: 0, cy: 0, r: 50, fill: 'none', stroke: 'rgba(230,234,245,0.7)', 'stroke-width': 1.6 },
      bob,
    );
    el(
      'path',
      {
        d: 'M -36 -30 A 48 48 0 0 1 18 -47',
        fill: 'none',
        stroke: 'rgba(255,255,255,0.5)',
        'stroke-width': 2.6,
        'stroke-linecap': 'round',
      },
      bob,
    );
    el(
      'rect',
      {
        x: -38,
        y: -17,
        width: 76,
        height: 37,
        rx: 18.5,
        fill: 'url(#' + U + '-visor)',
        stroke: 'rgba(214,220,238,0.32)',
        'stroke-width': 1.2,
      },
      bob,
    );
    var tint = el(
      'rect',
      { x: -38, y: -17, width: 76, height: 37, rx: 18.5, fill: C.red, opacity: 0 },
      bob,
    );
    var eyes = [-1, 1].map(function (sd) {
      return {
        sd: sd,
        bar: el('rect', { width: 11, height: 22, rx: 5.5, filter: 'url(#' + U + '-glow)' }, bob),
        arc: el(
          'path',
          {
            fill: 'none',
            stroke: C.ink,
            'stroke-width': 4.4,
            'stroke-linecap': 'round',
            filter: 'url(#' + U + '-glow)',
            opacity: 0,
          },
          bob,
        ),
      };
    });
    function update(s, t) {
      var by = s.still ? 0 : Math.sin(t * 2.4) * 3;
      set(g, {
        transform: 'translate(' + s.x + ',' + (s.y + (1 - s.on) * 18) + ') scale(' + s.s + ')',
        opacity: s.on,
      });
      set(bob, {
        transform: 'translate(0,' + (by + s.droop * 6) + ') rotate(' + -s.droop * 6 + ')',
      });
      set(halo, { opacity: 0.7 + 0.3 * s.happy });
      var col = s.red ? C.red : s.funded ? C.orange : C.ink;
      set(core, {
        fill: col,
        r: 7 + s.pulse * 2.5,
        opacity: (0.35 + 0.65 * s.awake) * (0.85 + 0.15 * Math.sin(t * 5)),
      });
      set(ring, { stroke: col, r: 9 + s.pulse * 16, opacity: s.pulse * 0.7 });
      set(tip, {
        fill: s.red ? C.red : C.ink,
        opacity: (0.2 + 0.8 * s.awake) * (0.75 + 0.25 * Math.sin(t * 6)),
      });
      hands.forEach(function (h, i) {
        var sd = i ? 1 : -1;
        set(h, {
          cx: sd * 58 + s.look * 10 + (i ? s.reach * 18 : 0),
          cy:
            52 +
            s.droop * 10 -
            s.happy * 6 -
            (i ? s.reach * 14 : 0) +
            (s.still ? 0 : Math.cos(t * 2.8 + i * 2) * 2),
        });
      });
      var blink = !s.happy && !s.still && t % 4.1 < 0.12 ? 0.08 : 1;
      var open = clamp(s.awake) * blink;
      set(tint, { opacity: s.red ? 0.22 : 0 });
      eyes.forEach(function (e) {
        var cx = e.sd * 14 + s.look * 8,
          cy = 1.5 + s.lookY * 5,
          h = Math.max(1.6, 22 * open);
        set(e.bar, {
          x: cx - 5.5,
          y: cy - h / 2,
          height: h,
          fill: s.red ? '#FFB4B6' : C.ink,
          opacity: s.happy > 0.5 ? 0 : 1,
        });
        set(e.arc, {
          d:
            'M ' +
            (cx - 7.5) +
            ' ' +
            (cy + 4) +
            ' Q ' +
            cx +
            ' ' +
            (cy - 8) +
            ' ' +
            (cx + 7.5) +
            ' ' +
            (cy + 4),
          opacity: s.happy > 0.5 ? 1 : 0,
        });
      });
    }
    return { update: update };
  }

  /* ── the seller agent (the film's vendor): rounded-square head, teal collar and antenna ── */
  function makeSeller(p, U) {
    var g = el('g', {}, p);
    el('ellipse', { cx: 0, cy: 100, rx: 44, ry: 6, fill: 'url(#' + U + '-shadow)' }, g);
    el('circle', { cx: 0, cy: 10, r: 100, fill: 'url(#' + U + '-haloTeal)' }, g);
    var bob = el('g', {}, g);
    el(
      'path',
      {
        d: 'M-38 44 C-38 34 38 34 38 44 L31 88 C29 96 -29 96 -31 88 Z',
        fill: 'url(#' + U + '-vBody)',
        stroke: rgba(C.teal, 0.55),
        'stroke-width': 1.4,
      },
      bob,
    );
    el(
      'path',
      {
        d: 'M-32 46 Q0 60 32 46',
        fill: 'none',
        stroke: C.teal,
        'stroke-width': 5,
        'stroke-linecap': 'round',
        opacity: 0.9,
      },
      bob,
    );
    var ring = el(
      'circle',
      { cx: 0, cy: 70, r: 10, fill: 'none', stroke: C.green, 'stroke-width': 2, opacity: 0 },
      bob,
    );
    el(
      'line',
      {
        x1: 0,
        y1: -46,
        x2: 0,
        y2: -62,
        stroke: shade(C.teal, -0.4),
        'stroke-width': 3.4,
        'stroke-linecap': 'round',
      },
      bob,
    );
    var tip = el(
      'circle',
      { cx: 0, cy: -65, r: 5.5, fill: C.teal, filter: 'url(#' + U + '-glow)' },
      bob,
    );
    el(
      'rect',
      { x: -52, y: -46, width: 104, height: 90, rx: 26, fill: 'url(#' + U + '-vHead)' },
      bob,
    );
    el(
      'rect',
      {
        x: -52,
        y: -46,
        width: 104,
        height: 90,
        rx: 26,
        fill: 'none',
        stroke: rgba(C.teal, 0.85),
        'stroke-width': 1.8,
      },
      bob,
    );
    el(
      'path',
      {
        d: 'M-38 -38 Q-10 -48 20 -44',
        fill: 'none',
        stroke: '#fff',
        'stroke-opacity': 0.45,
        'stroke-width': 2.4,
        'stroke-linecap': 'round',
      },
      bob,
    );
    el(
      'rect',
      {
        x: -38,
        y: -20,
        width: 76,
        height: 38,
        rx: 13,
        fill: '#06060A',
        stroke: rgba(C.teal, 0.35),
        'stroke-width': 1.2,
      },
      bob,
    );
    var eyes = [-1, 1].map(function (sd) {
      return {
        sd: sd,
        bar: el(
          'rect',
          { width: 11, height: 20, rx: 5.5, fill: C.ink, filter: 'url(#' + U + '-glow)' },
          bob,
        ),
        arc: el(
          'path',
          {
            fill: 'none',
            stroke: C.ink,
            'stroke-width': 4.4,
            'stroke-linecap': 'round',
            filter: 'url(#' + U + '-glow)',
            opacity: 0,
          },
          bob,
        ),
      };
    });
    function update(s, t) {
      var by = s.still ? 0 : Math.sin(t * 2.2 + 1.6) * 3;
      set(g, {
        transform: 'translate(' + s.x + ',' + s.y + ') scale(' + s.s * Math.max(0.001, s.on) + ')',
        opacity: clamp(s.on * 1.5),
      });
      set(bob, { transform: 'translate(0,' + by + ')' });
      set(ring, { r: 9 + s.pulse * 18, opacity: s.pulse * 0.8 });
      set(tip, { opacity: 0.75 + 0.25 * Math.sin(t * 5) });
      var blink = !s.happy && !s.still && (t + 1.7) % 4.6 < 0.12 ? 0.1 : 1;
      eyes.forEach(function (e) {
        var cx = e.sd * 15 + s.look * 7,
          cy = -1,
          h = Math.max(2, 20 * blink);
        set(e.bar, { x: cx - 5.5, y: cy - h / 2, height: h, opacity: s.happy > 0.5 ? 0 : 1 });
        set(e.arc, {
          d:
            'M' +
            (cx - 8) +
            ' ' +
            (cy + 4) +
            ' Q' +
            cx +
            ' ' +
            (cy - 8) +
            ' ' +
            (cx + 8) +
            ' ' +
            (cy + 4),
          opacity: s.happy > 0.5 ? 1 : 0,
        });
      });
    }
    return { update: update };
  }

  function mount(container, opts) {
    opts = opts || {};
    var U = 'baa' + Math.random().toString(36).slice(2, 8);
    var reduce = !!(
      global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H,
      width: '100%',
      height: '100%',
      role: 'img',
      'aria-label': 'Your buyer agent finds a seller agent, pays it and receives the item',
      preserveAspectRatio: 'xMidYMid meet',
    });
    svg.style.display = 'block';
    container.appendChild(svg);
    var defs = el('defs', {}, svg);
    function radial(id, col, a) {
      return (
        '<radialGradient id="' +
        U +
        '-' +
        id +
        '"><stop offset="0%" stop-color="' +
        col +
        '" stop-opacity="' +
        a +
        '"/><stop offset="100%" stop-color="' +
        col +
        '" stop-opacity="0"/></radialGradient>'
      );
    }
    defs.innerHTML =
      '<radialGradient id="' +
      U +
      '-aHead" cx="36%" cy="26%" r="82%"><stop offset="0%" stop-color="#5A5869"/><stop offset="45%" stop-color="#2B2936"/><stop offset="100%" stop-color="#111016"/></radialGradient>' +
      '<linearGradient id="' +
      U +
      '-aBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3A3846"/><stop offset="100%" stop-color="#15141B"/></linearGradient>' +
      '<linearGradient id="' +
      U +
      '-visor" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#12111A"/><stop offset="100%" stop-color="#030305"/></linearGradient>' +
      '<linearGradient id="' +
      U +
      '-vHead" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0%" stop-color="' +
      shade(C.teal, -0.35) +
      '"/><stop offset="55%" stop-color="' +
      shade(C.teal, -0.68) +
      '"/><stop offset="100%" stop-color="#0E0E14"/></linearGradient>' +
      '<linearGradient id="' +
      U +
      '-vBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' +
      shade(C.teal, -0.55) +
      '"/><stop offset="100%" stop-color="#101016"/></linearGradient>' +
      '<radialGradient id="' +
      U +
      '-shadow"><stop offset="0%" stop-color="#000" stop-opacity="0.7"/><stop offset="100%" stop-color="#000" stop-opacity="0"/></radialGradient>' +
      radial('halo', '#D6DCEE', 0.14) +
      radial('haloTeal', C.teal, 0.12) +
      radial('greenGlow', C.green, 0.45) +
      '<filter id="' +
      U +
      '-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';

    /* geometry: two fixed spots on one floor line, a lane between them at chest height */
    var S = 0.95,
      AX = 104,
      SX = 336,
      Y = 128,
      FLOOR = Y + 100 * S;
    var LANE_Y = Y + 52 * S,
      L0 = AX + 80 * S,
      L1 = SX - 58 * S,
      REST = L0 + 30;

    el(
      'line',
      {
        x1: 40,
        y1: FLOOR + 6,
        x2: W - 40,
        y2: FLOOR + 6,
        stroke: 'rgba(255,255,255,0.06)',
        'stroke-width': 1,
      },
      svg,
    );
    /* the seller's spot before it is found: a dashed outline that answers the search */
    var slot = el('g', { transform: 'translate(' + SX + ',' + Y + ')', opacity: 0 }, svg);
    var slotRing = el(
      'circle',
      { r: 54 * S, fill: 'none', stroke: C.dim, 'stroke-width': 1.6, 'stroke-dasharray': '5 6' },
      slot,
    );
    var slotQ = el(
      'text',
      {
        y: 9,
        'text-anchor': 'middle',
        'font-family': SANS,
        'font-size': 26,
        'font-weight': 600,
        fill: C.muted,
      },
      slot,
    );
    slotQ.textContent = '?';
    var pings = [0, 1, 2].map(function () {
      return el(
        'path',
        {
          fill: 'none',
          stroke: C.orange,
          'stroke-width': 2,
          'stroke-linecap': 'round',
          opacity: 0,
        },
        svg,
      );
    });
    /* the lane */
    var lane = el(
      'line',
      {
        x1: L0,
        y1: LANE_Y,
        x2: L1,
        y2: LANE_Y,
        stroke: C.dim,
        'stroke-width': 2,
        'stroke-dasharray': '2 7',
        'stroke-linecap': 'round',
        opacity: 0,
      },
      svg,
    );
    var laneLit = el(
      'line',
      {
        x1: L0,
        y1: LANE_Y,
        x2: L1,
        y2: LANE_Y,
        stroke: C.green,
        'stroke-width': 2.4,
        'stroke-linecap': 'round',
        opacity: 0,
      },
      svg,
    );
    var agent = makeAgent(svg, U);
    var seller = makeSeller(svg, U);
    /* the payment: a green coin */
    var coin = el('g', { opacity: 0 }, svg);
    el('circle', { r: 30, fill: 'url(#' + U + '-greenGlow)' }, coin);
    var coinFace = el('g', {}, coin);
    el(
      'circle',
      { r: 13, fill: C.green, stroke: '#C9FFE2', 'stroke-opacity': 0.7, 'stroke-width': 1.5 },
      coinFace,
    );
    var cs = el(
      'text',
      {
        y: 5,
        'text-anchor': 'middle',
        'font-family': MONO,
        'font-size': 14,
        'font-weight': 700,
        fill: '#062B19',
      },
      coinFace,
    );
    cs.textContent = '$';
    var wait = el(
      'circle',
      {
        r: 20,
        fill: 'none',
        stroke: C.green,
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-dasharray': '22 104',
        opacity: 0,
      },
      coin,
    );
    /* the item: a wallet card */
    var item = el('g', { opacity: 0 }, svg);
    el('circle', { r: 34, fill: 'url(#' + U + '-greenGlow)' }, item);
    el(
      'rect',
      {
        x: -20,
        y: -14,
        width: 40,
        height: 28,
        rx: 6,
        fill: '#1D1E27',
        stroke: C.ink,
        'stroke-width': 1.8,
      },
      item,
    );
    el(
      'path',
      {
        d: 'M -20 -5 L 12 -5 Q 20 -5 20 3 L 20 7 L 6 7 Q 0 7 0 1 Q 0 -5 7 -5',
        fill: '#2A2C36',
        stroke: C.ink,
        'stroke-width': 1.4,
      },
      item,
    );
    el('circle', { cx: 8, cy: 1, r: 2.6, fill: C.green }, item);
    /* the download bar under the lane, and the check */
    var barY = LANE_Y + 34;
    var barBg = el(
      'rect',
      {
        x: L0,
        y: barY,
        width: L1 - L0,
        height: 4,
        rx: 2,
        fill: 'rgba(255,255,255,0.08)',
        opacity: 0,
      },
      svg,
    );
    var bar = el(
      'rect',
      { x: L0, y: barY, width: 0, height: 4, rx: 2, fill: C.green, opacity: 0 },
      svg,
    );
    var check = el('g', { opacity: 0 }); // appended after the item, below
    el('circle', { r: 13, fill: C.green, filter: 'url(#' + U + '-glow)' }, check);
    el(
      'path',
      {
        d: 'M -5.5 0.5 L -1.5 4.5 L 6 -4',
        fill: 'none',
        stroke: '#06210F',
        'stroke-width': 2.8,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
      check,
    );
    svg.appendChild(check);

    /* the scene on screen walks toward the target, one scene at a time */
    function now() {
      return performance.now() / 1000;
    }
    var target = IDX[STEP_TO_SCENE[opts.step || 'created']] || 0;
    var cur = 0,
      curSince = now(),
      t0 = now(),
      error = false,
      errSince = 0,
      raf = 0,
      alive = true;

    function setStep(step) {
      if (step === 'error') {
        if (!error) errSince = now();
        error = true;
        return;
      }
      var s = STEP_TO_SCENE[step];
      if (s == null) return;
      error = false;
      target = Math.max(target, IDX[s]);
    }

    function frame() {
      if (!alive) return;
      var T = now(),
        t = reduce ? 0 : T - t0,
        lt = T - curSince;
      if (cur < target && lt >= SCENES[cur].min) {
        cur++;
        curSince = T;
        lt = 0;
      }
      var sc = SCENES[cur].id;
      function at(id) {
        return cur > IDX[id] ? 1e9 : cur === IDX[id] ? lt : -1;
      }
      var boot = at('boot'),
        search = at('search'),
        found = at('found'),
        pay = at('pay'),
        dlv = at('deliver'),
        dl = at('download'),
        done = at('done');

      /* your agent: rises in, a coin drops into its core (it turns orange: funded), it opens its eyes */
      var on = ease(boot / 0.8),
        funded = boot > 1.5,
        awake = ease((boot - 1.8) / 0.5);
      var look = 0,
        lookY = 0;
      if (sc === 'search') {
        look = 0.6 + 0.35 * Math.sin(search * 2.2);
        lookY = -0.2;
      } else if (cur >= IDX.found && cur < IDX.done) look = 0.9;
      var pulse =
        sc === 'boot'
          ? Math.max(0, 1 - Math.abs(boot - 1.55) / 0.35)
          : sc === 'done'
            ? Math.max(0, 1 - done / 0.7)
            : 0;
      var payCyc = pay % 2.4;
      var reach = sc === 'pay' ? Math.sin(clamp(payCyc / 0.5) * Math.PI) : 0;
      agent.update(
        {
          x: AX,
          y: Y,
          s: S,
          on: on,
          funded: funded && !error,
          awake: awake,
          pulse: pulse,
          look: look,
          lookY: lookY,
          happy: cur >= IDX.done && !error ? 1 : 0,
          reach: reach,
          droop: error ? ease((T - errSince) / 0.5) : 0,
          red: error,
          still: reduce,
        },
        t,
      );

      /* the search: pings travel from your agent toward the empty seller spot, which answers */
      var slotO =
        sc === 'search' ? clamp(search / 0.3) : sc === 'found' ? 1 - clamp(found / 0.25) : 0;
      set(slot, { opacity: slotO });
      set(slotRing, {
        stroke: sc === 'search' && search % 1.2 > 0.8 ? C.orange : C.dim,
        'stroke-dashoffset': reduce ? 0 : -t * 10,
      });
      pings.forEach(function (pg, i) {
        var ph = ((Math.max(0, search) + i * 0.4) % 1.2) / 1.2;
        var px = lerp(L0 - 6, L1 - 24, ph),
          r = 9 + ph * 16;
        set(pg, {
          d: 'M ' + px + ' ' + (Y - r) + ' A ' + r + ' ' + r + ' 0 0 1 ' + px + ' ' + (Y + r),
          opacity: sc === 'search' ? Math.sin(ph * Math.PI) * 0.8 * slotO : 0,
        });
      });

      /* the seller appears in the spot */
      var sOn = cur >= IDX.found ? pop(found / 0.6) : 0;
      seller.update(
        {
          x: SX,
          y: Y,
          s: S,
          on: sOn,
          look: -0.9,
          happy: sc === 'deliver' && dlv > 0.3 ? 1 : 0,
          pulse: sc === 'deliver' ? Math.max(0, 1 - Math.abs(dlv - 0.35) / 0.35) : 0,
          still: reduce,
        },
        t,
      );

      /* the lane: dotted once both are there; lit green while the item comes over */
      var laneO =
        cur >= IDX.found && cur < IDX.done
          ? clamp((found - 0.5) / 0.4)
          : cur >= IDX.done
            ? 1 - clamp(done / 0.5)
            : 0;
      set(lane, { opacity: laneO, 'stroke-dashoffset': reduce ? 0 : -t * 14 });
      var lit = sc === 'download' ? 1 : sc === 'deliver' ? clamp((dlv - 0.6) / 0.3) : 0;
      set(laneLit, { opacity: lit * 0.35 * laneO });

      /* the coin: into your agent at birth; along the lane while paying; it waits at the seller (a spinner) and goes again */
      var cx = 0,
        cy = 0,
        co = 0,
        waitO = 0;
      if (sc === 'boot' && boot > 0.7 && boot < 1.6) {
        cx = AX;
        cy = lerp(Y - 110, Y + 52 * S, ease((boot - 0.8) / 0.7));
        co = clamp((boot - 0.7) / 0.15) * (1 - clamp((boot - 1.45) / 0.12));
      } else if (sc === 'pay') {
        var u = ease(payCyc / 1.0);
        cx = lerp(L0, L1 - 26, u);
        cy = LANE_Y - Math.sin(u * Math.PI) * 10;
        co = clamp(payCyc / 0.15) * (1 - clamp((payCyc - 2.05) / 0.3));
        waitO = clamp((payCyc - 1.0) / 0.2) * (1 - clamp((payCyc - 1.95) / 0.2));
      } else if (sc === 'deliver' && dlv < 0.45) {
        cx = lerp(L1 - 26, L1 + 6, ease(dlv / 0.35));
        cy = LANE_Y;
        co = 1 - clamp((dlv - 0.3) / 0.15);
      }
      set(coin, { transform: 'translate(' + cx + ',' + cy + ')', opacity: co });
      set(coinFace, { transform: 'scale(' + Math.max(0.15, Math.abs(Math.cos(t * 4))) + ',1)' });
      set(wait, { opacity: waitO, transform: 'rotate(' + t * 360 + ')' });

      /* the item: out of the seller, along the lane to your agent; the bar fills as it travels */
      var ix = 0,
        io = 0,
        isc = 1;
      if (sc === 'deliver' && dlv >= 0.5) {
        ix = lerp(L1 + 4, L1 - 40, ease((dlv - 0.5) / 0.6));
        io = clamp((dlv - 0.5) / 0.2);
        isc = lerp(0.6, 1, ease((dlv - 0.5) / 0.4));
      } else if (sc === 'download') {
        var v = ease(clamp(dl / 2.0));
        ix = lerp(L1 - 40, REST, v);
        io = 1;
      } else if (cur >= IDX.done) {
        ix = REST;
        io = 1; // it stays with your agent: the thing it bought
      }
      var iy =
        LANE_Y -
        (sc === 'download' ? Math.sin(clamp(dl / 2.0) * Math.PI) * 8 : 0) -
        (cur >= IDX.done ? 16 * ease(done / 0.5) - (reduce ? 0 : Math.sin(t * 2.4) * 2) : 0);
      set(item, {
        transform:
          'translate(' +
          ix +
          ',' +
          iy +
          ') scale(' +
          isc * (cur >= IDX.done ? 1 + 0.15 * ease(done / 0.5) : 1) +
          ')',
        opacity: io,
      });
      var prog = sc === 'download' ? clamp(dl / 2.1) : cur > IDX.download ? 1 : 0;
      var barO =
        sc === 'download' ? clamp(dl / 0.3) : cur > IDX.download ? 1 - clamp(done / 0.5) : 0;
      set(barBg, { opacity: barO });
      set(bar, { width: (L1 - L0) * prog, x: L1 - (L1 - L0) * prog, opacity: barO });

      /* done: a check on your agent */
      var ck = sc === 'done' && !error ? pop((done - 0.2) / 0.5) : 0;
      set(check, {
        transform:
          'translate(' +
          (REST + 22) +
          ',' +
          (LANE_Y - 16 - 18) +
          ') scale(' +
          Math.max(0.001, ck) +
          ')',
        opacity: ck > 0 ? 1 : 0,
      });

      raf = global.requestAnimationFrame(frame);
    }
    raf = global.requestAnimationFrame(frame);

    return {
      setStep: setStep,
      scene: function () {
        return SCENES[cur].id;
      },
      destroy: function () {
        alive = false;
        global.cancelAnimationFrame(raf);
        if (svg.parentNode) svg.parentNode.removeChild(svg);
      },
    };
  }

  global.BuyerAgentAnim = { mount: mount };
})(typeof window !== 'undefined' ? window : this);
