import { useCallback, useEffect, useRef, useState } from 'react';

export type PageResult<T> = { items: T[]; hasMore: boolean };

/**
 * Infinite-scroll state for one list screen: loads page 1 (again whenever `deps` change),
 * appends the next page on `loadMore`, and reloads from page 1 on `refresh`. A reply that
 * arrives after a newer load started is dropped, so a quick filter change never mixes pages.
 * `fetchPage` is 1-based; rows are de-duplicated by `keyOf` across pages.
 */
export function usePagedList<T>(
  fetchPage: (page: number) => Promise<PageResult<T>>,
  keyOf: (item: T) => string,
  deps: unknown[],
  /** `resetOnChange` clears the rows as soon as `deps` change — for screens where rows from
   *  the previous query can't be drawn with the new one (e.g. switching between two tabs). */
  options: { enabled?: boolean; resetOnChange?: boolean } = {}
) {
  const enabled = options.enabled ?? true;
  const resetOnChange = options.resetOnChange ?? false;
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(1);
  const requestRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const keyRef = useRef(keyOf);
  keyRef.current = keyOf;

  const loadFirst = useCallback(async (isRefresh: boolean) => {
    const requestId = ++requestRef.current;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await fetchRef.current(1);
      if (requestId !== requestRef.current) return;
      pageRef.current = 1;
      setItems(result.items);
      setHasMore(result.hasMore);
      setError(null);
    } catch (err) {
      if (requestId !== requestRef.current) return;
      setError(err);
      // A failed pull-to-refresh keeps what's already on screen.
      if (!isRefresh) {
        setItems([]);
        setHasMore(false);
      }
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    if (resetOnChange) {
      setItems([]);
      setHasMore(false);
    }
    void loadFirst(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, loadFirst, ...deps]);

  const loadMore = useCallback(async () => {
    if (!enabled || !hasMore || loadingMoreRef.current || loading) return;
    const requestId = requestRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const result = await fetchRef.current(next);
      if (requestId !== requestRef.current) return;
      pageRef.current = next;
      setItems((current) => {
        const seen = new Set(current.map((item) => keyRef.current(item)));
        return [...current, ...result.items.filter((item) => !seen.has(keyRef.current(item)))];
      });
      setHasMore(result.hasMore);
    } catch (err) {
      // Leave hasMore set so the next scroll to the end retries.
      console.warn('Failed to load the next page.', err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [enabled, hasMore, loading]);

  const refresh = useCallback(() => loadFirst(true), [loadFirst]);

  return { items, setItems, loading, refreshing, loadingMore, hasMore, error, loadMore, refresh };
}
