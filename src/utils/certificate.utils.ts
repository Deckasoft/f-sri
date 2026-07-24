import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import forge from 'node-forge';
import { decrypt } from './encryption.utils';

/**
 * Shape of the fields needed to materialize a company's P12 certificate.
 * Deliberately narrow (not the full IssuingCompany document) so callers only
 * need to select the two encrypted-at-rest fields.
 */
export interface CompanyCertificate {
  certificate?: string;
  certificate_password?: string;
}

/**
 * Verifica, en un único intento, si una contraseña abre un archivo P12.
 * No prueba contraseñas alternativas: un certificado con contraseña
 * incorrecta debe fallar de forma explícita, nunca resolverse probando una
 * lista de contraseñas comunes.
 */
export const verifyP12Password = async (
  p12Path: string,
  password: string,
): Promise<{ valid: boolean; error?: string }> => {
  try {
    const p12Buffer = fs.readFileSync(p12Path);
    const p12Base64 = p12Buffer.toString('base64');
    const p12Der = forge.util.decode64(p12Base64);
    const p12Asn1 = forge.asn1.fromDer(p12Der);

    try {
      forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : 'Error desconocido' };
    }
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Error desconocido' };
  }
};

/**
 * Materializa el certificado P12 de una empresa (cifrado en reposo) en un
 * archivo temporal de vida corta, ejecuta `fn` con la ruta y la contraseña
 * descifradas, y garantiza que el archivo se elimine al terminar, tanto si
 * `fn` tiene éxito como si lanza un error.
 *
 * El nombre del archivo usa crypto.randomUUID() (no predecible) y se crea
 * con permisos 0o600 (solo el usuario propietario del proceso puede leerlo).
 *
 * Debe invocarse dentro del envío asíncrono al SRI (procesarEnvioSRI), justo
 * antes de firmar, y no al buscar la empresa emisora: ese flujo corre
 * desacoplado de la petición HTTP original, así que el archivo temporal no
 * debe existir más tiempo del estrictamente necesario para firmar.
 */
export const withCompanyP12 = async <T>(
  company: CompanyCertificate,
  fn: (p12Path: string, password: string) => Promise<T>,
): Promise<T> => {
  if (!company.certificate || !company.certificate_password) {
    throw new Error('La empresa no tiene certificado digital configurado');
  }

  const certificateBase64 = decrypt(company.certificate);
  const password = decrypt(company.certificate_password);
  const p12Buffer = Buffer.from(certificateBase64, 'base64');

  if (p12Buffer.length === 0) {
    throw new Error('El certificado está vacío');
  }

  const p12Path = path.join(os.tmpdir(), `${crypto.randomUUID()}.p12`);
  fs.writeFileSync(p12Path, p12Buffer, { mode: 0o600 });

  try {
    return await fn(p12Path, password);
  } finally {
    await fs.promises.unlink(p12Path).catch(() => undefined);
  }
};
