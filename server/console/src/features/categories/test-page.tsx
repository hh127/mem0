import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  FlaskConical,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { errorMessage } from "@/lib/utils";
import { Badge, Button, Card, Textarea, buttonClass } from "@/ui/primitives";
import { EmptyState, ErrorState, PageHeader } from "@/ui/feedback";
import { Spinner } from "@/ui/spinner";
import { testCategoryText } from "./api";
import type { CategoryCandidate } from "./api";

const SAMPLE_TEXTS = [
  "用户平时喜欢用 Python 写自动化脚本，周末会去徒步。",
  "我们下周要把项目结算材料补齐，周五之前提交。",
  "以后回答问题时先给结论，再给解释，代码要可运行。",
  "用户在杭州从事工程造价工作，已经做了八年。",
];

function confidencePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function CandidateRow({
  candidate,
  rank,
}: {
  candidate: CategoryCandidate;
  rank: number;
}) {
  const percent = confidencePercent(candidate.confidence);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm text-ink">
          <span className="w-5 text-right text-xs tabular-nums text-ink-faint">
            {rank}
          </span>
          <span className="font-medium">{candidate.name}</span>
          {rank === 1 ? <Badge tone="accent">首选分类</Badge> : null}
        </p>
        <span className="text-xs tabular-nums text-ink-soft">{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel-2">
        <div
          className={rank === 1 ? "h-full rounded-full bg-accent" : "h-full rounded-full bg-ink-faint"}
          style={{ width: `${percent}%` }}
        />
      </div>
      {candidate.reason ? (
        <p className="pl-7 text-xs leading-5 text-ink-faint">{candidate.reason}</p>
      ) : null}
    </div>
  );
}

export function CategoryTestPage() {
  const [text, setText] = useState("");
  const mutation = useMutation({ mutationFn: testCategoryText });
  const result = mutation.data;

  const ranked = useMemo(
    () => [...(result?.candidates ?? [])].sort((a, b) => b.confidence - a.confidence),
    [result],
  );

  const handleTest = () => {
    const value = text.trim();
    if (!value) return;
    mutation.mutate(value);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="分类"
        title="分类测试"
        description="用一段样例文本试运行分类器：不会写入任何记忆或配置，只返回候选分类与置信度。"
        actions={
          <>
            <Link to="/categories" className={buttonClass("secondary", "md")}>
              返回总览
            </Link>
            <Link to="/categories/manage" className={buttonClass("primary", "md")}>
              <SlidersHorizontal className="size-4" />
              去调整分类
            </Link>
          </>
        }
      />

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-ink">样例文本</p>
            <p className="text-xs text-ink-faint">
              输入一条准备写入记忆的内容，下面的结果就是服务端的归类判断。
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setText("")} disabled={!text}>
            <RotateCcw className="size-3.5" />
            清空
          </Button>
        </div>
        <Textarea
          value={text}
          className="min-h-32 text-sm leading-6"
          placeholder="例如：用户偏好深色界面，阅读文档时喜欢先看示例。"
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-xs text-ink-faint">
              <Sparkles className="size-3.5" />
              试试：
            </span>
            {SAMPLE_TEXTS.map((sample) => (
              <button
                key={sample}
                type="button"
                className={buttonClass("secondary", "sm")}
                onClick={() => {
                  setText(sample);
                  mutation.reset();
                }}
              >
                {sample.slice(0, 12)}…
              </button>
            ))}
          </div>
          <Button
            variant="primary"
            onClick={handleTest}
            loading={mutation.isPending}
            disabled={!text.trim()}
          >
            <FlaskConical className="size-4" />
            运行分类测试
          </Button>
        </div>
      </Card>

      {mutation.isError ? (
        <ErrorState
          title="分类测试失败"
          message={errorMessage(mutation.error, "服务端没有返回结果")}
        />
      ) : null}

      {mutation.isPending ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-panel px-4 py-10 text-sm text-ink-soft">
          <Spinner className="size-4 text-accent" />
          正在请求分类器…
        </div>
      ) : null}

      {!mutation.isPending && !result && !mutation.isError ? (
        <EmptyState
          icon={FlaskConical}
          title="还没有测试结果"
          description="输入样例文本并运行测试后，这里会显示排序后的候选分类、置信度与判定理由。"
        />
      ) : null}

      {result ? (
        <div className="space-y-3">
          {result.error ? (
            <div
              role="alert"
              className="rounded-[var(--radius-card)] border border-danger/30 bg-danger-soft/40 p-4 text-sm text-ink-soft"
            >
              <p className="font-medium text-danger">分类器返回了错误</p>
              <p className="mt-1 text-xs leading-5">{result.error}</p>
            </div>
          ) : null}

          {result.conflict ? (
            <div className="flex items-start gap-2 rounded-[var(--radius-card)] border border-warn/30 bg-warn-soft p-4 text-sm text-ink-soft">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
              <div className="space-y-1">
                <p className="font-medium text-ink">结果落在分类边界</p>
                <p className="text-xs leading-5">
                  候选分类的置信度比较接近，这条文本可能同时符合多个分类。建议在「分类管理」里补充判定规则，让边界更清晰。
                </p>
              </div>
            </div>
          ) : null}

          <Card className="space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-ink">判定结果</p>
                {result.top ? (
                  <Badge tone="accent">首选：{result.top}</Badge>
                ) : (
                  <Badge tone="neutral">没有明确归属</Badge>
                )}
                <Badge tone="outline">启用分类 {result.catalog_size} 个</Badge>
              </div>
              <p className="text-xs text-ink-faint">候选按置信度从高到低排序</p>
            </div>

            {ranked.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-faint">
                没有返回候选分类。
              </p>
            ) : (
              <div className="space-y-4">
                {ranked.map((candidate, index) => (
                  <CandidateRow
                    key={`${candidate.name}-${index}`}
                    candidate={candidate}
                    rank={index + 1}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
