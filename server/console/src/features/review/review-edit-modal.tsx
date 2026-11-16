/**
 * 审核页的编辑弹窗：就地修正文、分类、到期日（临时/永久），修完可以顺手通过。
 *
 * 保存走 `PUT /memories/{id}`，只提交真正改动的字段：正文没变就不触发服务端重新分类，
 * 到期日没变就不改临时/永久归属。保存后记忆仍留在原队列，由审核人决定是否通过。
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { errorMessage } from "@/lib/utils";
import { Modal } from "@/ui/modal";
import { Button, Field, Input, Select, Textarea } from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import { memoryKeys, reviewMemory, updateMemory } from "@/features/memories/memory-api";
import { reviewStatusOf } from "@/features/memories/memory-utils";
import type { Memory } from "@/features/memories/types";
import { buildReviewPatch, reviewDraftFrom, type ReviewDraft } from "./review-utils";

export function ReviewEditModal({
  memory,
  catalogNames,
  open,
  onClose,
}: {
  memory: Memory | null;
  catalogNames: readonly string[];
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const [draft, setDraft] = useState<ReviewDraft>({ text: "", categories: [], expirationDate: "" });
  const [customCategory, setCustomCategory] = useState("");
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    if (!open || !memory) return;
    setDraft(reviewDraftFrom(memory));
    setCustomCategory("");
    setApproving(false);
  }, [open, memory]);

  const rejected = memory ? reviewStatusOf(memory) === "rejected" : false;
  const patch = memory ? buildReviewPatch(memory, draft) : null;
  const available = catalogNames.filter((name) => !draft.categories.includes(name));

  const addCategory = (name: string) => {
    const value = name.trim();
    if (!value || draft.categories.includes(value)) return;
    setDraft((current) => ({ ...current, categories: [...current.categories, value] }));
  };

  const removeCategory = (name: string) => {
    setDraft((current) => ({
      ...current,
      categories: current.categories.filter((item) => item !== name),
    }));
  };

  const mutation = useMutation({
    mutationFn: async ({ approve }: { approve: boolean }) => {
      if (!memory) return { patched: false, approve };
      if (!draft.text.trim()) throw new Error("记忆正文不能为空");
      const next = buildReviewPatch(memory, draft);
      if (next) await updateMemory(memory.id, next);
      if (approve) await reviewMemory(memory.id, "approve");
      return { patched: Boolean(next), approve };
    },
    onSuccess: async ({ patched, approve }) => {
      await queryClient.invalidateQueries({ queryKey: memoryKeys.root });
      const changed = patched ? "修改已保存" : "未修改内容";
      const verdict = approve ? (rejected ? "已恢复" : "已通过") : "仍在待审核";
      success(`${changed}，${verdict}`);
      onClose();
    },
    onError: (error) => toastError(errorMessage(error, "保存失败")),
  });

  const submit = (approve: boolean) => {
    if (!draft.text.trim()) {
      toastError("记忆正文不能为空");
      return;
    }
    setApproving(approve);
    mutation.mutate({ approve });
  };

  const textChanged = memory ? draft.text.trim() !== memory.memory : false;
  const categoriesTouched = patch !== null && "categories" in patch;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="编辑记忆"
      description={memory ? `ID ${memory.id}` : "正在加载记忆…"}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="secondary"
            loading={mutation.isPending && !approving}
            disabled={!patch}
            onClick={() => submit(false)}
          >
            保存
          </Button>
          <Button
            variant="primary"
            loading={mutation.isPending && approving}
            onClick={() => submit(true)}
          >
            {rejected ? "保存并恢复" : "保存并通过"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field
          label="正文"
          htmlFor="review-edit-text"
          hint="修改后服务端会重新嵌入向量；若同时改了分类，以提交的分类为准。"
        >
          <Textarea
            id="review-edit-text"
            rows={6}
            value={draft.text}
            onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))}
          />
        </Field>

        <div className="space-y-2">
          <p className="text-xs font-medium text-ink-soft">分类</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {draft.categories.length === 0 ? (
              <span className="text-[11px] text-ink-faint">尚未归类</span>
            ) : null}
            {draft.categories.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-full border border-transparent bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent"
              >
                {name}
                <button
                  type="button"
                  aria-label={`移除分类 ${name}`}
                  className="text-accent/70 hover:text-accent"
                  onClick={() => removeCategory(name)}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="添加已有分类"
              className="h-8 w-44 text-xs"
              value=""
              onChange={(event) => {
                const name = event.target.value;
                if (name) addCategory(name);
              }}
            >
              <option value="">添加已有分类…</option>
              {available.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
            <Input
              aria-label="自定义分类"
              className="h-8 w-36 text-xs"
              placeholder="自定义分类"
              value={customCategory}
              onChange={(event) => setCustomCategory(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCategory(customCategory);
                  setCustomCategory("");
                }
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={!customCategory.trim()}
              onClick={() => {
                addCategory(customCategory);
                setCustomCategory("");
              }}
            >
              <Plus className="size-3.5" />
              添加
            </Button>
          </div>
        </div>

        <Field
          label="到期日"
          htmlFor="review-edit-expiry"
          hint="留空 = 永久记忆；填日期 = 临时记忆（到期后默认列表与搜索不再展示）。"
          className="w-56"
        >
          <Input
            id="review-edit-expiry"
            type="date"
            value={draft.expirationDate}
            onChange={(event) =>
              setDraft((current) => ({ ...current, expirationDate: event.target.value }))
            }
          />
        </Field>

        {textChanged && !categoriesTouched ? (
          <p className="text-[11px] leading-5 text-ink-faint">
            正文已修改：保存后服务端会按当前分类目录重新打标；如果要保留现有分类，请顺手改一下分类再保存。
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
