import swaggerSpec from '../src/swagger';

// src/swagger.ts is a hand-written ~1600-line OpenAPI object, excluded from
// test coverage thresholds because it's docs, not logic. That doesn't mean
// it should go unchecked: nothing else guards it, so a stale or malformed
// edit here would ship silently. This test only asserts on structure that
// Phase 8 changed (removed dead paths, new API-key auth scheme) — it's not
// meant to pin down every path/schema in the document.
describe('swagger spec', () => {
  it('does not document the retired self-registration endpoints', () => {
    expect(swaggerSpec.paths).not.toHaveProperty('/register');
    expect(swaggerSpec.paths).not.toHaveProperty('/auth');
    expect(swaggerSpec.paths).not.toHaveProperty('/status');
  });

  it('does not document identification-type or issuing-company mutations that no longer exist', () => {
    // identification-type is a read-only global catalog on /api/v1: no POST/PUT/DELETE.
    expect(swaggerSpec.paths['/api/v1/identification-type']).not.toHaveProperty('post');
    expect(swaggerSpec.paths['/api/v1/identification-type/{id}']).not.toHaveProperty('put');
    expect(swaggerSpec.paths['/api/v1/identification-type/{id}']).not.toHaveProperty('delete');

    // issuing-company is tenant self-service: no :id-scoped routes at all.
    expect(swaggerSpec.paths).not.toHaveProperty('/api/v1/issuing-company/{id}');
  });

  it('declares an ApiKeyAuth security scheme (X-API-Key header) instead of the retired JWT bearerAuth', () => {
    const { securitySchemes } = swaggerSpec.components;
    expect(securitySchemes).not.toHaveProperty('bearerAuth');
    expect(securitySchemes).toHaveProperty('ApiKeyAuth');
    expect(securitySchemes.ApiKeyAuth).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
    });
  });

  it('applies ApiKeyAuth as the default security requirement for the documented (/api/v1) surface', () => {
    expect(swaggerSpec.security).toEqual([{ ApiKeyAuth: [] }]);
  });

  it('no longer references bearerAuth from any operation', () => {
    expect(JSON.stringify(swaggerSpec)).not.toMatch(/bearerAuth/);
  });

  it('is valid, serializable JSON (what /swagger.json actually serves)', () => {
    expect(() => JSON.parse(JSON.stringify(swaggerSpec))).not.toThrow();
  });
});
