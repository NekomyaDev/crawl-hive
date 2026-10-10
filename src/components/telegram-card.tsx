"use client";
// Привязка Telegram для доставки сигналов: получаем одноразовую ссылку на бота, пользователь жмёт Start,
// карточка сама замечает привязку. Показывается, только если на сервере настроен бот.
import { useEffect, useState } from "react";
import { Send, Unlink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useApi } from "@/lib/client/use-api";
import { del, post } from "@/lib/client/api";

interface Status {
  enabled: boolean;
  bot: string | null;
  linked: boolean;
}

export function TelegramCard() {
  const toast = useToast();
  const [waiting, setWaiting] = useState(false);
  const { data, reload } = useApi<Status>("/api/telegram", waiting ? 3000 : 30000);

  useEffect(() => {
    if (waiting && data?.linked) {
      setWaiting(false);
      toast("Telegram connected: signals will arrive in your chat");
    }
  }, [waiting, data?.linked, toast]);

  if (!data?.enabled) return null;

  const connect = async () => {
    try {
      const r = await post<{ url: string | null }>("/api/telegram", {});
      if (!r.url) throw new Error("Bot is starting up, try again in a few seconds");
      window.open(r.url, "_blank", "noopener");
      setWaiting(true);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const disconnect = async () => {
    try {
      await del("/api/telegram");
      reload();
      toast("Telegram disconnected");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <Card className="mb-5 flex flex-wrap items-center gap-3 p-4">
      <Send className="size-5 shrink-0 text-sky" />
      <div className="min-w-0 flex-1 text-sm">
        {data.linked ? (
          <>
            <div className="font-medium">Signals go to your Telegram</div>
            <div className="text-xs text-muted">Every new signal from your crawlers is sent to your chat with @{data.bot}.</div>
          </>
        ) : (
          <>
            <div className="font-medium">Get signals in Telegram</div>
            <div className="text-xs text-muted">
              {waiting ? "Press Start in the bot chat that just opened…" : "Don't keep this page open: connect the bot and every signal comes to your DMs."}
            </div>
          </>
        )}
      </div>
      {data.linked ? (
        <Button variant="ghost" size="sm" onClick={disconnect}>
          <Unlink className="size-4" /> Disconnect
        </Button>
      ) : (
        <Button size="sm" onClick={connect}>
          <Send className="size-4" /> {waiting ? "Open bot again" : "Connect Telegram"}
        </Button>
      )}
    </Card>
  );
}
