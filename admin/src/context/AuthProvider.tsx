import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setUnauthorizedListener } from '../api/client';
import { AuthContext, type AuthState } from './AuthContext';

/**
 * Holds the admin JWT in memory only (React state) — deliberately NOT
 * localStorage/sessionStorage. Per the productization plan, this is an
 * internal Deckasoft staff tool: a page refresh forcing re-login is an
 * acceptable trade-off for not leaving a bearer token sitting in persistent
 * browser storage.
 *
 * Also registers itself as the app's single unauthorized-response listener
 * (see api/client.ts's setUnauthorizedListener): whenever any apiRequest
 * call gets a 401 (the 4-day admin JWT expired, or was otherwise rejected),
 * logout() runs so ProtectedRoute redirects back to /admin/login instead of
 * leaving every page permanently stuck on a generic load-failure message.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [auth, setAuthState] = useState<AuthState | null>(null);

  const setAuth = useCallback((next: AuthState) => {
    setAuthState(next);
  }, []);

  const logout = useCallback(() => {
    setAuthState(null);
  }, []);

  useEffect(() => {
    setUnauthorizedListener(logout);
    return () => setUnauthorizedListener(null);
  }, [logout]);

  const value = useMemo(() => ({ auth, setAuth, logout }), [auth, setAuth, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
