import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import runtime from '../../android/app/src/main/assets/monitoring/runtime.json';

export function useMonitoringClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), runtime.watchdogIntervalMs);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') setNow(Date.now()); });
    return () => { clearInterval(timer); listener.remove(); };
  }, []);
  return now;
}
