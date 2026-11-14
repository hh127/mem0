"use client";

import { addDays, format } from "date-fns";
import { useEffect, useState } from "react";
import { CalendarClock, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

const QUICK_PICKS = [7, 30, 365];

/** 批量设到期日：要么给一个具体日期，要么设成永不过期（和后端 expiration_date=null 对应）。 */
export function BatchExpiryDialog({
  open,
  count,
  busy,
  onOpenChange,
  onApply,
}: {
  open: boolean;
  count: number;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (value: string | null) => void;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) setValue("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>批量设到期日</DialogTitle>
        <DialogDescription>
          将作用于已选的 {count}{" "}
          条记忆。到期后记忆会从搜索和列表中隐藏（数据仍在库里，
          清掉日期即恢复）。
        </DialogDescription>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-onSurface-default-tertiary">
              到期日
            </Label>
            <Input
              type="date"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="h-9 w-44 text-sm"
            />
            <div className="flex flex-wrap gap-2 pt-1">
              {QUICK_PICKS.map((days) => {
                const next = format(addDays(new Date(), days), "yyyy-MM-dd");
                return (
                  <Button
                    key={days}
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={busy}
                    onClick={() => setValue(next)}
                  >
                    {days === 365 ? "1 年后" : `${days} 天后`}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              <X className="mr-1 size-3.5" />
              取消
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onApply(null)}
            >
              设为永不过期
            </Button>
            <Button
              size="sm"
              disabled={busy || !value}
              onClick={() => onApply(value)}
            >
              <Check className="mr-1 size-3.5" />
              保存
            </Button>
          </div>

          <p className="flex items-center gap-1.5 text-[11px] leading-4 text-onSurface-default-tertiary">
            <CalendarClock className="size-3.5 shrink-0" />
            不设日期 = 永不过期；「设为永不过期」会把已有到期日清掉。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
