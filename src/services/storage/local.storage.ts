import fs from 'fs';
import path from 'path';
import { IPDFStorageProvider, PDFStorageResponse } from '../../interfaces/pdf-storage.interface';

/**
 * Implementación de almacenamiento local de PDFs
 *
 * Esta implementación guarda los PDFs en el sistema de archivos local.
 * Es útil para desarrollo, pruebas o cuando no se desea usar un servicio externo.
 *
 * Configuración:
 * - PDF_STORAGE_PATH: Ruta donde se guardarán los PDFs (default: ./storage/pdfs)
 * - PDF_BASE_URL: URL base para acceder a los PDFs (default: http://localhost:3000/pdfs)
 */
export class LocalPDFStorage implements IPDFStorageProvider {
  private storagePath: string;
  private baseUrl: string;

  constructor() {
    // Directorio donde se guardarán los PDFs
    this.storagePath = process.env.PDF_STORAGE_PATH || path.join(process.cwd(), 'storage', 'pdfs');

    // URL base para acceder a los PDFs
    this.baseUrl = process.env.PDF_BASE_URL || 'http://localhost:3000/pdfs';

    // Crear el directorio si no existe
    this.ensureStorageDirectory();
  }

  /**
   * Asegura que el directorio de almacenamiento existe
   */
  private ensureStorageDirectory(): void {
    try {
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
        console.log(`✅ Directorio de almacenamiento creado: ${this.storagePath}`);
      }
    } catch (error) {
      console.error('❌ Error creando directorio de almacenamiento:', error);
      throw new Error(`No se pudo crear el directorio de almacenamiento: ${(error as Error).message}`);
    }
  }

  /**
   * Sube (guarda) un PDF en el sistema de archivos local
   */
  async upload(pdfBuffer: Buffer, filename: string): Promise<PDFStorageResponse> {
    try {
      console.log(`💾 Guardando PDF localmente: ${filename}`);

      // Limpiar el filename para evitar problemas de seguridad
      const sanitizedFilename = this.sanitizeFilename(filename);
      const fullFilename = `${sanitizedFilename}.pdf`;
      const filePath = path.join(this.storagePath, fullFilename);

      // Guardar el archivo
      fs.writeFileSync(filePath, pdfBuffer);

      console.log(`✅ PDF guardado exitosamente en: ${filePath}`);

      return {
        url: `${this.baseUrl}/${fullFilename}`,
        publicId: sanitizedFilename,
        size: pdfBuffer.length,
        provider: 'local',
      };
    } catch (error) {
      console.error('❌ Error en LocalPDFStorage.upload:', error);
      throw new Error(`Error guardando PDF localmente: ${(error as Error).message}`);
    }
  }

  /**
   * Elimina un PDF del sistema de archivos local
   */
  async delete(publicId: string): Promise<boolean> {
    try {
      console.log(`🗑️  Eliminando PDF local: ${publicId}`);

      const sanitizedId = this.sanitizeFilename(publicId);
      const filePath = path.join(this.storagePath, `${sanitizedId}.pdf`);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log('✅ PDF eliminado exitosamente');
        return true;
      } else {
        console.log('⚠️  El archivo no existe:', filePath);
        return false;
      }
    } catch (error) {
      console.error('❌ Error eliminando PDF local:', error);
      return false;
    }
  }

  /**
   * Obtiene la URL pública de un PDF
   *
   * No forma parte de IPDFStorageProvider (ese contrato solo expone
   * getDownloadUrl, async, para poder soportar URLs presignadas en S3). Se
   * conserva como método propio de esta clase por compatibilidad con el uso
   * existente y las pruebas directas sobre LocalPDFStorage.
   */
  getPublicUrl(publicId: string): string {
    const sanitizedId = this.sanitizeFilename(publicId);
    return `${this.baseUrl}/${sanitizedId}.pdf`;
  }

  /**
   * Obtiene una URL de descarga para el PDF. En almacenamiento local esto es
   * simplemente la URL pública — no hay nada que presignar ni que expire.
   */
  async getDownloadUrl(publicId: string): Promise<string> {
    return this.getPublicUrl(publicId);
  }

  /**
   * Lee los bytes del PDF almacenado localmente
   */
  async getFileBuffer(publicId: string): Promise<Buffer> {
    const sanitizedId = this.sanitizeFilename(publicId);
    const filePath = path.join(this.storagePath, `${sanitizedId}.pdf`);

    try {
      return fs.readFileSync(filePath);
    } catch (error) {
      throw new Error(`Error leyendo PDF local: ${(error as Error).message}`);
    }
  }

  /**
   * Retorna el nombre del proveedor
   */
  getProviderName(): string {
    return 'local';
  }

  /**
   * Sanitiza el nombre de archivo para evitar problemas de seguridad
   */
  private sanitizeFilename(filename: string): string {
    // Remover extensión .pdf si existe
    let sanitized = filename.replace(/\.pdf$/i, '');

    // Remover caracteres peligrosos
    sanitized = sanitized.replace(/[^a-zA-Z0-9_\-]/g, '_');

    return sanitized;
  }

  /**
   * Obtiene información del archivo almacenado
   */
  getFileInfo(publicId: string): { exists: boolean; size?: number; path?: string } {
    try {
      const sanitizedId = this.sanitizeFilename(publicId);
      const filePath = path.join(this.storagePath, `${sanitizedId}.pdf`);

      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        return {
          exists: true,
          size: stats.size,
          path: filePath,
        };
      }

      return { exists: false };
    } catch (error) {
      console.error('Error obteniendo información del archivo:', error);
      return { exists: false };
    }
  }
}
