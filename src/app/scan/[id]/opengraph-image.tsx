// Превью ссылки /scan/<адрес> в X и Telegram: тикер, оценка, вердикт, главная причина и худшие флаги.
import { ImageResponse } from "next/og";
import { connection } from "next/server";
import { savedScan } from "@/lib/server/scan";
import { VERDICT_COLOR, VERDICT_LABEL } from "@/lib/scan-share";

export const alt = "CrawlHive Instant Crawl result";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#07080a";
const PANEL = "#0e1013";
const LINE = "#22262c";
const FG = "#e8eaed";
const MUTED = "#8a9099";
const HONEY = "#ffb020";
const RING_R = 125;
const RING_LEN = 2 * Math.PI * RING_R;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const r = savedScan(id);
  const color = r ? VERDICT_COLOR[r.verdict] : HONEY;
  const flags = r ? [...r.factors].sort((a, b) => a.impact - b.impact).slice(0, 3) : [];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: BG, color: FG, padding: 56, fontSize: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: MUTED, fontSize: 26 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 14, height: 14, borderRadius: 7, background: HONEY }} />
            <span style={{ color: FG, fontWeight: 700 }}>CrawlHive</span>
            <span>· Instant Crawl</span>
          </div>
          <span>crawlhive.xyz</span>
        </div>

        {r ? (
          <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 56, marginTop: 24 }}>
            {/* Кольцо оценки: conic-gradient картинки не умеют, рисуем дугу в SVG. */}
            <div style={{ position: "relative", width: 280, height: 280, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="280" height="280" viewBox="0 0 280 280" style={{ position: "absolute", top: 0, left: 0 }}>
                <circle cx="140" cy="140" r={RING_R} fill={PANEL} stroke={LINE} strokeWidth="22" />
                <circle
                  cx="140"
                  cy="140"
                  r={RING_R}
                  fill="none"
                  stroke={color}
                  strokeWidth="22"
                  strokeLinecap="round"
                  strokeDasharray={`${(RING_LEN * (r.score ?? 0)) / 100} ${RING_LEN}`}
                  transform="rotate(-90 140 140)"
                />
              </svg>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ fontSize: 112, fontWeight: 700, color, lineHeight: 1 }}>{r.score ?? "—"}</span>
                <span style={{ fontSize: 24, color: MUTED }}>/ 100</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <span style={{ fontSize: 76, fontWeight: 700 }}>${r.symbol.slice(0, 12)}</span>
                <span style={{ fontSize: 30, fontWeight: 700, color, border: `3px solid ${color}`, borderRadius: 12, padding: "4px 16px" }}>{VERDICT_LABEL[r.verdict]}</span>
              </div>
              <div style={{ display: "flex", fontSize: 32, marginTop: 12, color: FG }}>{r.reason.slice(0, 90)}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 28 }}>
                {flags.map((f) => (
                  <div key={f.label} style={{ display: "flex", gap: 16, fontSize: 26 }}>
                    <span style={{ color: f.impact < 0 ? "#f87171" : "#b6f23a", width: 60 }}>{f.impact > 0 ? `+${f.impact}` : f.impact}</span>
                    <span style={{ fontWeight: 700 }}>{f.label}</span>
                    <span style={{ color: MUTED }}>{f.note.slice(0, 48)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center" }}>
            <span style={{ fontSize: 72, fontWeight: 700 }}>Send the swarm after any memecoin</span>
            <span style={{ fontSize: 32, color: MUTED, marginTop: 16 }}>Free token scan in seconds. No wallet.</span>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", color: MUTED, fontSize: 22, borderTop: `2px solid ${LINE}`, paddingTop: 20 }}>
          <span>market · mint · holders · bundles · copycats · Telegram · X</span>
          <span>not financial advice</span>
        </div>
      </div>
    ),
    size,
  );
}
