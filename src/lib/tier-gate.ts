// Тарифы, нужные и серверу, и клиенту: порядок тарифов и какой тариф открывает какую часть сайта.
// Без server-only: импортирует и tiers.ts (источник правды, переэкспортирует отсюда), и клиентские компоненты.
// Пороги в токенах сюда не кладём: они зависят от цены и приходят из tierTokens() через /api/tier.
export type Tier = "free" | "holder" | "pro" | "whale";
export const TIER_ORDER: Tier[] = ["free", "holder", "pro", "whale"];
export const TIER_NAME: Record<Tier, string> = { free: "Free", holder: "Holder", pro: "Pro", whale: "Whale" };
export const tierAtLeast = (t: Tier, min: Tier) => TIER_ORDER.indexOf(t) >= TIER_ORDER.indexOf(min);

// Полный разбор скана (bubble map, первые покупатели, роли кошельков, раскладка балла, история дева,
// доказательства запуска, Second look, что изменилось с прошлого скана). Вердикт, балл и главные флаги видят все.
export const DEEP_SCAN_TIER: Tier = "holder";

// Страница репутации дева /dev/<адрес>: ярлык, сводка и последние DEV_FREE_ROWS монет видят все, полная таблица от этого тарифа.
export const DEV_TABLE_TIER: Tier = "holder";
export const DEV_FREE_ROWS = 5;
