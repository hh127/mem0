import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Trash2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { errorMessage, formatDateTime } from "@/lib/utils";
import { Badge, Button, Input, Select } from "@/ui/primitives";
import { ConfirmDialog } from "@/ui/modal";
import { EmptyState, ErrorState, PageHeader } from "@/ui/feedback";
import { Spinner } from "@/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/ui/table";
import { useToast } from "@/ui/toast";

type EntityType = "user" | "agent" | "run";

interface EntityRow {
  id: string;
  type: EntityType | string;
  total_memories: number;
  created_at?: string | null;
  updated_at?: string | null;
}

type BadgeTone = "neutral" | "accent" | "ok" | "warn" | "danger" | "outline";

const TYPE_LABELS: Record<string, string> = {
  user: "用户",
  agent: "Agent",
  run: "Run",
};

const TYPE_TONES: Record<string, BadgeTone> = {
  user: "accent",
  agent: "neutral",
  run: "outline",
};

const FILTER_OPTIONS: { value: "all" | EntityType; label: string }[] = [
  { value: "all", label: "全部类型" },
  { value: "user", label: "用户" },
  { value: "agent", label: "Agent" },
  { value: "run", label: "Run" },
];

export function EntitiesPage() {
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<"all" | EntityType>("all");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<EntityRow | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["entities"],
    queryFn: () => api.get<EntityRow[]>("/entities"),
  });

  const rows = data ?? [];

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (typeFilter !== "all" && row.type !== typeFilter) return false;
      if (!keyword) return true;
      return String(row.id).toLowerCase().includes(keyword);
    });
  }, [rows, typeFilter, search]);

  const totals = useMemo(
    () => ({
      entities: rows.length,
      memories: rows.reduce((acc, row) => acc + row.total_memories, 0),
    }),
    [rows],
  );

  const deleteMutation = useMutation({
    mutationFn: (target: EntityRow) =>
      api.delete<{ message: string }>(
        `/entities/${encodeURIComponent(String(target.type))}/${encodeURIComponent(target.id)}`,
      ),
    onSuccess: async (_result, target) => {
      setDeleteTarget(null);
      success(
        `已删除${TYPE_LABELS[String(target.type)] ?? String(target.type)}「${target.id}」及其记忆`,
      );
      await queryClient.invalidateQueries({ queryKey: ["entities"] });
      await queryClient.invalidateQueries({ queryKey: ["memories"] });
    },
    onError: (err) => {
      setDeleteTarget(null);
      toastError(errorMessage(err, "删除实体失败"));
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="管理"
        title="实体"
        description="拥有记忆的 user / agent / run 及其记忆条数；删除实体会级联删除该实体下的所有记忆。"
        actions={
          <Button
            variant="secondary"
            onClick={() => void refetch()}
            loading={isFetching && !isLoading}
          >
            刷新
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="按类型筛选"
            className="h-8 w-32 text-xs"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as "all" | EntityType)}
          >
            {FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
            <Input
              aria-label="搜索实体标识"
              className="h-8 w-56 pl-8 text-xs"
              placeholder="搜索实体标识…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        {!isLoading && !isError ? (
          <p className="text-xs text-ink-faint">
            共 {totals.entities} 个实体、{totals.memories} 条记忆
            {filtered.length !== rows.length ? ` · 当前筛选 ${filtered.length} 个` : ""}
          </p>
        ) : null}
      </div>

      {isError ? (
        <ErrorState
          message={errorMessage(error, "无法读取实体列表")}
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-panel px-4 py-10 text-sm text-ink-soft">
          <Spinner className="size-4 text-accent" />
          正在加载实体…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={rows.length === 0 ? "还没有任何实体" : "没有符合条件的实体"}
          description={
            rows.length === 0
              ? "写入记忆后，记忆所属的 user / agent / run 会出现在这里。"
              : "调整类型筛选或搜索关键词再试试。"
          }
        />
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>类型</Th>
              <Th>标识</Th>
              <Th className="text-right">记忆数</Th>
              <Th className="whitespace-nowrap">创建时间</Th>
              <Th className="whitespace-nowrap">更新时间</Th>
              <Th className="text-right">操作</Th>
            </Tr>
          </Thead>
          <Tbody>
            {filtered.map((row) => (
              <Tr key={`${row.type}:${row.id}`}>
                <Td>
                  <Badge tone={TYPE_TONES[String(row.type)] ?? "outline"}>
                    {TYPE_LABELS[String(row.type)] ?? String(row.type)}
                  </Badge>
                </Td>
                <Td>
                  <code className="break-all font-mono text-xs text-ink">{row.id}</code>
                </Td>
                <Td className="text-right text-xs tabular-nums">
                  {row.total_memories}
                </Td>
                <Td className="whitespace-nowrap text-xs">
                  {formatDateTime(row.created_at)}
                </Td>
                <Td className="whitespace-nowrap text-xs">
                  {formatDateTime(row.updated_at)}
                </Td>
                <Td className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:text-danger"
                    onClick={() => setDeleteTarget(row)}
                  >
                    <Trash2 className="size-3.5" />
                    删除
                  </Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
        loading={deleteMutation.isPending}
        title="删除实体及其全部记忆？"
        description={
          deleteTarget
            ? `将删除${TYPE_LABELS[String(deleteTarget.type)] ?? String(deleteTarget.type)}「${deleteTarget.id}」及其 ${deleteTarget.total_memories} 条记忆。该操作会级联删除且无法恢复。`
            : ""
        }
        confirmLabel="删除实体"
      />
    </div>
  );
}
