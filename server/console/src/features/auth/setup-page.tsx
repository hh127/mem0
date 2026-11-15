import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/lib/utils";
import { useToast } from "@/ui/toast";
import { Button, Field, Input, Textarea } from "@/ui/primitives";

const USE_CASES = [
  "个人助理 / 生活记录",
  "客服与售后知识",
  "销售与客户关系",
  "开发者工具与编码助手",
  "团队内部知识库",
];

export function SetupPage() {
  const { register, completeOnboarding, needsSetup } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [useCase, setUseCase] = useState(USE_CASES[0] ?? "个人助理 / 生活记录");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!needsSetup) return <Navigate to="/login" replace />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("密码至少 8 个字符。");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致。");
      return;
    }
    setPending(true);
    try {
      await register({ name: name.trim(), email: email.trim(), password });
      const summary = [useCase, notes.trim()].filter(Boolean).join("；");
      try {
        await completeOnboarding(summary);
      } catch {
        // onboarding 遥测失败不应阻塞进入控制台。
      }
      toast.success("初始化完成，欢迎使用控制台");
      navigate("/memories", { replace: true });
    } catch (err) {
      setError(errorMessage(err, "创建管理员失败"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-12">
      <div className="w-full max-w-xl space-y-6">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-ink-faint">
            <span className="grid size-7 place-items-center rounded-md bg-ink font-display text-paper">
              M
            </span>
            首次部署 · 设置向导
          </div>
          <h1 className="font-display text-2xl text-ink">创建首个管理员</h1>
          <p className="text-sm leading-6 text-ink-soft">
            这个账号拥有全部管理权限，注册入口只对首次部署开放。使用场景会用于生成记忆抽取的偏好指令，之后可在「配置」页修改。
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-[var(--radius-card)] border border-line bg-panel p-5"
        >
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-ink-faint">
              ① 管理员账号
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="显示名称" htmlFor="setup-name">
                <Input
                  id="setup-name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Admin"
                />
              </Field>
              <Field label="邮箱" htmlFor="setup-email">
                <Input
                  id="setup-email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="admin@example.com"
                />
              </Field>
              <Field label="密码" hint="至少 8 个字符" htmlFor="setup-password">
                <Input
                  id="setup-password"
                  type="password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Field label="确认密码" htmlFor="setup-confirm">
                <Input
                  id="setup-confirm"
                  type="password"
                  required
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              </Field>
            </div>
          </div>

          <div className="space-y-3 border-t border-line pt-4">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-ink-faint">
              ② 使用场景（可选）
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {USE_CASES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setUseCase(item)}
                  className={
                    "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors " +
                    (useCase === item
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-panel-2/40 text-ink-soft hover:border-line-strong")
                  }
                >
                  <span>{item}</span>
                  {useCase === item ? <Check className="size-3.5" /> : null}
                </button>
              ))}
            </div>
            <Field
              label="补充说明"
              hint="例如：希望优先记住用户偏好、项目背景与长期目标"
              htmlFor="setup-notes"
            >
              <Textarea
                id="setup-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="用一句话描述你希望它记住什么…"
              />
            </Field>
          </div>

          {error ? (
            <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft/60 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
            <Sparkles className="size-4" />
            创建并进入控制台
            <ArrowRight className="size-4" />
          </Button>
        </form>

        <p className="text-xs text-ink-faint">
          提示：完成设置后可在「API 密钥」页签发程序化访问密钥，SDK 与 CLI 都使用
          <code className="mx-1 font-mono">X-API-Key</code>
          访问。
        </p>
      </div>
    </div>
  );
}
