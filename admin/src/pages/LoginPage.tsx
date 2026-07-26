import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../api/adminApi';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import {
  TESTID_LOGIN_EMAIL,
  TESTID_LOGIN_ERROR,
  TESTID_LOGIN_PASSWORD,
  TESTID_LOGIN_SUBMIT,
} from '../testIds';

export const LoginPage = () => {
  const { setAuth } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    login(email, password)
      .then((response) => {
        setAuth({ token: response.token, user: response.user });
        navigate('/admin/tenants', { replace: true });
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'No se pudo iniciar sesión');
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <main className="centered-page">
      <form className="card" onSubmit={handleSubmit}>
        <h1>F Sri · Backoffice</h1>
        <label htmlFor="email">Correo</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          data-testid={TESTID_LOGIN_EMAIL}
        />
        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          data-testid={TESTID_LOGIN_PASSWORD}
        />
        {error && (
          <p className="error-text" data-testid={TESTID_LOGIN_ERROR}>
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting} data-testid={TESTID_LOGIN_SUBMIT}>
          {submitting ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </main>
  );
};
