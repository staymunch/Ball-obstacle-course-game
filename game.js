import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const TRACK_W = 7;            // track width
const HW = TRACK_W / 2;       // half width
const R = 0.5;                // ball radius
const SLOPE = 0.05;           // gentle downhill (height lost per unit of distance)
const GRAVITY = 20;
const RAIL_H = 0.75;          // rail height above the floor
const RAIL_R = 0.13;
const FLOOR_T = 1.0;          // floor thickness
const STEER_SENS = 1.7;       // track widths per full-screen swipe
const PUSH_SENS = 16;         // speed gained per full-screen-height swipe up
const CRUISE = 3;             // the downhill slope alone rolls the ball this fast
const MAX_BACK = -6;          // fastest it can roll backwards

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('ballroll.' + key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('ballroll.' + key, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

// ---------------------------------------------------------------------------
// Sound (tiny synth, no files needed)
// ---------------------------------------------------------------------------
const sound = {
  ctx: null,
  muted: store.get('muted', false),
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, { type = 'sine', vol = 0.15, slideTo = null, delay = 0 } = {}) {
    if (this.muted || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  },
  coin() { this.tone(988, 0.08, { type: 'square', vol: 0.06 }); this.tone(1319, 0.18, { type: 'square', vol: 0.06, delay: 0.07 }); },
  bump() { this.tone(160, 0.18, { type: 'triangle', vol: 0.25, slideTo: 70 }); },
  jump() { this.tone(300, 0.35, { type: 'sine', vol: 0.15, slideTo: 900 }); },
  land() { this.tone(120, 0.12, { type: 'triangle', vol: 0.2, slideTo: 60 }); },
  ring() { [784, 988, 1175].forEach((f, i) => this.tone(f, 0.15, { type: 'triangle', vol: 0.12, delay: i * 0.06 })); },
  checkpoint() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', vol: 0.14, delay: i * 0.09 })); },
  whoops() { this.tone(500, 0.6, { type: 'sine', vol: 0.15, slideTo: 120 }); },
  win() {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) =>
      this.tone(f, i === 5 ? 0.6 : 0.16, { type: 'square', vol: 0.07, delay: i * 0.12 }));
  },
};

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

const woodTex = canvasTex(512, 512, (g, w, h) => {
  const rng = mulberry32(42);
  const planks = 5;
  const pw = w / planks;
  for (let p = 0; p < planks; p++) {
    const tone = 0.92 + rng() * 0.14;
    g.fillStyle = `rgb(${232 * tone | 0},${193 * tone | 0},${140 * tone | 0})`;
    g.fillRect(p * pw, 0, pw, h);
    // grain
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = `rgba(150,95,45,${0.08 + rng() * 0.14})`;
      g.lineWidth = 1 + rng() * 2;
      const x0 = p * pw + rng() * pw;
      const amp = 2 + rng() * 6, freq = 0.01 + rng() * 0.02, ph = rng() * 6;
      g.beginPath();
      for (let y = 0; y <= h; y += 8) {
        const x = x0 + Math.sin(y * freq + ph) * amp;
        y === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
    g.fillStyle = 'rgba(110,70,30,0.35)';
    g.fillRect(p * pw, 0, 2, h);
  }
});

const sideWoodTex = canvasTex(256, 64, (g, w, h) => {
  g.fillStyle = '#c9965a'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, h - 10, w, 10);
});

const stripeTex = canvasTex(128, 32, (g, w, h) => {
  g.fillStyle = '#ffd21f'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#222';
  for (let x = -h; x < w + h; x += 64) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 32, 0); g.lineTo(x + 32 + h, h); g.lineTo(x + h, h); g.closePath(); g.fill();
  }
});

const ballTex = canvasTex(512, 256, (g, w, h) => {
  g.fillStyle = '#8fdc2b'; g.fillRect(0, 0, w, h);
  // fuzzy speckles
  const rng = mulberry32(7);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(40,90,0,0.08)';
    g.fillRect(rng() * w, rng() * h, 3, 3);
  }
  // tennis-ball seam
  g.strokeStyle = '#ffffff'; g.lineWidth = 14; g.lineCap = 'round';
  g.beginPath();
  for (let x = 0; x <= w; x += 4) {
    const y = h / 2 + Math.sin((x / w) * Math.PI * 4) * h * 0.28;
    x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
}, false);

function bannerTex(text, bg1, bg2, checkered) {
  return canvasTex(512, 128, (g, w, h) => {
    if (checkered) {
      const sz = 32;
      for (let y = 0; y < h; y += sz) for (let x = 0; x < w; x += sz) {
        g.fillStyle = ((x + y) / sz) % 2 ? bg1 : bg2; g.fillRect(x, y, sz, sz);
      }
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(40, 22, w - 80, h - 44);
      g.fillStyle = '#222';
    } else {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, bg1); grd.addColorStop(1, bg2);
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
    }
    g.font = 'bold 72px "Arial Rounded MT Bold", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
  }, false);
}

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const SKY_TOP = new THREE.Color('#7cc4ff');
const SKY_BOTTOM = new THREE.Color('#eef6ff');
scene.background = canvasTex(4, 256, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#' + SKY_TOP.getHexString());
  grd.addColorStop(0.6, '#' + SKY_BOTTOM.getHexString());
  grd.addColorStop(1, '#' + SKY_BOTTOM.getHexString());
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
}, false);
scene.fog = new THREE.Fog(SKY_BOTTOM, 45, 140);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);

scene.add(new THREE.HemisphereLight(0xffffff, 0xb9a98f, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // portrait screens need a wider field of view so the track fits
  camera.fov = w / h < 1 ? 72 : 60;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Shared materials & geometries
const M = {
  wood: new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.8 }),
  woodSide: new THREE.MeshStandardMaterial({ map: sideWoodTex, roughness: 0.9 }),
  rail: new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.5 }),
  post: new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 }),
  railCap: new THREE.MeshStandardMaterial({ color: 0xffd21f, roughness: 0.5 }),
  star: new THREE.MeshStandardMaterial({ color: 0xffc928, emissive: 0x7a4b00, emissiveIntensity: 0.5, metalness: 0.3, roughness: 0.3 }),
  ring: new THREE.MeshStandardMaterial({ color: 0x3bb3ff, emissive: 0x0a3a66, emissiveIntensity: 0.4, roughness: 0.3 }),
  hammerHead: new THREE.MeshStandardMaterial({ color: 0xff4d6d, roughness: 0.4 }),
  hammerBand: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x8b5cf6, roughness: 0.5 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xc0c7d0, metalness: 0.6, roughness: 0.35 }),
  slider: [0x3b82f6, 0xf97316, 0xec4899, 0x14b8a6].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 })),
  spinner: new THREE.MeshStandardMaterial({ color: 0xa855f7, roughness: 0.4 }),
  cloud: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  gatePost: new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.5 }),
  gatePostDone: new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.5 }),
};

const starShape = (() => {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.2 : 0.46;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    i === 0 ? s.moveTo(Math.cos(a) * r, Math.sin(a) * r) : s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
})();
const G = {
  star: new THREE.ExtrudeGeometry(starShape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 2 }).center(),
  post: new THREE.CylinderGeometry(0.06, 0.06, 1, 6),
  railCap: new THREE.SphereGeometry(RAIL_R * 1.4, 12, 8),
  cloud: new THREE.SphereGeometry(1, 12, 10),
  confetti: new THREE.PlaneGeometry(0.22, 0.12),
};

// ---------------------------------------------------------------------------
// Ball
// ---------------------------------------------------------------------------
const ballMesh = new THREE.Mesh(
  new THREE.SphereGeometry(R, 32, 24),
  new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.75 })
);
ballMesh.castShadow = true;
scene.add(ballMesh);

const ball = {
  s: 0, x: 0, y: 0,          // s = distance along the track (world z = -s)
  v: 0, vy: 0, vxb: 0,       // forward speed, vertical speed, lateral "bump" speed
  target: 0,                 // where the finger wants the ball to be (x)
  grounded: true,
  lastSafeY: 0,
  inGap: false,
};

// ---------------------------------------------------------------------------
// Level generation
// ---------------------------------------------------------------------------
let level = null;
let levelGroup = null;

function baseY(s) { return -SLOPE * s; }

// The track's centerline bends left and right. Physics works in track coordinates
// (s = distance along the track, x = sideways offset); W() maps them into the world.
function curvature(s, L = level) {
  for (const c of L.curves) {
    if (s >= c.s0 && s < c.s0 + c.len) {
      const u = (s - c.s0) / c.len;
      return (c.angle / c.len) * (1 - Math.cos(2 * Math.PI * u));   // eases in and out
    }
  }
  return 0;
}
const CL_STEP = 0.25;
function buildCenterline(L) {
  const s0 = L.startS - 40, count = Math.ceil((L.endS + 60 - s0) / CL_STEP) + 1;
  const px = new Float64Array(count), pz = new Float64Array(count), psi = new Float64Array(count);
  let x = 0, z = -s0, h = 0;
  for (let i = 0; i < count; i++) {
    px[i] = x; pz[i] = z; psi[i] = h;
    const k = curvature(s0 + (i + 0.5) * CL_STEP, L);
    const hm = h + k * CL_STEP / 2;
    x -= Math.sin(hm) * CL_STEP;
    z -= Math.cos(hm) * CL_STEP;
    h += k * CL_STEP;
  }
  L.cl = { s0, count, px, pz, psi };
}
function frameAt(s) {
  const c = level.cl;
  const f = clamp((s - c.s0) / CL_STEP, 0, c.count - 1.001);
  const i = Math.floor(f), t = f - i;
  return { x: lerp(c.px[i], c.px[i + 1], t), z: lerp(c.pz[i], c.pz[i + 1], t), psi: lerp(c.psi[i], c.psi[i + 1], t) };
}
// track coords -> world position
function W(x, y, s, out = new THREE.Vector3()) {
  const f = frameAt(s);
  return out.set(f.x + x * Math.cos(f.psi), y, f.z - x * Math.sin(f.psi));
}
// place a group at a point on the track, turned to face along it
function placeOnTrack(obj, s, y, x = 0) {
  W(x, y, s, obj.position);
  obj.rotation.y = frameAt(s).psi;
  return obj;
}

function rampAt(s) {
  for (const r of level.ramps) if (s >= r.s0 && s < r.s0 + r.len) return r;
  return null;
}
function gapAt(s) {
  for (const gp of level.gaps) if (s > gp[0] && s < gp[1]) return gp;
  return null;
}
function floorY(s) {
  const r = rampAt(s);
  return baseY(s) + (r ? ((s - r.s0) / r.len) * r.H : 0);
}
function groundY(s, x) {
  if (s < level.startS || s > level.endS) return null;
  if (gapAt(s)) return null;
  if (Math.abs(x) > HW) return null;
  return floorY(s);
}
function slopeAt(s) {
  const r = rampAt(s);
  return -SLOPE + (r ? r.H / r.len : 0);
}
function railsAt(s) {
  return s >= level.startS && s <= level.endS && !gapAt(s);
}
function targetSpeed(n) { return Math.min(8.5 + n * 0.35, 13.5); }   // jump launch speed
function maxSpeed(n) { return targetSpeed(n) + 5; }

function generateLevel(n) {
  const rng = mulberry32(n * 7919 + 13);
  const pick = arr => arr[Math.floor(rng() * arr.length)];
  const L = {
    n, startS: -8, ramps: [], gaps: [], checkpoints: [], obstacles: [], coins: [], rings: [], curves: [],
  };
  let heading = 0;
  const MAX_HEADING = 1.4;   // never turn back on itself, so the track can't cross over itself
  const curve = (s0, dir) => {
    const len = 20 + rng() * 14;
    const maxAngle = Math.min(0.55 + n * 0.08, 1.3);
    const angle = (0.6 + rng() * 0.4) * maxAngle;
    if (!dir) dir = rng() < 0.5 ? -1 : 1;
    if (heading + dir * angle > MAX_HEADING || heading + dir * angle < -MAX_HEADING) dir = -dir;
    L.curves.push({ s0, len, angle: dir * angle });
    heading += dir * angle;
    return { end: s0 + len, dir };
  };
  const vt = targetSpeed(n);

  const coinLine = (from, to, style = pick(['center', 'wave', 'lane'])) => {
    const lane = (pick([-1, 1])) * 2;
    const ph = rng() * 6;
    for (let s = from; s <= to; s += 2) {
      let x = 0;
      if (style === 'wave') x = Math.sin(s * 0.35 + ph) * 2.2;
      if (style === 'lane') x = lane;
      L.coins.push({ s, x, h: 0 });
    }
  };

  const sections = {
    slider(s0) {
      const k = n < 4 ? 2 : 3;
      const speed = 1.3 + Math.min(n, 12) * 0.07;
      for (let i = 0; i < k; i++) {
        const s = s0 + 6 + i * 8;
        L.obstacles.push({ type: 'slider', s, amp: 2.2, speed, phase: rng() * Math.PI * 2, color: i % 4 });
        L.coins.push({ s: s + 4, x: pick([-2.4, 0, 2.4]), h: 0 });
      }
      return s0 + 6 + k * 8;
    },
    spinner(s0) {
      const k = n < 6 ? 1 : 2;
      for (let i = 0; i < k; i++) {
        const s = s0 + 7 + i * 11;
        const dir = rng() < 0.5 ? -1 : 1;
        L.obstacles.push({ type: 'spinner', s, speed: dir * (1.1 + Math.min(n, 12) * 0.05), phase: rng() * Math.PI });
        for (const x of [-2.7, 2.7]) L.coins.push({ s, x, h: 0 });
      }
      return s0 + 7 + k * 11;
    },
    hammer(s0) {
      const k = n < 5 ? 1 : 2;
      for (let i = 0; i < k; i++) {
        const s = s0 + 7 + i * 10;
        L.obstacles.push({ type: 'hammer', s, speed: (2 * Math.PI) / Math.max(2.4, 3.4 - n * 0.05), phase: rng() * Math.PI * 2 });
        for (let j = -1; j <= 1; j++) L.coins.push({ s: s + j * 1.6, x: 0, h: 0 });
      }
      return s0 + 7 + k * 10;
    },
    jump(s0) {
      L.checkpoints.push(s0);
      coinLine(s0 + 3, s0 + 9, 'center');
      const rs = s0 + 11, len = 8, H = 2.2;
      // Flight path relative to the (sloped) base, launched at target speed
      const vyr = vt * (H / len);
      const tLand = (vyr + Math.sqrt(vyr * vyr + 2 * GRAVITY * H)) / GRAVITY;
      const landDist = vt * tLand;
      const gap = n >= 3 ? clamp(landDist * 0.55, 2.5, 6) : 0;
      L.ramps.push({ s0: rs, len, H });
      const top = rs + len;
      if (gap > 0) L.gaps.push([top, top + gap]);
      // coins + ring along the arc
      const tApex = vyr / GRAVITY;
      const apexH = H + vyr * tApex - 0.5 * GRAVITY * tApex * tApex;
      L.rings.push({ s: top + vt * tApex, h: apexH + R });
      for (const f of [0.35, 1.65]) {
        const t = tApex * f;
        L.coins.push({ s: top + vt * t, x: 0, h: H + vyr * t - 0.5 * GRAVITY * t * t + R });
      }
      return top + Math.max(gap, landDist) + 6;
    },
  };

  let s = 0;
  L.checkpoints.push(0);
  coinLine(8, 20);
  s = 24;
  // twists and turns between obstacle sections (obstacles and jumps themselves sit on straights)
  const bend = () => {
    if (rng() > 0.75) return;
    const c = curve(s);
    coinLine(s + 4, c.end - 4, pick(['center', 'wave']));
    s = c.end;
    if (n >= 2 && rng() < 0.4) s = curve(s, -c.dir).end;   // S-bend
    s += 3;
  };
  bend();

  const types = ['slider', 'jump'];
  if (n >= 2) types.push('spinner');
  if (n >= 3) types.push('hammer');
  const count = Math.min(3 + n, 14);
  let last = null, sinceCp = 0;
  // Make sure the newest obstacle type shows up in the level it unlocks
  const forced = { 1: 'jump', 2: 'spinner', 3: 'hammer' }[n];
  for (let i = 0; i < count; i++) {
    let t;
    if (i === 1 && forced) t = forced;
    else do { t = pick(types); } while (t === last);
    if (t !== 'jump' && sinceCp >= 3) { L.checkpoints.push(s); sinceCp = 0; s += 3; }
    s = sections[t](s);
    sinceCp = t === 'jump' ? 0 : sinceCp + 1;
    last = t;
    if (rng() < 0.5) { coinLine(s + 3, s + 11); s += 14; } else s += 5;
    bend();
  }
  L.finishS = s + 6;
  L.endS = s + 45;
  buildCenterline(L);
  return L;
}

// ---------------------------------------------------------------------------
// Level meshes
// ---------------------------------------------------------------------------
function trackSamples(a, b) {
  // sample points along [a, b] including ramp edges, so the floor follows ramps exactly
  const pts = new Set([a, b]);
  for (let s = Math.ceil(a); s < b; s += 0.5) pts.add(s);
  for (const r of level.ramps) {
    for (const e of [r.s0, r.s0 + r.len - 0.001, r.s0 + r.len]) if (e > a && e < b) pts.add(e);
  }
  return [...pts].sort((p, q) => p - q);
}

function buildFloor(a, b) {
  const samples = trackSamples(a, b);
  const pos = [], uv = [], groups = [];
  const add = (quad, uvs, outward) => {
    // ensure triangle winding faces "outward"
    const [p0, p1, p2] = quad;
    const e1 = new THREE.Vector3().subVectors(p1, p0), e2 = new THREE.Vector3().subVectors(p2, p0);
    let q = quad, u = uvs;
    if (e1.cross(e2).dot(outward) < 0) { q = [quad[0], quad[3], quad[2], quad[1]]; u = [uvs[0], uvs[3], uvs[2], uvs[1]]; }
    for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(q[i].x, q[i].y, q[i].z); uv.push(u[i][0], u[i][1]); }
  };
  const V = (x, y, s) => W(x, y, s);
  const yAt = s => (s === b ? floorY(s - 0.001) : floorY(s));
  const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
  const rightAt = s => { const h = frameAt(s).psi; return new THREE.Vector3(Math.cos(h), 0, -Math.sin(h)); };
  const fwdAt = s => { const h = frameAt(s).psi; return new THREE.Vector3(-Math.sin(h), 0, -Math.cos(h)); };

  const topStart = pos.length;
  for (let i = 0; i < samples.length - 1; i++) {
    const s0 = samples[i], s1 = samples[i + 1], y0 = yAt(s0), y1 = yAt(s1);
    add([V(-HW, y0, s0), V(HW, y0, s0), V(HW, y1, s1), V(-HW, y1, s1)],
        [[0, s0 / 6], [1, s0 / 6], [1, s1 / 6], [0, s1 / 6]], UP);
  }
  const topCount = (pos.length - topStart) / 3;
  const sideStart = pos.length / 3;
  for (let i = 0; i < samples.length - 1; i++) {
    const s0 = samples[i], s1 = samples[i + 1], y0 = yAt(s0), y1 = yAt(s1);
    const T = FLOOR_T;
    add([V(-HW, y0, s0), V(-HW, y1, s1), V(-HW, y1 - T, s1), V(-HW, y0 - T, s0)],
        [[s0 / 4, 1], [s1 / 4, 1], [s1 / 4, 0], [s0 / 4, 0]], rightAt(s0).negate());
    add([V(HW, y0, s0), V(HW, y1, s1), V(HW, y1 - T, s1), V(HW, y0 - T, s0)],
        [[s0 / 4, 1], [s1 / 4, 1], [s1 / 4, 0], [s0 / 4, 0]], rightAt(s0));
    add([V(-HW, y0 - T, s0), V(HW, y0 - T, s0), V(HW, y1 - T, s1), V(-HW, y1 - T, s1)],
        [[0, 0], [1, 0], [1, 1], [0, 1]], DOWN);
  }
  for (const [s, dir] of [[a, fwdAt(a).negate()], [b, fwdAt(b)]]) {
    const y = yAt(s);
    add([V(-HW, y, s), V(HW, y, s), V(HW, y - FLOOR_T, s), V(-HW, y - FLOOR_T, s)],
        [[0, 1], [1, 1], [1, 0], [0, 0]], dir);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  geo.addGroup(0, topCount, 0);
  geo.addGroup(sideStart, pos.length / 3 - sideStart, 1);
  const mesh = new THREE.Mesh(geo, [M.wood, M.woodSide]);
  mesh.receiveShadow = true;
  return mesh;
}

function buildRails(a, b, group, postMatrices) {
  const samples = trackSamples(a, b);
  const yAt = s => (s === b ? floorY(s - 0.001) : floorY(s));
  for (const side of [-1, 1]) {
    const x = side * (HW + 0.02);
    const path = new THREE.CurvePath();
    for (let i = 0; i < samples.length - 1; i++) {
      const s0 = samples[i], s1 = samples[i + 1];
      path.add(new THREE.LineCurve3(W(x, yAt(s0) + RAIL_H, s0), W(x, yAt(s1) + RAIL_H, s1)));
    }
    const geo = new THREE.TubeGeometry(path, Math.max(4, samples.length * 2), RAIL_R, 8, false);
    const tex = stripeTex.clone();
    tex.repeat.set((b - a) / 1.4, 1);
    tex.needsUpdate = true;
    const mat = M.rail.clone();
    mat.map = tex;
    const tube = new THREE.Mesh(geo, mat);
    tube.castShadow = true;
    group.add(tube);
    for (const s of [a, b]) {
      const cap = new THREE.Mesh(G.railCap, M.railCap);
      W(x, yAt(s) + RAIL_H, s, cap.position);
      group.add(cap);
    }
    for (let s = a; s <= b; s += 2.5) {
      const y = yAt(s);
      postMatrices.push(new THREE.Matrix4().compose(
        W(x, y + RAIL_H / 2, s), new THREE.Quaternion(), new THREE.Vector3(1, RAIL_H, 1)));
    }
  }
}

function gate(s, banner, postMat) {
  const g = new THREE.Group();
  placeOnTrack(g, s, floorY(s));
  const postGeo = new THREE.CylinderGeometry(0.22, 0.22, 4.2, 12);
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(postGeo, postMat);
    p.position.set(side * (HW + 0.5), 2.1, 0);
    p.castShadow = true;
    g.add(p);
  }
  const ban = new THREE.Mesh(new THREE.BoxGeometry(TRACK_W + 1.4, 1.2, 0.15),
    [M.metal, M.metal, M.metal, M.metal, new THREE.MeshBasicMaterial({ map: banner }), M.metal]);
  ban.position.y = 3.9;
  g.add(ban);
  return g;
}

function buildObstacle(o) {
  const g = new THREE.Group();
  placeOnTrack(g, o.s, floorY(o.s));
  if (o.type === 'slider') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 1.2), M.slider[o.color]);
    box.position.y = 0.6;
    box.castShadow = true;
    g.add(box);
    // little track grooves so it reads as "slides here"
    const groove = new THREE.Mesh(new THREE.BoxGeometry(TRACK_W, 0.03, 0.25), M.post);
    groove.position.y = 0.015;
    g.add(groove);
    o.mesh = box;
  } else if (o.type === 'spinner') {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.4, 16), M.metal);
    post.position.y = 0.7;
    post.castShadow = true;
    g.add(post);
    const arm = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.4, 0.4), M.spinner);
    bar.castShadow = true;
    arm.add(bar);
    for (const side of [-1, 1]) {
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), M.hammerBand);
      knob.position.x = side * 2.9;
      arm.add(knob);
    }
    arm.position.y = 0.5;
    g.add(arm);
    o.mesh = arm;
  } else if (o.type === 'hammer') {
    o.pivotY = 8; o.len = 6.6; o.amp = 0.8;
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8.4, 0.4), M.frame);
      p.position.set(side * (HW + 0.6), 4.2, 0);
      p.castShadow = true;
      g.add(p);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(TRACK_W + 1.6, 0.4, 0.4), M.frame);
    top.position.y = 8.3;
    g.add(top);
    const pivot = new THREE.Group();
    pivot.position.y = o.pivotY;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, o.len, 8), M.metal);
    rod.position.y = -o.len / 2;
    pivot.add(rod);
    const head = new THREE.Group();
    head.position.y = -o.len;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.8, 24), M.hammerHead);
    cyl.rotation.x = Math.PI / 2;
    cyl.castShadow = true;
    head.add(cyl);
    for (const z of [-0.6, 0.6]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.87, 0.87, 0.18, 24), M.hammerBand);
      band.rotation.x = Math.PI / 2;
      band.position.z = z;
      head.add(band);
    }
    pivot.add(head);
    g.add(pivot);
    o.mesh = pivot;
  }
  o.cooldown = 0;
  return g;
}

function disposeGroup(group) {
  group.traverse(obj => {
    if (obj.geometry && !Object.values(G).includes(obj.geometry)) obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) {
      if (Object.values(M).includes(m) || M.slider.includes(m)) continue;
      if (m.map && m.map !== stripeTex) m.map.dispose();
      m.dispose();
    }
  });
}

function buildLevel(n) {
  if (levelGroup) { disposeGroup(levelGroup); scene.remove(levelGroup); }
  level = generateLevel(n);
  levelGroup = new THREE.Group();
  scene.add(levelGroup);

  // floor & rails for each continuous run between gaps
  const runs = [];
  let a = level.startS;
  for (const gp of [...level.gaps].sort((p, q) => p[0] - q[0])) { runs.push([a, gp[0]]); a = gp[1]; }
  runs.push([a, level.endS]);
  const postMatrices = [];
  for (const [ra, rb] of runs) {
    levelGroup.add(buildFloor(ra, rb));
    buildRails(ra, rb, levelGroup, postMatrices);
  }
  const posts = new THREE.InstancedMesh(G.post, M.post, postMatrices.length);
  postMatrices.forEach((m, i) => posts.setMatrixAt(i, m));
  levelGroup.add(posts);

  // stars
  level.coinMeshes = level.coins.map(c => {
    const m = new THREE.Mesh(G.star, M.star);
    W(c.x, floorY(c.s) + (c.h || 0.75), c.s, m.position);
    m.castShadow = true;
    c.mesh = m; c.taken = false;
    levelGroup.add(m);
    return m;
  });

  // rings over jumps
  for (const r of level.rings) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.22, 12, 40), M.ring);
    r.y = baseY(r.s) + r.h;
    placeOnTrack(m, r.s, r.y);
    levelGroup.add(m);
    r.mesh = m; r.done = false;
  }

  // obstacles
  for (const o of level.obstacles) levelGroup.add(buildObstacle(o));

  // checkpoints (skip the one at the very start)
  const cpBanner = bannerTex('CHECKPOINT', '#38bdf8', '#0284c7');
  level.cpGates = level.checkpoints.map((s, i) => {
    if (i === 0) return null;
    const gt = gate(s, cpBanner, M.gatePost.clone());
    levelGroup.add(gt);
    return gt;
  });
  levelGroup.add(gate(level.finishS, bannerTex('FINISH', '#222', '#fff', true), M.gatePost));

  // clouds for scenery
  const rng = mulberry32(n * 31 + 5);
  for (let s = -10; s < level.endS + 60; s += 9) {
    const side = rng() < 0.5 ? -1 : 1;
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < puffs; i++) {
      const p = new THREE.Mesh(G.cloud, M.cloud);
      const sc = 1.5 + rng() * 2;
      p.scale.set(sc * 1.3, sc, sc);
      p.position.set(i * 2.2 - puffs, rng() * 1.2, rng() * 1.5);
      cloud.add(p);
    }
    W(side * (16 + rng() * 30), baseY(s) - 14 + rng() * 12, s + rng() * 6, cloud.position);
    levelGroup.add(cloud);
  }
}

// ---------------------------------------------------------------------------
// Particles (confetti + star sparkles)
// ---------------------------------------------------------------------------
const particles = [];
const confettiColors = [0xff4d6d, 0xffd21f, 0x22c55e, 0x3b82f6, 0xa855f7, 0xf97316];
const confettiMats = confettiColors.map(c => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
function burst(pos, count, { speed = 6, up = 6, life = 1.6, gold = false } = {}) {
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(G.confetti, gold ? M.star : confettiMats[i % confettiMats.length]);
    m.position.copy(pos);
    m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    scene.add(m);
    particles.push({
      m, life, max: life,
      v: new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * up + up * 0.3, (Math.random() - 0.5) * speed),
      spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, 0),
    });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { scene.remove(p.m); particles.splice(i, 1); continue; }
    p.v.y -= 9 * dt;
    p.v.multiplyScalar(Math.exp(-1.2 * dt));
    p.m.position.addScaledVector(p.v, dt);
    p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt;
    const k = Math.min(1, p.life / (p.max * 0.3));
    p.m.scale.setScalar(k);
  }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const $ = id => document.getElementById(id);
const ui = {
  levelNum: $('levelNum'), progress: $('progressFill'), stars: $('starCount'), toast: $('toast'), hint: $('hint'),
  start: $('startScreen'), pause: $('pauseScreen'), win: $('winScreen'),
};
let toastTimer = 0;
function toast(text, secs = 1.2) {
  ui.toast.textContent = text;
  ui.toast.classList.add('show');
  toastTimer = secs;
}
function showOverlay(el) {
  for (const o of [ui.start, ui.pause, ui.win]) o.classList.toggle('show', o === el);
}

let maxLevel = store.get('maxLevel', 1);
let pickLevel = store.get('level', 1);
function refreshPicker() {
  pickLevel = clamp(pickLevel, 1, maxLevel);
  $('lvlPick').textContent = 'Level ' + pickLevel;
  $('lvlDown').disabled = pickLevel <= 1;
  $('lvlUp').disabled = pickLevel >= maxLevel;
}
refreshPicker();

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
let state = 'menu';            // menu | playing | paused | falling | finished
let stateTimer = 0;
let starsThisLevel = 0;
let checkpointIdx = 0;
let time = 0;
let invincible = 0;
let hintShown = true;
let squash = 0;

function placeBallAt(s) {
  ball.s = s; ball.x = 0; ball.target = 0;
  ball.y = floorY(s); ball.lastSafeY = ball.y;
  ball.v = s === 0 ? 0 : 4; ball.vy = 0; ball.vxb = 0;
  ball.grounded = true; ball.inGap = false;
}

function startLevel(n) {
  buildLevel(n);
  ui.levelNum.textContent = n;
  starsThisLevel = 0;
  ui.stars.textContent = 0;
  checkpointIdx = 0;
  placeBallAt(0);
  ballMesh.quaternion.identity();
  snapCamera();
  state = 'playing';
  showOverlay(null);
  store.set('level', n);
  toast('Level ' + n, 1.2);
}

function respawn() {
  placeBallAt(level.checkpoints[checkpointIdx]);
  invincible = 1.5;
  state = 'playing';
  snapCamera();
}

function finishLevel() {
  state = 'finished';
  stateTimer = 0;
  sound.win();
  burst(W(0, floorY(level.finishS) + 4, level.finishS), 120, { speed: 14, up: 8, life: 2.5 });
  if (level.n + 1 > maxLevel) { maxLevel = level.n + 1; store.set('maxLevel', maxLevel); }
  const finished = level;
  setTimeout(() => {
    if (state !== 'finished' || level !== finished) return;
    $('winTitle').textContent = `Level ${level.n} Done!`;
    $('winStars').textContent = `⭐ ${starsThisLevel} / ${level.coins.length + level.rings.length * 3}`;
    $('winMsg').textContent = ['Great job!', 'You did it!', 'Super rolling!', 'Amazing!', 'Way to go!'][level.n % 5];
    showOverlay(ui.win);
  }, 1600);
}

// ---------------------------------------------------------------------------
// Input: drag anywhere to steer
// ---------------------------------------------------------------------------
let dragging = false, lastPX = 0, lastPY = 0;
const keys = { left: false, right: false, up: false, down: false };
function pushBall(dv) {
  if (!ball.grounded) return;   // no pushing mid-air
  ball.v = clamp(ball.v + dv, MAX_BACK, maxSpeed(level.n));
}
window.addEventListener('pointerdown', e => {
  sound.unlock();
  if (e.target.closest('button')) return;
  dragging = true; lastPX = e.clientX; lastPY = e.clientY;
});
window.addEventListener('pointermove', e => {
  if (!dragging || state !== 'playing') { lastPX = e.clientX; lastPY = e.clientY; return; }
  const dx = e.clientX - lastPX;
  lastPX = e.clientX;
  const dy = e.clientY - lastPY;
  lastPY = e.clientY;
  ball.target += (dx / window.innerWidth) * TRACK_W * STEER_SENS;
  // swipe up pushes the ball forward, swipe down brakes / rolls it back
  pushBall((-dy / window.innerHeight) * PUSH_SENS);
  if (hintShown && Math.hypot(dx, dy) > 2) { hintShown = false; ui.hint.style.opacity = 0; }
});
for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, () => { dragging = false; });
window.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = true;
  if (e.key === 'ArrowRight' || e.key === 'd') keys.right = true;
  if (e.key === 'ArrowUp' || e.key === 'w') keys.up = true;
  if (e.key === 'ArrowDown' || e.key === 's') keys.down = true;
});
window.addEventListener('keyup', e => {
  if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = false;
  if (e.key === 'ArrowRight' || e.key === 'd') keys.right = false;
  if (e.key === 'ArrowUp' || e.key === 'w') keys.up = false;
  if (e.key === 'ArrowDown' || e.key === 's') keys.down = false;
});
// stop iOS pinch-zoom / double-tap zoom / scroll bounce
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
document.addEventListener('dblclick', e => e.preventDefault());

function pause() {
  if (state !== 'playing' && state !== 'falling') return;
  pausedFrom = state;
  state = 'paused';
  showOverlay(ui.pause);
}
let pausedFrom = 'playing';
$('pauseBtn').addEventListener('click', pause);
$('resumeBtn').addEventListener('click', () => { state = pausedFrom; showOverlay(null); });
$('restartBtn').addEventListener('click', () => startLevel(level.n));
$('menuBtn').addEventListener('click', () => { state = 'menu'; pickLevel = level.n; refreshPicker(); showOverlay(ui.start); });
$('playBtn').addEventListener('click', () => { sound.unlock(); startLevel(pickLevel); });
$('lvlDown').addEventListener('click', () => { pickLevel--; refreshPicker(); });
$('lvlUp').addEventListener('click', () => { pickLevel++; refreshPicker(); });
$('nextBtn').addEventListener('click', () => startLevel(level.n + 1));
$('againBtn').addEventListener('click', () => startLevel(level.n));
const muteBtn = $('muteBtn');
const syncMute = () => { muteBtn.textContent = sound.muted ? '🔇' : '🔊'; };
syncMute();
muteBtn.addEventListener('click', () => { sound.muted = !sound.muted; store.set('muted', sound.muted); syncMute(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------
function hit(o, nx, nz, pen, obsVx, strength) {
  // n points from the obstacle toward the ball, in world xz (world z = -s)
  ball.x += nx * pen;
  ball.target += nx * pen;
  ball.s -= nz * pen;
  if (o.cooldown > 0) return;
  o.cooldown = 0.35;
  // hit it head-on (front while rolling forward, back while rolling backward): bounce off
  if (Math.abs(nz) > 0.45 && ball.v * nz > 0) ball.v = -ball.v * 0.3;
  else ball.v *= 0.85;
  ball.vxb += nx * strength + obsVx * 0.5;
  squash = 1;
  sound.bump();
}

function collideObstacles(dt) {
  const g = groundY(ball.s, ball.x);
  if (g === null || ball.y > g + 1.5) return;
  const bz = -ball.s;
  for (const o of level.obstacles) {
    o.cooldown = Math.max(0, o.cooldown - dt);
    if (Math.abs(o.s - ball.s) > 4) continue;
    const oz = -o.s;
    if (o.type === 'slider') {
      const cx = o.mesh.position.x;
      const hx = 1.2, hz = 0.6;
      const px = clamp(ball.x, cx - hx, cx + hx), pz = clamp(bz, oz - hz, oz + hz);
      let dx = ball.x - px, dz = bz - pz;
      const d = Math.hypot(dx, dz);
      if (d < R) {
        if (d < 1e-4) { dx = Math.sign(ball.x - cx) || 1; dz = 0; }
        const len = Math.hypot(dx, dz);
        const nx = dx / len, nz = dz / len;
        const vx = o.amp * o.speed * Math.cos(time * o.speed + o.phase);
        hit(o, nx, nz, R - d + 0.01, vx, 5);
        // kindly nudge the ball around the block instead of stopping it dead
        if (Math.abs(nx) < 0.4) ball.vxb += (Math.sign(ball.x - cx) || 1) * 5;
      }
    } else if (o.type === 'spinner') {
      const th = o.mesh.rotation.y;
      const ex = Math.cos(th) * 2.9, ez = -Math.sin(th) * 2.9;
      // closest point on bar segment
      const t = clamp(((ball.x) * ex + (bz - oz) * ez) / (2.9 * 2.9), -1, 1);
      const px = ex * t, pz = oz + ez * t;
      let dx = ball.x - px, dz = bz - pz;
      const d = Math.hypot(dx, dz);
      const reach = R + 0.25;
      if (d < reach) {
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
        // velocity of the bar where it touched: w x r
        const w = o.speed;
        const vx = w * (pz - oz);
        hit(o, nx, nz, reach - d + 0.01, vx, 6);
      }
      // center post
      const dp = Math.hypot(ball.x, bz - oz);
      if (dp < R + 0.45) hit(o, ball.x / dp, (bz - oz) / dp, R + 0.45 - dp + 0.01, 0, 4);
    } else if (o.type === 'hammer') {
      const th = o.mesh.rotation.z;
      const hxp = o.len * Math.sin(th);
      const hy = floorY(o.s) + o.pivotY - o.len * Math.cos(th);
      const dzRaw = bz - oz;
      const dzc = dzRaw - clamp(dzRaw, -0.9, 0.9);
      const dx = ball.x - hxp, dy = (ball.y + R) - hy;
      const d = Math.hypot(dx, dy, dzc);
      const reach = R + 0.85;
      if (d < reach) {
        const flat = Math.hypot(dx, dzc) || 1;
        const nx = dx / flat, nz = dzc / flat;
        const thDot = o.amp * o.speed * Math.cos(time * o.speed + o.phase);
        const vx = o.len * Math.cos(th) * thDot;
        hit(o, Math.abs(nx) < 0.2 && Math.abs(nz) < 0.2 ? Math.sign(vx) || 1 : nx, nz, (reach - d) * 0.8 + 0.01, vx, 7);
      }
    }
  }
}

function stepBall(dt) {
  const vt = targetSpeed(level.n);
  // forward motion
  if (state === 'finished') ball.v = Math.max(0, ball.v - 6 * dt);
  else if (ball.grounded) {
    // momentum: speed from swipes fades slowly; the downhill slope keeps it gently rolling forward
    if (keys.up) pushBall(10 * dt);
    if (keys.down) pushBall(-10 * dt);
    if (ball.v > CRUISE) ball.v = Math.max(CRUISE, ball.v - (0.6 + (ball.v - CRUISE) * 0.12) * dt);
    else ball.v = Math.min(CRUISE, ball.v + 2.5 * dt);
  }
  // ramps act as boosters so every jump clears its gap
  if (rampAt(ball.s) && ball.grounded && ball.v > 0) ball.v = Math.max(ball.v, vt);
  const prevS = ball.s;
  ball.s += ball.v * dt;

  // steering
  if (keys.left) ball.target -= 9 * dt;
  if (keys.right) ball.target += 9 * dt;
  ball.target = clamp(ball.target, -HW - 1.2, HW + 1.2);
  const ctrl = clamp((ball.target - ball.x) * 12, -11, 11);
  ball.x += (ctrl + ball.vxb) * dt;
  ball.target += ball.vxb * dt;
  ball.vxb *= Math.exp(-5 * dt);
  // fast balls drift gently toward the outside of a bend
  if (ball.grounded) ball.vxb += curvature(ball.s) * ball.v * ball.v * 0.08 * dt;

  // guard rails
  const g0 = floorY(ball.s);
  // (a ball already outside the rails, e.g. after missing a jump, stays outside)
  if (railsAt(ball.s) && ball.y < g0 + RAIL_H + 0.6 && Math.abs(ball.x) < HW + 0.2) {
    const lim = HW - R - RAIL_R;
    if (Math.abs(ball.x) > lim) {
      const side = Math.sign(ball.x);
      ball.x = side * lim;
      if (Math.sign(ball.vxb) === side) ball.vxb = -ball.vxb * 0.35;
    }
    ball.target = clamp(ball.target, -lim, lim);
  }

  // bumped into the far side of a gap while falling short: stop and drop
  const gp = gapAt(prevS);
  if (gp && !gapAt(ball.s) && ball.s >= gp[1] && ball.y < floorY(ball.s) - 0.3) {
    ball.s = gp[1] - R * 1.1;
    ball.v = 0;
  }

  // vertical
  const g = groundY(ball.s, ball.x);
  if (ball.grounded) {
    if (g !== null && g > ball.y - 0.35) {
      ball.y = g;
      ball.vy = slopeAt(ball.s) * ball.v;
    } else {
      ball.grounded = false;
      if (ball.vy > 1) sound.jump();
    }
  }
  if (!ball.grounded) {
    ball.vy -= GRAVITY * dt;
    ball.y += ball.vy * dt;
    const g2 = groundY(ball.s, ball.x);
    if (g2 !== null && ball.y <= g2 && ball.y > g2 - 1.0 && ball.vy <= 0) {
      if (ball.vy < -5) { sound.land(); squash = 1; }
      ball.y = g2;
      ball.grounded = true;
    }
  }
  if (ball.grounded) ball.lastSafeY = ball.y;

  if (ball.s >= level.endS - 1) { ball.s = level.endS - 1; ball.v = 0; }
  if (ball.s <= level.startS + 1) { ball.s = level.startS + 1; ball.v = Math.max(0, ball.v); }

  return prevS;
}

function update(dt) {
  time += dt;
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) ui.toast.classList.remove('show'); }
  invincible = Math.max(0, invincible - dt);
  squash = Math.max(0, squash - dt * 4);

  if (!level) return;

  // animate obstacles, stars, rings
  for (const o of level.obstacles) {
    if (o.type === 'slider') o.mesh.position.x = o.amp * Math.sin(time * o.speed + o.phase);
    else if (o.type === 'spinner') o.mesh.rotation.y = time * o.speed + o.phase;
    else if (o.type === 'hammer') o.mesh.rotation.z = o.amp * Math.sin(time * o.speed + o.phase);
  }
  for (const c of level.coins) if (!c.taken) c.mesh.rotation.y = time * 3 + c.s;
  for (const r of level.rings) r.mesh.rotation.z = time * 0.6;
  updateParticles(dt);

  if (state === 'playing' || state === 'falling' || state === 'finished') {
    const prevS = stepBall(dt);
    if (state !== 'falling' && invincible <= 0) collideObstacles(dt);

    // stars
    for (const c of level.coins) {
      if (c.taken || Math.abs(c.s - ball.s) > 1.5) continue;
      const cy = floorY(c.s) + (c.h || 0.75);
      if (Math.hypot(c.x - ball.x, cy - (ball.y + R), c.s - ball.s) < 1.15) {
        c.taken = true;
        c.mesh.visible = false;
        starsThisLevel++;
        ui.stars.textContent = starsThisLevel;
        sound.coin();
        burst(c.mesh.position, 6, { speed: 3, up: 3, life: 0.6, gold: true });
      }
    }
    // rings
    for (const r of level.rings) {
      if (!r.done && prevS < r.s && ball.s >= r.s && Math.hypot(ball.x, ball.y + R - r.y) < 2.1) {
        r.done = true;
        starsThisLevel += 3;
        ui.stars.textContent = starsThisLevel;
        sound.ring();
        toast('Awesome! +3 ⭐', 1);
        burst(r.mesh.position, 30, { speed: 7, up: 3, life: 1 });
      }
    }
    // checkpoints
    for (let i = checkpointIdx + 1; i < level.checkpoints.length; i++) {
      if (ball.s >= level.checkpoints[i] && state === 'playing') {
        checkpointIdx = i;
        const gt = level.cpGates[i];
        if (gt) gt.children.forEach(ch => { if (ch.geometry?.type === 'CylinderGeometry') ch.material = M.gatePostDone; });
        sound.checkpoint();
        toast('Checkpoint! 🚩', 1);
      }
    }
    // finish line
    if (state === 'playing' && ball.s >= level.finishS) finishLevel();
    // fell off?
    if (state === 'playing' && ball.y < ball.lastSafeY - 5) {
      state = 'falling';
      stateTimer = 0;
      sound.whoops();
      toast('Whoops!', 1);
    }
    if (state === 'falling') {
      stateTimer += dt;
      if (stateTimer > 1.0) respawn();
    }
  }

  // ball visuals
  const prevPos = ballMesh.position.clone();
  W(ball.x, ball.y + R, ball.s, ballMesh.position);
  const move = ballMesh.position.clone().sub(prevPos);
  move.y = 0;
  const dist = move.length();
  if (dist > 0 && dist < 3) {
    const axis = new THREE.Vector3(0, 1, 0).cross(move).normalize();
    ballMesh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, dist / R));
  }
  const sq = Math.sin(squash * Math.PI) * 0.15;
  ballMesh.scale.set(1 + sq, 1 - sq, 1 + sq);
  ballMesh.visible = invincible <= 0 || Math.floor(invincible * 10) % 2 === 0;

  ui.progress.style.width = clamp((ball.s / level.finishS) * 100, 0, 100) + '%';
  updateCamera(dt);
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
function cameraGoal() {
  const followY = Math.max(ball.y, ball.lastSafeY - 2);
  return {
    pos: W(ball.x * 0.55, followY + 3.4, ball.s - 7),
    look: W(ball.x * 0.35, followY + 0.4, ball.s + 7),
  };
}
function snapCamera() {
  const { pos, look } = cameraGoal();
  camPos.copy(pos); camLook.copy(look);
}
function updateCamera(dt) {
  const { pos, look } = cameraGoal();
  const k = 1 - Math.exp(-7 * dt);
  camPos.lerp(pos, k);
  camLook.lerp(look, k);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  const bp = ballMesh.position;
  sun.position.set(bp.x + 6, bp.y + 16, bp.z + 4);
  sun.target.position.set(bp.x, bp.y, bp.z - 4);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastT = performance.now();
function frame(now) {
  const dt = Math.min((now - lastT) / 1000, 1 / 20);
  lastT = now;
  if (state !== 'paused') {
    // two substeps keep fast collisions solid
    update(dt / 2);
    update(dt / 2);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Show the course of the selected level behind the start menu
buildLevel(pickLevel);
ui.levelNum.textContent = pickLevel;
placeBallAt(0);
snapCamera();
requestAnimationFrame(frame);

// handy for testing in the console
window.__game = {
  get state() { return state; }, get level() { return level; }, ball, startLevel,
  get stars() { return starsThisLevel; },
};
