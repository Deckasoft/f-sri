/**
 * Módulo de almacenamiento de PDFs
 *
 * Este módulo exporta todos los proveedores de almacenamiento y el factory
 * para facilitar su uso en otras partes de la aplicación.
 *
 * Ejemplo de uso:
 * ```typescript
 * import { PDFStorageFactory } from './services/storage';
 *
 * const storage = PDFStorageFactory.create();
 * const result = await storage.upload(pdfBuffer, 'factura_001');
 * ```
 */

export { IPDFStorageProvider, PDFStorageResponse } from '../../interfaces/pdf-storage.interface';
export { CloudinaryPDFStorage } from './cloudinary.storage';
export { LocalPDFStorage } from './local.storage';
export { S3PDFStorage } from './s3.storage';
export { PDFStorageFactory, StorageProviderType } from './storage.factory';
