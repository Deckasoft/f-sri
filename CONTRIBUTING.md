# 🤝 Guía de Contribución - F Sri

¡Gracias por tu interés en contribuir a **F Sri**! Este documento te guiará a través del proceso de contribución.

## 🌟 Cómo Contribuir

F Sri es un proyecto de código abierto y valoramos todas las contribuciones de la comunidad.

## 🌟 Formas de Contribuir

- 🐛 **Reportar bugs** y problemas
- 💡 **Sugerir nuevas funcionalidades**
- 📝 **Mejorar la documentación**
- 🔧 **Escribir código** y corregir bugs
- 🧪 **Escribir tests** y mejorar la cobertura
- 🌐 **Traducir** a otros idiomas
- 📢 **Difundir** el proyecto

## 🚀 Configuración del Entorno de Desarrollo

### Prerrequisitos

- Node.js 20.x+ (Node 18 es EOL; `package.json` declara `engines.node >= 20.0.0` y CI ya solo corre en 20.x)
- MongoDB 4.4+
- Git

### Configuración Inicial

1. **Fork** el repositorio en GitHub
2. **Clona** tu fork:
   ```bash
   git clone https://github.com/TU_USUARIO/f-sri.git
   cd f-sri
   ```
3. **Agrega el repositorio original** como upstream:
   ```bash
   git remote add upstream https://github.com/f-sri/f-sri.git
   ```
4. **Instala las dependencias**:
   ```bash
   npm install
   ```
5. **Copia el archivo de configuración**:
   ```bash
   cp .env.example .env
   ```
6. **Ejecuta los tests** para verificar que todo funciona:
   ```bash
   npm test
   ```

## 📋 Proceso de Contribución

### 1. Antes de Empezar

- 🔍 **Revisa** los [issues existentes](https://github.com/f-sri/f-sri/issues)
- 💬 **Comenta** en el issue si planeas trabajar en él
- 🆕 **Crea un nuevo issue** si no existe uno relacionado

### 2. Desarrollo

1. **Crea una rama** para tu feature:
   ```bash
   git checkout -b feature/nombre-descriptivo
   ```

2. **Desarrolla** tu funcionalidad siguiendo las convenciones del proyecto

3. **Escribe tests** para tu código:
   ```bash
   npm test
   ```

4. **Verifica** que el código pase todas las validaciones:
   ```bash
   npm run validate
   ```

### 3. Commits

Usamos **commits semánticos**. El formato es:

```
tipo(scope): descripción corta

Descripción más detallada si es necesaria.

Fixes #123
```

#### Tipos de Commit

- `feat`: Nueva funcionalidad
- `fix`: Corrección de bug
- `docs`: Cambios en documentación
- `style`: Cambios de formato (no afectan funcionalidad)
- `refactor`: Refactorización de código
- `test`: Agregar o modificar tests
- `chore`: Tareas de mantenimiento

#### Ejemplos

```bash
git commit -m "feat(invoice): agregar validación de RUC"
git commit -m "fix(cors): corregir configuración para producción"
git commit -m "docs(readme): actualizar instrucciones de instalación"
```

### 4. Pull Request

1. **Actualiza** tu rama con los últimos cambios:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Push** a tu fork:
   ```bash
   git push origin feature/nombre-descriptivo
   ```

3. **Crea** un Pull Request desde GitHub

4. **Completa** la plantilla del PR con:
   - Descripción clara de los cambios
   - Referencias a issues relacionados
   - Screenshots si aplica
   - Checklist de verificación

## 🎯 Estándares de Código

### TypeScript

- Usa **TypeScript estricto**
- Define **interfaces** para todos los tipos
- Evita `any`, usa tipos específicos
- Documenta funciones complejas con JSDoc

### Estilo de Código

- Usamos **Prettier** para formateo automático
- Ejecuta `npm run lint:fix` antes de commit
- Máximo 100 caracteres por línea
- Usa nombres descriptivos para variables y funciones

### Estructura de Archivos

```
src/
├── config/          # Configuraciones
├── interfaces/      # Tipos e interfaces TypeScript
├── middleware/      # Middleware de Express
├── models/          # Modelos de MongoDB
├── routes/          # Rutas de la API
├── services/        # Lógica de negocio
└── utils/           # Utilidades y helpers
```

### Tests

- **Cobertura mínima**: 80%
- Tests unitarios para servicios y utilidades
- Tests de integración para endpoints
- Usa **Jest** y **Supertest**
- Mockea dependencias externas

```bash
# Ejecutar tests
npm test

# Tests con coverage
npm run test:coverage

# Tests en modo watch
npm run test:watch
```

## 🐛 Reportar Bugs

### Antes de Reportar

1. **Busca** en issues existentes
2. **Verifica** que uses la última versión
3. **Reproduce** el bug en un entorno limpio

### Información a Incluir

- **Descripción clara** del problema
- **Pasos para reproducir**
- **Comportamiento esperado** vs **actual**
- **Información del entorno**:
  - OS y versión
  - Node.js versión
  - MongoDB versión
  - Versión de F Sri

### Plantilla de Bug Report

```markdown
## Descripción
Descripción clara y concisa del bug.

## Pasos para Reproducir
1. Ir a '...'
2. Hacer clic en '...'
3. Ver error

## Comportamiento Esperado
Lo que esperabas que pasara.

## Comportamiento Actual
Lo que realmente pasó.

## Entorno
- OS: [ej. Ubuntu 20.04]
- Node.js: [ej. 18.17.0]
- MongoDB: [ej. 5.0.9]
- F Sri: [ej. 1.0.0]

## Información Adicional
Screenshots, logs, etc.
```

## 💡 Sugerir Funcionalidades

### Antes de Sugerir

1. **Revisa** el roadmap en el README
2. **Busca** en issues existentes
3. **Considera** si encaja con la visión del proyecto

### Plantilla de Feature Request

```markdown
## Resumen
Descripción breve de la funcionalidad.

## Problema que Resuelve
¿Qué problema actual resuelve esta funcionalidad?

## Solución Propuesta
Descripción detallada de cómo funcionaría.

## Alternativas Consideradas
Otras formas de resolver el problema.

## Información Adicional
Mockups, ejemplos, referencias, etc.
```

## 📚 Documentación

### Tipos de Documentación

- **README**: Información general y quick start
- **API Docs**: Documentación de endpoints (Swagger)
- **Code Comments**: Comentarios en código complejo
- **Wiki**: Guías detalladas y tutoriales

### Estándares

- Usa **español** para documentación dirigida a usuarios ecuatorianos
- Usa **inglés** para comentarios en código
- Incluye **ejemplos prácticos**
- Mantén la documentación **actualizada**

## 🏆 Reconocimiento

### Contributors

Todos los contribuidores aparecen en:
- Lista de contributors en GitHub
- Sección de agradecimientos en README
- Release notes cuando aplique

### Tipos de Contribución

Reconocemos todas las formas de contribución:
- 💻 Código
- 📖 Documentación
- 🐛 Bug reports
- 💡 Ideas
- 🌐 Traducción
- 📢 Promoción

## ❓ ¿Necesitas Ayuda?

- 💬 **Discord**: [Únete a nuestra comunidad](https://discord.gg/veronica-ec)
- 📧 **Email**: veronica-ec@googlegroups.com
- 📖 **Wiki**: [Documentación completa](https://github.com/veronica-ec/veronica-ec/wiki)
- 🐛 **Issues**: [GitHub Issues](https://github.com/veronica-ec/veronica-ec/issues)

## 📜 Código de Conducta

Este proyecto sigue el [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). 
Al participar, te comprometes a mantener un ambiente respetuoso y acogedor para todos.

---

¡Gracias por contribuir a F Sri! 🇪🇨❤️ 
