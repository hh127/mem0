/**
 * 记忆卡片：默认视图。
 *
 * 目标是「扫一眼就知道这条记忆是什么、属于哪里、什么时候过期」：
 * 正文优先，然后是分类、归属实体、时间与到期日，metadata 收进折叠区。
 */
import { useState } from "react";
import { Bot, CalendarClock, ChevronDown, ChevronUp, Play, Tag, User } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { Badge, Button, Checkbox } from "@/ui/primitives";
import type { Memory } from "./types";
import { categoriesOf, expiryInfo, metadataEntries, reviewInfo, timeSummary } from "./memory-utils";

const LONG_TEXT_THRESHOLD = 170;

export interface MemoryCardProps {
  memory: Memory;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onOpen: (memory: Memory) => void;
}

export function MemoryCard({ memory, selectMode, selected, onToggleSelect, onOpen }: MemoryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const categories = categoriesOf(memory);
  const expiry = expiryInfo(memory.expiration_date);
  const review = reviewInfo(memory);
  const metadata = metadataEntries(memory.metadata);
  const times = timeSummary(memory);
  const isLong = memory.memory.length > LONG_TEXT_THRESHOLD || memory.memory.split("\n").length > 4;
  const notifySelect = () => onToggleSelect(memory.id);

  const expiryTone = expiry.tone === "expired" ? "danger" : expiry.tone === "soon" ? "warn" : expiry.tone === "none" ? "outline" : "neutral";

  return (
    <article
      aria-label={`记忆：${memory.memory.slice(0, 36)}`}
      onClick={() => (selectMode ? notifySelect() : onOpen(memory))}
      className={cn(
        "flex cursor-pointer flex-col gap-3 rounded-[var(--radius-card)] border bg-panel p-4 shadow-[0_1px_2px_rgba(30,25,15,0.04)] transition-colors",
        selected ? "border-accent ring-1 ring-accent/40" : "border-line hover:border-line-strong",
      )}
    >
      <div className="flex items-start gap-2">
        {selectMode ? (
          <Checkbox
            checked={selected}
            onChange={notifySelect}
            onClick={(event) => event.stopPropagation()}
            aria-label={`选择记忆 ${memory.id}`}
            className="mt-1 shrink-0"
          />
        ) : null}
        <p className={cn("prose-memory min-w-0 flex-1 text-sm text-ink", !expanded && isLong && "line-clamp-5")}>
          {memory.memory}
        </p>
        {typeof memory.score === "number" ? (
          <Badge tone="accent" className="shrink-0 font-mono" title="语义搜索相关度">
            相关度 {memory.score.toFixed(3)}
          </Badge>
        ) : null}
      </div>

      {isLong ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 self-start text-[11px] font-medium text-accent hover:underline"
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
        >
          {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          {expanded ? "收起正文" : "展开全文"}
        </button>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {categories.length > 0 ? (
          categories.map((category) => (
            <Badge key={category} tone="accent">
              {category}
            </Badge>
          ))
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint">
            <Tag className="size-3" />
            尚未归类
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-soft">
        {memory.user_id ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <User className="size-3 shrink-0 text-ink-faint" />
            <span className="truncate">{memory.user_id}</span>
          </span>
        ) : null}
        {memory.agent_id ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <Bot className="size-3 shrink-0 text-ink-faint" />
            <span className="truncate">{memory.agent_id}</span>
          </span>
        ) : null}
        {memory.run_id ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <Play className="size-3 shrink-0 text-ink-faint" />
            <span className="truncate">{memory.run_id}</span>
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
        <span className="inline-flex items-center gap-1" title={times.updated}>
          <CalendarClock className="size-3" />
          创建于 {times.created}
        </span>
        <Badge tone={expiryTone}>{expiry.label}</Badge>
        <Badge tone="outline">{review.kindLabel}</Badge>
        <Badge tone={review.tone}>{review.label}</Badge>
      </div>

      {metadata.length > 0 ? (
        <details
          className="rounded-md border border-line/70 bg-panel-2/40 px-2 py-1.5"
          onClick={(event) => event.stopPropagation()}
        >
          <summary className="cursor-pointer list-none text-[11px] text-ink-faint hover:text-ink-soft [&::-webkit-details-marker]:hidden">
            元数据 · {metadata.length} 项
          </summary>
          <dl className="mt-1.5 space-y-1">
            {metadata.map(([key, value]) => (
              <div key={key} className="flex gap-2 text-[11px] leading-4">
                <dt className="shrink-0 font-mono text-ink-faint">{key}</dt>
                <dd className="min-w-0 break-all text-ink-soft">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line/60 pt-2">
        <span className="truncate text-[11px] text-ink-faint" title={formatDateTime(memory.updated_at)}>
          更新于 {times.updated}
        </span>
        {selectMode ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            aria-label={`查看记忆详情 ${memory.id}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(memory);
            }}
          >
            查看详情
          </Button>
        )}
      </div>
    </article>
  );
}
