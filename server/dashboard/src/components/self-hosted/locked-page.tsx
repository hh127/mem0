"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Lock } from "lucide-react";

interface LockedPageProps {
  title: string;
  description: string;
  previewContent: React.ReactNode;
  /** Kept for call-site compatibility; no longer used for outbound links. */
  utmMedium?: string;
}

export function LockedPage({
  title,
  description,
  previewContent,
}: LockedPageProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold font-fustat flex items-center gap-2">
          {title}
          <Lock className="size-4 text-onSurface-default-tertiary" />
        </h1>
        <p className="text-sm text-onSurface-default-secondary mt-1">
          {description}
        </p>
      </div>

      <div className="opacity-60 pointer-events-none select-none">
        {previewContent}
      </div>

      <Card className="border-memBorder-primary">
        <CardContent className="py-6">
          <p className="text-sm font-medium">自托管版不包含此功能。</p>
          <p className="text-xs text-onSurface-default-secondary mt-1">
            该页面依赖 Mem0
            官方云端提供的数据接口，本部署没有对应后端，因此只保留界面预览。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
