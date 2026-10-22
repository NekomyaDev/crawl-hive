"use client";
// Визуал CrawlHive Brain на three.js: облако нейронов в форме мозга (два полушария, борозды шумом, мозжечок),
// тонкие связи между ближними нейронами и световые импульсы, бегущие по связям. Пока мозг «думает»
// (проп thinking, событие window "crawlhive:brain" или клик по мозгу), импульсов и свечения резко больше
// и по коре идёт волна. В покое всё спокойно.
// three грузится динамически внутри useEffect, поэтому SSR и cacheComponents его не видят.
// Производительность: DPR не выше 2, точек меньше на телефонах и слабых CPU, рендер на паузе вне экрана
// и в скрытой вкладке, при prefers-reduced-motion один статичный кадр. Всё освобождается при размонтировании.
import { useEffect, useRef } from "react";
import type * as THREE_NS from "three";
import { cn } from "@/lib/utils";

type Three = typeof THREE_NS;

// Палитра из токенов globals.css (читаем на клиенте, запасные значения те же), с весами.
const TOKENS: [string, string, number][] = [
  ["--pink", "#f472b6", 0.34],
  ["--honey", "#ffb020", 0.3],
  ["--coral", "#ff6a3d", 0.24],
  ["--lime", "#b6f23a", 0.12],
];

const LINK = 0.17; // дальность связи между нейронами в единицах сцены
const MAX_LINKS = 3; // связей на нейрон, не больше

/** detail события window "crawlhive:brain": { thinking: true/false } или { burst: true }. */
export type BrainEventDetail = { thinking?: boolean; burst?: boolean };

const POINT_VS = /* glsl */ `
  attribute vec3 color;
  attribute float aSize;
  attribute float aFire;
  uniform float uScale;
  uniform float uGlow;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float depth = -mv.z;
    float fog = 1.0 - smoothstep(uFogNear, uFogFar, depth);
    vColor = color * (0.7 + aFire * 2.6) * uGlow;
    vAlpha = (0.2 + 0.8 * fog) * (0.55 + aFire * 0.45);
    gl_PointSize = aSize * uScale * (1.0 + aFire * 1.8) / depth;
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FS = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, pow(core, 1.8) * vAlpha);
  }
`;

const LINE_VS = /* glsl */ `
  attribute vec3 color;
  attribute float aFire;
  uniform float uOpacity;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float fog = 1.0 - smoothstep(uFogNear, uFogFar, -mv.z);
    vColor = color * (1.0 + aFire * 2.0);
    vAlpha = uOpacity * (0.15 + 0.85 * fog) * (1.0 + aFire * 3.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const LINE_FS = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(vColor, vAlpha);
  }
`;

// Детерминированный ГПСЧ (mulberry32), чтобы форма мозга не менялась между загрузками.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Точки мозга: полушария как сплюснутые эллипсоиды с бороздами, щель между ними, мозжечок сзади снизу, ствол.
function brainPoints(n: number, rand: () => number): Float32Array {
  const out = new Float32Array(n * 3);
  let i = 0;
  while (i < n) {
    const r = rand();
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const q = Math.sqrt(1 - u * u);
    const dx = q * Math.cos(th);
    const dy = u;
    const dz = q * Math.sin(th);
    let x: number, y: number, z: number;
    if (r < 0.9) {
      const side = rand() < 0.5 ? -1 : 1;
      const shell = 0.78 + 0.22 * Math.sqrt(rand()); // кора: точки тяготеют к поверхности
      const gyri = 1 + 0.075 * Math.sin(dx * 9 + dz * 3) * Math.sin(dy * 10 + side) * Math.sin(dz * 8 + dx * 2);
      const k = shell * gyri;
      x = side * 0.34 + dx * 0.6 * k;
      y = dy * 0.74 * k;
      z = dz * 1.02 * k;
      if (x * side < 0.035) continue; // продольная щель между полушариями
      if (y < -0.42) y = -0.42 + (y + 0.42) * 0.45; // плоское основание
      y += 0.08 * Math.cos(z * 1.6);
    } else if (r < 0.98) {
      const k = 0.7 + 0.3 * Math.sqrt(rand());
      x = dx * 0.5 * k;
      y = -0.5 + dy * 0.24 * k;
      z = -0.72 + dz * 0.36 * k;
    } else {
      const t = rand();
      x = (rand() - 0.5) * 0.14;
      y = -0.45 - t * 0.5;
      z = -0.25 - t * 0.15 + (rand() - 0.5) * 0.12;
    }
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
    i++;
  }
  return out;
}

// Связи: сетка ячеек размером LINK, для каждой точки до MAX_LINKS ближайших соседей, без повторов.
function buildEdges(pos: Float32Array, n: number): Uint32Array {
  const cell = LINK;
  const key = (a: number, b: number, c: number) => `${a},${b},${c}`;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(pos[i * 3] / cell), Math.floor(pos[i * 3 + 1] / cell), Math.floor(pos[i * 3 + 2] / cell));
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(i);
  }
  const seen = new Set<number>();
  const edges: number[] = [];
  const near: [number, number][] = [];
  const l2 = LINK * LINK;
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(pos[i * 3] / cell);
    const cy = Math.floor(pos[i * 3 + 1] / cell);
    const cz = Math.floor(pos[i * 3 + 2] / cell);
    near.length = 0;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++) {
          const arr = grid.get(key(cx + a, cy + b, cz + c));
          if (!arr) continue;
          for (const j of arr) {
            if (j === i) continue;
            const ddx = pos[i * 3] - pos[j * 3];
            const ddy = pos[i * 3 + 1] - pos[j * 3 + 1];
            const ddz = pos[i * 3 + 2] - pos[j * 3 + 2];
            const d = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d < l2 && d > 1e-6) near.push([d, j]);
          }
        }
    near.sort((p, q) => p[0] - q[0]);
    for (let m = 0; m < Math.min(MAX_LINKS, near.length); m++) {
      const j = near[m][1];
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      const id = lo * n + hi;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push(lo, hi);
    }
  }
  return Uint32Array.from(edges);
}

export function BrainNeurons({
  className,
  nodes,
  thinking = false,
}: {
  className?: string;
  /** Сколько нейронов. По умолчанию 3000 на десктопе и 1400 на телефоне или слабом CPU. */
  nodes?: number;
  /** Мозг думает: идёт запрос к Brain. */
  thinking?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const think = useRef(thinking);
  const api = useRef<{ burst: () => void; redraw: () => void } | null>(null);

  // Смена thinking не пересобирает сцену: цикл читает ref, а включение запускает волну.
  useEffect(() => {
    const was = think.current;
    think.current = thinking;
    if (thinking && !was) api.current?.burst();
    api.current?.redraw();
  }, [thinking]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let dead = false;
    let cleanup: (() => void) | null = null;

    import("three").then((THREE: Three) => {
      if (dead) return;
      cleanup = mount(THREE, el);
    });

    function mount(T: Three, host: HTMLDivElement): () => void {
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const small = window.matchMedia("(max-width: 640px)").matches || (navigator.hardwareConcurrency || 8) <= 4;
      const N = nodes ?? (small ? 1400 : 3000);
      const PULSES = small ? 120 : 260;
      const rand = rng(0xc4a1);

      let renderer: THREE_NS.WebGLRenderer;
      try {
        renderer = new T.WebGLRenderer({ antialias: !small, alpha: true, powerPreference: "high-performance" });
      } catch {
        return () => {}; // без WebGL остаётся фон контейнера
      }
      renderer.setClearColor(0x000000, 0);
      const canvas = renderer.domElement;
      canvas.className = "absolute inset-0 h-full w-full";
      canvas.setAttribute("aria-hidden", "true");
      host.prepend(canvas);

      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(38, 1, 0.1, 50);
      const group = new T.Group();
      group.rotation.set(0.3, 0.9, 0);
      scene.add(group);

      const css = getComputedStyle(document.documentElement);
      const pal = TOKENS.map(([v, fb, w]) => ({ c: new T.Color(css.getPropertyValue(v).trim() || fb), w }));
      const pick = () => {
        let x = rand();
        for (const p of pal) if ((x -= p.w) <= 0) return p.c;
        return pal[0].c;
      };

      // Нейроны
      const pos = brainPoints(N, rand);
      const col = new Float32Array(N * 3);
      const size = new Float32Array(N);
      const fire = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const c = pick();
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
        size[i] = 0.016 + rand() * rand() * 0.045;
      }
      const fog = { uFogNear: { value: 3.4 }, uFogFar: { value: 6.2 } };
      const scale = { value: 300 };
      const pGeo = new T.BufferGeometry();
      pGeo.setAttribute("position", new T.BufferAttribute(pos, 3));
      pGeo.setAttribute("color", new T.BufferAttribute(col, 3));
      pGeo.setAttribute("aSize", new T.BufferAttribute(size, 1));
      const fireAttr = new T.BufferAttribute(fire, 1).setUsage(T.DynamicDrawUsage);
      pGeo.setAttribute("aFire", fireAttr);
      const pointMat = (glow: number) =>
        new T.ShaderMaterial({
          uniforms: { uScale: scale, uGlow: { value: glow }, ...fog },
          vertexShader: POINT_VS,
          fragmentShader: POINT_FS,
          transparent: true,
          depthWrite: false,
          blending: T.AdditiveBlending,
        });
      const pMat = pointMat(0.7);
      group.add(new T.Points(pGeo, pMat));

      // Связи
      const edges = buildEdges(pos, N);
      const E = edges.length / 2;
      const lPos = new Float32Array(E * 6);
      const lCol = new Float32Array(E * 6);
      const lFire = new Float32Array(E * 2);
      for (let e = 0; e < E; e++)
        for (let s = 0; s < 2; s++) {
          const i = edges[e * 2 + s];
          for (let c = 0; c < 3; c++) {
            lPos[e * 6 + s * 3 + c] = pos[i * 3 + c];
            lCol[e * 6 + s * 3 + c] = col[i * 3 + c];
          }
        }
      const lGeo = new T.BufferGeometry();
      lGeo.setAttribute("position", new T.BufferAttribute(lPos, 3));
      lGeo.setAttribute("color", new T.BufferAttribute(lCol, 3));
      const lFireAttr = new T.BufferAttribute(lFire, 1).setUsage(T.DynamicDrawUsage);
      lGeo.setAttribute("aFire", lFireAttr);
      const lMat = new T.ShaderMaterial({
        uniforms: { uOpacity: { value: 0.1 }, ...fog },
        vertexShader: LINE_VS,
        fragmentShader: LINE_FS,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
      });
      group.add(new T.LineSegments(lGeo, lMat));

      // Соседство по связям (CSR), для цепочек импульсов
      const adjStart = new Uint32Array(N + 1);
      for (let e = 0; e < E; e++) {
        adjStart[edges[e * 2] + 1]++;
        adjStart[edges[e * 2 + 1] + 1]++;
      }
      for (let i = 0; i < N; i++) adjStart[i + 1] += adjStart[i];
      const adj = new Uint32Array(E * 2);
      const fillAt = adjStart.slice(0, N);
      for (let e = 0; e < E; e++) {
        adj[fillAt[edges[e * 2]]++] = e;
        adj[fillAt[edges[e * 2 + 1]]++] = e;
      }

      // Импульсы: пул точек, живые лежат в начале буфера
      const qPos = new Float32Array(PULSES * 3);
      const qCol = new Float32Array(PULSES * 3);
      const qEdge = new Int32Array(PULSES);
      const qFrom = new Int32Array(PULSES);
      const qT = new Float32Array(PULSES);
      const qSpeed = new Float32Array(PULSES);
      let live = 0;
      const qGeo = new T.BufferGeometry();
      const qPosAttr = new T.BufferAttribute(qPos, 3).setUsage(T.DynamicDrawUsage);
      const qColAttr = new T.BufferAttribute(qCol, 3).setUsage(T.DynamicDrawUsage);
      qGeo.setAttribute("position", qPosAttr);
      qGeo.setAttribute("color", qColAttr);
      qGeo.setAttribute("aSize", new T.BufferAttribute(new Float32Array(PULSES).fill(0.05), 1));
      qGeo.setAttribute("aFire", new T.BufferAttribute(new Float32Array(PULSES).fill(1), 1));
      qGeo.setDrawRange(0, 0);
      const qMat = pointMat(0.9);
      const qPoints = new T.Points(qGeo, qMat);
      qPoints.frustumCulled = false;
      group.add(qPoints);

      const spawn = (e: number, from: number) => {
        if (live >= PULSES) return;
        const q = live++;
        qEdge[q] = e;
        qFrom[q] = from;
        qT[q] = 0;
        qSpeed[q] = 1.6 + rand() * 1.6;
        const c = pick();
        qCol[q * 3] = c.r;
        qCol[q * 3 + 1] = c.g;
        qCol[q * 3 + 2] = c.b;
      };
      const spawnFrom = (node: number, except = -1) => {
        const a = adjStart[node];
        const b = adjStart[node + 1];
        if (b <= a) return;
        const e = adj[a + Math.floor(rand() * (b - a))];
        if (e !== except) spawn(e, node);
      };

      // Волна: сфера растёт от случайного нейрона и зажигает всё, что пересекает.
      let waveO = -1;
      let waveR = 0;
      let waveMax = 0;
      const burst = (max = 3.2) => {
        waveO = Math.floor(rand() * N);
        waveR = 0;
        waveMax = max;
      };

      let k = think.current ? 1 : 0; // сглаженная «задумчивость», 0 покой, 1 раздумье
      let firing = 0;

      const resize = () => {
        const w = Math.max(1, host.clientWidth);
        const h = Math.max(1, host.clientHeight);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        // узкий контейнер: камера дальше, чтобы мозг влезал по ширине
        camera.position.set(0, 0, 3.7 * Math.max(1, 1.2 / camera.aspect));
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        fog.uFogNear.value = camera.position.z - 1.0;
        fog.uFogFar.value = camera.position.z + 1.8;
        scale.value = (h * dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360));
      };

      const applyGlow = () => {
        pMat.uniforms.uGlow.value = 0.7 + 0.9 * k;
        qMat.uniforms.uGlow.value = 0.9 + 1.4 * k;
        lMat.uniforms.uOpacity.value = 0.1 + 0.16 * k;
      };

      const step = (dt: number) => {
        const target = think.current ? 1 : 0;
        k += (target - k) * Math.min(1, dt * (target ? 6 : 1.5));
        applyGlow();
        group.rotation.y += dt * (0.12 + 0.28 * k);

        // новые импульсы: в покое редко, в раздумье ливнем
        for (let n = (4 + 140 * k) * dt; n > 0; n -= 1) if (rand() < n) spawnFrom(Math.floor(rand() * N));
        // изредка мелкая спонтанная мысль, чтобы покой не был мёртвым
        if (waveO < 0 && k < 0.2 && rand() < dt / 9) burst(0.55);

        if (waveO >= 0) {
          waveR += dt * (1.3 + 0.9 * k);
          const ox = pos[waveO * 3];
          const oy = pos[waveO * 3 + 1];
          const oz = pos[waveO * 3 + 2];
          const lo = Math.max(0, waveR - 0.09) ** 2;
          const hi = waveR * waveR;
          for (let i = 0; i < N; i++) {
            const ddx = pos[i * 3] - ox;
            const ddy = pos[i * 3 + 1] - oy;
            const ddz = pos[i * 3 + 2] - oz;
            const d = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d <= hi && d >= lo) {
              fire[i] = 1;
              if (rand() < 0.03 + 0.07 * k) spawnFrom(i);
            }
          }
          if (waveR > waveMax) waveO = -1;
        }

        // движение импульсов; на прибытии нейрон вспыхивает и, бывает, передаёт сигнал дальше
        const chain = 0.35 + 0.5 * k;
        for (let q = live - 1; q >= 0; q--) {
          qT[q] += dt * qSpeed[q] * (1 + k);
          if (qT[q] < 1) continue;
          const e = qEdge[q];
          const to = edges[e * 2] === qFrom[q] ? edges[e * 2 + 1] : edges[e * 2];
          fire[to] = 1;
          const lastQ = --live;
          if (q !== lastQ) {
            qEdge[q] = qEdge[lastQ];
            qFrom[q] = qFrom[lastQ];
            qT[q] = qT[lastQ];
            qSpeed[q] = qSpeed[lastQ];
            qCol[q * 3] = qCol[lastQ * 3];
            qCol[q * 3 + 1] = qCol[lastQ * 3 + 1];
            qCol[q * 3 + 2] = qCol[lastQ * 3 + 2];
          }
          if (rand() < chain) spawnFrom(to, e);
        }
        for (let q = 0; q < live; q++) {
          const e = qEdge[q];
          const a = qFrom[q];
          const b = edges[e * 2] === a ? edges[e * 2 + 1] : edges[e * 2];
          const t = qT[q];
          for (let c = 0; c < 3; c++) qPos[q * 3 + c] = pos[a * 3 + c] + (pos[b * 3 + c] - pos[a * 3 + c]) * t;
        }
        qGeo.setDrawRange(0, live);
        qPosAttr.needsUpdate = true;
        qColAttr.needsUpdate = true;

        // затухание вспышек
        const decay = Math.exp(-dt * (2.6 - 0.8 * k));
        firing = 0;
        for (let i = 0; i < N; i++) {
          const f = fire[i] * decay;
          fire[i] = f < 0.003 ? 0 : f;
          if (f > 0.35) firing++;
        }
        for (let e = 0; e < E; e++) {
          lFire[e * 2] = fire[edges[e * 2]];
          lFire[e * 2 + 1] = fire[edges[e * 2 + 1]];
        }
        fireAttr.needsUpdate = true;
        lFireAttr.needsUpdate = true;
      };

      const fmt = new Intl.NumberFormat("en-US");
      const writeLabel = () => {
        if (label.current)
          label.current.textContent = `${fmt.format(N)} neurons · ${fmt.format(firing)} fired · ${think.current ? "thinking" : "idle"}`;
      };

      const renderStatic = () => {
        // статичный кадр: тот же мозг, свечение по текущему состоянию, без движения
        k = think.current ? 1 : 0;
        applyGlow();
        group.rotation.y = 0.6;
        renderer.render(scene, camera);
        writeLabel();
      };

      let raf = 0;
      let running = false;
      let visible = false;
      let last = 0;
      let lastLabel = 0;
      const loop = (now: number) => {
        const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
        last = now;
        step(dt);
        renderer.render(scene, camera);
        if (now - lastLabel > 250) {
          lastLabel = now;
          writeLabel();
        }
        raf = requestAnimationFrame(loop);
      };
      const sync = () => {
        const want = !still && visible && !document.hidden;
        if (want && !running) {
          running = true;
          last = performance.now();
          raf = requestAnimationFrame(loop);
        } else if (!want && running) {
          running = false;
          cancelAnimationFrame(raf);
        }
      };

      resize();
      if (still) renderStatic();
      else {
        step(0.016); // первый кадр сразу, чтобы блок не был пустым до старта цикла
        renderer.render(scene, camera);
        writeLabel();
      }

      api.current = {
        burst: () => {
          if (!still) burst();
        },
        redraw: () => {
          if (still) renderStatic();
        },
      };

      const ro = new ResizeObserver(() => {
        resize();
        if (!running) renderer.render(scene, camera);
      });
      ro.observe(host);
      const io = new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        sync();
      });
      io.observe(host);
      document.addEventListener("visibilitychange", sync);

      const onEvent = (ev: Event) => {
        const d = (ev as CustomEvent<BrainEventDetail>).detail || {};
        if (typeof d.thinking === "boolean") {
          const was = think.current;
          think.current = d.thinking;
          if (d.thinking && !was && !still) burst();
        }
        if (d.burst && !still) burst();
        if (still) renderStatic();
      };
      window.addEventListener("crawlhive:brain", onEvent);
      const onTap = () => {
        if (!still) burst();
      };
      host.addEventListener("pointerdown", onTap);

      return () => {
        running = false;
        cancelAnimationFrame(raf);
        ro.disconnect();
        io.disconnect();
        document.removeEventListener("visibilitychange", sync);
        window.removeEventListener("crawlhive:brain", onEvent);
        host.removeEventListener("pointerdown", onTap);
        api.current = null;
        pGeo.dispose();
        lGeo.dispose();
        qGeo.dispose();
        pMat.dispose();
        lMat.dispose();
        qMat.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        canvas.remove();
      };
    }

    return () => {
      dead = true;
      cleanup?.();
      cleanup = null;
    };
  }, [nodes]);

  return (
    <div ref={box} className={cn("relative overflow-hidden", className)}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(244,114,182,0.16),transparent_55%),radial-gradient(circle_at_50%_60%,rgba(255,176,32,0.08),transparent_65%)]" />
      <span
        ref={label}
        className="pointer-events-none absolute top-3 left-3 rounded-md border border-white/10 bg-black/50 px-2 py-1 font-mono text-[11px] text-fg/80 backdrop-blur"
      >
        CrawlHive Brain
      </span>
      <span className="sr-only">CrawlHive Brain: a 3D cloud of neurons shaped like a brain, with light pulses running between them. Tap it to make it think.</span>
    </div>
  );
}
