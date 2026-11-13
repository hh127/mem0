"use client";

import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/shared/data-table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { EmptyState } from "@/components/self-hosted/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/utils/api";
import { REQUEST_ENDPOINTS } from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import { ApiRequestLog } from "@/types/api";

type RequestLog = {
  id: string;
  createdAt: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  authType: string;
};

const REQUEST_LOG_LIMIT = 200;
const DEFAULT_PAGE_SIZE = 20;
// 每页条数可选值：默认 20，允许用户切换（底部选择器）
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

const getStatusClassName = (statusCode: number) => {
  if (statusCode >= 500) {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300";
  }

  if (statusCode >= 400) {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300";
};

const getMethodClassName = (method: string) => {
  switch (method.toUpperCase()) {
    case "POST":
      return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/40 dark:text-sky-300";
    case "PUT":
    case "PATCH":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300";
    case "DELETE":
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300";
    default:
      return "border-memBorder-primary bg-surface-default-secondary text-onSurface-default-secondary";
  }
};

const getAuthLabel = (authType: string) => {
  switch (authType.toLowerCase()) {
    case "bearer":
      return "JWT";
    case "api_key":
      return "API 密钥";
    case "admin_api_key":
      return "管理员密钥";
    case "disabled":
      return "Disabled";
    default:
      return "--";
  }
};

const normalizeLog = (entry: ApiRequestLog): RequestLog => {
  return {
    id: entry.id,
    createdAt: entry.created_at,
    method: entry.method,
    path: entry.path,
    statusCode: entry.status_code,
    latencyMs: entry.latency_ms,
    authType: entry.auth_type,
  };
};

export default function RequestsPage() {
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  // 每页条数（可在底部分页栏切换）；切换时回到第一页
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const {
    data: logs = [],
    isLoading,
    error,
    refetch,
  } = useApiQuery<RequestLog[]>(
    async () => {
      const res = await api.get<ApiRequestLog[]>(REQUEST_ENDPOINTS.BASE, {
        params: { limit: REQUEST_LOG_LIMIT },
      });
      setLastUpdated(new Date().toISOString());
      return (res.data ?? []).map(normalizeLog);
    },
    { errorToast: "请求日志加载失败", initialData: [] },
  );

  const totalRequests = logs.length;
  const successfulRequests = logs.filter((log) => log.statusCode < 400).length;
  const successRate =
    totalRequests > 0
      ? Math.round((successfulRequests / totalRequests) * 100)
      : 0;
  const averageLatency =
    totalRequests > 0
      ? Math.round(
          logs.reduce((sum, log) => sum + log.latencyMs, 0) / totalRequests,
        )
      : 0;

  // 分页：每页条数可调；拉取条数变化导致页码越界时钳回最后一页
  const totalPages = Math.max(1, Math.ceil(logs.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const pageStart = currentPage * pageSize;
  const pageEnd = pageStart + pageSize;

  const columns = [
    {
      key: "createdAt" as keyof RequestLog,
      label: "时间",
      width: 140,
      render: (value: string) => (
        <span title={format(new Date(value), "PPpp")}>
          {formatDistanceToNow(new Date(value), { addSuffix: true })}
        </span>
      ),
    },
    {
      key: "method" as keyof RequestLog,
      label: "方法",
      width: 96,
      render: (value: string) => (
        <Badge variant="outline" className={getMethodClassName(value)}>
          {value.toUpperCase()}
        </Badge>
      ),
    },
    {
      key: "path" as keyof RequestLog,
      label: "路径",
      width: 360,
      render: (value: string) => (
        <span className="font-mono text-xs break-all text-onSurface-default-primary">
          {value}
        </span>
      ),
    },
    {
      key: "statusCode" as keyof RequestLog,
      label: "状态",
      width: 120,
      render: (value: number) => (
        <Badge variant="outline" className={getStatusClassName(value)}>
          {value}
        </Badge>
      ),
    },
    {
      key: "latencyMs" as keyof RequestLog,
      label: "延迟",
      width: 100,
      render: (value: number) => <span>{value} ms</span>,
    },
    {
      key: "authType" as keyof RequestLog,
      label: "认证",
      width: 120,
      render: (value: string) => getAuthLabel(value),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold font-fustat">请求日志</h1>
          <p className="text-sm text-onSurface-default-secondary">
            来自你自托管实例的最近请求日志。
          </p>
          {lastUpdated && (
            <p className="text-xs text-onSurface-default-tertiary">
              Last updated{" "}
              {formatDistanceToNow(new Date(lastUpdated), { addSuffix: true })}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setPage(0);
            void refetch();
          }}
          disabled={isLoading}
        >
          <RefreshCw className="size-4 mr-2" />
          刷新
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          { label: "请求总数", value: totalRequests },
          {
            label: "成功率",
            value: totalRequests > 0 ? `${successRate}%` : "--",
          },
          {
            label: "平均延迟",
            value: totalRequests > 0 ? `${averageLatency} ms` : "--",
          },
        ].map((card) => (
          <Card key={card.label} className="border-memBorder-primary">
            <CardContent className="p-5">
              <p className="text-xs text-onSurface-default-tertiary">
                {card.label}
              </p>
              <p className="mt-1 text-2xl font-semibold">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {error && (
        <Card className="border-memBorder-primary">
          <CardContent className="p-4 text-sm text-onSurface-danger-primary">
            {error}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <TableSkeleton rows={6} columns={6} />
      ) : logs.length === 0 ? (
        <EmptyState
          title="暂无请求日志"
          description="实例收到请求后，日志会显示在这里。"
          image="requests"
        />
      ) : (
        <>
          <Card className="border-memBorder-primary overflow-hidden">
            <DataTable
              data={logs.slice(pageStart, pageEnd)}
              columns={columns}
              getRowKey={(row) => row.id}
            />
          </Card>
          {logs.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-onSurface-default-tertiary">
              <span>
                {currentPage * pageSize + 1}–
                {Math.min((currentPage + 1) * pageSize, logs.length)} / 共{" "}
                {logs.length} 条
              </span>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs">每页</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(value) => {
                      setPageSize(Number(value));
                      setPage(0);
                    }}
                  >
                    <SelectTrigger
                      className="h-8 w-24"
                      aria-label="每页显示条数"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} 条
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage >= totalPages - 1}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
