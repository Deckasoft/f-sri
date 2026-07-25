import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Guards the backoffice routes: redirects to /admin/login when there is no
 * in-memory admin session (fresh page load, expired session, or explicit
 * logout). Mirrors the backend's own guard (adminAuth middleware) at the UI
 * layer — the real enforcement is always server-side.
 */
export const ProtectedRoute = () => {
  const { auth } = useAuth();
  const location = useLocation();

  if (!auth) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
};
