import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { IPDFStorageProvider, PDFStorageResponse } from '../../interfaces/pdf-storage.interface';

/**
 * Implementación de almacenamiento de PDFs usando Amazon S3
 *
 * El bucket se asume PRIVADO: los RIDE contienen datos tributarios del
 * contribuyente (RUC, nombres, montos) y no deben ser accesibles
 * públicamente. Por eso:
 * - `upload` guarda el objeto con la clave `pdfs/{ruc}/{claveAcceso}.pdf` y
 *   NO devuelve una URL pública (el bucket no la tiene).
 * - `getDownloadUrl` genera una URL presignada de corta duración bajo
 *   demanda; nunca se debe persistir esa URL (expira).
 *
 * Configuración requerida (solo se valida al construir esta clase, no al
 * arrancar el proceso — ver src/config/env.config.ts para el razonamiento):
 * - AWS_ACCESS_KEY_ID
 * - AWS_SECRET_ACCESS_KEY
 * - AWS_REGION
 * - S3_BUCKET
 */

const CLAVE_ACCESO_LENGTH = 49;
const RUC_START_INDEX = 10;
const RUC_LENGTH = 13;
const PRESIGNED_URL_EXPIRY_SECONDS = 3600; // 1 hora

const claveAccesoPattern = new RegExp(`(\\d{${CLAVE_ACCESO_LENGTH}})$`);

/**
 * La clave de acceso del SRI (49 dígitos) siempre aparece al final del
 * `filename` que pasan los servicios de emisión (p. ej.
 * `factura_${secuencial}_${claveAcceso}`) y ella misma contiene el RUC del
 * emisor en las posiciones 11-23 (ver generarClaveAcceso en
 * src/utils/invoice.utils.ts). Esto permite derivar la clave del objeto S3
 * `pdfs/{ruc}/{claveAcceso}.pdf` sin cambiar la firma de `upload`.
 */
const extractClaveAcceso = (filename: string): string => {
  const match = filename.match(claveAccesoPattern);
  if (!match) {
    throw new Error(`No se pudo determinar la clave de acceso a partir del nombre de archivo: ${filename}`);
  }
  return match[1];
};

const buildObjectKey = (filename: string): string => {
  const claveAcceso = extractClaveAcceso(filename);
  const ruc = claveAcceso.substring(RUC_START_INDEX, RUC_START_INDEX + RUC_LENGTH);
  return `pdfs/${ruc}/${claveAcceso}.pdf`;
};

/**
 * Solo `region` y `bucket` son obligatorios aquí.
 *
 * Las credenciales las resuelve la cadena de proveedores por defecto del SDK
 * de AWS, que además de AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY contempla
 * AWS_SESSION_TOKEN, roles de instancia (EC2/ECS) e IAM Roles Anywhere. Si se
 * exigieran aquí, esos modos —en los que no existe ninguna variable de
 * entorno con la clave— quedarían descartados de entrada.
 */
const s3ConfigSchema = z.object({
  region: z.string().min(1, 'AWS_REGION no puede estar vacío'),
  bucket: z.string().min(1, 'S3_BUCKET no puede estar vacío'),
});

export class S3PDFStorage implements IPDFStorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const parsed = s3ConfigSchema.safeParse({
      region: process.env.AWS_REGION,
      bucket: process.env.S3_BUCKET,
    });

    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => issue.message).join('; ');
      throw new Error(`Configuración de S3 inválida: ${message}`);
    }

    this.bucket = parsed.data.bucket;
    // Sin bloque `credentials`: al omitirlo, el SDK usa su cadena de
    // proveedores por defecto. Antes se pasaban accessKeyId/secretAccessKey a
    // mano y NO se pasaba sessionToken, así que cualquier credencial temporal
    // (SSO, assume-role, cualquier llamada a STS) era rechazada por S3.
    //
    // La cadena además REFRESCA credenciales temporales por su cuenta. Este
    // cliente se construye una sola vez (PDFStorageFactory es un singleton),
    // de modo que con credenciales manuales y temporales el proceso empezaba
    // a devolver 403 horas después del despliegue y no se recuperaba hasta
    // reiniciar el contenedor.
    this.client = new S3Client({ region: parsed.data.region });
  }

  /**
   * Sube un PDF a S3 bajo la clave pdfs/{ruc}/{claveAcceso}.pdf
   */
  async upload(pdfBuffer: Buffer, filename: string): Promise<PDFStorageResponse> {
    const key = buildObjectKey(filename);

    try {
      console.log(`⬆️  Subiendo PDF a S3: ${key}`);

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
        }),
      );

      console.log(`✅ PDF subido exitosamente a S3: ${key}`);

      return {
        // La clave del objeto, NO una URL pública: el bucket es privado.
        url: key,
        publicId: key,
        size: pdfBuffer.length,
        provider: 's3',
      };
    } catch (error) {
      console.error('❌ Error en S3PDFStorage.upload:', error);
      throw new Error(`Error subiendo PDF a S3: ${(error as Error).message}`);
    }
  }

  /**
   * Elimina un PDF de S3
   */
  async delete(publicId: string): Promise<boolean> {
    try {
      console.log(`🗑️  Eliminando PDF de S3: ${publicId}`);

      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: publicId }));

      console.log('✅ PDF eliminado de S3 exitosamente');
      return true;
    } catch (error) {
      console.error('❌ Error eliminando PDF de S3:', error);
      return false;
    }
  }

  /**
   * Genera una URL presignada de descarga (GET), válida por ~1 hora. Se
   * genera bajo demanda y nunca debe persistirse — expira.
   */
  async getDownloadUrl(publicId: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: publicId });
    return getSignedUrl(this.client, command, { expiresIn: PRESIGNED_URL_EXPIRY_SECONDS });
  }

  /**
   * Descarga los bytes del PDF desde S3 (GetObject). Se usa para adjuntar el
   * PDF real a los emails en lugar de depender de un enlace.
   */
  async getFileBuffer(publicId: string): Promise<Buffer> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: publicId }));

      if (!response.Body) {
        throw new Error(`El objeto S3 no tiene contenido: ${publicId}`);
      }

      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error) {
      throw new Error(`Error descargando PDF de S3: ${(error as Error).message}`);
    }
  }

  /**
   * Retorna el nombre del proveedor
   */
  getProviderName(): string {
    return 's3';
  }
}
