// Языки интерфейса без локалей в URL: одни и те же адреса для SEO, ссылок, ботов и расширения.
// Общий модуль для сайта и Telegram-бота, без клиентского и серверного кода.
export const LANGS = ["en", "es", "pt", "ru", "tr", "zh"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "en";

// Подпись в переключателе: на своём языке, чтобы человек узнал свой.
export const LANG_NAME: Record<Lang, string> = { en: "English", es: "Español", pt: "Português", ru: "Русский", tr: "Türkçe", zh: "中文" };

export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGS as readonly string[]).includes(v);

// Код языка из браузера или Telegram (pt-BR, zh-Hans, ru) в один из наших; незнакомый уходит в null.
export function pickLang(code?: string | null): Lang | null {
  const base = (code ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return isLang(base) ? base : null;
}

// Подстановка {имя} в строку перевода.
export function fill(s: string, vars?: Record<string, string | number>) {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}
