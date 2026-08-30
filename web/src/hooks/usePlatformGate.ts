import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { isIosDevice } from '../platform/ios';

/**
 * Evaluated once at module load, not per render: the answer cannot change
 * without a reload, and re-running the sniff would only risk flicker.
 */
const IS_IOS = isIosDevice();

export type GateState = 'checking' | 'allowed' | 'blocked';

/**
 * Decides whether this device may use the client.
 *
 * iOS is always allowed and never waits on the network — the overwhelmingly
 * common case should not be gated behind a request that might be slow. Only a
 * non-iOS device has to ask the server whether the admin has opened access
 * (see `webAllowNonIos` in the Settings model).
 *
 * That request fails **closed**. A blocked device staying blocked when the
 * network hiccups is the safe direction: the alternative would let a flaky
 * connection silently open the client to everyone, which is exactly what the
 * switch exists to control.
 */
export function usePlatformGate(): GateState {
  const [state, setState] = useState<GateState>(IS_IOS ? 'allowed' : 'checking');

  useEffect(() => {
    if (IS_IOS) return;

    let cancelled = false;
    void api.webConfig().then((res) => {
      if (cancelled) return;
      setState(res.ok && res.data.allowNonIos === true ? 'allowed' : 'blocked');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
