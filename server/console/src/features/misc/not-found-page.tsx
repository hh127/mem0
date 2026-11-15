import { Link } from "react-router-dom";
import { buttonClass } from "@/ui/primitives";

export function NotFoundPage() {
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 text-center">
      <p className="font-display text-5xl text-ink-faint">404</p>
      <div className="space-y-1">
        <h1 className="font-display text-xl text-ink">页面不存在</h1>
        <p className="text-sm text-ink-soft">地址可能拼错了，或者页面已被移除。</p>
      </div>
      <Link to="/memories" className={buttonClass("primary")}>
        回到记忆库
      </Link>
    </div>
  );
}
