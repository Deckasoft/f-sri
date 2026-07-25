import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createTenant, listTenants } from '../api/adminApi';
import { ApiError } from '../api/client';
import type { Tenant } from '../api/types';
import { useAuth } from '../context/AuthContext';
import {
  TESTID_NEW_TENANT_FORM,
  TESTID_NEW_TENANT_NOMBRE_COMERCIAL,
  TESTID_NEW_TENANT_RAZON_SOCIAL,
  TESTID_NEW_TENANT_RUC,
  TESTID_NEW_TENANT_SUBMIT,
  TESTID_TENANTS_TABLE,
} from '../testIds';

export const TenantsListPage = () => {
  const { auth, logout } = useAuth();
  const token = auth?.token ?? '';

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [ruc, setRuc] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [nombreComercial, setNombreComercial] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadTenants = (): void => {
    setLoading(true);
    listTenants(token)
      .then(setTenants)
      .catch((err: unknown) =>
        setLoadError(err instanceof ApiError ? err.message : 'Error al cargar tenants'),
      )
      .finally(() => setLoading(false));
  };

  // Intentional: load once on mount only (empty deps) — loadTenants is
  // re-created every render but always closes over the current `token`.
  useEffect(() => {
    loadTenants();
  }, []);

  const handleCreate = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setCreateError(null);
    setCreating(true);

    createTenant(token, { ruc, razon_social: razonSocial, nombre_comercial: nombreComercial })
      .then(() => {
        setRuc('');
        setRazonSocial('');
        setNombreComercial('');
        loadTenants();
      })
      .catch((err: unknown) =>
        setCreateError(err instanceof ApiError ? err.message : 'No se pudo crear el tenant'),
      )
      .finally(() => setCreating(false));
  };

  return (
    <main className="page">
      <header className="page__header">
        <h1>Tenants</h1>
        <button type="button" onClick={logout}>
          Cerrar sesión
        </button>
      </header>

      <section className="card">
        <h2>Nuevo tenant</h2>
        <form onSubmit={handleCreate} data-testid={TESTID_NEW_TENANT_FORM} className="form-grid">
          <label htmlFor="ruc">RUC</label>
          <input
            id="ruc"
            required
            value={ruc}
            onChange={(event) => setRuc(event.target.value)}
            data-testid={TESTID_NEW_TENANT_RUC}
          />
          <label htmlFor="razon_social">Razón social</label>
          <input
            id="razon_social"
            required
            value={razonSocial}
            onChange={(event) => setRazonSocial(event.target.value)}
            data-testid={TESTID_NEW_TENANT_RAZON_SOCIAL}
          />
          <label htmlFor="nombre_comercial">Nombre comercial</label>
          <input
            id="nombre_comercial"
            required
            value={nombreComercial}
            onChange={(event) => setNombreComercial(event.target.value)}
            data-testid={TESTID_NEW_TENANT_NOMBRE_COMERCIAL}
          />
          {createError && <p className="error-text">{createError}</p>}
          <button type="submit" disabled={creating} data-testid={TESTID_NEW_TENANT_SUBMIT}>
            {creating ? 'Creando…' : 'Crear tenant'}
          </button>
        </form>
      </section>

      {loading && <p>Cargando…</p>}
      {loadError && <p className="error-text">{loadError}</p>}

      {!loading && !loadError && (
        <table className="table" data-testid={TESTID_TENANTS_TABLE}>
          <thead>
            <tr>
              <th>RUC</th>
              <th>Razón social</th>
              <th>Nombre comercial</th>
              <th>Estado</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant) => (
              <tr key={tenant._id}>
                <td>{tenant.ruc}</td>
                <td>{tenant.razon_social}</td>
                <td>{tenant.nombre_comercial}</td>
                <td>
                  <span className={tenant.active ? 'badge badge--active' : 'badge badge--inactive'}>
                    {tenant.active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td>
                  <Link to={`/admin/tenants/${tenant._id}`}>Ver detalle</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
};
