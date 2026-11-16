/**
 * 新建记忆：把一段对话内容提交给 `POST /memories`，服务端负责抽取与自动分类。
 */
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/lib/utils";
import { Modal } from "@/ui/modal";
import { Button, Field, Input, Textarea } from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import { createMemory, memoryKeys } from "./memory-api";
import { readLastUserId, saveLastUserId } from "./memory-utils";

export function CreateMemoryModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const { user, isAdmin } = useSession();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const [content, setContent] = useState("");
  const [userId, setUserId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [runId, setRunId] = useState("");
  const [expiry, setExpiry] = useState("");
  const [errors, setErrors] = useState<{ content?: string; userId?: string }>({});

  useEffect(() => {
    if (!open) return;
    setContent("");
    setAgentId("");
    setRunId("");
    setExpiry("");
    setErrors({});
    const last = readLastUserId();
    setUserId(last || (!isAdmin ? user?.memory_scope ?? "" : ""));
  }, [open, isAdmin, user?.memory_scope]);

  const mutation = useMutation({
    mutationFn: createMemory,
    onSuccess: async (payload) => {
      saveLastUserId(userId.trim());
      await queryClient.invalidateQueries({ queryKey: memoryKeys.root });
      const created = payload.results?.[0]?.id;
      success(created ? "记忆已创建，服务端已完成自动分类" : "记忆已创建");
      onCreated?.();
      onClose();
    },
    onError: (error) => toastError(errorMessage(error, "创建记忆失败")),
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = content.trim();
    const nextErrors: { content?: string; userId?: string } = {};
    if (!trimmed) nextErrors.content = "请输入记忆内容";
    if (!userId.trim()) nextErrors.userId = "user_id 不能为空";
    setErrors(nextErrors);
    if (nextErrors.content || nextErrors.userId) return;

    mutation.mutate({
      messages: [{ role: "user", content: trimmed }],
      user_id: userId.trim(),
      agent_id: agentId.trim() || undefined,
      run_id: runId.trim() || undefined,
      expiration_date: expiry || undefined,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建记忆"
      description="提交一段对话内容，服务端会抽取记忆并按分类目录自动打标；新记忆会进入待审核队列，管理员通过后才会归档到记忆库。"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            取消
          </Button>
          <Button type="submit" form="create-memory-form" variant="primary" loading={mutation.isPending}>
            创建
          </Button>
        </>
      }
    >
      <form id="create-memory-form" className="space-y-4" onSubmit={handleSubmit}>
        <Field
          label="记忆内容"
          htmlFor="create-memory-content"
          error={errors.content}
          hint="必填；支持多行，角色固定为 user。"
        >
          <Textarea
            id="create-memory-content"
            rows={5}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="例如：用户喜欢在周末徒步，偏好开源软件而不是商业 SaaS。"
          />
        </Field>

        <Field
          label="user_id"
          htmlFor="create-memory-user"
          error={errors.userId}
          hint="必填；默认沿用最近一次使用的值。"
        >
          <Input
            id="create-memory-user"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="hermes-user-1"
            autoComplete="off"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="agent_id" htmlFor="create-memory-agent" hint="可选">
            <Input
              id="create-memory-agent"
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              placeholder="openclaw-main"
              autoComplete="off"
            />
          </Field>
          <Field label="run_id" htmlFor="create-memory-run" hint="可选">
            <Input
              id="create-memory-run"
              value={runId}
              onChange={(event) => setRunId(event.target.value)}
              placeholder="run-2026-11-a"
              autoComplete="off"
            />
          </Field>
        </div>

        <Field label="到期日" htmlFor="create-memory-expiry" hint="可选；留空则使用服务端默认到期策略。">
          <Input
            id="create-memory-expiry"
            type="date"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
