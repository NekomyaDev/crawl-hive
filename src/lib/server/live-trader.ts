// Живая торговля по сигналам Paper Engine: когда разрешённая стратегия (LIVE_STRATEGIES) открывает бумажную позицию,
// каждому включившему её пользователю (Holder и выше, не на паузе, в пределах лимитов, выключатель снят) движок
// покупает через Jupiter с его торгового кошелька; бумажное закрытие продаёт весь остаток. Страховка раз в 30 с:
// стоп стратегии и лимит времени по своей цене, повтор неудачных продаж, перевод комиссий с прибыли в казну.
//
// Режимы LIVE_TRADING: off (по умолчанию, ничего не запускается), dryrun (котировки Jupiter настоящие, свапы не
// отправляются, исполнение по котировке, сделки пишутся с mode="dryrun"), live (настоящие отправки).
// Telegram сюда не подключён: снаружи слушают onLiveEvent.
import "server-only";
import { onPaperEvent, STRATEGIES } from "./paper-engine";
import { ApiError, setMeta } from "./store";
import { isAdminWallet } from "./admin";
import { LIVE_STRATEGIES, liveConfig, type LiveEvent } from "./live-core";
import { emitLive, liveCall, liveEngine, liveHooks, liveKill, liveReady } from "./live-wallets";

export { LIVE_STRATEGIES };
export type { LiveEvent };

const TICK_MS = 30_000;
const g = globalThis as unknown as { __crawlhiveLiveTrader?: { started: boolean } };

// Подписка на события живой торговли (покупки, продажи, отказы, вывод, выдача ключа, уведомления).
export function onLiveEvent(cb: (e: LiveEvent) => void) {
  liveHooks().add(cb);
  return () => void liveHooks().delete(cb);
}

// Зовётся из radar.ts рядом со startPaperEngine, только если LIVE_TRADING не off.
export function startLiveTrader() {
  const s = (g.__crawlhiveLiveTrader ??= { started: false });
  if (s.started) return;
  const cfg = liveConfig();
  if (cfg.mode === "off") return;
  const ready = liveReady();
  if (!ready.ok) {
    console.warn(`[live] trader not started: ${ready.reason}`);
    return;
  }
  const engine = liveEngine();
  if (!engine) return;
  s.started = true;
  onPaperEvent((e) => {
    try {
      engine.onPaper({ kind: e.kind, strategy: e.strategy, token: e.token, chain: e.chain, symbol: e.symbol, positionId: e.positionId, price: e.kind === "open" ? e.price : undefined, reason: e.kind === "close" ? e.reason : undefined });
    } catch (err) {
      console.warn("[live] paper event", (err as Error).message);
    }
  });
  setInterval(() => void engine.tick().catch((err) => console.warn("[live] tick", (err as Error).message)), TICK_MS).unref?.();
  setTimeout(() => void engine.tick().catch(() => {}), 5_000).unref?.();
  console.log(`[live] trader started in ${cfg.mode} mode, strategies ${LIVE_STRATEGIES.join(", ")}, max trade ${cfg.maxTradeSol} SOL, max open ${cfg.maxOpen}`);
}

// ---------- для API ----------

const strategyList = () =>
  LIVE_STRATEGIES.map((id) => {
    const s = STRATEGIES.find((x) => x.id === id);
    return { id, label: s?.label ?? id, note: s?.note ?? "", exits: s?.exits ?? null };
  });

export async function liveStatus(wallet: string | null) {
  const cfg = liveConfig();
  const ready = liveReady();
  const kill = liveKill();
  const admin = isAdminWallet(wallet);
  const engine = liveEngine();
  return {
    mode: cfg.mode,
    ready: ready.ok,
    reason: ready.reason,
    kill: { on: kill.on, at: kill.on ? kill.at : null },
    strategies: strategyList(),
    caps: {
      maxWalletSol: cfg.maxWalletSol,
      maxTradeSol: cfg.maxTradeSol,
      minTradeSol: cfg.minTradeSol,
      defaultTradeSol: cfg.defaultTradeSol,
      maxOpen: cfg.maxOpen,
      dailyLossSol: cfg.dailyLossSol,
      feeReserveSol: cfg.feeReserveSol,
      defaultSlippagePct: cfg.defaultSlippagePct,
      maxSlippagePct: cfg.maxSlippagePct,
      exportsPerDay: cfg.exportsPerDay,
    },
    fees: { profitFeePct: cfg.profitFeePct, buybackSharePct: cfg.buybackSharePct },
    wallet: wallet && engine ? await engine.ownerStatus(wallet) : null,
    admin: admin && engine ? { ...engine.adminSummary(), kill } : null,
  };
}

export const setLiveSettings = (owner: string, b: Record<string, unknown>, ip: string | null) => liveCall((e) => e.setSettings(owner, b, ip));
export const closeLive = (owner: string, b: { positionId?: unknown; all?: unknown }) => liveCall((e) => e.closeOwn(owner, b));

// Админ: выключатель новых входов и по желанию закрытие всех открытых позиций.
export async function adminLive(wallet: string, b: { kill?: unknown; closeAll?: unknown }) {
  if (!isAdminWallet(wallet)) throw new ApiError("Admins only", 403);
  if (typeof b.kill !== "boolean") throw new ApiError("kill must be true or false");
  if (b.closeAll !== undefined && typeof b.closeAll !== "boolean") throw new ApiError("closeAll must be true or false");
  const prev = liveKill();
  setMeta("liveKill", JSON.stringify({ on: b.kill, at: Date.now(), by: wallet }));
  let closing = 0;
  if (b.closeAll === true) closing = await liveCall((e) => (liveConfig().mode === "off" ? 0 : e.closeEverything("kill")));
  if (prev.on !== b.kill || b.closeAll) {
    console.warn(`[live] kill switch ${b.kill ? "ON" : "off"} by ${wallet}${b.closeAll ? `, closing ${closing} positions` : ""}`);
    emitLive({ kind: "kill", on: b.kill, by: wallet, closeAll: b.closeAll === true });
  }
  return { kill: liveKill(), closing };
}
