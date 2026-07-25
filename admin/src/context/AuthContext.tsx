import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export interface AdminUser {
  id: string;
  email: string;
  role: string;
}

export interface AuthState {
  token: string;
  user: AdminUser;
}

interface AuthContextValue {
  auth: AuthState | null;
  setAuth: (auth: AuthState) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Holds the admin JWT in memory only (React state) — deliberately NOT
 * localStorage/sessionStorage. Per the productization plan, this is an
 * internal Deckasoft staff tool: a page refresh forcing re-login is an
 * acceptable trade-off for not leaving a bearer token sitting in persistent
 * browser storage.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [auth, setAuthState] = useState<AuthState | null>(null);

  const setAuth = useCallback((next: AuthState) => {
    setAuthState(next);
  }, []);

  const logout = useCallback(() => {
    setAuthState(null);
  }, []);

  const value = useMemo(() => ({ auth, setAuth, logout }), [auth, setAuth, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
