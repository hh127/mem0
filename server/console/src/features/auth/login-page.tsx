import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, KeyRound, Layers, ShieldCheck } from "lucide-react";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/lib/utils";
import { Button, Field, Input } from "@/ui/primitives";

const HIGHLIGHTS = [
  { icon: ShieldCheck, text: "会话只存在内存，刷新令牌走 httpOnly Cookie" },
  { icon: Layers, text: "记忆浏览、分类、用量与配置集中在一个界面" },
  { icon: KeyRound, text: "管理员与普通用户按记忆作用域隔离" },
];

export function LoginPage() {
  const { login, status, needsSetup } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (status === "authenticated") return <Navigate to="/memories" replace />;

  const from = (location.state as { from?: string } | null)?.from;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(email.trim(), password);
      navigate(from && from !== "/login" ? from : "/memories", { replace: true });
    } catch (err) {
      setError(errorMessage(err, "登录失败，请检查邮箱与密码"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid min-h-dvh md:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between bg-ink px-12 py-10 text-paper md:flex">
        <div className="flex items-center gap-2 text-sm text-paper/70">
          <span className="grid size-7 place-items-center rounded-md bg-paper/10 font-display">
            M
          </span>
          self-hosted console
        </div>
        <div className="max-w-md space-y-6">
          <h1 className="font-display text-4xl leading-snug">
            把记忆
            <br />
            留在自己手里。
          </h1>
          <p className="text-sm leading-6 text-paper/70">
            为自托管 Mem0 打造的独立控制台。没有云导流，没有外链，全部数据留在你自己的服务端。
          </p>
          <ul className="space-y-3">
            {HIGHLIGHTS.map((item) => (
              <li key={item.text} className="flex items-start gap-2.5 text-sm text-paper/80">
                <item.icon className="mt-0.5 size-4 shrink-0 text-paper/50" />
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-paper/40">
          Mem0 Console · Apache-2.0 · 与官方 Dashboard 相互独立
        </p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm space-y-7">
          <div className="space-y-1.5 md:hidden">
            <span className="grid size-9 place-items-center rounded-lg bg-ink font-display text-paper">
              M
            </span>
            <h1 className="font-display text-2xl text-ink">登录控制台</h1>
          </div>
          <div className="hidden space-y-1.5 md:block">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-accent">
              登录
            </p>
            <h1 className="font-display text-2xl text-ink">欢迎回来</h1>
            <p className="text-sm text-ink-soft">使用管理员或用户账号登录。</p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <Field label="邮箱" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@example.com"
              />
            </Field>
            <Field label="密码" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </Field>

            {error ? (
              <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft/60 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            ) : null}

            <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
              登录
              <ArrowRight className="size-4" />
            </Button>
          </form>

          <div className="space-y-2 text-xs text-ink-faint">
            {needsSetup ? (
              <p>
                还没有账号？
                <Link to="/setup" className="ml-1 font-medium text-accent hover:underline">
                  创建首个管理员
                </Link>
              </p>
            ) : (
              <p>忘记密码时可在宿主机执行 `make reset-admin-password`。</p>
            )}
            <p>
              API 地址：<code className="font-mono">{import.meta.env.VITE_API_BASE_URL || "/api"}</code>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
