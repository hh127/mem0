import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { errorMessage, formatDateTime } from "@/lib/utils";
import { Badge, Button, Select } from "@/ui/primitives";
import { EmptyState, ErrorState, PageHeader } from "@/ui/feedback";
import { Spinner } from "@/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/ui/table";

interface RequestLogRow {
  id: string;
  method: string;
  path: string;
  status_code: number;
  latency_ms: number;
  auth_type: string;
  created_at: string;
}

type BadgeTone = "neutral" | "accent" | "ok" | "warn" | "danger" | "outline";

const LIMIT_OPTIONS = [50, 100, 200];

const AUTH_TYPE_LABELS: Record<string, string> = {
  api_key: "API 密钥",
  admin_api_key: "管理员密钥",
  jwt: "会话令牌",
  none: "未认证",
};

function methodTone(method: string): BadgeTone {
  switch (method.toUpperCase()) {
    case "GET":
      return "neutral";
    case "POST":
      return "accent";
    case "PUT":
    case "PATCH":
      return "warn";
    case "DELETE":
      return "danger";
    default:
      return "outline";
  }
}

function statusTone(status: number): BadgeTone {
  if (status >= 500) return "danger";
  if (status >= 400) return "warn";
  if (status >= 300) return "neutral";
  if (status >= 200) return "ok";
  return "outline";
}

function formatLatency(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)} ms`;
}

export function RequestsPage() {
  const [limit, setLimit] = useState(50);
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["requests", limit],
    queryFn: () => api.get<RequestLogRow[]>("/requests", { limit }),
  });

  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="管理"
        title="请求日志"
        description="按时间倒序展示 API 调用审计记录，包含方法、路径、状态码、耗时与认证方式。"
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          <span>显示最近</span>
          <Select
            aria-label="每页条数"
            className="h-8 w-24 text-xs"
            value={String(limit)}
            onChange={(event) => setLimit(Number(event.target.value))}
          >
            {LIMIT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option} 条
              </option>
            ))}
          </Select>
          <span>记录</span>
        </div>
        {!isLoading && !isError ? (
          <p className="text-xs text-ink-faint">当前显示 {rows.length} 条</p>
        ) : null}
      </div>

      {isError ? (
        <ErrorState
          message={errorMessage(error, "无法读取请求日志")}
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-panel px-4 py-10 text-sm text-ink-soft">
          <Spinner className="size-4 text-accent" />
          正在加载请求日志…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="暂无请求记录"
          description="服务端只记录带 API 密钥的调用；产生新的调用后这里会出现记录。"
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              重新加载
            </Button>
          }
        />
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th className="whitespace-nowrap">时间</Th>
              <Th>方法</Th>
              <Th>路径</Th>
              <Th>状态码</Th>
              <Th className="whitespace-nowrap">耗时</Th>
              <Th>认证方式</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Tr key={row.id}>
                <Td className="whitespace-nowrap text-xs">
                  {formatDateTime(row.created_at)}
                </Td>
                <Td>
                  <Badge tone={methodTone(row.method)}>{row.method}</Badge>
                </Td>
                <Td>
                  <code className="break-all font-mono text-xs text-ink">{row.path}</code>
                </Td>
                <Td>
                  <Badge tone={statusTone(row.status_code)}>{row.status_code}</Badge>
                </Td>
                <Td className="whitespace-nowrap text-xs tabular-nums">
                  {formatLatency(row.latency_ms)}
                </Td>
                <Td className="whitespace-nowrap text-xs">
                  {AUTH_TYPE_LABELS[row.auth_type] ?? row.auth_type}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </div>
  );
}
