"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * One category chip. Deliberately single-accent: 18 categories must not turn into
 * 18 colours — the name carries the meaning, the dot only marks "this is a tag".
 */
export function CategoryTag({
  name,
  count,
  href,
  active = false,
  muted = false,
  className,
}: {
  name: string;
  count?: number;
  href?: string;
  active?: boolean;
  muted?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <span
        className={cn(
          "size-1.5 rounded-full shrink-0",
          active ? "bg-onSurface-default-brand" : "bg-onSurface-default-tertiary",
        )}
      />
      <span className="typo-body-xs truncate">{name}</span>
      {count !== undefined && (
        <span className="typo-caption-sm text-onSurface-default-tertiary tabular-nums">
          {count}
        </span>
      )}
    </>
  );

  const classes = cn(
    "inline-flex items-center gap-1.5 max-w-full rounded-md border px-2 py-1 transition-colors",
    active
      ? "border-onSurface-default-brand/40 bg-surface-default-brand/10 text-onSurface-default-primary"
      : "border-memBorder-primary bg-surface-default-fg-secondary text-onSurface-default-secondary",
    muted && "opacity-60",
    href && "hover:bg-surface-default-tertiary-hover cursor-pointer",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    );
  }

  return <span className={classes}>{body}</span>;
}
