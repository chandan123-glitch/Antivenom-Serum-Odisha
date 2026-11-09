import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
export const useData = () => useContext(Ctx);

export function DataProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', districts: [], facilities: [], low: 20, error: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: s.status === 'ready' ? 'ready' : 'loading', error: null }));
    try {
      const [meta, districts, facilities] = await Promise.all([api('/meta'), api('/districts'), api('/facilities')]);
      setState({ status: 'ready', districts, facilities, low: meta.lowStock, error: null });
    } catch (e) {
      setState((s) => ({ ...s, status: 'error', error: e.message }));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const value = useMemo(() => ({ ...state, reload: load }), [state, load]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
