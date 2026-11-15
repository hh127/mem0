/** 加载占位：保持与真实内容相同的网格/表格骨架，避免布局跳动。 */

export function MemoryListSkeleton({ view }: { view: "cards" | "table" }) {
  if (view === "table") {
    return (
      <div role="status" aria-label="正在加载记忆" className="space-y-2 rounded-[var(--radius-card)] border border-line bg-panel p-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex animate-pulse items-center gap-3">
            <div className="h-4 w-1/3 rounded bg-panel-2" />
            <div className="h-4 w-16 rounded bg-panel-2" />
            <div className="h-4 w-24 rounded bg-panel-2" />
            <div className="ml-auto h-4 w-20 rounded bg-panel-2" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-label="正在加载记忆"
      className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
    >
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="animate-pulse space-y-3 rounded-[var(--radius-card)] border border-line bg-panel p-4">
          <div className="h-4 w-11/12 rounded bg-panel-2" />
          <div className="h-4 w-2/3 rounded bg-panel-2" />
          <div className="flex gap-1.5">
            <div className="h-5 w-16 rounded-full bg-panel-2" />
            <div className="h-5 w-12 rounded-full bg-panel-2" />
          </div>
          <div className="h-3 w-1/2 rounded bg-panel-2" />
          <div className="h-8 w-full rounded bg-panel-2" />
        </div>
      ))}
    </div>
  );
}
