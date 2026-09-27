"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, FlaskConical, Lightbulb, Settings2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import { useCategoryCatalog } from "@/hooks/use-category-catalog";
import { api } from "@/utils/api";
import { CATEGORY_ENDPOINTS } from "@/utils/api-endpoints";
import { cn } from "@/lib/utils";
import type { CategoryTestResult } from "@/types/api";

const EXAMPLES = [
  "以后我的 Docker 服务都统一加入 nginx-net。",
  "我在做工程造价审计项目，负责某住宅楼的算量核对。",
  "汇报材料我喜欢正式、简洁的风格。",
];

/**
 * 分类测试 — dry-run the classifier against the live catalog without writing anything.
 * Shows the ranked candidates with confidence and, when the top two are close, flags the
 * sample as sitting on a category boundary.
 */
export default function CategoryTestPage() {
  const { catalog, isLoading } = useCategoryCatalog();
  const [text, setText] = useState("");
  const [result, setResult] = useState<CategoryTestResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  async function runTest() {
    const sample = text.trim();
    if (!sample) {
      toast({ title: "请先输入一段内容", variant: "destructive" });
      return;
    }
    setIsRunning(true);
    try {
      const response = await api.post(CATEGORY_ENDPOINTS.TEST, { text: sample });
      setResult(response.data as CategoryTestResult);
    } catch (error) {
      toast({
        title: "测试失败",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold font-fustat">分类测试</h1>
          <p className="text-sm text-onSurface-default-tertiary mt-1">
            输入一段用户对话，看看分类模型会归到哪个分类、为什么。测试不会写入任何记忆。
            {catalog && ` 当前目录 ${catalog.enabled_count} 个启用分类。`}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/categories/manage">
            <Settings2 className="size-3.5 mr-1" />
            分类管理
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-memBorder-primary">
          <CardContent className="space-y-3 p-4">
            <Label className="text-xs text-onSurface-default-tertiary">测试内容</Label>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={6}
              className="text-sm"
              placeholder="粘贴一段用户会说的话，例如：以后我的 Docker 服务都统一加入 nginx-net。"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void runTest()} disabled={isRunning || isLoading}>
                <FlaskConical className="size-3.5 mr-1" />
                {isRunning ? "分类中…" : "测试分类"}
              </Button>
              {EXAMPLES.map((example, index) => (
                <Button
                  key={example}
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-onSurface-default-tertiary"
                  onClick={() => setText(example)}
                >
                  示例 {index + 1}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-memBorder-primary">
          <CardContent className="space-y-4 p-4">
            <Label className="text-xs text-onSurface-default-tertiary">AI 判断</Label>

            {!result && !isRunning && (
              <p className="text-sm text-onSurface-default-tertiary">
                还没有结果 —— 输入内容后点「测试分类」。分类调用需要几秒。
              </p>
            )}

            {isRunning && (
              <p className="text-sm text-onSurface-default-tertiary">正在调用分类模型…</p>
            )}

            {result?.error && (
              <div className="rounded-md border border-memBorder-primary bg-surface-default-secondary p-3 text-sm text-onSurface-danger-primary">
                {result.error}
              </div>
            )}

            {result && !result.error && result.candidates.length === 0 && (
              <p className="text-sm text-onSurface-default-tertiary">
                模型认为这段内容不属于目录里的任何分类。可以到「分类管理」补一个分类，或确认这段内容
                是否真的值得长期记住。
              </p>
            )}

            {result && !result.error && result.candidates.length > 0 && (
              <div className="space-y-3">
                {result.candidates.map((candidate, index) => (
                  <div key={candidate.name} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "flex items-center gap-1.5 text-sm",
                          index === 0
                            ? "font-medium text-onSurface-default-primary"
                            : "text-onSurface-default-secondary",
                        )}
                      >
                        {index === 0 && <Sparkles className="size-3.5 text-onSurface-default-brand" />}
                        {candidate.name}
                      </span>
                      <span className="text-xs tabular-nums text-onSurface-default-tertiary">
                        {Math.round(candidate.confidence * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-default-tertiary">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          index === 0 ? "bg-surface-default-brand" : "bg-onSurface-default-tertiary/50",
                        )}
                        style={{ width: `${Math.round(candidate.confidence * 100)}%` }}
                      />
                    </div>
                    {candidate.reason && (
                      <p className="text-xs leading-relaxed text-onSurface-default-tertiary">
                        {candidate.reason}
                      </p>
                    )}
                  </div>
                ))}

                {result.conflict && (
                  <div className="space-y-2 rounded-md border border-onSurface-default-brand/40 bg-surface-default-brand/5 p-3">
                    <p className="flex items-center gap-1.5 text-sm">
                      <AlertTriangle className="size-3.5 text-onSurface-default-brand" />
                      检测到分类边界
                    </p>
                    <p className="text-xs leading-relaxed text-onSurface-default-secondary">
                      这条内容同时贴近「{result.candidates[0]?.name}」和「
                      {result.candidates[1]?.name}」，两者的判定规则在真实场景里容易互相越界。
                      建议到分类管理里给这两个分类补上边界说明（包含什么、不包含什么），再回来复测。
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {result.candidates.slice(0, 2).map((candidate) => (
                        <Button key={candidate.name} variant="outline" size="sm" asChild>
                          <Link
                            href={`/dashboard/categories/manage?edit=${encodeURIComponent(candidate.name)}`}
                          >
                            调整「{candidate.name}」
                          </Link>
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-onSurface-default-tertiary">
        <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
        测试用的模型与写入记忆时是同一个；结果只代表当前目录下的判断，目录改了结论也会变。
      </p>
    </div>
  );
}
