"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronDown, FlaskConical, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import { useCategoryCatalog } from "@/hooks/use-category-catalog";
import { api } from "@/utils/api";
import { CATEGORY_ENDPOINTS } from "@/utils/api-endpoints";
import { cn } from "@/lib/utils";
import type { CategoryEntry } from "@/types/api";

interface DraftEntry extends CategoryEntry {
  count: number;
}

function ManageCategoriesContent() {
  const { stats, rules, isLoading, refetch } = useCategoryCatalog();
  const searchParams = useSearchParams();
  const editParam = searchParams?.get("edit") ?? "";

  const [draft, setDraft] = useState<DraftEntry[]>([]);
  const [rulesText, setRulesText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [editing, setEditing] = useState<DraftEntry | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [removeTarget, setRemoveTarget] = useState<DraftEntry | null>(null);

  useEffect(() => {
    if (stats.length === 0) return;
    setDraft(stats.map((stat) => ({ ...stat })));
    setRulesText(rules.join("\n"));
    setDirty(false);
  }, [stats, rules]);

  // Deep link from the browse page / tester: ?edit=分类名 opens that editor directly.
  useEffect(() => {
    if (!editParam || draft.length === 0) return;
    const target = draft.find((entry) => entry.name === editParam);
    if (target) openEditor(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, draft.length]);

  const enabledCount = useMemo(
    () => draft.filter((entry) => entry.enabled !== false).length,
    [draft],
  );

  function openEditor(entry: DraftEntry) {
    setEditing(entry);
    setEditName(entry.name);
    setEditDescription(entry.description);
  }

  function markDirty() {
    setDirty(true);
  }

  function toggleEnabled(name: string, next: boolean) {
    setDraft((current) =>
      current.map((entry) =>
        entry.name === name
          ? { ...entry, enabled: next ? undefined : false }
          : entry,
      ),
    );
    markDirty();
  }

  function saveEditor() {
    if (!editing) return;
    const name = editName.trim();
    if (!name) {
      toast({ title: "分类名不能为空", variant: "destructive" });
      return;
    }
    const collision = draft.some((entry) => entry.name === name && entry.name !== editing.name);
    if (collision) {
      toast({ title: `已存在同名分类「${name}」`, variant: "destructive" });
      return;
    }
    setDraft((current) =>
      current.map((entry) =>
        entry.name === editing.name
          ? { ...entry, name, description: editDescription.trim() }
          : entry,
      ),
    );
    setEditing(null);
    markDirty();
  }

  function createCategory() {
    const name = newName.trim();
    if (!name) {
      toast({ title: "分类名不能为空", variant: "destructive" });
      return;
    }
    if (draft.some((entry) => entry.name === name)) {
      toast({ title: `已存在同名分类「${name}」`, variant: "destructive" });
      return;
    }
    setDraft((current) => [
      ...current,
      { name, description: newDescription.trim(), count: 0 },
    ]);
    setCreateOpen(false);
    setNewName("");
    setNewDescription("");
    markDirty();
  }

  function removeCategory() {
    if (!removeTarget) return;
    setDraft((current) => current.filter((entry) => entry.name !== removeTarget.name));
    setRemoveTarget(null);
    markDirty();
  }

  async function save() {
    setIsSaving(true);
    try {
      await api.post(CATEGORY_ENDPOINTS.BASE, {
        custom_categories: draft.map((entry) => ({
          name: entry.name,
          description: entry.description,
          ...(entry.enabled === false ? { enabled: false } : {}),
        })),
        custom_category_rules: rulesText
          .split("\n")
          .map((rule) => rule.trim())
          .filter(Boolean),
      });
      toast({ title: "分类目录已保存", variant: "success" });
      setDirty(false);
      await refetch();
    } catch (error) {
      toast({
        title: "保存失败",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold font-fustat">分类管理</h1>
          <p className="text-sm text-onSurface-default-tertiary mt-1">
            管理 AI 如何理解和组织长期记忆：描述即判断规则，改动只影响之后写入的记忆。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/categories/test">
              <FlaskConical className="size-3.5 mr-1" />
              分类测试
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5 mr-1" />
            新建分类
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={!dirty || isSaving}>
            <Save className="size-3.5 mr-1" />
            {isSaving ? "保存中…" : dirty ? "保存目录" : "已保存"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-onSurface-default-tertiary">
        <span>
          共 {draft.length} 个分类，启用 {enabledCount} 个
        </span>
        <span>·</span>
        <span>停用的分类仍保留描述，但不再参与打标；已打上的标签不受影响</span>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} columns={2} />
      ) : (
        <div className="space-y-2">
          {draft.map((entry) => (
            <Card key={entry.name} className="border-memBorder-primary">
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={cn(
                        "text-sm font-medium",
                        entry.enabled === false && "text-onSurface-default-tertiary line-through",
                      )}
                    >
                      {entry.name}
                    </span>
                    <span className="shrink-0 typo-caption-sm text-onSurface-default-tertiary tabular-nums">
                      {entry.count} 条记忆
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-onSurface-default-tertiary select-none">
                      <Switch
                        checked={entry.enabled !== false}
                        onCheckedChange={(next) => toggleEnabled(entry.name, next)}
                      />
                      {entry.enabled === false ? "已停用" : "启用"}
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => openEditor(entry)}
                    >
                      <Pencil className="size-3.5 mr-1" />
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-onSurface-danger-primary"
                      onClick={() => setRemoveTarget(entry)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-onSurface-default-tertiary">
                  {entry.description || "（无描述 — 模型只能靠分类名判断，建议补上描述）"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Collapsible open={rulesOpen} onOpenChange={setRulesOpen}>
        <Card className="border-memBorder-primary">
          <CollapsibleTrigger asChild>
            <button className="flex w-full items-center justify-between px-4 py-3 text-left">
              <span className="text-sm font-medium">
                判定规则（{rulesText.split("\n").filter((line) => line.trim()).length} 条）
              </span>
              <ChevronDown
                className={cn("size-4 transition-transform", rulesOpen && "rotate-180")}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-2 border-t border-memBorder-primary p-4">
              <Label className="text-xs text-onSurface-default-tertiary">
                按顺序判断、命中即停止；一行一条。分类歧义优先靠顺序消解。
              </Label>
              <Textarea
                value={rulesText}
                onChange={(event) => {
                  setRulesText(event.target.value);
                  markDirty();
                }}
                rows={10}
                className="font-mono text-xs"
              />
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑分类</DialogTitle>
            <DialogDescription>
              描述是分类模型唯一能读到的判断依据，写清「包含什么、不包含什么」最有效。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-onSurface-default-tertiary">分类名</Label>
              <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-onSurface-default-tertiary">描述</Label>
              <Textarea
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                rows={8}
                className="text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={saveEditor}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新建分类</DialogTitle>
            <DialogDescription>
              新增后需要保存目录才会对之后的记忆生效。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-onSurface-default-tertiary">分类名</Label>
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="例如：风险提示"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-onSurface-default-tertiary">描述</Label>
              <Textarea
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                rows={6}
                className="text-sm"
                placeholder="描述这个分类包含什么、不包含什么、判断依据是什么。"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={createCategory}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除分类「{removeTarget?.name}」</DialogTitle>
            <DialogDescription>
              删除只影响之后的分类；已经打上这个标签的 {removeTarget?.count ?? 0} 条记忆会保留原标签。
              如果只是暂时不想用，改成「停用」更稳妥。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              取消
            </Button>
            <Button
              className="bg-surface-danger-primary text-onSurface-danger-primary"
              onClick={removeCategory}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ManageCategoriesPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={5} columns={2} />}>
      <ManageCategoriesContent />
    </Suspense>
  );
}
