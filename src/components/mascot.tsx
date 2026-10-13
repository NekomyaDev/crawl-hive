"use client";
// Талисман: спрут-паук из логотипа ползает поверх сайта. Рисуется на прозрачном canvas во весь экран
// и не перехватывает клики. Ноги — двухзвенная инверсная кинематика: стопа стоит на месте, пока тело
// не уйдёт далеко, потом делает шаг; ноги ходят двумя группами вперемешку, как у настоящего паука.
// Убегает от курсора, от клика удирает бегом. Скрывается кнопкой в углу, выбор помнится в браузере.
import { useEffect, useRef, useState } from "react";

const KEY = "crawlhive.mascot.off";
const MANTLE_D =
  "M-12 -2.5 C-12 -15.5 -6.5 -22.5 0 -22.5 C6.5 -22.5 12 -15.5 12 -2.5 C12 3.5 6.6 7.5 0 7.5 C-6.6 7.5 -12 3.5 -12 -2.5Z";

// Вид сверху, как у паука: глаза смотрят вперёд (+y тела), купол-мантия — брюшко сзади.
// Тазобедренные суставы и точки покоя стоп правой стороны (левая — зеркально).
const HIPS = [[6, 6], [7.5, 3], [8, 0], [7, -3]];
const REST = [[17, 29], [28, 13], [28, -4], [20, -19]];
const THIGH = 13;
const SHIN = 15;

type Vec = { x: number; y: number };
interface Leg {
  side: 1 | -1;
  idx: number;
  group: number;
  foot: Vec;
  from: Vec;
  to: Vec;
  t: number; // 1 — стоит; меньше — в шаге
}

const rot = (x: number, y: number, a: number): Vec => ({
  x: x * Math.cos(a) - y * Math.sin(a),
  y: x * Math.sin(a) + y * Math.cos(a),
});
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

export function Mascot() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [off, setOff] = useState<boolean | null>(null);

  useEffect(() => {
    let v = false;
    try {
      v = localStorage.getItem(KEY) === "1";
    } catch {}
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) v = true;
    setOff(v);
  }, []);

  const toggle = () => {
    const v = !off;
    setOff(v);
    try {
      if (v) localStorage.setItem(KEY, "1");
      else localStorage.removeItem(KEY);
    } catch {}
  };

  useEffect(() => {
    if (off !== false) return;
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const MANTLE = new Path2D(MANTLE_D);

    let W = 0;
    let H = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = window.innerWidth;
      H = window.innerHeight;
      cv.width = W * dpr;
      cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const S = W < 640 ? 0.9 : 1.3; // масштаб тела
    const margin = 40 * S;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const randomPoint = (): Vec => ({ x: rnd(margin, W - margin), y: rnd(margin, H - margin) });

    // Появляется из-за правого края.
    const p: Vec = { x: W + 40, y: rnd(H * 0.3, H * 0.8) };
    let heading = Math.PI;
    let speed = 0;
    let target = randomPoint();
    let pauseUntil = 0;
    let sprintUntil = 0;
    let squintUntil = 0;
    const mouse: Vec = { x: -999, y: -999 };

    const bodyAngle = () => heading - Math.PI / 2; // локальный +y (глаза) смотрит по направлению движения
    const toWorld = (lx: number, ly: number): Vec => {
      const r = rot(lx * S, ly * S, bodyAngle());
      return { x: p.x + r.x, y: p.y + r.y };
    };

    const legs: Leg[] = [];
    for (const side of [1, -1] as const)
      for (let i = 0; i < 4; i++) {
        const f = toWorld(REST[i][0] * side, REST[i][1]);
        legs.push({ side, idx: i, group: (i + (side === 1 ? 0 : 1)) % 2, foot: f, from: f, to: f, t: 1 });
      }

    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const onDown = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 30 * S) {
        // Ткнули — удирает в дальний угол и жмурится.
        sprintUntil = performance.now() + 1600;
        squintUntil = performance.now() + 900;
        pauseUntil = 0;
        target = { x: p.x < W / 2 ? rnd(W * 0.65, W - margin) : rnd(margin, W * 0.35), y: rnd(margin, H - margin) };
      }
    };
    const onLeave = () => {
      mouse.x = mouse.y = -999;
    };
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    let last = performance.now();
    let raf = 0;

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // --- поведение ---
      const fleeing = Math.hypot(mouse.x - p.x, mouse.y - p.y) < 110 * S;
      if (fleeing) {
        const a = Math.atan2(p.y - mouse.y, p.x - mouse.x) + rnd(-0.4, 0.4);
        target = {
          x: Math.min(W - margin, Math.max(margin, p.x + Math.cos(a) * 220)),
          y: Math.min(H - margin, Math.max(margin, p.y + Math.sin(a) * 220)),
        };
        pauseUntil = 0;
        sprintUntil = Math.max(sprintUntil, now + 500);
      }
      const toT = dist(p, target);
      if (toT < 14 && now > pauseUntil && !fleeing) {
        // Дошёл: иногда задерживается «осмотреться», потом выбирает новую точку.
        if (Math.random() < 0.55) pauseUntil = now + rnd(900, 4200);
        target = randomPoint();
      }
      const sprint = now < sprintUntil;
      const want = now < pauseUntil ? 0 : sprint ? 230 : 70;
      speed += (want - speed) * Math.min(1, dt * (sprint ? 8 : 3));

      if (now >= pauseUntil) {
        const desired = Math.atan2(target.y - p.y, target.x - p.x);
        let d = desired - heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const turn = (sprint ? 7 : 3.2) * dt;
        heading += Math.max(-turn, Math.min(turn, d));
        // Замедляется на крутом повороте, чтобы не описывать дуги вокруг цели.
        const slow = Math.max(0.25, Math.cos(Math.min(Math.PI / 2, Math.abs(d))));
        p.x += Math.cos(heading) * speed * slow * dt;
        p.y += Math.sin(heading) * speed * slow * dt;
      }

      // --- ноги ---
      const vel: Vec = { x: Math.cos(heading) * speed, y: Math.sin(heading) * speed };
      const stride = 13 * S * (1 + speed / 160);
      const stepTime = sprint ? 0.07 : 0.13;
      for (const leg of legs) {
        if (leg.t < 1) {
          leg.t = Math.min(1, leg.t + dt / stepTime);
          const e = leg.t * leg.t * (3 - 2 * leg.t);
          leg.foot = { x: leg.from.x + (leg.to.x - leg.from.x) * e, y: leg.from.y + (leg.to.y - leg.from.y) * e };
          continue;
        }
        const rest = toWorld(REST[leg.idx][0] * leg.side, REST[leg.idx][1]);
        const otherStepping = legs.some((l) => l.group !== leg.group && l.t < 1);
        const far = dist(leg.foot, rest);
        if ((!otherStepping && far > stride) || far > stride * 2) {
          leg.from = leg.foot;
          // Ставит стопу с упреждением по ходу движения.
          leg.to = { x: rest.x + vel.x * stepTime * 1.6, y: rest.y + vel.y * stepTime * 1.6 };
          leg.t = 0;
        }
      }

      // --- рисование ---
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Тень
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(p.x + 3, p.y + 5, 15 * S, 12 * S, bodyAngle(), 0, Math.PI * 2);
      ctx.fill();

      for (const leg of legs) {
        const hip = toWorld(HIPS[leg.idx][0] * leg.side, HIPS[leg.idx][1]);
        const a = THIGH * S;
        const b = SHIN * S;
        let dx = leg.foot.x - hip.x;
        let dy = leg.foot.y - hip.y;
        let d = Math.hypot(dx, dy);
        if (d > a + b - 0.5) {
          // Тело ушло дальше длины ноги — подтягиваем стопу.
          const k = (a + b - 0.5) / d;
          leg.foot = { x: hip.x + dx * k, y: hip.y + dy * k };
          dx *= k;
          dy *= k;
          d = a + b - 0.5;
        }
        d = Math.max(d, Math.abs(a - b) + 0.5);
        const base = Math.atan2(dy, dx);
        const alpha = Math.acos(Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d))));
        // Колено выгибается наружу от тела.
        const outV = rot(leg.side, 0, bodyAngle());
        const k1 = { x: hip.x + Math.cos(base + alpha) * a, y: hip.y + Math.sin(base + alpha) * a };
        const k2 = { x: hip.x + Math.cos(base - alpha) * a, y: hip.y + Math.sin(base - alpha) * a };
        const knee =
          (k1.x - hip.x) * outV.x + (k1.y - hip.y) * outV.y > (k2.x - hip.x) * outV.x + (k2.y - hip.y) * outV.y ? k1 : k2;
        const lift = leg.t < 1 ? Math.sin(leg.t * Math.PI) : 0;

        ctx.strokeStyle = "#f39614";
        ctx.lineWidth = 3.4 * S;
        ctx.beginPath();
        ctx.moveTo(hip.x, hip.y);
        ctx.lineTo(knee.x, knee.y);
        ctx.stroke();

        // Голень — изогнутое щупальце с завитком на конце.
        const mx = (knee.x + leg.foot.x) / 2;
        const my = (knee.y + leg.foot.y) / 2;
        const nx = -(leg.foot.y - knee.y);
        const ny = leg.foot.x - knee.x;
        const nl = Math.hypot(nx, ny) || 1;
        const bend = 3.5 * S * leg.side;
        ctx.lineWidth = (2.3 + lift * 0.8) * S;
        ctx.beginPath();
        ctx.moveTo(knee.x, knee.y);
        ctx.quadraticCurveTo(mx + (nx / nl) * bend, my + (ny / nl) * bend, leg.foot.x, leg.foot.y);
        ctx.stroke();
        const fa = Math.atan2(leg.foot.y - knee.y, leg.foot.x - knee.x);
        ctx.lineWidth = 1.8 * S;
        ctx.beginPath();
        ctx.arc(
          leg.foot.x + Math.cos(fa + (Math.PI / 2) * leg.side) * 2.2 * S,
          leg.foot.y + Math.sin(fa + (Math.PI / 2) * leg.side) * 2.2 * S,
          2.2 * S,
          fa - (Math.PI / 2) * leg.side,
          fa - (Math.PI / 2) * leg.side + Math.PI * 1.3 * leg.side,
          leg.side < 0,
        );
        ctx.stroke();

        ctx.fillStyle = "#f39614";
        ctx.beginPath();
        ctx.arc(knee.x, knee.y, 2.1 * S, 0, Math.PI * 2);
        ctx.fill();
      }

      // Тело: поворачивается по ходу, слегка покачивается в такт шагам.
      const sway = Math.sin(now / 90) * Math.min(1, speed / 120) * 0.06;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(bodyAngle() + sway);
      ctx.scale(S, S);
      ctx.fillStyle = "#c45a0a";
      ctx.beginPath();
      ctx.ellipse(0, 5.8, 7.5, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      const g = ctx.createRadialGradient(-3, -14, 1, 0, -6, 22);
      g.addColorStop(0, "#ffd27a");
      g.addColorStop(0.55, "#ffb020");
      g.addColorStop(1, "#e2700f");
      ctx.fillStyle = g;
      ctx.fill(MANTLE);
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.beginPath();
      ctx.ellipse(-5, -16.5, 3.6, 2.2, -0.44, 0, Math.PI * 2);
      ctx.fill();

      const squint = now < squintUntil;
      const eyes: [number, number, number][] = [
        [-4.4, -4, 3.6], [4.4, -4, 3.6],
        [-7.4, -9.4, 1.5], [-2.6, -10.8, 1.7], [2.6, -10.8, 1.7], [7.4, -9.4, 1.5],
      ];
      ctx.fillStyle = "#07080a";
      for (const [x, y, r] of eyes) {
        ctx.beginPath();
        ctx.ellipse(x, y, r, squint ? r * 0.25 : r, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!squint) {
        // Блики смотрят в сторону курсора, если он рядом.
        const look = Math.hypot(mouse.x - p.x, mouse.y - p.y) < 300 ? rot(mouse.x - p.x, mouse.y - p.y, -bodyAngle()) : { x: 0, y: 1 };
        const ll = Math.hypot(look.x, look.y) || 1;
        const ox = (look.x / ll) * 1.1;
        const oy = (look.y / ll) * 1.1;
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        for (const [x, y, r] of eyes) {
          ctx.beginPath();
          ctx.arc(x + ox * (r / 3.6), y + oy * (r / 3.6), r > 2 ? 1.05 : 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [off]);

  if (off === null) return null;
  return (
    <>
      {!off && <canvas data-chrome ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-40 h-full w-full" />}
      <button
        data-chrome
        type="button"
        onClick={toggle}
        title={off ? "Let the crawler out" : "Put the crawler away"}
        aria-label={off ? "Show the crawling mascot" : "Hide the crawling mascot"}
        className="fixed right-3 bottom-3 z-50 grid h-8 w-8 place-items-center rounded-full border border-line bg-panel/80 text-sm opacity-50 backdrop-blur transition hover:opacity-100"
      >
        {off ? "🕷" : "✕"}
      </button>
    </>
  );
}
