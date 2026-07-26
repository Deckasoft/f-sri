import { createContext } from 'react';

export interface AdminUser {
  id: string;
  email: string;
  role: string;
}

export interface AuthState {
  token: string;
  user: AdminUser;
}

export interface AuthContextValue {
  auth: AuthState | null;
  setAuth: (auth: AuthState) => void;
  logout: () => void;
}

// Split from the AuthProvider component (AuthProvider.tsx) and the useAuth
// hook (useAuth.ts) so every file here exports only one kind of thing
// (component-only / hook-only) — react-refresh/only-export-components
// otherwise warns that Fast Refresh can't reliably hot-reload a file mixing
// a component with plain values.
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
