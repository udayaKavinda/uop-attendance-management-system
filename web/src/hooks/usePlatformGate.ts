import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { isIosDevice } from '../platform/ios';

/**
 * Evaluated once at module load, not per render: the answer cannot change
 * without a reload, and re-running the sniff would only risk flicker.
 */
const IS_IOS = isIosDevice();

export type GateState = 'checking' | 'allowed' | 'blocked' | 'unavailable';

/**
 * Decides whether this device may use the client.
 *
 * iOS is always allowed and never waits on the network — the overwhelmingly
 * common case should not be gated behind a request that might be slow. Only a
 * non-iOS device has to ask the server whether the admin has opened access
 * (see `webAllowNonIos` in the Settings model).
 *
 * That request still fails **closed**: a device stays out when the check cannot
 * be completed, because the alternative would let a flaky connection silently
 * open the client to everyone, which is exactly what the switch exists to
 * control. What changed is that it no longer misreports why. A failed check is
 * `unavailable`, not `blocked`, so the user is told the check did not complete
 * and offered a retry, rather than being told this device is unsupported —
 * which, for an Android device the admin had actually permitted, was simply
 * untrue and left no way forward.
 */
export function usePlatformGate(): { state: GateState; retry: () => void } {
  const [state, setState] = useState<GateState>(IS_IOS ? 'allowed' : 'checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (IS_IOS) return;

    let cancelled = false;
    setState('checking');
    void api.webConfig().then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setState('unavailable');
        return;
      }
      setState(res.data.allowNonIos === true ? 'allowed' : 'blocked');
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { state, retry: () => setAttempt((n) => n + 1) };
}
