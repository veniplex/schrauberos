import { createElement, type ReactElement } from "react";

/**
 * Next-Router für Komponententests: `usePathname()` und `useRouter()` aus `next/navigation` brauchen die Kontexte der App-Router-Laufzeit. Der Test bekommt einen festen
 * Pfad und einen `push`, der die Ziele festhält. Nur in Tests verwenden.
 */
export async function withRouter(element: ReactElement, options: { pathname?: string; pushed?: string[] } = {}): Promise<ReactElement> {
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { PathnameContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime");
  const router = {
    push: (href: string) => void options.pushed?.push(href),
    replace: (href: string) => void options.pushed?.push(href),
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: () => {},
  };
  return createElement(AppRouterContext.Provider, { value: router as never }, createElement(PathnameContext.Provider, { value: options.pathname ?? "/" }, element));
}
