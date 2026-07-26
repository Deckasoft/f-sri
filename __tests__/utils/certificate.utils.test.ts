import fs from 'fs';
import os from 'os';
import path from 'path';
import forge from 'node-forge';
import { encrypt } from '../../src/utils/encryption.utils';
import { withCompanyP12, verifyP12Password } from '../../src/utils/certificate.utils';

const P12_PASSWORD = 'test-p12-password';

/**
 * Builds a self-signed certificate P12 buffer for testing.
 */
function crearP12DePrueba(): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [
    { shortName: 'CN', value: 'JUAN PEREZ' },
    { shortName: 'C', value: 'EC' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, P12_PASSWORD);
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(p12Der, 'binary');
}

describe('certificate.utils', () => {
  let p12Buffer: Buffer;
  let p12Base64: string;

  beforeAll(() => {
    p12Buffer = crearP12DePrueba();
    p12Base64 = p12Buffer.toString('base64');
  });

  describe('verifyP12Password', () => {
    let p12Path: string;

    beforeAll(() => {
      p12Path = path.join(os.tmpdir(), `certificate-utils-test-${Date.now()}.p12`);
      fs.writeFileSync(p12Path, p12Buffer);
    });

    afterAll(() => {
      if (fs.existsSync(p12Path)) fs.unlinkSync(p12Path);
    });

    it('resolves valid: true for the correct password, in a single attempt', async () => {
      await expect(verifyP12Password(p12Path, P12_PASSWORD)).resolves.toEqual({ valid: true });
    });

    it('resolves valid: false with an error for a wrong password, without trying alternatives', async () => {
      const result = await verifyP12Password(p12Path, 'incorrecta');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('resolves valid: false when the file does not exist', async () => {
      const result = await verifyP12Password('/tmp/no-existe-certificate-utils.p12', 'x');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('withCompanyP12', () => {
    const buildCompany = () => ({
      certificate: encrypt(p12Base64),
      certificate_password: encrypt(P12_PASSWORD),
    });

    it('materializes a temp file with 0o600 permissions, passes it to fn, and removes it on success', async () => {
      let capturedPath = '';

      const result = await withCompanyP12(buildCompany(), async (p12Path, password) => {
        capturedPath = p12Path;
        expect(fs.existsSync(p12Path)).toBe(true);
        expect(fs.statSync(p12Path).mode & 0o777).toBe(0o600);
        expect(password).toBe(P12_PASSWORD);

        const verification = await verifyP12Password(p12Path, password);
        expect(verification.valid).toBe(true);

        return 'signed-result';
      });

      expect(result).toBe('signed-result');
      expect(capturedPath).not.toBe('');
      expect(fs.existsSync(capturedPath)).toBe(false);
    });

    it('removes the temp file even when fn throws', async () => {
      let capturedPath = '';

      await expect(
        withCompanyP12(buildCompany(), async (p12Path) => {
          capturedPath = p12Path;
          expect(fs.existsSync(p12Path)).toBe(true);
          throw new Error('fallo intencional al firmar');
        }),
      ).rejects.toThrow('fallo intencional al firmar');

      expect(capturedPath).not.toBe('');
      expect(fs.existsSync(capturedPath)).toBe(false);
    });

    it('uses an unpredictable filename (crypto.randomUUID) rather than a sequential/guessable one', async () => {
      const seenPaths: string[] = [];

      await withCompanyP12(buildCompany(), async (p12Path) => {
        seenPaths.push(p12Path);
        return undefined;
      });
      await withCompanyP12(buildCompany(), async (p12Path) => {
        seenPaths.push(p12Path);
        return undefined;
      });

      expect(seenPaths[0]).not.toBe(seenPaths[1]);
      const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.p12$/i;
      expect(path.basename(seenPaths[0])).toMatch(uuidPattern);
    });

    it('throws without writing any file when the certificate is missing', async () => {
      const fn = jest.fn();

      await expect(withCompanyP12({ certificate_password: encrypt(P12_PASSWORD) }, fn)).rejects.toThrow(
        'certificado digital',
      );
      expect(fn).not.toHaveBeenCalled();
    });

    it('throws without writing any file when the certificate password is missing', async () => {
      const fn = jest.fn();

      await expect(withCompanyP12({ certificate: encrypt(p12Base64) }, fn)).rejects.toThrow('certificado digital');
      expect(fn).not.toHaveBeenCalled();
    });
  });
});
