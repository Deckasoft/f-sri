import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { completeOnboarding, getInvitePreview } from '../api/onboardingApi';
import { ApiError } from '../api/client';
import type { InvitePreview, OnboardingCompleteResponse } from '../api/types';
import { ShowOnceSecret } from '../components/ShowOnceSecret';
import {
  TESTID_ONBOARDING_EMAIL_INPUT,
  TESTID_ONBOARDING_FILE_INPUT,
  TESTID_ONBOARDING_KEY_UNCHANGED,
  TESTID_ONBOARDING_PASSWORD_INPUT,
  TESTID_ONBOARDING_SUBMIT,
} from '../testIds';

/**
 * Reads a .p12 file and resolves its bare base64 payload — the onboarding
 * API (`POST /onboarding/api/complete`) expects base64 in a JSON body, not a
 * multipart upload, so the certificate must be encoded client-side before
 * the request is sent.
 */
const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('No se pudo leer el archivo'));
        return;
      }
      // readAsDataURL yields "data:<mime>;base64,<payload>" — keep only the
      // payload after the first comma.
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });

export const OnboardingPage = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<OnboardingCompleteResponse | null>(null);

  useEffect(() => {
    if (!token) {
      setPreviewError('Falta el token de invitación en el enlace');
      return;
    }
    getInvitePreview(token)
      .then(setPreview)
      .catch((err: unknown) =>
        setPreviewError(err instanceof ApiError ? err.message : 'No se pudo validar la invitación'),
      );
  }, [token]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setFile(event.target.files?.[0] ?? null);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!file) {
      setSubmitError('Selecciona tu certificado .p12');
      return;
    }
    setSubmitError(null);
    setSubmitting(true);

    readFileAsBase64(file)
      .then((certificateBase64) =>
        completeOnboarding({
          token,
          certificateBase64,
          certificatePassword: password,
          contactEmail: contactEmail || undefined,
        }),
      )
      .then(setResult)
      .catch((err: unknown) =>
        setSubmitError(err instanceof ApiError ? err.message : 'No se pudo completar el registro'),
      )
      .finally(() => setSubmitting(false));
  };

  if (result) {
    return (
      <main className="centered-page">
        <div className="card">
          {/* Dos casos por el mismo flujo: alta inicial (se emite una API key,
              que sólo se muestra aquí y nunca más) y renovación de certificado
              (no se emite ninguna, porque el tenant ya tiene una activa). Sin
              distinguirlos, quien renueva vería un recuadro de "tu clave de
              API" vacío y creería que debe redesplegar su integración. */}
          <h1>{result.api_key_issued ? 'Registro completado' : 'Certificado actualizado'}</h1>
          <p>
            {result.company.razon_social} ({result.company.ruc}) ya puede emitir comprobantes.
          </p>
          {result.api_key_issued && result.api_key ? (
            <ShowOnceSecret
              title="Tu clave de API"
              description="Úsala como Bearer token contra /api/v1."
              value={result.api_key}
            />
          ) : (
            <p data-testid={TESTID_ONBOARDING_KEY_UNCHANGED}>
              Tu clave de API existente sigue funcionando: no hace falta cambiar nada en tu
              integración.
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="centered-page">
      <div className="card">
        <h1>Completa tu registro</h1>
        {previewError && <p className="error-text">{previewError}</p>}
        {!previewError && !preview && <p>Validando invitación…</p>}
        {preview && !preview.valid && (
          <p className="error-text">
            Esta invitación ya no es válida ({preview.reason}). Contacta a soporte para obtener una
            nueva.
          </p>
        )}
        {preview && preview.valid && (
          <>
            <p>
              Empresa: <strong>{preview.company.razon_social}</strong> (
              {preview.company.nombre_comercial})
            </p>
            <p>RUC: {preview.company.ruc}</p>
            <form onSubmit={handleSubmit} className="form-grid">
              <label htmlFor="certificate">Certificado (.p12)</label>
              <input
                id="certificate"
                type="file"
                accept=".p12,.pfx"
                required
                onChange={handleFileChange}
                data-testid={TESTID_ONBOARDING_FILE_INPUT}
              />
              <label htmlFor="certificate_password">Contraseña del certificado</label>
              <input
                id="certificate_password"
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                data-testid={TESTID_ONBOARDING_PASSWORD_INPUT}
              />
              <label htmlFor="contact_email">Email de contacto (opcional)</label>
              <input
                id="contact_email"
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                data-testid={TESTID_ONBOARDING_EMAIL_INPUT}
              />
              {submitError && <p className="error-text">{submitError}</p>}
              <button type="submit" disabled={submitting} data-testid={TESTID_ONBOARDING_SUBMIT}>
                {submitting ? 'Enviando…' : 'Completar registro'}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
};
