import { Suspense } from "react";
import { DevView } from "./view";

// Адрес приходит из URL только в рантайме, поэтому клиентская часть стримится внутри Suspense.
export default function DevPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-muted">Loading dev history…</div>}>
      <DevView />
    </Suspense>
  );
}
