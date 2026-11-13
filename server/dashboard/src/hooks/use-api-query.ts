import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";

interface UseApiQueryOptions<T> {
  enabled?: boolean;
  errorToast?: string;
  initialData?: T;
}

interface UseApiQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: string;
  refetch: () => Promise<void>;
}

export function useApiQuery<T>(
  fetcher: () => Promise<T>,
  options: UseApiQueryOptions<T> = {},
): UseApiQueryResult<T> {
  const { enabled = true, errorToast, initialData } = options;

  const [data, setData] = useState<T | undefined>(initialData);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState("");

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Request sequence guard: a slow earlier request must not overwrite fresher data
  // (e.g. batch refetch racing a filter switch). Only the newest run may publish.
  const seqRef = useRef(0);

  const run = useCallback(async () => {
    const seq = ++seqRef.current;
    setIsLoading(true);
    setError("");
    try {
      const next = await fetcherRef.current();
      if (seq !== seqRef.current) return;
      setData(next);
    } catch (err) {
      if (seq !== seqRef.current) return;
      const message = getErrorMessage(err, errorToast || "请求失败");
      setError(message);
      if (errorToast) {
        toast({
          title: errorToast,
          description: message,
          variant: "destructive",
        });
      }
    } finally {
      if (seq === seqRef.current) setIsLoading(false);
    }
  }, [errorToast]);

  useEffect(() => {
    if (enabled) void run();
  }, [enabled, run]);

  return { data, isLoading, error, refetch: run };
}
