"use client";
// Язык интерфейса без локалей в URL. Сервер и первый клиентский рендер всегда на английском (пререндер с
// cacheComponents не читает cookie), после монтирования провайдер берёт выбор из localStorage или cookie,
// а при первом визите язык браузера, и перерисовывает переведённые компоненты.
// Выбор пишется и в cookie lang (на будущее для сервера), и в localStorage.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Globe } from "lucide-react";
import { DEFAULT_LANG, LANG_NAME, LANGS, isLang, pickLang, translate, type DictKey, type Lang, type TFn } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const KEY = "crawlhive:lang";

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
}

const Ctx = createContext<LangCtx>({ lang: DEFAULT_LANG, setLang: () => {}, t: (k, v) => translate(DEFAULT_LANG, k, v) });

function stored(): Lang | null {
  try {
    const v = localStorage.getItem(KEY);
    if (isLang(v)) return v;
  } catch {}
  const c = document.cookie.match(/(?:^|;\s*)lang=([a-z]{2})/)?.[1];
  return isLang(c) ? c : null;
}

function detect(): Lang {
  const list = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of list) {
    const p = pickLang(l);
    if (p) return p;
  }
  return DEFAULT_LANG;
}

function save(l: Lang) {
  try {
    localStorage.setItem(KEY, l);
  } catch {}
  document.cookie = `lang=${l}; path=/; max-age=31536000; samesite=lax`;
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  // Первый визит: язык браузера; дальше то, что сохранено.
  useEffect(() => {
    const s = stored();
    const l = s ?? detect();
    if (!s) save(l);
    setLangState(l);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    save(l);
    setLangState(l);
  }, []);

  const value = useMemo<LangCtx>(() => ({ lang, setLang, t: (k, v) => translate(lang, k, v) }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx);

// Перевод внутри серверного компонента: сам текст рисуется на клиенте.
export function T({ k, vars }: { k: DictKey; vars?: Record<string, string | number> }) {
  const { t } = useT();
  return <>{t(k, vars)}</>;
}

// Кнопка-глобус с выпадающим списком языков.
export function LangSwitcher({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { lang, setLang, t } = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={box} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={t("lang.label")}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t("lang.label")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl border border-line bg-panel-2 text-muted transition-colors hover:border-honey/50 hover:text-fg",
          compact ? "h-7 rounded-md px-1.5 text-[11px]" : "h-12 px-3 text-sm",
        )}
      >
        <Globe className={compact ? "size-3.5" : "size-4"} />
        <span className="font-semibold uppercase">{lang}</span>
      </button>
      {open && (
        <ul role="listbox" aria-label={t("lang.label")} className="absolute right-0 z-50 mt-1.5 min-w-36 overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-xl">
          {LANGS.map((l) => (
            <li key={l}>
              <button
                type="button"
                role="option"
                aria-selected={l === lang}
                onClick={() => {
                  setLang(l);
                  setOpen(false);
                }}
                className={cn("flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-panel-2", l === lang ? "text-honey" : "text-fg")}
              >
                {LANG_NAME[l]}
                {l === lang && <Check className="size-3.5" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
