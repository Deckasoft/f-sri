/**
 * Respuesta del almacenamiento de PDF
 */
export interface PDFStorageResponse {
  /**
   * Localizador del PDF almacenado. Para proveedores públicos (Cloudinary,
   * almacenamiento local) es una URL pública lista para usar. Para S3 —
   * bucket privado por diseño, ya que un RIDE contiene datos tributarios del
   * contribuyente — es la clave del objeto (p. ej. `pdfs/{ruc}/{claveAcceso}.pdf`),
   * NO una URL. Usa `getDownloadUrl(publicId)` para obtener una URL utilizable
   * (pública o presignada, según el proveedor) en el momento en que se necesite.
   */
  url: string;
  /** Identificador único del archivo en el proveedor (clave/ID a usar en delete/getDownloadUrl/getFileBuffer) */
  publicId: string;
  /** Tamaño del archivo en bytes */
  size: number;
  /** Proveedor utilizado (cloudinary, local, s3, etc.) */
  provider: string;
}

/**
 * Interfaz para proveedores de almacenamiento de PDFs
 * Esta interfaz permite implementar diferentes proveedores de almacenamiento
 * manteniendo el principio de inversión de dependencias (SOLID)
 */
export interface IPDFStorageProvider {
  /**
   * Sube un PDF al proveedor de almacenamiento
   * @param pdfBuffer Buffer del PDF a subir
   * @param filename Nombre del archivo (sin extensión)
   * @returns Promise con la información del archivo almacenado
   */
  upload(pdfBuffer: Buffer, filename: string): Promise<PDFStorageResponse>;

  /**
   * Elimina un PDF del proveedor de almacenamiento
   * @param publicId Identificador único del archivo
   * @returns Promise<boolean> true si se eliminó correctamente
   */
  delete(publicId: string): Promise<boolean>;

  /**
   * Obtiene una URL utilizable para descargar el PDF, generada en el momento
   * en que se solicita. En proveedores con almacenamiento público
   * (Cloudinary, local) esto es simplemente la URL pública. En S3 esto
   * genera una URL presignada de corta duración (ver S3PDFStorage), ya que
   * el bucket es privado y las claves de objeto nunca deben exponerse como
   * URLs permanentes. El resultado NUNCA debe persistirse en base de datos
   * (expira) — solo debe usarse inmediatamente en la respuesta HTTP.
   * @param publicId Identificador único del archivo
   */
  getDownloadUrl(publicId: string): Promise<string>;

  /**
   * Obtiene los bytes crudos del PDF almacenado. Se usa, por ejemplo, para
   * adjuntar el PDF real a un email (el adjunto es el entregable; nunca se
   * debe depender de un enlace de descarga que puede expirar).
   * @param publicId Identificador único del archivo
   */
  getFileBuffer(publicId: string): Promise<Buffer>;

  /**
   * Obtiene el nombre del proveedor
   * @returns Nombre del proveedor (cloudinary, local, s3, etc.)
   */
  getProviderName(): string;
}
