"use client";
// Лаунчпад: запуск монеты на pump.fun с сайта. Ключ минта рождается здесь, в браузере; сервер кладёт картинку
// в IPFS и собирает транзакцию, Phantom подписывает, сервер отправляет без изменений. Сразу после запуска рой
// сканирует монету по тем же правилам, что и любую другую.
import { useEffect, useRef, useState } from "react";
import { ExternalLink, ImagePlus, Loader2, Palette, Rocket, ShieldCheck, Sparkles } from "lucide-react";
import { BannerMaker } from "@/components/banner-maker";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { evmProvider, phantom } from "@/components/wallet-provider";
import { useToast } from "@/components/ui/toast";
import { useApi } from "@/lib/client/use-api";
import { api, post } from "@/lib/client/api";
import { cn, short, timeAgo } from "@/lib/utils";

interface Launch {
  chain?: "solana" | "robinhood" | "bsc";
  mint: string;
  name: string;
  symbol: string;
  image: string;
  creator: string;
  devBuySol: number;
  signature: string;
  at: number;
  verdict?: string | null;
  score?: number | null;
}
interface Recent {
  enabled: boolean;
  maxDevBuySol: number;
  launches: Launch[];
}

type Step = "ipfs" | "sign" | "send" | "live";
const STEP_LABEL: Record<Step, string> = { ipfs: "Storing the picture on IPFS…", sign: "Confirm in your wallet…", send: "Launching…", live: "Live" };
type Net = "solana" | "robinhood" | "bsc";
const NETS: { id: Net | "bsc"; t: string; pad: string; soon?: boolean }[] = [
  { id: "solana", t: "Solana", pad: "pump.fun" },
  { id: "robinhood", t: "Robinhood Chain", pad: "Pons" },
  { id: "bsc", t: "BNB Chain", pad: "four.meme" },
];
const RH_CHAIN = {
  chainId: "0x1237",
  chainName: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
  blockExplorerUrls: ["https://robin.etherscan.io"],
};
const EVM_CHAINS = {
  robinhood: RH_CHAIN,
  bsc: { chainId: "0x38", chainName: "BNB Smart Chain", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: ["https://bsc-dataseed.binance.org"], blockExplorerUrls: ["https://bscscan.com"] },
};
const CHAIN_BADGE: Record<string, string> = { solana: "SOL", robinhood: "RH", bsc: "BNB" };
const VERDICT_CLS: Record<string, string> = {
  CLEAN: "border-lime/50 text-lime",
  OK: "border-teal/50 text-teal",
  RISKY: "border-honey/50 text-honey",
  DANGER: "border-danger/50 text-danger",
  TOO_EARLY: "border-line text-muted",
};

const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (c) => String.fromCharCode(c)).join(""));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const FIELD = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-honey/60";

export default function LaunchPage() {
  const { data, reload } = useApi<Recent>("/api/launch", 30_000);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ name: "", symbol: "", description: "", website: "", twitter: "", telegram: "", devBuySol: "" });
  const [image, setImage] = useState<string>("");
  const [step, setStep] = useState<Step | null>(null);
  const [done, setDone] = useState<{ mint: string; signature: string; symbol: string; chain: Net } | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [net, setNet] = useState<Net>("solana");
  const [tax, setTax] = useState(0);
  const { data: rh } = useApi<{ enabled: boolean; feeEth: number | null }>("/api/launch/evm?chain=robinhood", 60_000);
  const { data: bnb } = useApi<{ enabled: boolean; feeEth: number | null; maxDevBuy: number }>("/api/launch/evm?chain=bsc", 60_000);
  const [devBnb, setDevBnb] = useState("");
  const [nid, setNid] = useState("");
  const [imgNote, setImgNote] = useState("");
  const [drawing, setDrawing] = useState(false);

  // Картинка по ссылке (пост X через наш прокси или нарисованный арт) → data URL для формы и баннера.
  const loadImage = async (src: string, note: string) => {
    const r = await fetch(src);
    if (!r.ok) throw new Error("Could not load the picture");
    const blob = await r.blob();
    const data = await new Promise<string>((ok) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result));
      fr.readAsDataURL(blob);
    });
    setImage(data);
    setImgNote(note);
  };

  const drawArt = async () => {
    if (!nid) return;
    setDrawing(true);
    try {
      const { url } = await post<{ url: string }>("/api/narratives/art", { id: nid });
      await loadImage(url, "AI art for this narrative");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDrawing(false);
    }
  };
  // Пришли с сигнала Narrative Hunter: название, тикер и описание уже заполнены, остаётся картинка.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const name = q.get("name")?.slice(0, 32);
    const symbol = q.get("symbol")?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    const description = q.get("description")?.slice(0, 500);
    if (!name && !symbol && !description) return;
    setF((x) => ({ ...x, name: name ?? x.name, symbol: symbol ?? x.symbol, description: description ?? x.description }));
    const src = q.get("from");
    setFrom(src && /^https:\/\/(x|twitter)\.com\//.test(src) ? src : "");
    setNid(q.get("nid")?.replace(/[^a-z0-9-]/gi, "") ?? "");
    const img = q.get("img");
    if (img && /^https:\/\/pbs\.twimg\.com\//.test(img)) loadImage(`/api/narratives/image?u=${encodeURIComponent(img)}`, "picture from the source post").catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const pick = (file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return toast("Image: a PNG, JPEG, WebP or GIF", "error");
    if (file.size > 2_000_000) return toast("Image: up to 2 MB", "error");
    const r = new FileReader();
    r.onload = () => setImage(String(r.result));
    r.readAsDataURL(file);
  };

  const launch = async () => {
    const p = phantom();
    if (!p?.signTransaction) return toast("Open the site in a browser with Phantom", "error");
    if (!image) return toast("Add a picture for the coin", "error");
    setDone(null);
    try {
      const { publicKey } = await p.connect();
      const { Keypair, VersionedTransaction } = await import("@solana/web3.js");
      // Адрес монеты создаётся здесь, в браузере; наружу уходит только публичная половина.
      const mint = Keypair.generate();
      setStep("ipfs");
      const prep = await post<{ id: string; tx: string }>("/api/launch/prepare", { ...f, image, creator: publicKey.toString(), mint: mint.publicKey.toBase58() });
      const tx = VersionedTransaction.deserialize(unb64(prep.tx));
      // Сначала подписывает минт, потом кошелёк подписывает ровно эту транзакцию.
      tx.sign([mint]);
      setStep("sign");
      let signed: typeof tx;
      try {
        signed = await p.signTransaction(tx);
      } catch {
        throw new Error("You cancelled in Phantom. Nothing was sent.");
      }
      setStep("send");
      let r = await post<{ status: string; signature: string; mint: string }>("/api/launch/submit", { id: prep.id, signed: b64(signed.serialize()) });
      for (let i = 0; r.status === "pending" && i < 20; i++) {
        await new Promise((ok) => setTimeout(ok, 3000));
        r = { ...r, ...(await api<{ status: string }>(`/api/launch?status=${r.signature}`)) };
      }
      if (r.status !== "live") throw new Error(r.status === "failed" ? "The launch failed onchain. Nothing was created." : `Still confirming. Check the transaction in a minute: ${r.signature}`);
      setStep("live");
      setDone({ mint: r.mint, signature: r.signature, symbol: f.symbol.replace(/^\$/, "").toUpperCase(), chain: "solana" });
      toast(`$${f.symbol.replace(/^\$/, "").toUpperCase()} is live 🐙`);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setStep((s) => (s === "live" ? s : null));
    }
  };

  // EVM-сети. Robinhood Chain (Pons): сервер собирает вызов фабрики. BNB Chain (four.meme): сначала подпись текста
  // входа (не транзакция), сервер входит ею, загружает картинку и собирает createToken. Отправляет всегда кошелёк.
  const launchEvm = async (chain: "robinhood" | "bsc") => {
    const p = evmProvider();
    if (!p) return toast("Open the site in a browser with MetaMask or Rabby", "error");
    if (!image) return toast("Add a picture for the coin", "error");
    const net = EVM_CHAINS[chain];
    setDone(null);
    try {
      const [from] = (await p.request({ method: "eth_requestAccounts" })) as string[];
      try {
        await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: net.chainId }] });
      } catch (e) {
        if ((e as { code?: number }).code === 4001) throw new Error("You cancelled in your wallet. Nothing was sent.");
        await p.request({ method: "wallet_addEthereumChain", params: [net] });
      }
      let loginSignature: string | undefined;
      if (chain === "bsc") {
        const { message } = await post<{ message: string }>("/api/launch/evm/nonce", { address: from });
        setStep("sign");
        try {
          loginSignature = (await p.request({ method: "personal_sign", params: [message, from] })) as string;
        } catch {
          throw new Error("You cancelled the four.meme sign-in. Nothing was sent.");
        }
      }
      setStep("ipfs");
      const prep = await post<{ id: string; tx: { to: string; data: string; value: string } }>("/api/launch/evm", { ...f, image, chain, creator: from, taxBps: tax, loginSignature, devBuy: chain === "bsc" ? devBnb : undefined });
      setStep("sign");
      let hash: string;
      try {
        hash = (await p.request({ method: "eth_sendTransaction", params: [{ from, to: prep.tx.to, data: prep.tx.data, value: prep.tx.value }] })) as string;
      } catch {
        throw new Error("You cancelled in your wallet. Nothing was sent.");
      }
      setStep("send");
      let r = { status: "pending", mint: "", hash };
      for (let i = 0; r.status === "pending" && i < 30; i++) {
        await new Promise((ok) => setTimeout(ok, 2500));
        r = await post<typeof r>("/api/launch/evm/submit", { id: prep.id, hash }).catch((e) => ({ ...r, status: (e as Error).message }));
      }
      if (r.status !== "live") throw new Error(r.status === "failed" ? "The launch failed onchain. Nothing was created." : r.status === "pending" ? `Still confirming. Check the transaction in a minute: ${hash}` : r.status);
      setStep("live");
      setDone({ mint: r.mint, signature: hash, symbol: f.symbol.replace(/^\$/, "").toUpperCase(), chain });
      toast(`$${f.symbol.replace(/^\$/, "").toUpperCase()} is live on ${net.chainName} 🐙`);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setStep((s) => (s === "live" ? s : null));
    }
  };

  const busy = step !== null && step !== "live";
  const off = net === "solana" ? data && !data.enabled : net === "robinhood" ? rh && !rh.enabled : bnb && !bnb.enabled;

  return (
    <>
      <PageHeader
        title={
          <>
            <Rocket className="mr-2 inline size-7 text-honey" />
            Clean Launch
          </>
        }
        sub="Launch a coin on pump.fun (Solana), Pons (Robinhood Chain) or four.meme (BNB Chain) right from CrawlHive. The moment it is live, the swarm scans it by the same rules as every other coin: no special treatment, and the verdict goes on the public Track Record."
      />

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader title="Your coin" sub={`0% platform fee · you pay only ${net === "solana" ? "pump.fun" : net === "robinhood" ? "Pons" : "four.meme"} and the network`} />
          <div className="space-y-3 p-4">
            {from !== null && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-honey/40 bg-honey/[0.07] px-3 py-2 text-[13px]">
                <Sparkles className="size-4 shrink-0 text-honey" />
                <span>
                  Filled in from a <b>Narrative Hunter</b> signal. Add a picture, check the text, launch.
                </span>
                {from && (
                  <a href={from} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky hover:underline">
                    source post <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {NETS.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  disabled={n.soon}
                  onClick={() => !n.soon && setNet(n.id as Net)}
                  className={cn(
                    "rounded-xl border px-2 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    net === n.id ? "border-honey/70 bg-honey/10" : "border-line hover:border-honey/40",
                  )}
                >
                  <span className="block font-bold text-fg">{n.t}</span>
                  <span className="text-muted">{n.soon ? `${n.pad} · soon` : n.pad}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-line bg-bg text-muted hover:border-honey/60 hover:text-honey"
                aria-label="Pick a picture"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {image ? <img src={image} alt="" className="size-full object-cover" /> : <ImagePlus className="size-7" />}
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
              <div className="grid flex-1 gap-2">
                <input className={FIELD} placeholder="Name (2-32)" maxLength={32} value={f.name} onChange={set("name")} />
                <input className={cn(FIELD, "num uppercase")} placeholder="TICKER (2-10)" maxLength={11} value={f.symbol} onChange={set("symbol")} />
              </div>
            </div>
            {(nid || imgNote) && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {imgNote && <span className="text-muted">🖼 {imgNote} · tap the picture to use your own</span>}
                {nid && (
                  <button type="button" onClick={drawArt} disabled={drawing} className="inline-flex items-center gap-1.5 rounded-lg border border-violet/60 px-2.5 py-1 text-violet hover:bg-violet/10 disabled:opacity-60">
                    {drawing ? <Loader2 className="size-3.5 animate-spin" /> : <Palette className="size-3.5" />}
                    {drawing ? "Drawing…" : "Generate art"}
                  </button>
                )}
              </div>
            )}
            <textarea className={cn(FIELD, "min-h-20")} placeholder="Description (up to 500)" maxLength={500} value={f.description} onChange={set("description")} />
            <div className="grid gap-2 sm:grid-cols-3">
              <input className={FIELD} placeholder="https://website" value={f.website} onChange={set("website")} />
              <input className={FIELD} placeholder="https://x.com/…" value={f.twitter} onChange={set("twitter")} />
              <input className={FIELD} placeholder="https://t.me/…" value={f.telegram} onChange={set("telegram")} />
            </div>
            {net === "bsc" ? (
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted" htmlFor="devbnb">
                  Dev buy
                </label>
                <div className="flex items-center rounded-lg border border-line bg-bg px-3">
                  <input id="devbnb" inputMode="decimal" className="num h-9 w-20 bg-transparent text-sm outline-none" placeholder="0" value={devBnb} onChange={(e) => setDevBnb(e.target.value.replace(",", "."))} />
                  <span className="text-xs text-muted">BNB</span>
                </div>
                <span className="text-xs text-muted">optional, up to {bnb?.maxDevBuy ?? 1} BNB, in the same transaction</span>
              </div>
            ) : net === "robinhood" ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted">Creator fee on trades</span>
                {[0, 100, 200].map((b) => (
                  <button key={b} type="button" onClick={() => setTax(b)} className={cn("num rounded-lg border px-3 py-1.5 text-sm", tax === b ? "border-honey/70 bg-honey/10 text-honey" : "border-line text-muted hover:text-fg")}>
                    {b / 100}%
                  </button>
                ))}
                <span className="text-xs text-muted">paid to your wallet by Pons; 0% looks cleanest to scanners</span>
              </div>
            ) : (
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted" htmlFor="devbuy">
                Dev buy
              </label>
              <div className="flex items-center rounded-lg border border-line bg-bg px-3">
                <input id="devbuy" inputMode="decimal" className="num h-9 w-20 bg-transparent text-sm outline-none" placeholder="0" value={f.devBuySol} onChange={(e) => setF((x) => ({ ...x, devBuySol: e.target.value.replace(",", ".") }))} />
                <span className="text-xs text-muted">SOL</span>
              </div>
              <span className="text-xs text-muted">optional, up to {data?.maxDevBuySol ?? 5} SOL, in the same transaction</span>
            </div>
            )}
            <button
              type="button"
              disabled={busy || !!off}
              onClick={net === "solana" ? launch : () => launchEvm(net)}
              className="dex-cta flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-honey via-coral to-pink text-lg font-extrabold text-black disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-5 animate-spin" /> : <Rocket className="size-5" />}
              {off ? "Launches are paused" : busy ? STEP_LABEL[step!] : net === "solana" ? "Launch on pump.fun" : net === "robinhood" ? "Launch on Robinhood Chain" : "Launch on four.meme"}
            </button>
            <p className="text-[11px] text-muted">
              {net === "solana"
                ? "A launch costs about 0.03 SOL in pump.fun and network fees, plus your dev buy."
                : net === "robinhood"
                  ? `A launch costs ${rh?.feeEth ?? 0.0005} ETH to Pons plus network gas, paid from MetaMask or Rabby.`
                  : `four.meme charges ${bnb?.feeEth ?? 0} BNB to launch, plus gas and your dev buy. You sign a four.meme login message first (free), then the launch.`}{" "}
              Launching a coin does not make it a good investment.
            </p>
          </div>
        </Card>

        <div className="space-y-5">
          {done && (
            <Card className="border-lime/50">
              <div className="space-y-2 p-4">
                <div className="text-lg font-bold text-lime">${done.symbol} is live 🐙</div>
                <div className="num text-xs text-muted break-all">{done.mint}</div>
                <div className="text-sm text-fg/80">The swarm is scanning it now. The verdict lands on its scan page and on the Track Record.</div>
                <div className="flex flex-wrap gap-2 pt-1 text-sm">
                  <a href={`/scan/${done.mint}`} className="rounded-lg border border-honey/60 px-3 py-1.5 text-honey hover:bg-honey/10">
                    Swarm scan
                  </a>
                  <a href={done.chain === "solana" ? `https://pump.fun/coin/${done.mint}` : done.chain === "bsc" ? `https://four.meme/token/${done.mint}` : `https://dexscreener.com/robinhood/${done.mint}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 hover:text-honey">
                    {done.chain === "solana" ? "pump.fun" : done.chain === "bsc" ? "four.meme" : "DexScreener"} <ExternalLink className="size-3" />
                  </a>
                  <a href={done.chain === "solana" ? `https://solscan.io/tx/${done.signature}` : done.chain === "bsc" ? `https://bscscan.com/tx/${done.signature}` : `https://robin.etherscan.io/tx/${done.signature}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 hover:text-honey">
                    {done.chain === "solana" ? "Solscan" : "Explorer"} <ExternalLink className="size-3" />
                  </a>
                </div>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="DexScreener banner" sub="3:1, drawn in your browser from your picture, name and ticker" />
            <div className="p-4">
              <BannerMaker image={image} name={f.name} symbol={f.symbol.replace(/^\$/, "").toUpperCase()} />
            </div>
          </Card>

          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="size-4 text-lime" /> How it stays safe</span>} />
            <ul className="space-y-2 p-4 text-sm text-fg/80">
              {net === "solana" ? (
                <>
                  <li>• <b>The coin&apos;s key is made in your browser.</b> Only its public address is sent to us.</li>
                  <li>• <b>We build the transaction, Phantom signs it.</b> We send it only if it is byte for byte the one we built and both signatures are on it.</li>
                </>
              ) : (
                <>
                  <li>• <b>Your wallet calls the {net === "robinhood" ? "Pons factory" : "four.meme contract"} itself.</b> We only build the call; MetaMask or Rabby shows it and sends it.{net === "bsc" ? " The four.meme sign-in is a free message signature, not a transaction, and we never keep its session." : ""}</li>
                  <li>• <b>You are the creator.</b> The creator fee, if you set one, goes to your wallet. We check the receipt is exactly the call we built.</li>
                </>
              )}
              <li>• <b>No key on our server, 0% platform fee.</b> The creator fees pump.fun pays go to your wallet as usual.</li>
              <li>• <b>Scanned at birth, by the same rules.</b> Coins launched here get no score boost. If the swarm says DANGER, it says DANGER.</li>
            </ul>
          </Card>

          <Card>
            <CardHeader title="Launched on CrawlHive" sub={data ? `${data.launches.length} so far` : undefined} />
            {data && data.launches.length > 0 ? (
              <ul className="divide-y divide-line/60">
                {data.launches.map((l) => (
                  <li key={l.mint} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={l.image} alt="" className="size-9 rounded-lg object-cover" />
                    <div className="min-w-0 flex-1">
                      <a href={`/scan/${l.mint}`} className="font-semibold hover:text-honey">
                        ${l.symbol}
                      </a>{" "}
                      <span className="text-muted">{l.name}</span>{" "}
                      <span className="num rounded border border-line px-1 text-[10px] text-muted">{CHAIN_BADGE[l.chain ?? "solana"]}</span>
                      <div className="num text-[11px] text-muted">
                        {short(l.creator)} · {timeAgo(l.at)}
                        {l.devBuySol ? ` · dev buy ${l.devBuySol} SOL` : ""}
                      </div>
                    </div>
                    <span className={cn("num rounded-md border px-2 py-0.5 text-[11px] font-semibold", VERDICT_CLS[l.verdict ?? "TOO_EARLY"] ?? "border-line text-muted")}>
                      {l.verdict ? `${l.verdict}${l.score != null ? ` ${l.score}` : ""}` : "scanning…"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-4 text-sm text-muted">No launches yet. Be the first coin born scanned.</div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
