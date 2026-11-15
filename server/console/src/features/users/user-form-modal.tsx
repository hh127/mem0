import { useEffect, useState } from "react";
import { Button, Checkbox, Field, Input, Select } from "@/ui/primitives";
import { Modal } from "@/ui/modal";

export type UserRole = "admin" | "user";

export interface UserFormSubmit {
  name: string;
  email: string;
  /** 新建时必填；编辑时留空表示不重置密码。 */
  password: string;
  role: UserRole;
  memoryScope: string;
  isActive: boolean;
}

export interface EditableUser {
  id: string;
  name: string;
  email: string;
  role: string;
  memory_scope: string | null;
  is_active?: boolean;
}

interface UserFormModalProps {
  open: boolean;
  mode: "create" | "edit";
  initial?: EditableUser | null;
  pending: boolean;
  serverError: string | null;
  onClose: () => void;
  onSubmit: (values: UserFormSubmit) => void;
}

const FORM_ID = "user-form";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function UserFormModal({
  open,
  mode,
  initial,
  pending,
  serverError,
  onClose,
  onSubmit,
}: UserFormModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("user");
  const [scope, setScope] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setPassword("");
    if (mode === "edit" && initial) {
      setName(initial.name ?? "");
      setEmail(initial.email ?? "");
      setRole(initial.role === "admin" ? "admin" : "user");
      setScope(initial.memory_scope ?? "");
      setIsActive(initial.is_active !== false);
    } else {
      setName("");
      setEmail("");
      setRole("user");
      setScope("");
      setIsActive(true);
    }
  }, [open, mode, initial]);

  const validate = (): Record<string, string> => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "请输入姓名";

    if (mode === "create") {
      if (!email.trim()) next.email = "请输入邮箱";
      else if (!EMAIL_PATTERN.test(email.trim())) next.email = "邮箱格式不正确";
      if (!password) next.password = "请输入密码";
      else if (password.length < 8) next.password = "密码至少 8 位";
    } else if (password && password.length < 8) {
      next.password = "密码至少 8 位（留空表示不重置）";
    }

    if (role === "user" && !scope.trim()) {
      next.scope = "普通用户必须绑定记忆作用域";
    }
    return next;
  };

  const handleSubmit = () => {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onSubmit({
      name: name.trim(),
      email: email.trim(),
      password,
      role,
      memoryScope: scope.trim(),
      isActive,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "create" ? "创建用户" : "编辑用户"}
      description={
        mode === "create"
          ? "普通用户只能看到其记忆作用域内的数据，管理员可见全部。"
          : "可调整角色、记忆作用域与启用状态；密码留空表示不重置。"
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={pending}>
            {mode === "create" ? "创建用户" : "保存修改"}
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <Field label="姓名" htmlFor="user-name" error={errors.name}>
          <Input
            id="user-name"
            value={name}
            placeholder="例如：小何"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field
          label="邮箱"
          htmlFor="user-email"
          error={errors.email}
          hint={mode === "edit" ? "邮箱暂不支持在此修改" : "用于登录控制台"}
        >
          <Input
            id="user-email"
            type="email"
            autoComplete="off"
            value={email}
            placeholder="name@example.com"
            disabled={mode === "edit"}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <Field
          label={mode === "create" ? "密码" : "重置密码（可选）"}
          htmlFor="user-password"
          error={errors.password}
          hint={mode === "create" ? "至少 8 位" : "留空表示不修改现有密码"}
        >
          <Input
            id="user-password"
            type="password"
            autoComplete="new-password"
            value={password}
            placeholder={mode === "create" ? "至少 8 位" : "留空表示不重置"}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="角色" htmlFor="user-role">
            <Select
              id="user-role"
              value={role}
              onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "user")}
            >
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </Select>
          </Field>

          <Field
            label="记忆作用域"
            htmlFor="user-scope"
            error={errors.scope}
            hint={
              role === "user"
                ? "必填：该账号只能看到此 user_id 下的记忆"
                : "管理员可见全部记忆，可留空"
            }
          >
            <Input
              id="user-scope"
              value={scope}
              placeholder={role === "user" ? "例如 hermes-user-2" : "留空表示全部记忆"}
              onChange={(event) => setScope(event.target.value)}
            />
          </Field>
        </div>

        {mode === "edit" ? (
          <label className="flex items-center gap-2 text-sm text-ink">
            <Checkbox
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            <span>启用该账号（停用后无法登录）</span>
          </label>
        ) : null}

        {serverError ? (
          <p
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger-soft/60 px-3 py-2 text-sm text-danger"
          >
            {serverError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
