"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApiQuery } from "@/hooks/use-api-query";
import type { UsageStatsResponse } from "@/types/api";
import { api } from "@/utils/api";
import { USAGE_ENDPOINTS } from "@/utils/api-endpoints";

type GroupKey = "day" | "month" | "user" | "operation";

const GROUPINGS: { value: GroupKey; label: string }[] = [
  { value: "day", label: "按天" },
  { value: "month", label: "按月" },
  { value: "user", label: "按用户" },
  { value: "operation", label: "按搜索" },
];

const RANGES: { value: number; label: string }[] = [
  { value: 7, label: "近 7 天" },
  { value: 30, label: "近 30 天" },
  { value: 90, label: "近 90 天" },
  { value: 3650, label: "全部" },
];

const MODEL_META: Record<string, { label: string; short: string; color: string; hint: string }> = {
  llm: {
    label: "LLM",
    short: "记忆抽取",
    color: "#6366f1",
    hint: "写入记忆时用它理解内容、抽取事实、判断是否要更新",
  },
  embedder: {
    label: "嵌入模型",
    short: "向量化",
    color: "#0ea5e9",
    hint: "写入和搜索时把文本转成向量，只有输入没有输出",
  },
  reranker: {
    label: "重排序模型",
    short: "重排",
    color: "#f59e0b",
    hint: "搜索时对候选结果重新排序，决定谁排在前面",
  },
};

const MODEL_ORDER = ["llm", "embedder", "reranker"];

const OPERATION_LABELS: Record<string, string> = {
  add: "写入记忆",
  search: "搜索记忆",
  update: "更新记忆",
  delete: "删除记忆",
  read: "读取记忆",
  other: "其他请求",
};

const fmt = (value: number | undefined | null) =>
  value === undefined || value === null ? "0" : Number(value).toLocaleString("zh-CN");

const modelLabel = (type: string) => MODEL_META[type]?.label ?? type;

const dimensionLabel = (key: string, groupBy: GroupKey) => {
  if (groupBy === "operation") return OPERATION_LABELS[key] ?? key;
  if (key === "(未标注)") return "未标注";
  return key;
};

export default function UsagePage() {
  const [groupBy, setGroupBy] = useState<GroupKey>("day");
  const [days, setDays] = useState(30);
  const skipFirstRefetch = useRef(true);

  const { data, isLoading, error, refetch } = useApiQuery<UsageStatsResponse>(async () => {
    const res = await api.get<UsageStatsResponse>(USAGE_ENDPOINTS.STATS, {
      params: { group_by: groupBy, days },
    });
    return res.data;
  });

  // 切换维度 / 时间范围后重新拉取（首次挂载由 useApiQuery 自己发起）
  useEffect(() => {
    if (skipFirstRefetch.current) {
      skipFirstRefetch.current = false;
      return;
    }
    void refetch();
  }, [groupBy, days, refetch]);

  const rows = data?.rows ?? [];
  const byModel = data?.by_model ?? [];
  const totals = data?.totals;

  const summaries = useMemo(
    () =>
      MODEL_ORDER.map((type) => ({
        type,
        meta: MODEL_META[type],
        summary: byModel.find((item) => item.model_type === type),
      })),
    [byModel],
  );

  const chartData = useMemo(() => {
    const buckets = new Map<string, Record<string, string | number>>();
    for (const row of rows) {
      const entry = buckets.get(row.key) ?? { name: row.key };
      entry[row.model_type] = (Number(entry[row.model_type]) || 0) + Number(row.total_tokens);
      buckets.set(row.key, entry);
    }
    return Array.from(buckets.values());
  }, [rows]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (a.key !== b.key) return a.key.localeCompare(b.key);
      return b.total_tokens - a.total_tokens;
    });
  }, [rows]);

  const hasData = rows.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">用量统计</h1>
          <p className="mt-1 text-sm text-onSurface-default-secondary">
            统计记忆系统的三个模型：LLM（记忆抽取）、嵌入模型（向量化）、重排序模型（重排）。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isLoading}>
          <RefreshCw className={isLoading ? "animate-spin" : undefined} />
          刷新
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1">
          {GROUPINGS.map((item) => (
            <Button
              key={item.value}
              size="sm"
              variant={groupBy === item.value ? "default" : "outline"}
              onClick={() => setGroupBy(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {RANGES.map((item) => (
            <Button
              key={item.value}
              size="sm"
              variant={days === item.value ? "default" : "outline"}
              onClick={() => setDays(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-onSurface-default-secondary">总消耗</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{fmt(totals?.total_tokens)}</div>
            <div className="mt-1 text-xs text-onSurface-default-secondary">
              输入 {fmt(totals?.prompt_tokens)} · 输出 {fmt(totals?.completion_tokens)} · 调用 {fmt(totals?.calls)} 次
            </div>
          </CardContent>
        </Card>

        {summaries.map(({ type, meta, summary }) => (
          <Card key={type}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                {meta.label}
                <span className="text-xs font-normal text-onSurface-default-secondary">{meta.short}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{fmt(summary?.total_tokens)}</div>
              <div className="mt-1 text-xs text-onSurface-default-secondary">
                输入 {fmt(summary?.prompt_tokens)} · 输出 {fmt(summary?.completion_tokens)} · 调用 {fmt(summary?.calls)} 次
              </div>
              <div className="mt-2 text-xs text-onSurface-default-secondary">{meta.hint}</div>
              {summary?.model_name ? (
                <div className="mt-1 truncate text-xs text-onSurface-default-secondary" title={summary.model_name}>
                  模型：{summary.model_name}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      {error ? (
        <Card>
          <CardContent className="py-6 text-sm text-rose-600 dark:text-rose-400">{error}</CardContent>
        </Card>
      ) : null}

      {!isLoading && !hasData && !error ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-onSurface-default-secondary">
            这段时间还没有用量数据。
            <br />
            采集从这次更新后开始，之前的调用没有记录（补不回来）。去写一条记忆或搜一次，这里就会有数了。
          </CardContent>
        </Card>
      ) : null}

      {hasData ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">三个模型的消耗对比（token）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} width={64} />
                  <Tooltip
                    formatter={(value) => fmt(Number(value))}
                    labelFormatter={(label) => dimensionLabel(String(label), groupBy)}
                  />
                  <Legend formatter={(value) => modelLabel(String(value))} />
                  {MODEL_ORDER.map((type) => (
                    <Bar
                      key={type}
                      dataKey={type}
                      name={type}
                      fill={MODEL_META[type].color}
                      radius={[4, 4, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {hasData ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">明细</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-memBorder-primary text-left text-onSurface-default-secondary">
                  <th className="py-2 pr-3 font-medium">
                    {groupBy === "day" ? "日期" : groupBy === "month" ? "月份" : groupBy === "user" ? "用户" : "操作"}
                  </th>
                  <th className="py-2 pr-3 font-medium">模型</th>
                  <th className="py-2 pr-3 text-right font-medium">输入</th>
                  <th className="py-2 pr-3 text-right font-medium">输出</th>
                  <th className="py-2 pr-3 text-right font-medium">合计</th>
                  <th className="py-2 text-right font-medium">调用次数</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, index) => (
                  <tr
                    key={`${row.key}-${row.model_type}-${index}`}
                    className="border-b border-memBorder-primary/50 last:border-0"
                  >
                    <td className="py-2 pr-3">{dimensionLabel(row.key, groupBy)}</td>
                    <td className="py-2 pr-3">
                      <span
                        className="mr-1.5 inline-block size-2 rounded-full align-middle"
                        style={{ backgroundColor: MODEL_META[row.model_type]?.color ?? "#94a3b8" }}
                      />
                      {modelLabel(row.model_type)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmt(row.prompt_tokens)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmt(row.completion_tokens)}</td>
                    <td className="py-2 pr-3 text-right font-medium tabular-nums">{fmt(row.total_tokens)}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(row.calls)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      <p className="text-xs text-onSurface-default-secondary">
        说明：一次写入记忆通常会调多次模型（LLM 抽取 + 向量化），一次搜索通常调嵌入 + 重排，所以这里按「调用」逐次记录。
        数据来自记忆系统自身的模型调用，不含其他程序。
      </p>
    </div>
  );
}
