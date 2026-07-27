import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createTenant, listTenants } from '../api/adminApi';
import { ApiError } from '../api/client';
import type { Tenant } from '../api/types';
import { useAuth } from '../context/useAuth';
import {
  TESTID_NEW_TENANT_CODIGO_ESTABLECIMIENTO,
  TESTID_NEW_TENANT_FORM,
  TESTID_NEW_TENANT_NOMBRE_COMERCIAL,
  TESTID_NEW_TENANT_PUNTO_EMISION,
  TESTID_NEW_TENANT_RAZON_SOCIAL,
  TESTID_NEW_TENANT_RUC,
  TESTID_NEW_TENANT_SUBMIT,
  TESTID_NEW_TENANT_TIPO_AMBIENTE,
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
  // Collected at creation rather than left to the model defaults: together
  // these decide the numbering series every comprobante lands in, and a
  // tenant created with the wrong emission point has to be corrected before
  // it emits anything, not after.
  const [codigoEstablecimiento, setCodigoEstablecimiento] = useState('001');
  const [puntoEmision, setPuntoEmision] = useState('001');
  const [tipoAmbiente, setTipoAmbiente] = useState<1 | 2>(1);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadTenants = useCallback((): void => {
    setLoading(true);
    listTenants(token)
      .then(setTenants)
      .catch((err: unknown) =>
        setLoadError(err instanceof ApiError ? err.message : 'Error al cargar tenants'),
      )
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  const handleCreate = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setCreateError(null);
    setCreating(true);

    createTenant(token, {
      ruc,
      razon_social: razonSocial,
      nombre_comercial: nombreComercial,
      codigo_establecimiento: codigoEstablecimiento,
      punto_emision: puntoEmision,
      tipo_ambiente: tipoAmbiente,
    })
      .then(() => {
        setRuc('');
        setRazonSocial('');
        setNombreComercial('');
        setCodigoEstablecimiento('001');
        setPuntoEmision('001');
        setTipoAmbiente(1);
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
          <label htmlFor="codigo_establecimiento">Código establecimiento</label>
          <input
            id="codigo_establecimiento"
            required
            inputMode="numeric"
            pattern="\d{3}"
            title="Exactamente 3 dígitos, p. ej. 001"
            value={codigoEstablecimiento}
            onChange={(event) => setCodigoEstablecimiento(event.target.value)}
            data-testid={TESTID_NEW_TENANT_CODIGO_ESTABLECIMIENTO}
          />
          <label htmlFor="punto_emision">Punto de emisión</label>
          <input
            id="punto_emision"
            required
            inputMode="numeric"
            pattern="\d{3}"
            title="Exactamente 3 dígitos, p. ej. 001"
            value={puntoEmision}
            onChange={(event) => setPuntoEmision(event.target.value)}
            data-testid={TESTID_NEW_TENANT_PUNTO_EMISION}
          />
          <label htmlFor="tipo_ambiente">Ambiente</label>
          <select
            id="tipo_ambiente"
            value={tipoAmbiente}
            onChange={(event) => setTipoAmbiente(event.target.value === '2' ? 2 : 1)}
            data-testid={TESTID_NEW_TENANT_TIPO_AMBIENTE}
          >
            <option value={1}>Pruebas</option>
            <option value={2}>Producción</option>
          </select>
          <p className="hint-text">
            Tras crear el tenant, configura sus secuenciales en la ficha antes de emitir: si el
            cliente venía de otro sistema, su numeración no empieza en cero.
          </p>
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
