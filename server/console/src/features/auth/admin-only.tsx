import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "@/lib/session";
import { FullPageLoader } from "@/ui/feedback";

/** 管理面路由守卫：普通用户访问时静默回到记忆库。 */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { status, isAdmin } = useSession();
  if (status === "loading") return <FullPageLoader />;
  if (!isAdmin) return <Navigate to="/memories" replace />;
  return <>{children}</>;
}
