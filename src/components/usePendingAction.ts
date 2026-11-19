import { useRef, useState } from 'react';

export function usePendingAction() {
  const running = useRef(false);
  const [pending, setPending] = useState<string | null>(null);

  async function run(action: string, task: () => Promise<void>, onError: () => void) {
    if (running.current) return;
    running.current = true;
    setPending(action);
    try {
      await task();
    } catch {
      onError();
    } finally {
      running.current = false;
      setPending(null);
    }
  }

  return { pending, run };
}
