"use client";
// Баннер 3:1 (1500×500) для профиля DexScreener: рисуется в браузере из картинки монеты, названия и тикера.
// Сервер не участвует, ничего не стоит; результат можно скачать PNG.
import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";

const W = 1500;
const H = 500;

function load(src: string) {
  return new Promise<HTMLImageElement>((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = fail;
    i.src = src;
  });
}

// Картинка, обрезанная до заданного прямоугольника по центру (как object-fit: cover).
function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

export function BannerMaker({ image, name, symbol }: { image: string; name: string; symbol: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState("");

  useEffect(() => {
    let dead = false;
    (async () => {
      const c = ref.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx || !image) return;
      const img = await load(image).catch(() => null);
      if (!img || dead) return;
      // Фон: та же картинка, размытая и затемнённая.
      ctx.filter = "blur(28px) saturate(1.3)";
      cover(ctx, img, -60, -60, W + 120, H + 120);
      ctx.filter = "none";
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, "rgba(7,8,11,.88)");
      g.addColorStop(0.55, "rgba(7,8,11,.55)");
      g.addColorStop(1, "rgba(7,8,11,.2)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // Картинка монеты в круге справа.
      const r = 190;
      const cx = W - 290;
      const cy = H / 2;
      ctx.save();
      ctx.shadowColor = "rgba(255,176,32,.7)";
      ctx.shadowBlur = 50;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
      ctx.fillStyle = "#ffb020";
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      cover(ctx, img, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
      // Тикер и название слева.
      const tick = `$${symbol || "TICKER"}`;
      let size = 150;
      ctx.font = `900 ${size}px -apple-system, "SF Pro Display", Inter, sans-serif`;
      while (ctx.measureText(tick).width > 860 && size > 70) ctx.font = `900 ${(size -= 6)}px -apple-system, "SF Pro Display", Inter, sans-serif`;
      const tg = ctx.createLinearGradient(90, 0, 90 + ctx.measureText(tick).width, 0);
      tg.addColorStop(0, "#ffc93a");
      tg.addColorStop(0.6, "#ff6a3d");
      tg.addColorStop(1, "#f472b6");
      ctx.fillStyle = tg;
      ctx.shadowColor = "rgba(0,0,0,.6)";
      ctx.shadowBlur = 20;
      ctx.fillText(tick, 90, H / 2 + size * 0.15);
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#f2f3f5";
      ctx.font = `700 54px -apple-system, "SF Pro Display", Inter, sans-serif`;
      let title = name || "Your coin";
      while (ctx.measureText(title).width > 860 && title.length > 4) title = `${title.slice(0, -2).trimEnd()}…`;
      ctx.fillText(title, 94, H / 2 + size * 0.15 + 80);
      ctx.shadowBlur = 0;
      setUrl(c.toDataURL("image/png"));
    })();
    return () => {
      dead = true;
    };
  }, [image, name, symbol]);

  return (
    <div className="space-y-2">
      <canvas ref={ref} width={W} height={H} className="hidden" />
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="DexScreener banner preview" className="w-full rounded-xl border border-line" />
      ) : (
        <div className="grid aspect-[3/1] place-items-center rounded-xl border border-dashed border-line text-xs text-muted">Add a picture to draw the banner</div>
      )}
      {url && (
        <a href={url} download={`${(symbol || "coin").toLowerCase()}-banner-1500x500.png`} className="inline-flex items-center gap-1.5 rounded-lg border border-honey/60 px-3 py-1.5 text-sm text-honey hover:bg-honey/10">
          <Download className="size-4" /> Download banner 1500×500
        </a>
      )}
    </div>
  );
}
