import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gauge, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { errorMessage, formatNumber } from "@/lib/utils";
import { Button, Card, Select } from "@/ui/primitives";
import { EmptyState, ErrorState, PageHeader } from "@/ui/feedback";
import { Spinner } from "@/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/ui/table";

type GroupBy = "day" | "month" | "user" | "operation" | "model";
type ModelType = "all" | "llm" | "embedder" | "reranker";

interface UsageRow {
  key: string;
  model_type: string;
  model_name?: string;
  prompt_tokens: number;
  prompt_cached_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  calls: number;
}

interface UsageTotals {
  prompt_tokens: number;
  prompt_cached_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  calls: number;
}

interface UsageByModel {
  model_type: string;
  model_name: string;
  calls: number;
  prompt_tokens: number;
  prompt_cached_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface UsageStats {
  group_by: string;
  days: number;
  rows: UsageRow[];
  totals: UsageTotals;
  by_model: UsageByModel[];
}

const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "day", label: "按天" },
  { value: "month", label: "按月" },
  { value: "user", label: "按用户" },
  { value: "operation", label: "按操作" },
  { value: "model", label: "按模型类型" },
];

const DAYS_OPTIONS = [7, 30, 90, 365];

const MODEL_TYPE_OPTIONS: { value: ModelType; label: string }[] = [
  { value: "all", label: "全部模型" },
  { value: "llm", label: "大模型（LLM）" },
  { value: "embedder", label: "嵌入模型" },
  { value: "reranker", label: "重排模型" },
];

const MODEL_TYPE_LABELS: Record<string, string> = {
  llm: "大模型",
  embedder: "嵌入模型",
  reranker: "重排模型",
};

const GROUP_AXIS_LABELS: Record<GroupBy, string> = {
  day: "日期",
  month: "月份",
  user: "用户",
  operation: "操作",
  model: "模型类型",
};

const MAX_BARS = 60;

function modelTypeLabel(value: string): string {
  return MODEL_TYPE_LABELS[value] ?? value;
}

function axisLabel(key: string, groupBy: GroupBy): string {
  if (groupBy === "day" && key.length >= 10) return key.slice(5);
  if (groupBy === "month" && key.length >= 7) return key.slice(0, 7);
  if (groupBy === "model") return modelTypeLabel(key);
  return key.length > 6 ? `${key.slice(0, 6)}…` : key;
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="mt-1 font-display text-2xl tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-1 text-[11px] leading-4 text-ink-faint">{hint}</p> : null}
    </Card>
  );
}

export function UsagePage() {
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  const [days, setDays] = useState(30);
  const [modelType, setModelType] = useState<ModelType>("all");

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["usage", "stats", groupBy, days, modelType],
    queryFn: () =>
      api.get<UsageStats>("/usage/stats", {
        group_by: groupBy,
        days,
        model_type: modelType === "all" ? undefined : modelType,
      }),
  });

  const rows = data?.rows ?? [];
  const totals = data?.totals;
  const byModel = data?.by_model ?? [];

  const chartData = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const row of rows) {
      const key = String(row.key);
      buckets.set(key, (buckets.get(key) ?? 0) + row.total_tokens);
    }
    const items = [...buckets.entries()].map(([key, total]) => ({ key, total }));
    if (groupBy === "day" || groupBy === "month") {
      items.sort((a, b) => a.key.localeCompare(b.key));
    } else {
      items.sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
    }
    return items;
  }, [rows, groupBy]);

  const visibleBars = useMemo(() => {
    const items = chartData.slice(-MAX_BARS);
    const max = items.reduce((acc, item) => Math.max(acc, item.total), 0);
    return { items, max };
  }, [chartData]);

  const cachedPercent =
    totals && totals.prompt_tokens > 0
      ? ((totals.prompt_cached_tokens / totals.prompt_tokens) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="管理"
        title="用量统计"
        description="聚合 LLM、嵌入与重排模型的 token 消耗；totals、明细与按模型三处使用同一份筛选条件。"
        actions={
          <Button
            variant="secondary"
            onClick={() => void refetch()}
            loading={isFetching && !isLoading}
          >
            <RefreshCw className="size-4" />
            刷新
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          分组方式
          <Select
            aria-label="分组方式"
            className="h-8 w-32 text-xs"
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as GroupBy)}
          >
            {GROUP_BY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          时间范围
          <Select
            aria-label="时间范围"
            className="h-8 w-28 text-xs"
            value={String(days)}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            {DAYS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                最近 {option} 天
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          模型类型
          <Select
            aria-label="模型类型"
            className="h-8 w-36 text-xs"
            value={modelType}
            onChange={(event) => setModelType(event.target.value as ModelType)}
          >
            {MODEL_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {isError ? (
        <ErrorState
          message={errorMessage(error, "无法读取用量统计")}
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-panel px-4 py-10 text-sm text-ink-soft">
          <Spinner className="size-4 text-accent" />
          正在统计 token 用量…
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="总 token"
              value={formatNumber(totals?.total_tokens ?? 0)}
              hint={`输入 ${formatNumber(totals?.prompt_tokens ?? 0)} · 输出 ${formatNumber(
                totals?.completion_tokens ?? 0,
              )}`}
            />
            <StatCard
              label="缓存命中 token"
              value={formatNumber(totals?.prompt_cached_tokens ?? 0)}
              hint={`占输入 token 的 ${cachedPercent}%`}
            />
            <StatCard
              label="调用次数"
              value={formatNumber(totals?.calls ?? 0)}
              hint={
                totals && totals.calls > 0
                  ? `平均每次 ${formatNumber(Math.round(totals.total_tokens / totals.calls))} token`
                  : "暂无调用"
              }
            />
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={Gauge}
              title="所选范围内没有用量记录"
              description="换一个时间范围或模型类型试试；只有真实调用才会产生 token 记录。"
              action={
                <Button variant="secondary" onClick={() => void refetch()}>
                  重新加载
                </Button>
              }
            />
          ) : (
            <>
              <Card className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-ink">
                      按{GROUP_AXIS_LABELS[groupBy]}的 token 消耗
                    </p>
                    <p className="text-xs text-ink-faint">
                      柱高按 total token 归一化，悬停可查看具体数值。
                    </p>
                  </div>
                  <p className="text-xs text-ink-faint">
                    共 {chartData.length} 个分组
                    {chartData.length > MAX_BARS ? `（仅显示最近 ${MAX_BARS} 个）` : ""}
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <div className="flex min-w-full items-end gap-1">
                    {visibleBars.items.map((item) => {
                      const percent =
                        visibleBars.max > 0
                          ? Math.max(2, (item.total / visibleBars.max) * 100)
                          : 2;
                      return (
                        <div
                          key={item.key}
                          className="flex min-w-[10px] flex-1 flex-col items-center gap-1"
                        >
                          <div
                            className="flex h-32 w-full items-end"
                            title={`${item.key}：${formatNumber(item.total)} token`}
                          >
                            <div
                              className="w-full rounded-t bg-accent/80 transition-colors hover:bg-accent"
                              style={{ height: `${percent}%` }}
                            />
                          </div>
                          <span className="w-full truncate text-center text-[10px] leading-4 text-ink-faint">
                            {axisLabel(item.key, groupBy)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>

              <div className="space-y-2">
                <p className="text-sm font-medium text-ink">分组明细</p>
                <Table>
                  <Thead>
                    <Tr>
                      <Th>{GROUP_AXIS_LABELS[groupBy]}</Th>
                      <Th>模型类型</Th>
                      <Th className="text-right">调用次数</Th>
                      <Th className="text-right">输入 token</Th>
                      <Th className="text-right">缓存 token</Th>
                      <Th className="text-right">输出 token</Th>
                      <Th className="text-right">总 token</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {rows.map((row, index) => (
                      <Tr key={`${row.key}-${row.model_type}-${index}`}>
                        <Td className="whitespace-nowrap font-medium text-ink">
                          {row.key}
                        </Td>
                        <Td className="whitespace-nowrap text-xs">
                          {modelTypeLabel(row.model_type)}
                        </Td>
                        <Td className="text-right text-xs tabular-nums">
                          {formatNumber(row.calls)}
                        </Td>
                        <Td className="text-right text-xs tabular-nums">
                          {formatNumber(row.prompt_tokens)}
                        </Td>
                        <Td className="text-right text-xs tabular-nums">
                          {formatNumber(row.prompt_cached_tokens)}
                        </Td>
                        <Td className="text-right text-xs tabular-nums">
                          {formatNumber(row.completion_tokens)}
                        </Td>
                        <Td className="text-right text-xs tabular-nums text-ink">
                          {formatNumber(row.total_tokens)}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </div>

              {byModel.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-ink">按模型汇总</p>
                  <Table>
                    <Thead>
                      <Tr>
                        <Th>模型类型</Th>
                        <Th>模型</Th>
                        <Th className="text-right">调用次数</Th>
                        <Th className="text-right">输入 token</Th>
                        <Th className="text-right">缓存 token</Th>
                        <Th className="text-right">输出 token</Th>
                        <Th className="text-right">总 token</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {byModel.map((row) => (
                        <Tr key={`${row.model_type}-${row.model_name}`}>
                          <Td className="whitespace-nowrap text-xs">
                            {modelTypeLabel(row.model_type)}
                          </Td>
                          <Td className="whitespace-nowrap font-mono text-xs text-ink">
                            {row.model_name || "—"}
                          </Td>
                          <Td className="text-right text-xs tabular-nums">
                            {formatNumber(row.calls)}
                          </Td>
                          <Td className="text-right text-xs tabular-nums">
                            {formatNumber(row.prompt_tokens)}
                          </Td>
                          <Td className="text-right text-xs tabular-nums">
                            {formatNumber(row.prompt_cached_tokens)}
                          </Td>
                          <Td className="text-right text-xs tabular-nums">
                            {formatNumber(row.completion_tokens)}
                          </Td>
                          <Td className="text-right text-xs tabular-nums text-ink">
                            {formatNumber(row.total_tokens)}
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
