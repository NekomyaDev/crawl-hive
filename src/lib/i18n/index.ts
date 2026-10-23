// Словари сайта и перевод по ключу. Незнакомый язык и пропущенный ключ падают на английский.
import { en, type DictKey, type Dict } from "./en";
import { es } from "./es";
import { pt } from "./pt";
import { ru } from "./ru";
import { tr } from "./tr";
import { zh } from "./zh";
import { fill, type Lang } from "./langs";

export * from "./langs";
export type { DictKey, Dict };

const DICTS: Record<Lang, Dict> = { en, es, pt, ru, tr, zh };

export type TFn = (key: DictKey, vars?: Record<string, string | number>) => string;

export function translate(lang: Lang, key: DictKey, vars?: Record<string, string | number>) {
  return fill(DICTS[lang]?.[key] ?? en[key] ?? key, vars);
}

// Локаль для дат и чисел (toLocaleDateString): у китайского свой код.
export const DATE_LOCALE: Record<Lang, string> = { en: "en-US", es: "es", pt: "pt-BR", ru: "ru", tr: "tr", zh: "zh-CN" };
