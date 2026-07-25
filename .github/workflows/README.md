# GitHub Actions CI/CD

Este directorio contiene los workflows de GitHub Actions para el proyecto de facturación electrónica.

## 🚀 Workflow Principal: `ci.yml`

### Triggers
- **Push** a ramas `main` y `develop`
- **Pull Requests** a la rama `main`

### Jobs

#### 1. **Test** 
- ✅ Se ejecuta en **Node.js 20.x** (matriz de una sola versión — Node 18 es
  EOL y `package.json` ya declara `engines.node >= 20.0.0`)
- 🔍 **Type checking** con TypeScript
- 🎨 **Linting** con Prettier
- 🧪 **Tests con coverage** usando Jest
- 📊 **Upload coverage** a Codecov

#### 2. **Build**
- 🏗️ Se ejecuta **solo en rama main**
- ⚠️ **Requiere** que pasen todos los tests
- 📦 Compila la aplicación TypeScript
- ✅ Ejecuta validación completa

#### 3. **Security Scan**
- 🔒 **Auditoría de seguridad** con npm audit
- 🛡️ **Verificación de vulnerabilidades**
- ⚠️ Continúa en caso de errores (informativo)

## 📋 Scripts Disponibles

```bash
# Validación completa (lo que ejecuta CI)
npm run validate

# Tests con coverage
npm run test:ci

# Verificación de tipos
npm run typecheck

# Formateo de código
npm run lint:fix
```

## 🎯 Coverage Thresholds

Configurado en `jest.config.js` (`coverageThreshold.global`):
- **Statements**: 85%
- **Branches**: 70%
- **Functions**: 90%
- **Lines**: 85%

## 🔧 Configuración Local

Para que el workflow funcione correctamente:

1. **Verificar que los tests pasen localmente:**
   ```bash
   npm run validate
   ```

2. **Formatear código antes de commit:**
   ```bash
   npm run lint:fix
   ```

3. **Verificar coverage:**
   ```bash
   npm run test:coverage
   ```

## 🚫 Qué bloquea el pipeline

El job `docker` (build + push a GHCR) requiere que el job `test` termine
exitosamente primero — un push a `main` con tests, lint, tipos o coverage en
rojo no llega a construir/publicar una imagen nueva:
- ❌ Los tests fallan
- ❌ El linting falla
- ❌ La compilación TypeScript falla
- ❌ El coverage está por debajo del umbral

Esto no bloquea un *deploy* automáticamente (no hay uno automatizado — ver
sección anterior), pero sí evita publicar una imagen rota en GHCR.

## 🔗 Build e Imagen Docker

El despliegue actual es Docker + VPS (ver `DEPLOYMENT.md`), no una plataforma
PaaS con auto-deploy vía checks de GitHub. El workflow de CI construye y
publica la imagen Docker a GitHub Container Registry (GHCR) — ver el job
correspondiente en `ci.yml`. El `docker compose pull && up -d` en el VPS (o el
paso equivalente de tu pipeline de despliegue) es responsabilidad de quien
opera el VPS, no de este workflow.

## 📈 Métricas

El workflow rastrea:
- ⏱️ **Tiempo de ejecución** de tests
- 📊 **Porcentaje de coverage**
- 🔍 **Vulnerabilidades de seguridad**
- ✅ **Estado de checks** para deploy automático 