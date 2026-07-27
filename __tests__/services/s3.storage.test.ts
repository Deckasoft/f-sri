// Mocks the AWS SDK v3 client + presigner entirely — no real S3 calls are
// made. Command classes just echo their input so assertions can inspect
// Bucket/Key/ContentType without depending on AWS SDK internals.
const sendMock = jest.fn();
const s3ClientConstructorMock = jest.fn();

class MockCommand {
  input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) {
    this.input = input;
  }
}

jest.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    constructor(config: unknown) {
      s3ClientConstructorMock(config);
    }
    send(...args: unknown[]) {
      return sendMock(...args);
    }
  }
  return {
    __esModule: true,
    S3Client: MockS3Client,
    PutObjectCommand: MockCommand,
    GetObjectCommand: MockCommand,
    DeleteObjectCommand: MockCommand,
  };
});

const getSignedUrlMock = jest.fn();
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  __esModule: true,
  getSignedUrl: (...args: unknown[]) => getSignedUrlMock(...args),
}));

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { S3PDFStorage } from '../../src/services/storage/s3.storage';

// 49-digit SRI access key; digits 11-23 (0-indexed 10-22) are the emisor's
// RUC (1790012345001), per generarClaveAcceso in src/utils/invoice.utils.ts.
const CLAVE_ACCESO = '1705202501179001234500110010010000000011234567810';
const RUC = '1790012345001';
const EXPECTED_KEY = `pdfs/${RUC}/${CLAVE_ACCESO}.pdf`;

describe('S3PDFStorage', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.AWS_REGION = 'us-east-1';
    process.env.S3_BUCKET = 'test-bucket';
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    // No `credentials` block: passing one explicitly meant no sessionToken
    // was ever sent, so temporary credentials (SSO, assume-role, any STS
    // call) were rejected by S3 outright, and the cached client could not
    // refresh them. Omitting it hands resolution to the SDK's default
    // provider chain, which also covers instance roles and IAM Roles
    // Anywhere.
    it('configures the S3 client with only the region, leaving credentials to the SDK provider chain', () => {
      new S3PDFStorage();

      expect(s3ClientConstructorMock).toHaveBeenCalledWith({ region: 'us-east-1' });
    });

    it.each(['AWS_REGION', 'S3_BUCKET'])(
      'throws a descriptive error when %s is missing (lazy validation, not process-boot)',
      (missingVar) => {
        delete process.env[missingVar];

        expect(() => new S3PDFStorage()).toThrow('Configuración de S3 inválida');
      },
    );

    // These are no longer required here on purpose — role-based credential
    // modes supply no such environment variables at all, and demanding them
    // would rule those modes out before the SDK ever gets a chance.
    it.each(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'])(
      'constructs without %s, leaving that to the provider chain',
      (optionalVar) => {
        delete process.env[optionalVar];

        expect(() => new S3PDFStorage()).not.toThrow();
      },
    );
  });

  describe('upload', () => {
    it('puts the object under pdfs/{ruc}/{claveAcceso}.pdf with ContentType application/pdf', async () => {
      sendMock.mockResolvedValueOnce({});
      const storage = new S3PDFStorage();
      const pdfBuffer = Buffer.from('pdf-bytes');

      const result = await storage.upload(pdfBuffer, `factura_1_${CLAVE_ACCESO}`);

      expect(sendMock).toHaveBeenCalledTimes(1);
      const putCommand = sendMock.mock.calls[0][0] as InstanceType<typeof PutObjectCommand>;
      expect(putCommand).toBeInstanceOf(PutObjectCommand);
      expect(putCommand.input).toEqual({
        Bucket: 'test-bucket',
        Key: EXPECTED_KEY,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
      });

      // The stored value is the S3 key, NEVER a public URL — the bucket is
      // private and RIDE PDFs carry taxpayer data.
      expect(result).toEqual({
        url: EXPECTED_KEY,
        publicId: EXPECTED_KEY,
        size: pdfBuffer.length,
        provider: 's3',
      });
    });

    it('throws a descriptive error when the filename has no recognizable access key', async () => {
      const storage = new S3PDFStorage();

      await expect(storage.upload(Buffer.from('x'), 'not-a-valid-filename')).rejects.toThrow(
        'No se pudo determinar la clave de acceso',
      );
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('wraps S3 failures in a descriptive error', async () => {
      sendMock.mockRejectedValueOnce(new Error('Access Denied'));
      const storage = new S3PDFStorage();

      await expect(storage.upload(Buffer.from('x'), `factura_1_${CLAVE_ACCESO}`)).rejects.toThrow(
        'Error subiendo PDF a S3',
      );
    });
  });

  describe('delete', () => {
    it('deletes the object by key and returns true', async () => {
      sendMock.mockResolvedValueOnce({});
      const storage = new S3PDFStorage();

      const result = await storage.delete(EXPECTED_KEY);

      expect(result).toBe(true);
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock.mock.calls[0][0].input).toEqual({ Bucket: 'test-bucket', Key: EXPECTED_KEY });
    });

    it('returns false when deletion fails', async () => {
      sendMock.mockRejectedValueOnce(new Error('NoSuchKey'));
      const storage = new S3PDFStorage();

      const result = await storage.delete(EXPECTED_KEY);

      expect(result).toBe(false);
    });
  });

  describe('getDownloadUrl', () => {
    it('presigns a GetObject request with a 1-hour expiry', async () => {
      getSignedUrlMock.mockResolvedValueOnce('https://s3.amazonaws.com/test-bucket/signed?X-Amz-Expires=3600');
      const storage = new S3PDFStorage();

      const url = await storage.getDownloadUrl(EXPECTED_KEY);

      expect(url).toBe('https://s3.amazonaws.com/test-bucket/signed?X-Amz-Expires=3600');
      expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
      const [, command, options] = getSignedUrlMock.mock.calls[0];
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect(command.input).toEqual({ Bucket: 'test-bucket', Key: EXPECTED_KEY });
      expect(options).toEqual({ expiresIn: 3600 });
    });

    it('never persists the presigned URL — it is only returned for immediate use', async () => {
      // Nothing in S3PDFStorage writes to a database; this test simply
      // documents/guards the contract that getDownloadUrl is a pure
      // pass-through of getSignedUrl's result with no side effects.
      getSignedUrlMock.mockResolvedValueOnce('https://s3.amazonaws.com/one-shot-url');
      const storage = new S3PDFStorage();

      await storage.getDownloadUrl(EXPECTED_KEY);

      expect(sendMock).not.toHaveBeenCalled();
    });
  });

  describe('getFileBuffer', () => {
    it('downloads the object via GetObject and returns its bytes as a Buffer', async () => {
      const bytes = new TextEncoder().encode('pdf-bytes-from-s3');
      sendMock.mockResolvedValueOnce({ Body: { transformToByteArray: async () => bytes } });
      const storage = new S3PDFStorage();

      const buffer = await storage.getFileBuffer(EXPECTED_KEY);

      expect(Buffer.from(buffer).toString()).toBe('pdf-bytes-from-s3');
      expect(sendMock.mock.calls[0][0].input).toEqual({ Bucket: 'test-bucket', Key: EXPECTED_KEY });
    });

    it('throws when the object has no body', async () => {
      sendMock.mockResolvedValueOnce({ Body: undefined });
      const storage = new S3PDFStorage();

      await expect(storage.getFileBuffer(EXPECTED_KEY)).rejects.toThrow('Error descargando PDF de S3');
    });

    it('wraps GetObject failures (e.g. NoSuchKey) in a descriptive error', async () => {
      sendMock.mockRejectedValueOnce(new Error('NoSuchKey'));
      const storage = new S3PDFStorage();

      await expect(storage.getFileBuffer(EXPECTED_KEY)).rejects.toThrow('Error descargando PDF de S3');
    });
  });

  describe('getProviderName', () => {
    it('returns exactly "s3" (the factory caches by this value)', () => {
      const storage = new S3PDFStorage();
      expect(storage.getProviderName()).toBe('s3');
    });
  });
});
