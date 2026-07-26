import { IPDFStorageProvider } from '../../interfaces/pdf-storage.interface';
import { CloudinaryPDFStorage } from './cloudinary.storage';
import { LocalPDFStorage } from './local.storage';
import { S3PDFStorage } from './s3.storage';

/**
 * Tipos de proveedores de almacenamiento soportados
 */
export type StorageProviderType = 'cloudinary' | 'local' | 's3' | 'azure';

/**
 * Factory para crear instancias de proveedores de almacenamiento de PDFs
 *
 * Este factory implementa el patrón Factory Method y permite
 * la creación dinámica de proveedores de almacenamiento basándose
 * en la configuración del entorno.
 *
 * Configuración:
 * - PDF_STORAGE_PROVIDER: Tipo de proveedor (cloudinary, local, s3, azure)
 *   Default: 'local'
 *
 * Ejemplos de uso:
 *
 * // Obtener el proveedor configurado en las variables de entorno
 * const storage = PDFStorageFactory.create();
 *
 * // Crear un proveedor específico
 * const cloudinaryStorage = PDFStorageFactory.create('cloudinary');
 *
 * // Subir un PDF
 * const result = await storage.upload(pdfBuffer, 'factura_001');
 */
export class PDFStorageFactory {
  private static instance: IPDFStorageProvider | null = null;

  /**
   * Crea o retorna una instancia del proveedor de almacenamiento
   * Implementa el patrón Singleton para reutilizar la misma instancia
   *
   * @param providerType Tipo de proveedor (opcional, usa la variable de entorno si no se especifica)
   * @param forceFresh Si es true, crea una nueva instancia en lugar de usar el singleton
   * @returns Instancia del proveedor de almacenamiento
   */
  static create(providerType?: StorageProviderType, forceFresh: boolean = false): IPDFStorageProvider {
    // Si no se especifica un tipo, usar la variable de entorno
    const type = providerType || (process.env.PDF_STORAGE_PROVIDER as StorageProviderType) || 'local';

    // Si ya existe una instancia y no se requiere una nueva, retornarla
    if (!forceFresh && this.instance && this.instance.getProviderName() === type) {
      return this.instance;
    }

    // Crear nueva instancia según el tipo
    let provider: IPDFStorageProvider;

    switch (type) {
      case 'cloudinary':
        console.log('🌥️  Usando proveedor de almacenamiento: Cloudinary');
        provider = new CloudinaryPDFStorage();
        break;

      case 'local':
        console.log('💾 Usando proveedor de almacenamiento: Local');
        provider = new LocalPDFStorage();
        break;

      case 's3':
        console.log('☁️  Usando proveedor de almacenamiento: S3');
        provider = new S3PDFStorage();
        break;

      case 'azure':
        console.log('⚠️  Azure no está implementado aún, usando almacenamiento local');
        // TODO: Implementar AzurePDFStorage cuando sea necesario
        // provider = new AzurePDFStorage();
        provider = new LocalPDFStorage();
        break;

      default:
        console.log(`⚠️  Proveedor desconocido: ${type}, usando almacenamiento local`);
        provider = new LocalPDFStorage();
    }

    // Guardar la instancia para reutilizarla
    this.instance = provider;

    return provider;
  }

  /**
   * Obtiene el tipo de proveedor configurado actualmente
   */
  static getConfiguredProviderType(): StorageProviderType {
    return (process.env.PDF_STORAGE_PROVIDER as StorageProviderType) || 'local';
  }

  /**
   * Verifica si un tipo de proveedor está soportado
   */
  static isProviderSupported(providerType: string): boolean {
    const supportedProviders: readonly StorageProviderType[] = ['cloudinary', 'local', 's3'];
    // 'azure' está en el tipo pero no implementado
    return supportedProviders.some((supported) => supported === providerType);
  }

  /**
   * Lista todos los proveedores disponibles
   */
  static getAvailableProviders(): { type: StorageProviderType; implemented: boolean; description: string }[] {
    return [
      {
        type: 'cloudinary',
        implemented: true,
        description: 'Almacenamiento en Cloudinary (servicio en la nube)',
      },
      {
        type: 'local',
        implemented: true,
        description: 'Almacenamiento local en el servidor',
      },
      {
        type: 's3',
        implemented: true,
        description: 'Amazon S3 (bucket privado, URLs de descarga presignadas)',
      },
      {
        type: 'azure',
        implemented: false,
        description: 'Azure Blob Storage (no implementado)',
      },
    ];
  }

  /**
   * Reinicia el singleton (útil para pruebas)
   */
  static reset(): void {
    this.instance = null;
  }
}
