# 🌐 Configuración de CORS

Este documento explica cómo está configurado CORS en la aplicación y cómo
habilitar un frontend/backoffice adicional.

> Nota: este documento describía originalmente la resolución de un problema
> de CORS puntual contra un despliegue en Heroku de un frontend específico.
> El despliegue actual de F Sri es Docker + VPS (ver `DEPLOYMENT.md`), y los
> antiguos endpoints `/auth`/`/register` ya no existen — este documento se
> generalizó para reflejar la configuración de CORS actual, independiente de
> dónde se despliegue el frontend consumidor.

## ✅ **Configuración Implementada**

`src/config/cors.config.ts` implementa una configuración de CORS que permite:

- ✅ **Desarrollo**: Cualquier `localhost` o `127.0.0.1`
- ✅ **Peticiones sin origen**: Postman, aplicaciones móviles, cURL
- ✅ **Dominios personalizados**: Vía la variable de entorno `ALLOWED_ORIGINS`

### Variables de Entorno

```bash
# Orígenes permitidos, separados por coma
ALLOWED_ORIGINS=https://tu-frontend.com,https://tu-backoffice.com

# Deshabilita CORS completamente (NO recomendado en producción)
CORS_DISABLED=false

NODE_ENV=production
```

Ver `.env.example` para el detalle completo.

## 🧪 **Testing de CORS**

### Endpoints de Prueba

1. **Health Check** (público):
   ```
   GET $BASE_URL/health
   ```

2. **CORS Test** (público):
   ```
   GET $BASE_URL/cors-test
   ```

### Desde el Frontend

```javascript
// Ejemplo con fetch
fetch(`${BASE_URL}/cors-test`, {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include', // Importante para CORS
})
.then(response => response.json())
.then(data => console.log('✅ CORS working:', data))
.catch(error => console.error('❌ CORS error:', error));
```

## 🔧 **Configuración para Diferentes Frontends de Desarrollo**

### React (localhost:3000), Angular (localhost:4200), Vue.js (localhost:8080)

Ya incluidos automáticamente en desarrollo (cualquier `localhost`/`127.0.0.1`
es permitido sin necesidad de configurar `ALLOWED_ORIGINS`).

### Frontend en Producción

```bash
# Agrega tu dominio a ALLOWED_ORIGINS en las variables de entorno de tu despliegue
# (.env.production si usas Docker/VPS — ver DEPLOYMENT.md)
ALLOWED_ORIGINS=https://tu-frontend.vercel.app,https://tu-frontend.netlify.app
```

## 🐛 **Debugging**

Si sigues teniendo problemas:

1. **Verificar los logs del servidor**, buscando mensajes como:
   ```
   🌐 CORS configured for: PRODUCTION
   📋 Allowed origins: [...]
   ✅ Origin allowed: https://tu-frontend.com
   🚫 CORS blocked origin: https://otro-origen.com
   ```

2. **Test temporal** (deshabilitar CORS — solo para diagnosticar, nunca dejarlo así en producción):
   ```bash
   CORS_DISABLED=true
   ```

## 📋 **Checklist de Verificación**

- [ ] ✅ `ALLOWED_ORIGINS` configurado con el/los dominio(s) reales del frontend
- [ ] ✅ Frontend usa `credentials: 'include'` si depende de cookies (la mayoría de integraciones vía `X-API-Key` no lo necesitan)
- [ ] ✅ `GET /health` y `GET /cors-test` responden correctamente desde el origen del frontend
- [ ] ✅ `CORS_DISABLED=false` en producción 