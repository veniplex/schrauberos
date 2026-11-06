import { NotFoundContent } from "@/app/not-found-content";

// Innerhalb des Anwendungsrahmens: Navigation bleibt sichtbar (auch für `notFound()` aus Seiten und fehlende Rechte).
export default function AppNotFound() {
  return <NotFoundContent />;
}
