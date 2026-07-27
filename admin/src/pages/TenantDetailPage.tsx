import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  createApiKey,
  createInvite,
  deleteInvite,
  getTenant,
  getTenantSequences,
  getTenantUsage,
  listApiKeys,
  listInvites,
  revokeApiKey,
  seedTenantSequence,
  setTenantActive,
  updateTenant,
} from '../api/adminApi';
import { ApiError } from '../api/client';
import type {
  ApiKeyItem,
  InviteItem,
  Tenant,
  TenantProfileInput,
  TenantSequences,
  UsageRow,
} from '../api/types';
import { ShowOnceSecret } from '../components/ShowOnceSecret';
import { useAuth } from '../context/useAuth';
import {
  TESTID_API_KEY_CREATE_BUTTON,
  TESTID_API_KEY_LIST,
  TESTID_API_KEY_NAME_INPUT,
  TESTID_API_KEY_REVOKE_BUTTON,
  TESTID_INVITE_CREATE_BUTTON,
  TESTID_INVITE_DELETE_BUTTON,
  TESTID_INVITE_LIST,
  TESTID_SEQUENCE_INPUT,
  TESTID_SEQUENCE_ROW,
  TESTID_SEQUENCE_SAVE,
  TESTID_SEQUENCE_UNSEEDED_WARNING,
  TESTID_TENANT_ACTIVE_TOGGLE,
  TESTID_TENANT_PROFILE_FORM,
  TESTID_TENANT_PROFILE_SAVE,
} from '../testIds';

const toProfileInput = (tenant: Tenant): TenantProfileInput => ({
  razon_social: tenant.razon_social,
  nombre_comercial: tenant.nombre_comercial,
  direccion: tenant.direccion ?? '',
  direccion_matriz: tenant.direccion_matriz ?? '',
  direccion_establecimiento: tenant.direccion_establecimiento ?? '',
  telefono: tenant.telefono ?? '',
  email: tenant.email ?? '',
  codigo_establecimiento: tenant.codigo_establecimiento,
  punto_emision: tenant.punto_emision,
  tipo_ambiente: tenant.tipo_ambiente,
  obligado_contabilidad: tenant.obligado_contabilidad ?? false,
  contribuyente_especial: tenant.contribuyente_especial ?? '',
  email_notificacion: tenant.email_notificacion ?? '',
});

interface RevealedApiKey {
  name: string;
  token: string;
}

interface RevealedInvite {
  url: string;
  expiresAt: string;
}

export const TenantDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const { auth } = useAuth();
  const token = auth?.token ?? '';

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [profile, setProfile] = useState<TenantProfileInput | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [togglingActive, setTogglingActive] = useState(false);

  const [newKeyName, setNewKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [revealedApiKey, setRevealedApiKey] = useState<RevealedApiKey | null>(null);

  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [revealedInvite, setRevealedInvite] = useState<RevealedInvite | null>(null);

  const [usageError, setUsageError] = useState<string | null>(null);

  const [sequences, setSequences] = useState<TenantSequences | null>(null);
  const [sequenceDrafts, setSequenceDrafts] = useState<Record<string, string>>({});
  const [savingSequence, setSavingSequence] = useState<string | null>(null);
  const [sequenceError, setSequenceError] = useState<string | null>(null);
  const [sequenceNotice, setSequenceNotice] = useState<string | null>(null);

  // `isStale` is checked before every setState below: navigating between
  // tenants (id changes) re-runs this effect, and without the check a
  // slower response for the PREVIOUS tenant could resolve after a faster
  // response for the new one and overwrite it with the wrong tenant's data.
  const load = useCallback(
    (tenantId: string, isStale: () => boolean): void => {
      getTenant(token, tenantId)
        .then((data) => {
          if (isStale()) return;
          setTenant(data);
          setProfile(toProfileInput(data));
        })
        .catch((err: unknown) => {
          if (isStale()) return;
          setLoadError(err instanceof ApiError ? err.message : 'Error al cargar el tenant');
        });

      listApiKeys(token, tenantId)
        .then((data) => {
          if (isStale()) return;
          setApiKeys(data);
          setKeyError(null);
        })
        .catch((err: unknown) => {
          if (isStale()) return;
          setKeyError(
            err instanceof ApiError ? err.message : 'No se pudieron cargar las claves de API',
          );
        });

      listInvites(token, tenantId)
        .then((data) => {
          if (isStale()) return;
          setInvites(data);
          setInviteError(null);
        })
        .catch((err: unknown) => {
          if (isStale()) return;
          setInviteError(
            err instanceof ApiError ? err.message : 'No se pudieron cargar las invitaciones',
          );
        });

      getTenantUsage(token, tenantId)
        .then((data) => {
          if (isStale()) return;
          setUsage(data);
          setUsageError(null);
        })
        .catch((err: unknown) => {
          if (isStale()) return;
          setUsageError(err instanceof ApiError ? err.message : 'No se pudo cargar el uso');
        });

      getTenantSequences(token, tenantId)
        .then((data) => {
          if (isStale()) return;
          setSequences(data);
          // Drafts start from the stored values so an operator editing one
          // row cannot accidentally re-submit a stale number in another.
          setSequenceDrafts(
            Object.fromEntries(
              data.secuenciales.map((s) => [s.document_type, String(s.ultimo_secuencial)]),
            ),
          );
          setSequenceError(null);
        })
        .catch((err: unknown) => {
          if (isStale()) return;
          setSequenceError(
            err instanceof ApiError ? err.message : 'No se pudieron cargar los secuenciales',
          );
        });
    },
    [token],
  );

  useEffect(() => {
    if (!id) {
      return;
    }
    let stale = false;
    load(id, () => stale);
    return () => {
      stale = true;
    };
  }, [id, load]);

  if (!id) {
    return <p className="error-text">Tenant no encontrado</p>;
  }

  const handleToggleActive = (): void => {
    if (!tenant) {
      return;
    }
    setTogglingActive(true);
    setTenantActive(token, id, !tenant.active)
      .then(setTenant)
      .catch((err: unknown) =>
        setLoadError(err instanceof ApiError ? err.message : 'No se pudo cambiar el estado'),
      )
      .finally(() => setTogglingActive(false));
  };

  const handleSeedSequence = (documentType: string): void => {
    const raw = (sequenceDrafts[documentType] ?? '').trim();
    const value = Number(raw);
    if (raw === '' || !Number.isInteger(value) || value < 0) {
      setSequenceError('El último secuencial debe ser un número entero de 0 o más');
      return;
    }

    setSequenceError(null);
    setSequenceNotice(null);
    setSavingSequence(documentType);
    seedTenantSequence(token, id, documentType, value)
      .then((result) => {
        setSequences((prev) =>
          prev
            ? {
                ...prev,
                secuenciales: prev.secuenciales.map((s) =>
                  s.document_type === documentType
                    ? { ...s, ultimo_secuencial: result.ultimo_secuencial, existe: true }
                    : s,
                ),
              }
            : prev,
        );
        setSequenceNotice(
          result.actualizado
            ? `Guardado. El próximo comprobante será ${result.proximo_secuencial}.`
            : `Sin cambios: ya estaba en ${result.ultimo_secuencial}.`,
        );
      })
      .catch((err: unknown) =>
        // A 409 here is the raise-only rule refusing to lower the counter;
        // the API's message explains why, so surface it verbatim.
        setSequenceError(
          err instanceof ApiError ? err.message : 'No se pudo guardar el secuencial',
        ),
      )
      .finally(() => setSavingSequence(null));
  };

  const handleSaveProfile = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!profile) {
      return;
    }
    setProfileError(null);
    setSavingProfile(true);
    updateTenant(token, id, profile)
      .then((data) => {
        setTenant(data);
        setProfile(toProfileInput(data));
      })
      .catch((err: unknown) =>
        setProfileError(err instanceof ApiError ? err.message : 'No se pudo guardar el perfil'),
      )
      .finally(() => setSavingProfile(false));
  };

  const handleCreateApiKey = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setKeyError(null);
    setCreatingKey(true);
    createApiKey(token, id, newKeyName)
      .then((created) => {
        setRevealedApiKey({ name: created.name, token: created.token });
        setNewKeyName('');
        return listApiKeys(token, id).then(setApiKeys);
      })
      .catch((err: unknown) =>
        setKeyError(err instanceof ApiError ? err.message : 'No se pudo crear la clave'),
      )
      .finally(() => setCreatingKey(false));
  };

  const handleRevokeApiKey = (keyId: string): void => {
    revokeApiKey(token, id, keyId)
      .then(() => listApiKeys(token, id))
      .then(setApiKeys)
      .catch((err: unknown) =>
        setKeyError(err instanceof ApiError ? err.message : 'No se pudo revocar la clave'),
      );
  };

  const handleCreateInvite = (): void => {
    setInviteError(null);
    setCreatingInvite(true);
    createInvite(token, id)
      .then((created) => {
        setRevealedInvite({ url: created.onboarding_url, expiresAt: created.expires_at });
        return listInvites(token, id).then(setInvites);
      })
      .catch((err: unknown) =>
        setInviteError(err instanceof ApiError ? err.message : 'No se pudo crear la invitación'),
      )
      .finally(() => setCreatingInvite(false));
  };

  const handleDeleteInvite = (inviteId: string): void => {
    deleteInvite(token, id, inviteId)
      .then(() => listInvites(token, id))
      .then(setInvites)
      .catch((err: unknown) =>
        setInviteError(err instanceof ApiError ? err.message : 'No se pudo eliminar la invitación'),
      );
  };

  return (
    <main className="page">
      {loadError && <p className="error-text">{loadError}</p>}

      {tenant && profile ? (
        <>
          <header className="page__header">
            <h1>{tenant.razon_social}</h1>
            <button
              type="button"
              onClick={handleToggleActive}
              disabled={togglingActive}
              data-testid={TESTID_TENANT_ACTIVE_TOGGLE}
            >
              {tenant.active ? 'Desactivar acceso' : 'Activar acceso'}
            </button>
          </header>
          <p>
            RUC: {tenant.ruc} · Estado:{' '}
            <span className={tenant.active ? 'badge badge--active' : 'badge badge--inactive'}>
              {tenant.active ? 'Activo' : 'Inactivo'}
            </span>
          </p>

          <section className="card">
            <h2>Perfil</h2>
            <form
              onSubmit={handleSaveProfile}
              data-testid={TESTID_TENANT_PROFILE_FORM}
              className="form-grid"
            >
              <label htmlFor="razon_social">Razón social</label>
              <input
                id="razon_social"
                required
                value={profile.razon_social}
                onChange={(event) => setProfile({ ...profile, razon_social: event.target.value })}
              />
              <label htmlFor="nombre_comercial">Nombre comercial</label>
              <input
                id="nombre_comercial"
                required
                value={profile.nombre_comercial}
                onChange={(event) =>
                  setProfile({ ...profile, nombre_comercial: event.target.value })
                }
              />
              <label htmlFor="direccion">Dirección</label>
              <input
                id="direccion"
                value={profile.direccion ?? ''}
                onChange={(event) => setProfile({ ...profile, direccion: event.target.value })}
              />
              <label htmlFor="telefono">Teléfono</label>
              <input
                id="telefono"
                value={profile.telefono ?? ''}
                onChange={(event) => setProfile({ ...profile, telefono: event.target.value })}
              />
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={profile.email ?? ''}
                onChange={(event) => setProfile({ ...profile, email: event.target.value })}
              />
              <label htmlFor="email_notificacion">Email de notificación</label>
              <input
                id="email_notificacion"
                type="email"
                value={profile.email_notificacion ?? ''}
                onChange={(event) =>
                  setProfile({ ...profile, email_notificacion: event.target.value })
                }
              />
              <label htmlFor="codigo_establecimiento">Código establecimiento</label>
              <input
                id="codigo_establecimiento"
                value={profile.codigo_establecimiento ?? ''}
                onChange={(event) =>
                  setProfile({ ...profile, codigo_establecimiento: event.target.value })
                }
              />
              <label htmlFor="punto_emision">Punto de emisión</label>
              <input
                id="punto_emision"
                value={profile.punto_emision ?? ''}
                onChange={(event) => setProfile({ ...profile, punto_emision: event.target.value })}
              />
              <label htmlFor="tipo_ambiente">Ambiente</label>
              <select
                id="tipo_ambiente"
                value={profile.tipo_ambiente ?? 1}
                onChange={(event) =>
                  setProfile({ ...profile, tipo_ambiente: event.target.value === '2' ? 2 : 1 })
                }
              >
                <option value={1}>Pruebas</option>
                <option value={2}>Producción</option>
              </select>
              <label htmlFor="contribuyente_especial">Contribuyente especial</label>
              <input
                id="contribuyente_especial"
                value={profile.contribuyente_especial ?? ''}
                onChange={(event) =>
                  setProfile({ ...profile, contribuyente_especial: event.target.value })
                }
              />
              <label htmlFor="obligado_contabilidad">Obligado a llevar contabilidad</label>
              <input
                id="obligado_contabilidad"
                type="checkbox"
                checked={profile.obligado_contabilidad ?? false}
                onChange={(event) =>
                  setProfile({ ...profile, obligado_contabilidad: event.target.checked })
                }
              />
              {profileError && <p className="error-text">{profileError}</p>}
              <button
                type="submit"
                disabled={savingProfile}
                data-testid={TESTID_TENANT_PROFILE_SAVE}
              >
                {savingProfile ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </form>
          </section>

          <section className="card">
            <h2>Secuenciales</h2>
            {sequences && (
              <>
                <p className="hint-text">
                  Serie {sequences.serie.tipo_ambiente === 1 ? 'Pruebas' : 'Producción'} ·{' '}
                  {sequences.serie.codigo_establecimiento}-{sequences.serie.punto_emision}. Indica
                  el <strong>último</strong> secuencial que el cliente ya emitió en su sistema
                  anterior; el siguiente comprobante usará ese número más uno. Solo se puede
                  aumentar: bajarlo genera claves de acceso duplicadas que el SRI rechaza.
                </p>
                {apiKeys.some((key) => !key.revoked_at) &&
                  sequences.secuenciales.some((s) => !s.existe) && (
                    <p className="error-text" data-testid={TESTID_SEQUENCE_UNSEEDED_WARNING}>
                      Este tenant ya puede emitir (tiene una clave de API activa) pero hay
                      secuenciales sin configurar. Los que falten empezarán en 000000001.
                    </p>
                  )}
                <table>
                  <thead>
                    <tr>
                      <th>Comprobante</th>
                      <th>Último secuencial emitido</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sequences.secuenciales.map((row) => (
                      <tr
                        key={row.document_type}
                        data-testid={`${TESTID_SEQUENCE_ROW}-${row.document_type}`}
                      >
                        <td>
                          {row.label} ({row.document_type})
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            aria-label={`Último secuencial emitido de ${row.label}`}
                            data-testid={`${TESTID_SEQUENCE_INPUT}-${row.document_type}`}
                            value={sequenceDrafts[row.document_type] ?? ''}
                            onChange={(event) =>
                              setSequenceDrafts({
                                ...sequenceDrafts,
                                [row.document_type]: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            disabled={savingSequence === row.document_type}
                            data-testid={`${TESTID_SEQUENCE_SAVE}-${row.document_type}`}
                            onClick={() => handleSeedSequence(row.document_type)}
                          >
                            {savingSequence === row.document_type ? 'Guardando…' : 'Guardar'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sequences.otras_series.length > 0 && (
                  <>
                    <h3>Otras series</h3>
                    <p className="hint-text">
                      Contadores de series en las que este tenant ya no emite — normalmente su
                      numeración de pruebas tras pasar a producción. Se conservan intactos.
                    </p>
                    <ul>
                      {sequences.otras_series.map((other) => (
                        <li
                          key={`${other.tipo_ambiente}-${other.codigo_establecimiento}-${other.punto_emision}-${other.document_type}`}
                        >
                          {other.tipo_ambiente === 1 ? 'Pruebas' : 'Producción'} ·{' '}
                          {other.codigo_establecimiento}-{other.punto_emision} ·{' '}
                          {other.document_type}: {other.ultimo_secuencial}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
            {sequenceNotice && <p className="hint-text">{sequenceNotice}</p>}
            {sequenceError && <p className="error-text">{sequenceError}</p>}
          </section>

          <section className="card">
            <h2>Claves de API</h2>
            {revealedApiKey && (
              <ShowOnceSecret
                title={`Clave "${revealedApiKey.name}" creada`}
                description="Úsala como Bearer token contra /api/v1."
                value={revealedApiKey.token}
                onDismiss={() => setRevealedApiKey(null)}
              />
            )}
            <form onSubmit={handleCreateApiKey} className="inline-form">
              <input
                placeholder="Nombre de la clave"
                required
                value={newKeyName}
                onChange={(event) => setNewKeyName(event.target.value)}
                data-testid={TESTID_API_KEY_NAME_INPUT}
              />
              <button
                type="submit"
                disabled={creatingKey}
                data-testid={TESTID_API_KEY_CREATE_BUTTON}
              >
                {creatingKey ? 'Creando…' : 'Crear clave'}
              </button>
            </form>
            {keyError && <p className="error-text">{keyError}</p>}
            <ul data-testid={TESTID_API_KEY_LIST} className="list">
              {apiKeys.map((key) => (
                <li key={key._id}>
                  <span>
                    {key.name} — {key.prefix}… {key.revoked_at ? '(revocada)' : ''}
                  </span>
                  {!key.revoked_at && (
                    <button
                      type="button"
                      onClick={() => handleRevokeApiKey(key._id)}
                      data-testid={TESTID_API_KEY_REVOKE_BUTTON}
                    >
                      Revocar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>Invitaciones</h2>
            {revealedInvite && (
              <ShowOnceSecret
                title="Invitación creada"
                description={`Comparte este enlace con el cliente. Expira: ${new Date(
                  revealedInvite.expiresAt,
                ).toLocaleString()}.`}
                value={revealedInvite.url}
                onDismiss={() => setRevealedInvite(null)}
              />
            )}
            <button
              type="button"
              onClick={handleCreateInvite}
              disabled={creatingInvite}
              data-testid={TESTID_INVITE_CREATE_BUTTON}
            >
              {creatingInvite ? 'Creando…' : 'Crear invitación'}
            </button>
            {inviteError && <p className="error-text">{inviteError}</p>}
            <ul data-testid={TESTID_INVITE_LIST} className="list">
              {invites.map((invite) => (
                <li key={invite._id}>
                  <span>
                    Expira: {new Date(invite.expires_at).toLocaleString()}{' '}
                    {invite.used_at ? '(usada)' : ''}
                  </span>
                  {!invite.used_at && (
                    <button
                      type="button"
                      onClick={() => handleDeleteInvite(invite._id)}
                      data-testid={TESTID_INVITE_DELETE_BUTTON}
                    >
                      Eliminar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>Uso</h2>
            {usageError ? (
              <p className="error-text">{usageError}</p>
            ) : usage.length === 0 ? (
              <p>Sin actividad registrada todavía.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Tipo de documento</th>
                    <th>Estado SRI</th>
                    <th>Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((row) => (
                    <tr key={`${row.document_type}-${row.sri_estado}`}>
                      <td>{row.document_type}</td>
                      <td>{row.sri_estado}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : (
        !loadError && <p>Cargando…</p>
      )}
    </main>
  );
};
