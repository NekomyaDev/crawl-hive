"use client";
// Разделы, которые пока работают только на внутренних credits (маркетплейс, голосования). На проде,
// где демо-сеть выключена, вместо них показываем честную заглушку, а не симуляцию под видом настоящего.
import Link from "next/link";
import type { ReactNode } from "react";
import { Hourglass } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { useConfig } from "@/lib/client/use-config";

export function ComingSoon({ title, children, what }: { title: string; what: string; children: ReactNode }) {
  const cfg = useConfig();
  if (!cfg) return null;
  if (cfg.demoNetwork) return <>{children}</>;
  return (
    <>
      <PageHeader title={title} />
      <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <Hourglass className="size-8 text-honey" />
        <div className="font-semibold">Coming after the token launch</div>
        <p className="max-w-md text-sm text-muted">{what}</p>
        <Link href="/spawn">
          <Button>Spawn a crawler meanwhile</Button>
        </Link>
      </Card>
    </>
  );
}
