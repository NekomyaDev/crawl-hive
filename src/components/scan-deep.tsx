"use client";
// Полный разбор на странице скана. Сервер отдаёт его только тарифу от DEEP_SCAN_TIER (deepScan проверяет токен
// сессии), остальным заглушка DeepLock. Пока вход не подтверждён, данных в браузере нет вовсе.
import { useEffect, useState } from "react";
import { BubbleMap } from "@/components/bubble-map";
import { DeepLock } from "@/components/deep-lock";
import { DumpProjection } from "@/components/dump-projection";
import { FirstBuyers } from "@/components/first-buyers";
import { LaunchEvidence } from "@/components/launch-evidence";
import { ScanFactors } from "@/components/scan-factors";
import { SecondLook } from "@/components/second-look";
import { SinceLastScan } from "@/components/since-last-scan";
import { useWallet } from "@/components/wallet-provider";
import { deepScan, type DeepScan } from "@/app/scan/[id]/actions";
import { apiSession } from "@/lib/client/api";

export function ScanDeep({ id }: { id: string }) {
  const { address, signedIn } = useWallet();
  const [deep, setDeep] = useState<DeepScan | null>(null);
  const [asked, setAsked] = useState<string | null>(null); // для какого кошелька уже спросили сервер

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    deepScan(id, apiSession())
      .then((x) => live && (setDeep(x.deep), setAsked(address)))
      .catch(() => live && setAsked(address));
    return () => {
      live = false;
    };
  }, [id, signedIn, address]);

  if (signedIn && asked !== address) return <div className="mt-4 h-40 animate-pulse rounded-xl border border-line bg-panel-2/40" />;
  if (!signedIn || !deep) return <DeepLock className="mt-4" />;
  const d = deep;
  return (
    <div className="mt-4 space-y-4">
      <SecondLook v={d.secondLook} />
      <SinceLastScan s={d.since} />
      <ScanFactors lines={d.lines} factors={d.factors} className="" />
      <DumpProjection d={d.dump} />
      {d.launch && <LaunchEvidence l={{ ...d.launch, deployer: d.launch.deployer ?? undefined }} chain={d.chain} />}
      {d.operators?.map && <BubbleMap data={d.operators.map} ops={d.operators.operators} chain={d.chain} />}
      <FirstBuyers f={d.firstBuyers} chain={d.chain} />
    </div>
  );
}
