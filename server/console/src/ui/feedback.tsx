import type { ComponentType, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Spinner } from "@/ui/spinner";
import { Button } from "@/ui/primitives";

export function FullPageLoader({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-paper text-ink-soft">
      <Spinner className="size-6 text-accent" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line px-6 py-14 text-center">
      {Icon ? <Icon className="size-7 text-ink-faint" /> : null}
      <div className="space-y-1">
        <p className="font-display text-base text-ink">{title}</p>
        {description ? (
          <p className="max-w-md text-sm leading-6 text-ink-soft">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "加载失败",
  message,
  onRetry,
  retryLabel = "重试",
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-danger/30 bg-danger-soft/40 p-5"
    >
      <div className="flex items-center gap-2 text-danger">
        <AlertTriangle className="size-4" />
        <p className="text-sm font-medium">{title}</p>
      </div>
      {message ? <p className="text-sm text-ink-soft">{message}</p> : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
      <div className="space-y-1.5">
        {eyebrow ? (
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-accent">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-2xl leading-tight text-ink md:text-[28px]">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-6 text-ink-soft">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
