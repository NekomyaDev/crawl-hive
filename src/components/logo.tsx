// Знак CrawlHive: мантия спрута с паучьими глазами и восемь суставчатых ног, переходящих в щупальца.
// Тот же рисунок лежит в public/brand/crawlhive-mark.svg и (на плашке) в app/icon.svg.
export function Logo({ size = 28 }: { size?: number }) {
  // Статичные id: лого рендерится и в заглушке навигации, и в самой навигации, а useId в разных ветках
  // Suspense давал расхождение при гидратации. Определения одинаковые, поэтому дубли id безвредны.
  const grad = "crawlhive-logo-body";
  const legs = "crawlhive-logo-legs";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <radialGradient id={grad} cx="40%" cy="30%" r="75%">
          <stop offset="0" stopColor="#ffd27a" />
          <stop offset=".55" stopColor="#ffb020" />
          <stop offset="1" stopColor="#e2700f" />
        </radialGradient>
      </defs>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <g id={legs} stroke="#f39614">
          <path d="M23.5 29 L13 18.5" strokeWidth="3.2" />
          <path d="M13 18.5 C8 22 5 26 6 30.5 C6.6 33 9.6 33 9.6 30.6" strokeWidth="2.2" />
          <path d="M24.5 33 L11.5 29" strokeWidth="3.2" />
          <path d="M11.5 29 C7.5 33.5 5.5 38 7 42.5 C8 45 11 44.5 10.6 42" strokeWidth="2.2" />
          <path d="M27 35.5 L17 41" strokeWidth="3.2" />
          <path d="M17 41 C13.5 45 12.5 49.5 14.5 53.5 C15.8 55.8 18.6 54.6 17.8 52.3" strokeWidth="2.2" />
          <path d="M30 36.5 L25.5 46" strokeWidth="3.2" />
          <path d="M25.5 46 C23.5 50 23.5 54.5 26.5 57.5 C28.4 59.3 30.8 57.4 29.4 55.4" strokeWidth="2.2" />
          <g fill="#f39614" stroke="none">
            <circle cx="13" cy="18.5" r="2" />
            <circle cx="11.5" cy="29" r="2" />
            <circle cx="17" cy="41" r="2" />
            <circle cx="25.5" cy="46" r="2" />
          </g>
        </g>
        <use href={`#${legs}`} transform="matrix(-1 0 0 1 64 0)" />
      </g>
      <ellipse cx="32" cy="35.8" rx="7.5" ry="3.2" fill="#c45a0a" />
      <path
        d="M20 27.5 C20 14.5 25.5 7.5 32 7.5 C38.5 7.5 44 14.5 44 27.5 C44 33.5 38.6 37.5 32 37.5 C25.4 37.5 20 33.5 20 27.5Z"
        fill={`url(#${grad})`}
      />
      <ellipse cx="27" cy="13.5" rx="3.6" ry="2.2" fill="#fff" opacity=".28" transform="rotate(-25 27 13.5)" />
      <g fill="#07080a">
        <circle cx="27.6" cy="26" r="3.6" />
        <circle cx="36.4" cy="26" r="3.6" />
        <circle cx="24.6" cy="20.6" r="1.5" />
        <circle cx="29.4" cy="19.2" r="1.7" />
        <circle cx="34.6" cy="19.2" r="1.7" />
        <circle cx="39.4" cy="20.6" r="1.5" />
      </g>
      <g fill="#fff" opacity=".9">
        <circle cx="28.6" cy="25" r="1.05" />
        <circle cx="37.4" cy="25" r="1.05" />
        <circle cx="29.9" cy="18.7" r=".5" />
        <circle cx="35.1" cy="18.7" r=".5" />
      </g>
    </svg>
  );
}
