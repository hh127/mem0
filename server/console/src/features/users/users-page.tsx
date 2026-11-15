import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, UserCog } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { errorMessage, formatDateTime } from "@/lib/utils";
import { Badge, Button } from "@/ui/primitives";
import { ConfirmDialog } from "@/ui/modal";
import { EmptyState, ErrorState, PageHeader } from "@/ui/feedback";
import { Spinner } from "@/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/ui/table";
import { useToast } from "@/ui/toast";
import { UserFormModal } from "./user-form-modal";
import type { UserFormSubmit } from "./user-form-modal";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  memory_scope: string | null;
  is_active: boolean;
  created_at: string;
  last_login_at?: string | null;
}

export function UsersPage() {
  const { success, error: toastError } = useToast();
  const { user: currentUser } = useSession();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<AdminUser[]>("/users"),
  });

  const rows = data ?? [];

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["users"] });
  };

  const createMutation = useMutation({
    mutationFn: (values: UserFormSubmit) =>
      api.post<AdminUser>("/users", {
        name: values.name,
        email: values.email,
        password: values.password,
        role: values.role,
        memory_scope: values.role === "user" ? values.memoryScope : null,
      }),
    onSuccess: async (created) => {
      setCreateOpen(false);
      setCreateError(null);
      success(`已创建用户「${created.name}」`);
      await invalidate();
    },
    onError: (err) => setCreateError(errorMessage(err, "创建用户失败")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: UserFormSubmit }) => {
      const body: Record<string, unknown> = {
        name: values.name,
        role: values.role,
        memory_scope: values.role === "user" ? values.memoryScope : null,
        is_active: values.isActive,
      };
      if (values.password) body.password = values.password;
      return api.patch<AdminUser>(`/users/${id}`, body);
    },
    onSuccess: async (updated) => {
      setEditing(null);
      setEditError(null);
      success(`已更新用户「${updated.name}」`);
      await invalidate();
    },
    onError: (err) => setEditError(errorMessage(err, "更新用户失败")),
  });

  const deleteMutation = useMutation({
    mutationFn: (target: AdminUser) =>
      api.delete<{ message: string }>(`/users/${target.id}`),
    onSuccess: async (_result, target) => {
      setDeleteTarget(null);
      success(`已删除用户「${target.name}」`);
      await invalidate();
    },
    onError: (err) => {
      setDeleteTarget(null);
      toastError(errorMessage(err, "删除用户失败"));
    },
  });

  const openCreate = () => {
    setCreateError(null);
    setCreateOpen(true);
  };

  const openEdit = (target: AdminUser) => {
    setEditError(null);
    setEditing(target);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="管理"
        title="用户管理"
        description="创建控制台账号，并绑定其可见的记忆作用域。最后一个管理员既不能停用也不能删除。"
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
              创建用户
            </Button>
          </>
        }
      />

      {isError ? (
        <ErrorState
          message={errorMessage(error, "无法读取用户列表")}
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-panel px-4 py-10 text-sm text-ink-soft">
          <Spinner className="size-4 text-accent" />
          正在加载用户…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={UserCog}
          title="还没有其他账号"
          description="创建普通用户并绑定记忆作用域，即可让他们访问各自的数据。"
          action={
            <Button variant="primary" onClick={openCreate}>
              <Plus className="size-4" />
              创建用户
            </Button>
          }
        />
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>姓名</Th>
              <Th>邮箱</Th>
              <Th>角色</Th>
              <Th>记忆作用域</Th>
              <Th>状态</Th>
              <Th className="whitespace-nowrap">创建时间</Th>
              <Th className="text-right">操作</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => {
              const isSelf = currentUser?.id === row.id;
              return (
                <Tr key={row.id}>
                  <Td className="whitespace-nowrap font-medium text-ink">
                    <span className="inline-flex items-center gap-1.5">
                      {row.name}
                      {isSelf ? <Badge tone="accent">当前账号</Badge> : null}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{row.email}</Td>
                  <Td>
                    <Badge tone={row.role === "admin" ? "ok" : "neutral"}>
                      {row.role === "admin" ? "管理员" : "普通用户"}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-xs">
                    {row.memory_scope ? (
                      <code className="font-mono text-ink">{row.memory_scope}</code>
                    ) : (
                      <span className="text-ink-faint">全部记忆</span>
                    )}
                  </Td>
                  <Td>
                    {row.is_active ? (
                      <Badge tone="ok">启用</Badge>
                    ) : (
                      <Badge tone="danger">已停用</Badge>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">
                    {formatDateTime(row.created_at)}
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(row)}
                      >
                        <Pencil className="size-3.5" />
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger hover:text-danger"
                        onClick={() => setDeleteTarget(row)}
                      >
                        <Trash2 className="size-3.5" />
                        删除
                      </Button>
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      )}

      <UserFormModal
        open={createOpen}
        mode="create"
        pending={createMutation.isPending}
        serverError={createError}
        onClose={() => setCreateOpen(false)}
        onSubmit={(values) => createMutation.mutate(values)}
      />

      <UserFormModal
        open={editing !== null}
        mode="edit"
        initial={editing}
        pending={updateMutation.isPending}
        serverError={editError}
        onClose={() => setEditing(null)}
        onSubmit={(values) => {
          if (editing) updateMutation.mutate({ id: editing.id, values });
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
        loading={deleteMutation.isPending}
        title="删除这个账号？"
        description={
          deleteTarget
            ? `将删除用户「${deleteTarget.name}」（${deleteTarget.email}）。该账号的 API 密钥与刷新令牌会一并失效，且无法恢复。`
            : ""
        }
        confirmLabel="删除账号"
      />
    </div>
  );
}
