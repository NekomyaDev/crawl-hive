// Краулер, над которым стоит Grok Bot: наш спрут-паук с логотипа, но мантия перламутровая, а лицо — как у
// Grok Bot, два наклонённых овала-глаза. Ноги окрашены в цвет источника краулера. Те же контуры рисует
// карта роя на canvas (BOT_OCTO_* ниже), поэтому вид на карте и в карточках один.

// Координаты в квадрате 64×64, центр мантии около (32, 24). Правая сторона ног — зеркало левой.
export const BOT_OCTO_LEGS = [
  "M23.5 29 L13 18.5 C8 22 5 26 6 30.5",
  "M24.5 33 L11.5 29 C7.5 33.5 5.5 38 7 42.5",
  "M27 35.5 L17 41 C13.5 45 12.5 49.5 14.5 53.5",
  "M30 36.5 L25.5 46 C23.5 50 23.5 54.5 26.5 57.5",
];
export const BOT_OCTO_MANTLE = "M18 26 C18 12 24.5 5 32 5 C39.5 5 46 12 46 26 C46 33 39.7 38 32 38 C24.3 38 18 33 18 26Z";
// Глаза: овалы, наклонённые внутрь, как «‖» у Grok Bot. [cx, cy, rx, ry, наклон в градусах]
export const BOT_OCTO_EYES: [number, number, number, number, number][] = [
  [27.2, 24.5, 2.3, 4.4, -24],
  [36.8, 24.5, 2.3, 4.4, -24],
];

export function BotOcto({ color = "#ffb020", size = 28, live = false, className }: { color?: string; size?: number; live?: boolean; className?: string }) {
  const id = `octo-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className={className}>
      <defs>
        <radialGradient id={`${id}-pearl`} cx="38%" cy="28%" r="80%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".6" stopColor="#eef0f3" />
          <stop offset="1" stopColor="#b9bec7" />
        </radialGradient>
      </defs>
      {live && <circle cx="32" cy="26" r="24" fill={color} opacity=".18" className="animate-pulse" />}
      <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6">
        {BOT_OCTO_LEGS.map((d) => (
          <path key={d} d={d} />
        ))}
        <g transform="matrix(-1 0 0 1 64 0)">
          {BOT_OCTO_LEGS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </g>
      <path d={BOT_OCTO_MANTLE} fill={`url(#${id}-pearl)`} stroke={color} strokeOpacity=".55" strokeWidth="1.2" />
      <ellipse cx="26" cy="12" rx="4" ry="2.2" fill="#fff" opacity=".7" transform="rotate(-25 26 12)" />
      <g fill="#0b0c0f" className={live ? "bot-blink" : undefined} style={{ transformOrigin: "32px 24.5px" }}>
        {BOT_OCTO_EYES.map(([cx, cy, rx, ry, a]) => (
          <ellipse key={cx} cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(${a} ${cx} ${cy})`} />
        ))}
      </g>
    </svg>
  );
}
