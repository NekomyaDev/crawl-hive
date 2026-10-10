// Формула репутации краулера. Вынесена отдельно, чтобы её можно было менять
// голосованием и показывать пользователю разложение по компонентам.
import type { Crawler } from "./types";

export const REP_WEIGHTS = {
  quality: 0.4, // доля подтвердившихся сигналов
  uptime: 0.25, // доля времени, когда краулер работал
  volume: 0.2, // объём собранных данных (логарифм, чтобы не выигрывал спам)
  stake: 0.15, // сколько владелец сжёг: «шкура в игре»
};

export interface RepBreakdown {
  quality: number;
  uptime: number;
  volume: number;
  stake: number;
  total: number;
}

export function reputationBreakdown(c: Pick<Crawler, "stats" | "burned">): RepBreakdown {
  const { hits, signals, uptimeSec, totalSec, items } = c.stats;
  // Считаем только сигналы с известным исходом; пока их мало, точность тянем к 0.5,
  // чтобы новичок с 1/1 не взлетал в топ.
  const scored = c.stats.scored ?? signals;
  const quality = (hits + 2.5) / (scored + 5);
  const uptime = totalSec > 0 ? Math.min(1, uptimeSec / totalSec) : 1;
  const volume = Math.min(1, Math.log10(items + 1) / 5);
  const stake = Math.min(1, Math.log10(c.burned + 1) / 5);
  const total = Math.round(
    1000 *
      (REP_WEIGHTS.quality * quality +
        REP_WEIGHTS.uptime * uptime +
        REP_WEIGHTS.volume * volume +
        REP_WEIGHTS.stake * stake),
  );
  return { quality, uptime, volume, stake, total };
}

export function computeReputation(c: Pick<Crawler, "stats" | "burned">): number {
  return reputationBreakdown(c).total;
}

export function repGrade(rep: number): { grade: string; color: string } {
  if (rep >= 800) return { grade: "S", color: "text-honey" };
  if (rep >= 650) return { grade: "A", color: "text-lime" };
  if (rep >= 500) return { grade: "B", color: "text-sky" };
  if (rep >= 350) return { grade: "C", color: "text-muted" };
  return { grade: "D", color: "text-danger" };
}
