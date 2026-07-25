import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthProvider';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { TenantDetailPage } from './pages/TenantDetailPage';
import { TenantsListPage } from './pages/TenantsListPage';

export const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/admin/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/admin/tenants" element={<TenantsListPage />} />
          <Route path="/admin/tenants/:id" element={<TenantDetailPage />} />
        </Route>
        <Route path="/admin" element={<Navigate to="/admin/tenants" replace />} />
        <Route path="/" element={<Navigate to="/admin/tenants" replace />} />
        <Route path="*" element={<Navigate to="/admin/tenants" replace />} />
      </Routes>
    </AuthProvider>
  </BrowserRouter>
);
