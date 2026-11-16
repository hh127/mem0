/**
 * 审核卡片：一条待审核（或已驳回）记忆 + 就地审核动作。
 *
 * 正文默认折行展示，长内容可展开——审核要看全文，不能只给一行截断。
 * 动作按钮横排在卡片底部，避免右侧竖排按钮把正文挤窄。
 */
import { useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Pencil,
  Play,
  RotateCcw,
  Tag,
  Trash2,
  User,
  X,
} from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { Badge, Button, Checkbox } from "@/ui/primitives";
import type { Memory } from "@/features/memories/types";
import { categoriesOf, reviewInfo, timeSummary } from "@/features/memories/memory-utils";

const LONG_TEXT_THRESHOLD = 220;

export interface ReviewCardProps {
  memory: Memory;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onApprove: (memory: Memory) => void;
  onReject: (memory: Memory) => void;
  onEdit: (memory: Memory) => void;
  onDelete: (memory: Memory) => void;
  busy: boolean;
}

export function ReviewCard({
  memory,
  selected,
  onToggleSelect,
  onApprove,
  onReject,
  onEdit,
  onDelete,
  busy,
}: ReviewCardProps) {
  const [expanded, setExpanded] = useState(false);
  const info = reviewInfo(memory);
  const categories = categoriesOf(memory);
  const times = timeSummary(memory);
  const isLong =
    memory.memory.length > LONG_TEXT_THRESHOLD || memory.memory.split("\n").length > 5;
  const isRejected = info.status === "rejected";

  return (
    <article
      aria-label={`待审核记忆：${memory.memory.slice(0, 32)}`}
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-card)] border bg-panel p-4 transition-colors",
        selected ? "border-accent ring-1 ring-accent/40" : "border-line",
      )}
    >
      <div className="flex gap-3">
        <Checkbox
          checked={selected}
          onChange={() => onToggleSelect(memory.id)}
          aria-label={`选择记忆 ${memory.id}`}
          className="mt-1 shrink-0"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <p
            className={cn(
              "prose-memory whitespace-pre-wrap break-words text-sm leading-6 text-ink",
              isLong && !expanded && "line-clamp-6",
            )}
          >
            {memory.memory}
          </p>
          {isLong ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 self-start text-[11px] font-medium text-accent hover:underline"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              {expanded ? "收起正文" : "展开全文"}
            </button>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={info.tone}>{info.label}</Badge>
            <Badge tone="outline">{info.kindLabel}</Badge>
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
            <span className="text-ink-faint" title={formatDateTime(memory.created_at)}>
              创建于 {times.created}
            </span>
            {isRejected && info.reviewedBy ? (
              <span className="text-ink-faint">
                由 {info.reviewedBy} 驳回于 {formatDateTime(info.reviewedAt)}
              </span>
            ) : null}
          </div>

          {isRejected && info.note ? (
            <p className="rounded-md border border-danger/30 bg-danger-soft/40 px-2.5 py-1.5 text-[11px] leading-5 text-ink-soft">
              驳回理由：{info.note}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line/60 pt-2">
        {isRejected ? (
          <>
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => onApprove(memory)}
            >
              <RotateCcw className="size-3.5" />
              恢复通过
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => onEdit(memory)}>
              <Pencil className="size-3.5" />
              编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:bg-danger-soft"
              disabled={busy}
              onClick={() => onDelete(memory)}
            >
              <Trash2 className="size-3.5" />
              彻底删除
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => onApprove(memory)}>
              <Check className="size-3.5" />
              通过
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => onEdit(memory)}>
              <Pencil className="size-3.5" />
              编辑
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => onReject(memory)}>
              <X className="size-3.5" />
              驳回
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:bg-danger-soft"
              disabled={busy}
              onClick={() => onDelete(memory)}
            >
              <Trash2 className="size-3.5" />
              删除
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
