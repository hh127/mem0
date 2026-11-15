import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { errorMessage, formatDateTime } from "@/lib/utils";
import { Button, Field, Input, InlineCode } from "@/ui/primitives";
import { ConfirmDialog, Modal } from "@/ui/modal";
import { EmptyState, ErrorState, PageHeader } from "@/ui/feedback";
import { Spinner } from "@/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/ui/table";
import { useToast } from "@/ui/toast";

interface ApiKeyRow {
  id: string;
  label: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

interface CreatedKey {
  id: string;
  key: string;
  label: string;
  key_prefix: string;
  created_at: string;
}

export function ApiKeysPage() {
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => api.get<ApiKeyRow[]>("/api-keys"),
  });

  const rows = data ?? [];

  const createMutation = useMutation({
    mutationFn: (nextLabel: string) =>
      api.post<CreatedKey>("/api-keys", { label: nextLabel }),
    onSuccess: async (key) => {
      setCreated(key);
      setCreateOpen(false);
      setLabel("");
      setFormError(null);
      success("API 密钥已创建");
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (err) => setFormError(errorMessage(err, "创建密钥失败")),
  });

  const revokeMutation = useMutation({
    mutationFn: (key: ApiKeyRow) => api.delete<{ message: string }>(`/api-keys/${key.id}`),
    onSuccess: async (_result, key) => {
      setRevokeTarget(null);
      success(`已吊销密钥「${key.label}」`);
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (err) => {
      setRevokeTarget(null);
      toastError(errorMessage(err, "吊销密钥失败"));
    },
  });

  const openCreate = () => {
    setLabel("");
    setFormError(null);
    setCreateOpen(true);
  };

  const handleCreate = () => {
    const value = label.trim();
    if (!value) {
      setFormError("请填写密钥标签");
      return;
    }
    createMutation.mutate(value);
  };

  const copyCreatedKey = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      success("已复制到剪贴板");
    } catch {
      toastError("复制失败，请手动选中密钥复制");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="管理"
        title="API 密钥"
        description="签发与吊销程序化访问所用的密钥。完整密钥只在创建时显示一次，之后只保留前缀。"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => void refetch()}
              loading={isFetching && !isLoading}
            >
              刷新
            </Button>
            <Button variant="primary" onClick={openCreate}>
              <Plus className="size-4" />
              创建密钥
            </Button>
          </>
        }
      />

      {isError ? (
        <ErrorState
          message={errorMessage(error, "无法读取 API 密钥")}
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-panel px-4 py-10 text-sm text-ink-soft">
          <Spinner className="size-4 text-accent" />
          正在加载 API 密钥…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="还没有 API 密钥"
          description="创建密钥后即可在程序中使用 X-API-Key 访问 Mem0 API。"
          action={
            <Button variant="primary" onClick={openCreate}>
              <Plus className="size-4" />
              创建密钥
            </Button>
          }
        />
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>标签</Th>
              <Th>密钥前缀</Th>
              <Th className="whitespace-nowrap">创建时间</Th>
              <Th className="whitespace-nowrap">最近使用</Th>
              <Th className="text-right">操作</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Tr key={row.id}>
                <Td className="whitespace-nowrap font-medium text-ink">{row.label}</Td>
                <Td>
                  <InlineCode>{row.key_prefix}…</InlineCode>
                </Td>
                <Td className="whitespace-nowrap text-xs">
                  {formatDateTime(row.created_at)}
                </Td>
                <Td className="whitespace-nowrap text-xs">
                  {row.last_used_at ? formatDateTime(row.last_used_at) : "从未使用"}
                </Td>
                <Td className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:text-danger"
                    onClick={() => setRevokeTarget(row)}
                  >
                    <Trash2 className="size-3.5" />
                    吊销
                  </Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="创建 API 密钥"
        description="密钥创建后只显示一次，请立刻复制保存。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={handleCreate} loading={createMutation.isPending}>
              创建密钥
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field
            label="标签"
            htmlFor="api-key-label"
            hint="用于区分用途，例如 openclaw-nas；可随时吊销后重建。"
          >
            <Input
              id="api-key-label"
              value={label}
              placeholder="例如：openclaw-nas"
              autoComplete="off"
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
          {formError ? (
            <p
              role="alert"
              className="rounded-lg border border-danger/30 bg-danger-soft/60 px-3 py-2 text-sm text-danger"
            >
              {formError}
            </p>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={created !== null}
        onClose={() => setCreated(null)}
        title="密钥已创建"
        description="这是唯一一次显示完整密钥的机会，关闭后无法再次查看。"
        footer={
          <Button variant="primary" onClick={() => setCreated(null)}>
            我已保存
          </Button>
        }
      >
        {created ? (
          <div className="space-y-4">
            <div className="rounded-[var(--radius-card)] border border-accent/40 bg-accent-soft p-4">
              <div className="flex items-center gap-2 text-accent">
                <KeyRound className="size-4" />
                <p className="text-sm font-medium">{created.label}</p>
              </div>
              <code className="mt-3 block break-all rounded-lg border border-line bg-panel px-3 py-2 font-mono text-sm text-ink">
                {created.key}
              </code>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => void copyCreatedKey()}>
                <Copy className="size-3.5" />
                复制密钥
              </Button>
            </div>
            <p className="text-xs leading-5 text-ink-soft">
              请把它保存到密码管理器或部署环境变量中。如果丢失，只能吊销后重新创建。
            </p>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => {
          if (revokeTarget) revokeMutation.mutate(revokeTarget);
        }}
        loading={revokeMutation.isPending}
        title="吊销这个 API 密钥？"
        description={
          revokeTarget
            ? `使用「${revokeTarget.label}」（前缀 ${revokeTarget.key_prefix}…）的程序将立即失去访问权限，且不可恢复。`
            : ""
        }
        confirmLabel="吊销密钥"
      />
    </div>
  );
}
