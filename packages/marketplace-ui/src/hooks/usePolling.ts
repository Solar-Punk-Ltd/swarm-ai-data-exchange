import { useEffect, useRef } from 'react';

/**
 * Run `task` immediately, then on an interval, pausing while the tab is hidden.
 *
 * A backgrounded demo tab should not burn RPC quota; on becoming visible again it refreshes at
 * once rather than waiting out the interval.
 */
export function usePolling(task: () => void | Promise<void>, intervalMs: number): void {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    const run = () => void taskRef.current();

    const start = () => {
      if (timer !== undefined) return;
      run();
      timer = setInterval(run, intervalMs);
    };

    const stop = () => {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
    };

    const onVisibility = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
}
