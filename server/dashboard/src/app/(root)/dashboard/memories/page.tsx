"use client";

import { useRef, useState } from "react";
import { Pencil, Search, Trash2, X } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/shared/data-table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { EmptyState } from "@/components/self-hosted/empty-state";
import DeleteConfirmationModal from "@/components/ui/delete-confirmation-modal";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { UpgradeBanner } from "@/components/self-hosted/upgrade-banner";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import { api } from "@/utils/api";
import { MEMORY_ENDPOINTS } from "@/utils/api-endpoints";
import { useApiQuery } from "@/hooks/use-api-query";
import { Memory } from "@/types/api";

const PAGE_SIZE = 20;
// Keep in sync with ALL_MEMORIES_LIMIT in server/main.py.
const MEMORY_FETCH_LIMIT = 1000;

export default function MemoriesPage() {
  const [userId, setUserId] = useState("");
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [memoryToDelete, setMemoryToDelete] = useState<Memory | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  // 重排开关：默认开（语义搜索先用向量召回，再用重排模型精排）
  const [useRerank, setUseRerank] = useState(true);
  // 用 ref 存查询词：提交后立即 refetch，此时 state 还没更新完
  const searchQueryRef = useRef("");
  const rerankRef = useRef(true);
  const [page, setPage] = useState(0);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";

  const {
    data: memories = [],
    isLoading,
    refetch,
  } = useApiQuery<Memory[]>(
    async () => {
      const query = searchQueryRef.current.trim();
      if (query) {
        // 后端要求 filters 至少含一个实体（user_id/agent_id/run_id），不能空手搜。
        // 用户没指定就取全量列表里出现过的所有 user_id，分别搜再合并。
        let idList: string[] = [];
        if (userId.trim()) {
          idList = [userId.trim()];
        } else {
          const all = await api.get(MEMORY_ENDPOINTS.BASE, {
            params: { top_k: MEMORY_FETCH_LIMIT },
          });
          const allRaw = all.data?.results ?? all.data ?? [];
          idList = Array.from(
            new Set(
              (Array.isArray(allRaw) ? allRaw : [])
                .map((m: Memory) => m.user_id)
                .filter((v): v is string => !!v),
            ),
          );
        }
        if (idList.length === 0) return [];
        const responses = await Promise.all(
          idList.map((uid) =>
            api.post(MEMORY_ENDPOINTS.SEARCH, {
              query,
              filters: { user_id: uid },
              top_k: MEMORY_FETCH_LIMIT,
              rerank: rerankRef.current,
            }),
          ),
        );
        const merged: Memory[] = [];
        for (const res of responses) {
          const raw = res.data?.results ?? res.data ?? [];
          if (Array.isArray(raw)) merged.push(...(raw as Memory[]));
        }
        const seen = new Set<string>();
        return merged
          .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      }
      const params = userId.trim()
        ? { user_id: userId.trim(), top_k: MEMORY_FETCH_LIMIT }
        : { top_k: MEMORY_FETCH_LIMIT };
      const res = await api.get(MEMORY_ENDPOINTS.BASE, { params });
      const raw = res.data?.results ?? res.data ?? [];
      return Array.isArray(raw) ? raw : [];
    },
    { errorToast: "记忆加载失败", initialData: [] },
  );

  const totalPages = Math.ceil(memories.length / PAGE_SIZE);
  const paginatedMemories = memories.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );

  const runSearch = () => {
    const q = searchInput.trim();
    searchQueryRef.current = q;
    rerankRef.current = useRerank;
    setActiveSearch(q);
    setPage(0);
    void refetch();
  };

  // 切换重排后若已有搜索结果，立即重搜一次（否则等下次点搜索）
  const toggleRerank = (next: boolean) => {
    setUseRerank(next);
    rerankRef.current = next;
    if (searchQueryRef.current.trim()) void refetch();
  };

  const clearSearch = () => {
    searchQueryRef.current = "";
    setActiveSearch("");
    setSearchInput("");
    setPage(0);
    void refetch();
  };

  const closeDetail = () => {
    setSelectedMemory(null);
    setIsEditing(false);
  };

  const startEditing = (memory: Memory) => {
    setEditText(memory.memory);
    setIsEditing(true);
  };

  const handleUpdate = async () => {
    if (!selectedMemory) return;
    const text = editText.trim();
    if (!text) {
      toast({ title: "记忆内容不能为空", variant: "destructive" });
      return;
    }
    if (text === selectedMemory.memory) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    try {
      await api.put(MEMORY_ENDPOINTS.BY_ID(selectedMemory.id), { text });
      setSelectedMemory({ ...selectedMemory, memory: text });
      setIsEditing(false);
      toast({ title: "记忆已更新", variant: "success" });
      void refetch();
    } catch (error) {
      toast({
        title: "记忆更新失败",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!memoryToDelete) return;
    try {
      await api.delete(MEMORY_ENDPOINTS.BY_ID(memoryToDelete.id));
      toast({ title: "记忆已删除", variant: "success" });
      if (selectedMemory?.id === memoryToDelete.id) {
        setSelectedMemory(null);
        setIsEditing(false);
      }
      setMemoryToDelete(null);
      void refetch();
    } catch (error) {
      toast({
        title: "记忆删除失败",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  const columns = [
    {
      key: "memory" as keyof Memory,
      label: "内容",
      width: 400,
      render: (value: string, row: Memory) => (
        <div className="flex items-center gap-2">
          <span className="line-clamp-2 text-sm">{value}</span>
          {row.score != null && (
            <span className="shrink-0 rounded bg-surface-default-tertiary px-1.5 py-0.5 font-mono text-[10px] text-onSurface-default-tertiary">
              {row.score.toFixed(3)}
            </span>
          )}
        </div>
      ),
    },
    { key: "user_id" as keyof Memory, label: "用户", width: 100 },
    { key: "agent_id" as keyof Memory, label: "代理", width: 100 },
    {
      key: "created_at" as keyof Memory,
      label: "创建时间",
      width: 120,
      render: (value: string) =>
        value ? format(new Date(value), "MMM d, yyyy") : "--",
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold font-fustat">记忆</h1>

      {memories.length >= MEMORY_FETCH_LIMIT && (
        <UpgradeBanner
          id="memories-1k"
          message="1,000+ memories stored. Categories can help organize them."
          ctaLabel="了解云服务"
          ctaUrl="https://app.mem0.ai?utm_source=oss&utm_medium=dashboard-memories"
          variant="cloud"
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="按用户 ID 筛选（可选）"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setPage(0);
              refetch();
            }
          }}
          className="w-56"
        />
        <Input
          placeholder="搜索记忆内容（按意思搜，回车执行）"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch();
          }}
          className="w-80"
        />
        <Button variant="outline" size="sm" onClick={runSearch}>
          <Search className="size-3.5 mr-1" />
          搜索
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-onSurface-default-tertiary select-none">
          <Switch checked={useRerank} onCheckedChange={toggleRerank} />
          使用重排
        </label>
        {activeSearch && (
          <Button variant="ghost" size="sm" onClick={clearSearch}>
            <X className="size-3.5 mr-1" />
            清除搜索
          </Button>
        )}
      </div>

      {activeSearch && (
        <p className="text-sm text-onSurface-default-tertiary">
          搜索「{activeSearch}」—— 命中 {memories.length} 条，按相关度排序
          {useRerank ? "（已用重排模型精排）" : "（仅向量召回，未重排）"}
          {userId.trim() ? `（限用户 ${userId.trim()}）` : ""}
        </p>
      )}

      {isLoading ? (
        <TableSkeleton rows={5} columns={4} />
      ) : memories.length === 0 ? (
        activeSearch ? (
          <EmptyState
            title="没有匹配的记忆"
            description={`没有找到与「${activeSearch}」相关的记忆，换个说法试试。`}
          />
        ) : (
          <EmptyState
            title="暂无记忆"
            description="Create your first memory by sending a POST /memories request."
          >
            <pre className="text-xs text-left bg-surface-default-secondary p-3 rounded font-mono overflow-x-auto mt-3 max-w-lg">
              {`curl -X POST ${apiUrl}/memories \\\\
  -H "X-API-Key: *** \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"messages": [{"role": "user", "content": "我喜欢徒步"}], "user_id": "alice"}'`}
            </pre>
            <a
              href="https://docs.mem0.ai/open-source/features/rest-api#memory-operations"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-onSurface-default-tertiary underline underline-offset-4 hover:text-onSurface-default-primary mt-2"
            >
              REST API 文档
            </a>
          </EmptyState>
        )
      ) : (
        <>
          <Card className="border-memBorder-primary overflow-hidden">
            <DataTable
              data={paginatedMemories}
              columns={columns}
              getRowKey={(row) => row.id}
              onRowClick={(row) => {
                setSelectedMemory(row);
                setIsEditing(false);
              }}
              getRowClassName={(row) =>
                selectedMemory?.id === row.id
                  ? "bg-surface-default-tertiary"
                  : undefined
              }
            />
          </Card>
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-onSurface-default-tertiary">
              <span>
                {page * PAGE_SIZE + 1}–
                {Math.min((page + 1) * PAGE_SIZE, memories.length)} of{" "}
                {memories.length}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Sheet
        open={!!selectedMemory}
        onOpenChange={(open) => {
          if (!open) closeDetail();
        }}
      >
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>记忆详情</SheetTitle>
            <SheetDescription className="sr-only">
              查看和修改记忆内容
            </SheetDescription>
          </SheetHeader>
          {selectedMemory && (
            <div className="mt-6 space-y-4">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-onSurface-default-tertiary">
                    内容
                  </Label>
                  {!isEditing && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => startEditing(selectedMemory)}
                    >
                      <Pencil className="size-3.5 mr-1" />
                      编辑
                    </Button>
                  )}
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    <Textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={4}
                      className="text-sm"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={isSaving}
                        onClick={handleUpdate}
                      >
                        {isSaving ? "保存中…" : "保存"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isSaving}
                        onClick={() => setIsEditing(false)}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm">{selectedMemory.memory}</p>
                )}
              </div>
              {selectedMemory.score != null && (
                <div className="space-y-1">
                  <Label className="text-xs text-onSurface-default-tertiary">
                    搜索相关度
                  </Label>
                  <p className="text-sm font-mono">
                    {selectedMemory.score.toFixed(4)}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-onSurface-default-tertiary">
                    ID
                  </Label>
                  <p className="text-xs font-mono break-all">
                    {selectedMemory.id}
                  </p>
                </div>
                {selectedMemory.user_id && (
                  <div className="space-y-1">
                    <Label className="text-xs text-onSurface-default-tertiary">
                      用户
                    </Label>
                    <p className="text-sm">{selectedMemory.user_id}</p>
                  </div>
                )}
                {selectedMemory.agent_id && (
                  <div className="space-y-1">
                    <Label className="text-xs text-onSurface-default-tertiary">
                      代理
                    </Label>
                    <p className="text-sm">{selectedMemory.agent_id}</p>
                  </div>
                )}
                {selectedMemory.created_at && (
                  <div className="space-y-1">
                    <Label className="text-xs text-onSurface-default-tertiary">
                      创建时间
                    </Label>
                    <p className="text-sm">
                      {new Date(selectedMemory.created_at).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-onSurface-danger-primary"
                onClick={() => setMemoryToDelete(selectedMemory)}
              >
                <Trash2 className="size-3.5 mr-1" />
                删除记忆
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <DeleteConfirmationModal
        isOpen={!!memoryToDelete}
        onClose={() => setMemoryToDelete(null)}
        onConfirm={handleDelete}
        title="删除记忆"
        description="This memory will be permanently removed. This cannot be undone."
        itemName={memoryToDelete?.id ?? ""}
        confirmButtonText="Delete"
      />
    </div>
  );
}
