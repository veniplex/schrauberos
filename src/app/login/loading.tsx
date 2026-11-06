import { FullscreenLoadingView } from "@/components/shell/loading-view";

// Ohne Anwendungsrahmen: nicht das Dashboard-Gerüst der Wurzel-Ladeseite zeigen
export default function Loading() {
  return <FullscreenLoadingView />;
}
