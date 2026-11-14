"use client";

import { Clock, Pencil, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { CategoryTag } from "@/components/categories/category-tag";
import {
  categoriesOf,
  expiryLabel,
  relativeTime,
  sourceLabel,
} from "@/lib/category-utils";
import { cn } from "@/lib/utils";
import type { Memory } from "@/types/api";

/**
 * The memory card: what was remembered, which categories it belongs to, where it came
 * from, when it formed and whether it is a long-term memory — the six things a user
 * actually scans for. Only fields the backend really stores are shown (no invented
 * confidence or type badges).
 */
export function MemoryCard({
  memory,
  onOpen,
  onEdit,
  selectable = false,
  selected = false,
  onToggleSelect,
  className,
}: {
  memory: Memory;
  onOpen?: (memory: Memory) => void;
  onEdit?: (memory: Memory) => void;
  /** true = 卡片进入「批量选择」态：点卡片即勾选/取消，不再打开详情。 */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (memory: Memory) => void;
  className?: string;
}) {
  const categories = categoriesOf(memory);
  const expiry = expiryLabel(memory);

  return (
    <Card
      className={cn(
        "border-memBorder-primary transition-colors",
        (onOpen || selectable) &&
          "cursor-pointer hover:border-onSurface-default-brand/40",
        selectable && "relative",
        selectable &&
          selected &&
          "border-onSurface-default-brand ring-1 ring-onSurface-default-brand",
        className,
      )}
      onClick={
        selectable
          ? () => onToggleSelect?.(memory)
          : onOpen
            ? () => onOpen(memory)
            : undefined
      }
    >
      {selectable && (
        <span className="absolute right-3 top-3 z-10">
          <Checkbox
            checked={selected}
            aria-label={`选择记忆 ${memory.id}`}
            onCheckedChange={() => onToggleSelect?.(memory)}
            onClick={(event) => event.stopPropagation()}
          />
        </span>
      )}
      <CardContent className="p-4 space-y-3">
        <p
          className={cn(
            "typo-body-sm text-onSurface-default-primary leading-relaxed",
            selectable && "pr-6",
          )}
        >
          {memory.memory}
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          {categories.length > 0 ? (
            categories.map((category) => (
              <CategoryTag key={category} name={category} />
            ))
          ) : (
            <span className="inline-flex items-center gap-1.5 typo-caption-sm text-onSurface-default-tertiary">
              <Tag className="size-3" />
              尚未归类
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 typo-caption-sm text-onSurface-default-tertiary">
          <span className="truncate">{sourceLabel(memory)}</span>
          <span className="flex items-center gap-1.5 shrink-0">
            <Clock className="size-3" />
            {relativeTime(memory.created_at)}
            <span className="text-onSurface-default-tertiary/60">·</span>
            <span
              className={cn(
                expiry.expired && "text-onSurface-danger-primary",
                expiry.longTerm && "text-onSurface-default-secondary",
              )}
            >
              {expiry.longTerm ? "长期记忆" : `到期 ${expiry.text}`}
            </span>
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 min-w-0">
            {memory.score !== undefined && (
              <span className="shrink-0 rounded bg-surface-default-tertiary px-1.5 py-0.5 font-mono text-[10px] text-onSurface-default-tertiary">
                相关度 {memory.score.toFixed(3)}
              </span>
            )}
          </span>
          {(onOpen || onEdit) && (
            <span className="flex items-center gap-1 shrink-0">
              {onEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    onEdit(memory);
                  }}
                >
                  <Pencil className="size-3.5 mr-1" />
                  编辑
                </Button>
              )}
              {onOpen && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(memory);
                  }}
                >
                  更多
                </Button>
              )}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
