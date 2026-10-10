import { Suspense } from "react";
import { CrawlerView } from "./view";

// id приходит из URL только в рантайме, поэтому клиентская часть стримится внутри Suspense.
export default function CrawlerPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-muted">Loading crawler…</div>}>
      <CrawlerView />
    </Suspense>
  );
}
