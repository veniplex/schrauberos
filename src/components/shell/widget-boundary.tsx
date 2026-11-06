"use client";

import { Component, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/buttons";
import { Alert } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";

type Props = { children: ReactNode; fallback: (retry: () => void) => ReactNode };
type State = { failed: boolean };

/** Fehlergrenze für einen Baustein: Wirft er beim Rendern, fällt nur er aus – der Rest der Seite bleibt. */
export class FallbackBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  private retry = () => this.setState({ failed: false });

  render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}

function WidgetFallback({ retry }: { retry: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <div className="flex flex-col items-start gap-3">
      <Alert tone="warning">
        <strong className="font-medium">{t("errors.widgetTitle")}</strong> {t("errors.widgetText")}
      </Alert>
      <Button
        size="sm"
        onClick={() => {
          router.refresh();
          retry();
        }}
      >
        {t("errors.retry")}
      </Button>
    </div>
  );
}

/** Dashboard-Baustein in eigener Fehlergrenze: ein werfendes Widget zerstört nicht die Übersicht. */
export function WidgetBoundary({ children }: { children: ReactNode }) {
  return <FallbackBoundary fallback={(retry) => <WidgetFallback retry={retry} />}>{children}</FallbackBoundary>;
}
