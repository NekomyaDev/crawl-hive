import { Suspense } from "react";
import { AuthorizeView } from "./view";

// Параметры OAuth приходят в URL только в рантайме, поэтому клиентская часть стримится внутри Suspense.
export default function Page() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-muted">Loading…</div>}>
      <AuthorizeView />
    </Suspense>
  );
}
