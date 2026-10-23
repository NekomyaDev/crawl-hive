"use client";
// «Invite friends» на /pricing: личные ссылки с кнопкой копирования, сколько приглашено, текущий бонус и правила.
// Награды только лимитами продукта: ни денег, ни выплат токенами. Без входа: просим подключить кошелёк.
import { useApi } from "@/lib/client/use-api";
import { useWallet } from "./wallet-provider";
import { useToast } from "./ui/toast";
import { Card } from "./ui/card";
import { Button } from "./ui/button";

type RefApi =
  | { wallet: null }
  | {
      wallet: string;
      code: string;
      links: { site: string; telegram: string };
      pending: number;
      qualified: number;
      cap: number;
      bonus: { ask: number; trackedWallets: number };
      per: { ask: number; trackedWallets: number };
      referee: { by: string; askBonus: number; until: number | null; active: boolean } | null;
      refereeBonus: { ask: number; days: number };
    };

function LinkRow({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <div className="w-24 shrink-0 text-xs text-muted">{label}</div>
      <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs">{value}</code>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          navigator.clipboard
            ?.writeText(value)
            .then(() => toast("Link copied"))
            .catch(() => toast("Could not copy, select the link and copy it", "error"))
        }
      >
        Copy
      </Button>
    </div>
  );
}

export function InviteCard() {
  const { signedIn, address, connect, signIn } = useWallet();
  const { data, error } = useApi<RefApi>(signedIn ? `/api/ref?w=${address}` : null, 120_000);
  const me = data && data.wallet === address ? data : null;

  return (
    <Card id="invite" className="scroll-mt-20 p-5 text-sm text-fg/85">
      <div className="text-lg font-bold text-fg">🤝 Invite friends</div>
      <div className="mt-1 text-muted">Bring friends to CrawlHive and unlock more of the product. Rewards are product limits only: no money, no token payouts.</div>

      {!signedIn ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span>Connect wallet to get your link.</span>
          <Button size="sm" onClick={() => (address ? signIn() : connect()).catch(() => {})}>
            {address ? "Sign in" : "Connect wallet"}
          </Button>
        </div>
      ) : !me ? (
        <div className="mt-4 text-muted">{error ?? "Loading your link…"}</div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <LinkRow label="Site link" value={me.links.site} />
            <LinkRow label="Telegram bot" value={me.links.telegram} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-line p-3">
              <div className="text-xs text-muted">Waiting for Holder</div>
              <div className="text-2xl font-black">{me.pending}</div>
            </div>
            <div className="rounded-lg border border-line p-3">
              <div className="text-xs text-muted">Counted</div>
              <div className="text-2xl font-black">
                {me.qualified}
                <span className="text-sm font-semibold text-muted"> / {me.cap} with a bonus</span>
              </div>
            </div>
            <div className="rounded-lg border border-honey/40 p-3">
              <div className="text-xs text-muted">Your bonus now</div>
              <div className="font-bold text-fg">+{me.bonus.ask} Ask questions a day</div>
              <div className="font-bold text-fg">+{me.bonus.trackedWallets} tracked wallets</div>
            </div>
          </div>
          {me.referee && (
            <div className="text-muted">
              You were invited by <code>{me.referee.by}</code>.{" "}
              {me.referee.active ? `Your welcome bonus of +${me.referee.askBonus} Ask questions a day is on.` : "Your welcome bonus has ended."}
            </div>
          )}
        </div>
      )}

      <ul className="mt-4 space-y-1.5">
        <li>• A friend counts once their wallet reaches Holder (about $10 of $CRAWLHIVE held) at least once. Counted invites keep their bonus.</li>
        <li>• For every counted friend: +5 Ask questions a day and +2 tracked wallets, up to 10 friends (+50 questions, +20 wallets).</li>
        <li>• Your friend gets +3 Ask questions a day for their first 7 days.</li>
        <li>• Only new wallets can be invited, one inviter per wallet, the first link wins. Inviting yourself does not count.</li>
        <li>• In Telegram: send /invite to the bot to see your link and counts.</li>
      </ul>
    </Card>
  );
}
