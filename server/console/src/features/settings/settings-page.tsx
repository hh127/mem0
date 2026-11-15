import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, KeyRound, Moon, Palette, Sun, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { errorMessage, formatDateTime } from "@/lib/utils";
import { Badge, Button, Card, Field, Input } from "@/ui/primitives";
import { PageHeader } from "@/ui/feedback";
import { useToast } from "@/ui/toast";
import type { AuthUser } from "@/lib/types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line/60 py-2 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-xs text-ink-faint">{label}</span>
      <span className="min-w-0 break-all text-right text-sm text-ink">{value}</span>
    </div>
  );
}

export function SettingsPage() {
  const { user, refreshUser } = useSession();
  const { theme, setTheme } = useTheme();
  const { success, toast } = useToast();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setName(user.name ?? "");
    setEmail(user.email ?? "");
  }, [user]);

  const profileMutation = useMutation({
    mutationFn: (body: { name?: string; email?: string }) =>
      api.patch<AuthUser>("/auth/me", body),
    onSuccess: async () => {
      setProfileError(null);
      await refreshUser();
      success("资料已更新");
    },
    onError: (err) => setProfileError(errorMessage(err, "更新资料失败")),
  });

  const handleProfileSave = () => {
    setProfileError(null);
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      setProfileError("姓名不能为空");
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setProfileError("邮箱格式不正确");
      return;
    }
    const body: { name?: string; email?: string } = {};
    if (trimmedName !== (user?.name ?? "")) body.name = trimmedName;
    if (trimmedEmail !== (user?.email ?? "")) body.email = trimmedEmail;
    if (Object.keys(body).length === 0) {
      toast("资料没有变化", "info");
      return;
    }
    profileMutation.mutate(body);
  };

  const passwordMutation = useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) =>
      api.post<{ message: string }>("/auth/change-password", body),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordError(null);
      success("密码已更新");
    },
    onError: (err) => setPasswordError(errorMessage(err, "修改密码失败")),
  });

  const handlePasswordSave = () => {
    setPasswordError(null);
    if (!currentPassword) {
      setPasswordError("请输入当前密码");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("新密码至少 8 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的新密码不一致");
      return;
    }
    passwordMutation.mutate({
      current_password: currentPassword,
      new_password: newPassword,
    });
  };

  if (!user) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="账户" title="设置" description="账号资料、密码与界面偏好。" />
        <p className="text-sm text-ink-soft">正在加载账号信息…</p>
      </div>
    );
  }

  const isAdmin = user.role === "admin";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="账户"
        title="设置"
        description="管理你的个人资料、登录密码与界面偏好。"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <UserRound className="size-4 text-ink-faint" />
            <div>
              <p className="text-sm font-medium text-ink">个人资料</p>
              <p className="text-xs text-ink-faint">用于控制台展示与登录</p>
            </div>
          </div>

          <Field label="姓名" htmlFor="settings-name">
            <Input
              id="settings-name"
              value={name}
              placeholder="你的姓名"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label="邮箱"
            htmlFor="settings-email"
            hint="修改后请使用新邮箱登录"
          >
            <Input
              id="settings-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          {profileError ? (
            <p
              role="alert"
              className="rounded-lg border border-danger/30 bg-danger-soft/60 px-3 py-2 text-sm text-danger"
            >
              {profileError}
            </p>
          ) : null}

          <Button
            variant="primary"
            onClick={handleProfileSave}
            loading={profileMutation.isPending}
          >
            保存资料
          </Button>
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <KeyRound className="size-4 text-ink-faint" />
            <div>
              <p className="text-sm font-medium text-ink">修改密码</p>
              <p className="text-xs text-ink-faint">新密码至少 8 位</p>
            </div>
          </div>

          <Field label="当前密码" htmlFor="settings-current-password">
            <Input
              id="settings-current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              placeholder="请输入当前密码"
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="新密码" htmlFor="settings-new-password" hint="至少 8 位">
              <Input
                id="settings-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                placeholder="至少 8 位"
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </Field>
            <Field label="确认新密码" htmlFor="settings-confirm-password">
              <Input
                id="settings-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                placeholder="再次输入新密码"
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </Field>
          </div>

          {passwordError ? (
            <p
              role="alert"
              className="rounded-lg border border-danger/30 bg-danger-soft/60 px-3 py-2 text-sm text-danger"
            >
              {passwordError}
            </p>
          ) : null}

          <Button
            variant="primary"
            onClick={handlePasswordSave}
            loading={passwordMutation.isPending}
          >
            更新密码
          </Button>
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <Palette className="size-4 text-ink-faint" />
            <div>
              <p className="text-sm font-medium text-ink">外观</p>
              <p className="text-xs text-ink-faint">偏好保存在本机浏览器</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={theme === "light" ? "primary" : "secondary"}
              onClick={() => setTheme("light")}
            >
              <Sun className="size-4" />
              浅色
              {theme === "light" ? <Check className="size-3.5" /> : null}
            </Button>
            <Button
              variant={theme === "dark" ? "primary" : "secondary"}
              onClick={() => setTheme("dark")}
            >
              <Moon className="size-4" />
              深色
              {theme === "dark" ? <Check className="size-3.5" /> : null}
            </Button>
            <Badge tone="neutral">
              当前：{theme === "dark" ? "深色" : "浅色"}
            </Badge>
          </div>
        </Card>

        <Card className="space-y-2 p-4">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <Badge tone={isAdmin ? "ok" : "neutral"}>
              {isAdmin ? "管理员" : "普通用户"}
            </Badge>
            <p className="text-sm font-medium text-ink">账号信息</p>
          </div>
          <InfoRow
            label="账号 ID"
            value={<code className="font-mono text-xs">{user.id}</code>}
          />
          <InfoRow label="角色" value={isAdmin ? "管理员" : "普通用户"} />
          <InfoRow
            label="记忆作用域"
            value={
              user.memory_scope ? (
                <code className="font-mono text-xs">{user.memory_scope}</code>
              ) : (
                "全部记忆（管理员）"
              )
            }
          />
          <InfoRow label="创建时间" value={formatDateTime(user.created_at)} />
        </Card>
      </div>
    </div>
  );
}
