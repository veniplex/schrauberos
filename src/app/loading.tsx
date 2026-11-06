import { LoadingView } from "@/components/shell/loading-view";

export default function RootLoading() {
  return (
    <main className="mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 lg:py-8">
      <LoadingView />
    </main>
  );
}
