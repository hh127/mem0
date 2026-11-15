/**
 * 记忆紧凑表格视图：行更密，适合逐条核对时间/到期日。
 */
import { cn, formatDateTime } from "@/lib/utils";
import { Badge, Button, Checkbox } from "@/ui/primitives";
import { Table, Tbody, Td, Th, Thead } from "@/ui/table";
import type { Memory } from "./types";
import { categoriesOf, expiryInfo, timeSummary } from "./memory-utils";

function expiryTone(memory: Memory): "danger" | "warn" | "outline" | "neutral" {
  const tone = expiryInfo(memory.expiration_date).tone;
  if (tone === "expired") return "danger";
  if (tone === "soon") return "warn";
  if (tone === "none") return "outline";
  return "neutral";
}

export interface MemoryTableProps {
  memories: readonly Memory[];
  selectMode: boolean;
  selectedIds: ReadonlySet<string>;
  allPageSelected: boolean;
  onToggleSelect: (id: string) => void;
  onTogglePage: () => void;
  onOpen: (memory: Memory) => void;
}

export function MemoryTable({
  memories,
  selectMode,
  selectedIds,
  allPageSelected,
  onToggleSelect,
  onTogglePage,
  onOpen,
}: MemoryTableProps) {
  return (
    <Table>
      <Thead>
        <tr>
          {selectMode ? (
            <Th className="w-10">
              <Checkbox checked={allPageSelected} onChange={onTogglePage} aria-label="全选当前页记忆" />
            </Th>
          ) : null}
          <Th>内容</Th>
          <Th>分类</Th>
          <Th>归属实体</Th>
          <Th>时间</Th>
          <Th>到期日</Th>
          <Th className="w-16">操作</Th>
        </tr>
      </Thead>
      <Tbody>
        {memories.map((memory) => {
          const categories = categoriesOf(memory);
          const expiry = expiryInfo(memory.expiration_date);
          const times = timeSummary(memory);
          const selected = selectedIds.has(memory.id);
          return (
            <tr
              key={memory.id}
              className={cn(
                "transition-colors hover:bg-panel-2/50",
                !selectMode && "cursor-pointer",
                selected && "bg-accent-soft/40",
              )}
              onClick={() => (selectMode ? onToggleSelect(memory.id) : onOpen(memory))}
            >
              {selectMode ? (
                <Td>
                  <Checkbox
                    checked={selected}
                    onChange={() => onToggleSelect(memory.id)}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`选择记忆 ${memory.id}`}
                  />
                </Td>
              ) : null}
              <Td className="min-w-[260px] max-w-[420px]">
                <div className="flex items-start gap-2">
                  <span className="line-clamp-2 text-sm text-ink" title={memory.memory}>
                    {memory.memory}
                  </span>
                  {typeof memory.score === "number" ? (
                    <Badge tone="accent" className="shrink-0 font-mono">
                      {memory.score.toFixed(3)}
                    </Badge>
                  ) : null}
                </div>
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {categories.length > 0 ? (
                    categories.map((category) => (
                      <Badge key={category} tone="accent">
                        {category}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-ink-faint">未归类</span>
                  )}
                </div>
              </Td>
              <Td>
                <div className="space-y-0.5 text-xs">
                  <p className="truncate text-ink-soft">{memory.user_id ?? "—"}</p>
                  {memory.agent_id ? <p className="truncate text-ink-faint">代理 {memory.agent_id}</p> : null}
                  {memory.run_id ? <p className="truncate text-ink-faint">运行 {memory.run_id}</p> : null}
                </div>
              </Td>
              <Td>
                <div className="space-y-0.5 text-xs">
                  <p className="whitespace-nowrap text-ink-soft">{times.created}</p>
                  <p className="whitespace-nowrap text-ink-faint" title={formatDateTime(memory.updated_at)}>
                    {times.updated}
                  </p>
                </div>
              </Td>
              <Td>
                <Badge tone={expiryTone(memory)}>{expiry.label}</Badge>
              </Td>
              <Td>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  aria-label={`查看记忆详情 ${memory.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(memory);
                  }}
                >
                  查看
                </Button>
              </Td>
            </tr>
          );
        })}
      </Tbody>
    </Table>
  );
}
