import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FlaskConical, ListChecks, SlidersHorizontal, Tag } from "lucide-react";
import { errorMessage } from "@/lib/utils";
import { Badge, Card, buttonClass } from "@/ui/primitives";
import { EmptyState, ErrorState, PageHeader } from "@/ui/feedback";
import { Spinner } from "@/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/ui/table";
import { categoryQueryKeys, fetchCategoryCatalog } from "./api";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="mt-1 font-display text-2xl tabular-nums text-ink">{value}</p>
    </Card>
  );
}

export function CategoriesPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: categoryQueryKeys.catalog,
    queryFn: fetchCategoryCatalog,
  });

  const entries = data?.custom_categories ?? [];
  const total = data?.names.length ?? entries.length;
  const enabledCount = data?.enabled_count ?? 0;
  const disabledCount = data?.disabled.length ?? 0;
  const ruleCount = data?.custom_category_rules.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="分类"
        title="分类总览"
        description="查看当前生效的分类目录、启用状态与判定规则；分类会在记忆写入时自动打标。"
        actions={
          <>
            <Link to="/categories/manage" className={buttonClass("primary", "md")}>
              <SlidersHorizontal className="size-4" />
              分类管理
            </Link>
            <Link to="/categories/test" className={buttonClass("secondary", "md")}>
              <FlaskConical className="size-4" />
              分类测试
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="启用分类" value={String(enabledCount)} />
        <StatCard label="分类总数" value={String(total)} />
        <StatCard label="已停用" value={String(disabledCount)} />
        <StatCard label="判定规则" value={String(ruleCount)} />
      </div>

      {isError ? (
        <ErrorState
          message={errorMessage(error, "无法读取分类目录")}
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-panel px-4 py-10 text-sm text-ink-soft">
          <Spinner className="size-4 text-accent" />
          正在加载分类目录…
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="还没有配置任何分类"
          description="分类为空时，记忆不会被打上分类标签。可以先在分类管理里导入或新增分类。"
          action={
            <Link to="/categories/manage" className={buttonClass("primary", "md")}>
              去配置分类
            </Link>
          }
        />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-ink-faint">
              共 {total} 个分类，其中 {enabledCount} 个已启用
            </p>
            <button
              type="button"
              className={buttonClass("ghost", "sm")}
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              刷新
            </button>
          </div>
          <Table>
            <Thead>
              <Tr>
                <Th>分类</Th>
                <Th>描述</Th>
                <Th>状态</Th>
                <Th className="text-right">操作</Th>
              </Tr>
            </Thead>
            <Tbody>
              {entries.map((entry) => {
                const enabled = entry.enabled !== false;
                const dropRate = data?.disabled.includes(entry.name) ?? false;
                return (
                  <Tr key={entry.name}>
                    <Td className="whitespace-nowrap font-medium text-ink">
                      <span className="inline-flex items-center gap-1.5">
                        <Tag className="size-3.5 text-ink-faint" />
                        {entry.name}
                      </span>
                    </Td>
                    <Td className="max-w-[520px]">
                      <p
                        className="line-clamp-2 text-xs leading-5 text-ink-soft"
                        title={entry.description}
                      >
                        {entry.description || "—"}
                      </p>
                    </Td>
                    <Td>
                      {enabled && !dropRate ? (
                        <Badge tone="ok">已启用</Badge>
                      ) : (
                        <Badge tone="neutral">已停用</Badge>
                      )}
                    </Td>
                    <Td className="text-right">
                      <Link
                        to={`/memories?category=${encodeURIComponent(entry.name)}`}
                        className={buttonClass("ghost", "sm")}
                        title="在记忆库中按该分类筛选"
                      >
                        查看该分类记忆
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
          {ruleCount > 0 ? (
            <Card className="p-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink">
                <ListChecks className="size-3.5 text-ink-faint" />
                判定规则（{ruleCount} 条，按顺序生效）
              </p>
              <ol className="list-decimal space-y-1 pl-5 text-xs leading-5 text-ink-soft">
                {(data?.custom_category_rules ?? []).map((rule, index) => (
                  <li key={`${index}-${rule}`}>{rule}</li>
                ))}
              </ol>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
