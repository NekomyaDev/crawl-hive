// Превью ссылки /scan/<адрес> в X и Telegram: брендированная карточка скана. Оценка с кольцом, вердикт, причина,
// худшие флаги, мини-бабл-карта держателей и второе мнение Larpcheck, если оно есть. Её и шерят из скана.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { connection } from "next/server";
import { savedScan } from "@/lib/server/scan";
import { CHAIN_LABEL, VERDICT_COLOR, VERDICT_LABEL } from "@/lib/scan-share";

export const alt = "CrawlHive scan result";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#05060a";
const FG = "#f2f3f5";
const MUTED = "#8a9099";
const HONEY = "#ffb020";
const NEON = ["#ff9f1c", "#ff4fa3", "#a3e635", "#38bdf8", "#a78bfa", "#2dd4bf"];
const SOLO = ["#f97316", "#e879f9", "#facc15", "#4ade80", "#22d3ee", "#818cf8", "#fb7185", "#34d399", "#60a5fa"];
const RING_R = 96;
const RING_LEN = 2 * Math.PI * RING_R;
// Места кружков мини-карты: крупнейший в центре, остальные вокруг.
const SPOTS = [[115, 107], [60, 70], [170, 66], [52, 148], [178, 150], [115, 38], [115, 178], [30, 108], [200, 110]];

let mascot: string | null | undefined;
async function mascotSrc() {
  if (mascot !== undefined) return mascot;
  mascot = await readFile(path.join(process.cwd(), "public/tg/watch.png"))
    .then((b) => `data:image/png;base64,${b.toString("base64")}`)
    .catch(() => null);
  return mascot;
}
// Inter: встроенный шрифт картинок только тонкий, а карточке нужны жирные цифры и тикер.
let fonts: { name: string; data: Buffer; weight: 500 | 800; style: "normal" }[] | undefined;
async function loadFonts() {
  if (fonts) return fonts;
  const f = (file: string) => readFile(path.join(process.cwd(), "public/fonts", file)).catch(() => null);
  const [m, b] = await Promise.all([f("Inter-Medium.ttf"), f("Inter-ExtraBold.ttf")]);
  fonts = [...(m ? [{ name: "Inter", data: m, weight: 500 as const, style: "normal" as const }] : []), ...(b ? [{ name: "Inter", data: b, weight: 800 as const, style: "normal" as const }] : [])];
  return fonts;
}

const TRUST_COLOR: Record<string, string> = { TRUSTED: "#a3e635", MIXED: "#2dd4bf", CAUTION: HONEY, AVOID: "#f87171" };
const larpColor = (v: string) => (/SCAM|LARP/.test(v) ? "#f87171" : /REAL/.test(v) && !/PARTLY/.test(v) ? "#a3e635" : HONEY);

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const r = savedScan(id);
  const [pic, font] = await Promise.all([mascotSrc(), loadFonts()]);
  const color = r ? VERDICT_COLOR[r.verdict] : HONEY;
  const flags = r ? [...r.factors].filter((f) => f.impact !== 0).sort((a, b) => a.impact - b.impact).slice(0, 3) : [];
  const nodes = (r?.operators?.map?.nodes ?? []).filter((n) => !n.hub).sort((a, b) => b.pct - a.pct).slice(0, 9);
  const maxPct = Math.max(...nodes.map((n) => n.pct), 0.01);
  const ops = r?.operators?.operators.length ?? 0;
  const larp = r?.larp;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: BG, color: FG, padding: "44px 52px", fontSize: 26, position: "relative", fontFamily: "Inter", fontWeight: 500 }}>
        <div style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, display: "flex", backgroundImage: "radial-gradient(circle at 12% 18%, rgba(124,58,237,0.35), transparent 45%), radial-gradient(circle at 90% 92%, rgba(255,159,28,0.28), transparent 45%)" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 24 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ width: 16, height: 16, borderRadius: 8, background: HONEY, marginRight: 12 }} />
            <span style={{ fontWeight: 800 }}>Crawl</span>
            <span style={{ fontWeight: 800, color: HONEY }}>Hive</span>
            <span style={{ color: MUTED, marginLeft: 12 }}>· memecoin safety scan</span>
          </div>
          <span style={{ color: MUTED }}>crawlhive.xyz</span>
        </div>

        {r ? (
          <div style={{ display: "flex", flex: 1, marginTop: 22 }}>
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, marginRight: 36 }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div style={{ position: "relative", width: 216, height: 216, display: "flex", alignItems: "center", justifyContent: "center", marginRight: 30 }}>
                  <svg width="216" height="216" viewBox="0 0 216 216" style={{ position: "absolute", top: 0, left: 0 }}>
                    <circle cx="108" cy="108" r={RING_R} fill="#0d0e13" stroke="rgba(255,255,255,0.08)" strokeWidth="18" />
                    <circle cx="108" cy="108" r={RING_R} fill="none" stroke={color} strokeWidth="18" strokeLinecap="round" strokeDasharray={`${(RING_LEN * (r.score ?? 0)) / 100} ${RING_LEN}`} transform="rotate(-90 108 108)" />
                  </svg>
                  <span style={{ fontSize: 88, fontWeight: 800, color, lineHeight: 1 }}>{r.score ?? "?"}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontSize: 62, fontWeight: 800, lineHeight: 1 }}>${r.symbol.slice(0, 11)}</span>
                  <div style={{ display: "flex", marginTop: 14 }}>
                    <span style={{ fontSize: 26, fontWeight: 800, color, border: `3px solid ${color}`, borderRadius: 12, padding: "3px 14px", marginRight: 12 }}>{VERDICT_LABEL[r.verdict]}</span>
                    <span style={{ fontSize: 22, color: "#c084fc", border: "2px solid rgba(192,132,252,0.5)", borderRadius: 10, padding: "5px 12px" }}>{CHAIN_LABEL[r.chain] ?? r.chain}</span>
                  </div>
                  <span style={{ fontSize: 23, marginTop: 14, color: "#d1d5db" }}>{r.reason.slice(0, 58)}</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", marginTop: 20 }}>
                {flags.map((f) => (
                  <div key={f.label} style={{ display: "flex", fontSize: 22, marginTop: 8 }}>
                    <span style={{ color: f.impact < 0 ? "#f87171" : "#a3e635", width: 56, fontWeight: 800 }}>{f.impact > 0 ? `+${f.impact}` : f.impact}</span>
                    <span style={{ fontWeight: 700, marginRight: 12 }}>{f.label}</span>
                    <span style={{ color: MUTED }}>{f.note.length > 30 ? `${f.note.slice(0, 29)}…` : f.note}</span>
                  </div>
                ))}
              </div>
              {larp && (
                <div style={{ display: "flex", alignItems: "center", marginTop: "auto", padding: "14px 18px", borderRadius: 16, border: `2px solid ${larpColor(larp.verdict)}`, background: "rgba(255,255,255,0.03)" }}>
                  <span style={{ fontSize: 16, color: MUTED, letterSpacing: 2, marginRight: 16 }}>SECOND OPINION</span>
                  <span style={{ fontSize: 24, fontWeight: 800, marginRight: 16 }}>Larpcheck</span>
                  <span style={{ fontSize: 26, fontWeight: 900, color: larpColor(larp.verdict) }}>
                    {larp.verdict}
                    {larp.score != null ? ` ${larp.score}` : ""}
                  </span>
                  {/* третий вердикт в той же строке, чтобы карточка не росла */}
                  {r.trust && (
                    <span style={{ marginLeft: "auto", fontSize: 22, fontWeight: 900, color: TRUST_COLOR[r.trust.verdict] }}>
                      🤝 Trust {r.trust.score} {r.trust.verdict}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", width: 300, alignItems: "center" }}>
              {nodes.length >= 3 && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 300, padding: 16, borderRadius: 22, background: "rgba(13,14,19,0.92)", border: "2px solid rgba(255,255,255,0.1)" }}>
                  <span style={{ fontSize: 16, color: MUTED, letterSpacing: 2 }}>WHO HOLDS IT</span>
                  <svg width="230" height="215" viewBox="0 0 230 215" style={{ marginTop: 8 }}>
                    {nodes.map((n, i) => {
                      const rr = 9 + 17 * Math.sqrt(n.pct / maxPct);
                      const c = n.g >= 0 ? NEON[n.g % NEON.length] : SOLO[i % SOLO.length];
                      return <circle key={n.w} cx={SPOTS[i][0]} cy={SPOTS[i][1]} r={rr} fill={c} fillOpacity={0.35} stroke={c} strokeWidth={n.g >= 0 ? 4 : 2} />;
                    })}
                  </svg>
                  <span style={{ fontSize: 18, color: "#d1d5db" }}>{ops ? `${ops} linked operator${ops > 1 ? "s" : ""}` : "no linked wallets"}</span>
                </div>
              )}
              {pic && <img src={pic} width={nodes.length >= 3 ? 160 : 250} height={nodes.length >= 3 ? 160 : 250} style={{ marginTop: "auto" }} />}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 68, fontWeight: 800 }}>Send the swarm after any memecoin</span>
              <span style={{ fontSize: 30, color: MUTED, marginTop: 16 }}>Free token scan in seconds. No wallet.</span>
            </div>
            {pic && <img src={pic} width={250} height={250} />}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", color: MUTED, fontSize: 19, marginTop: 14 }}>
          <span>bundles · snipers · operators · LP · dev history · bubble map</span>
          <span>not financial advice</span>
        </div>
      </div>
    ),
    { ...size, ...(font.length ? { fonts: font } : {}) },
  );
}
