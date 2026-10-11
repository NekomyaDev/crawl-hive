"use client";
// Кнопки «поделиться» для результата скана: пост в X со ссылкой на /scan/<адрес> (у неё своё превью) и копия ссылки.
import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { scanPath, xIntent } from "@/lib/scan-share";

export function ShareOnX({ id, text }: { id: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const url = () => `${window.location.origin}${scanPath(id)}`;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => window.open(xIntent(text, url()), "_blank", "noopener,noreferrer")}>
        <span className="text-sm leading-none font-bold">𝕏</span> Share on X
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          navigator.clipboard?.writeText(url()).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? <Check className="size-4" /> : <Link2 className="size-4" />} {copied ? "copied" : "copy link"}
      </Button>
    </>
  );
}
