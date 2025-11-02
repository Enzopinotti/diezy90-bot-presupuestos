
# Diez y 90 — Bot de Presupuestos (WATI + Shopify + OCR + STT + PDF)

Backend **Node.js/Express** para el *Modo Presupuesto* conversacional de **Diez y 90** por WhatsApp (WATI).
Integra **Shopify** (catálogo/precios), **Redis** (sesiones 24 h), **OCR** (Tesseract) para planillas, **STT** (Whisper) para audios y **PDF** (Puppeteer) con la plantilla del cliente.

> **Estado**: MVP operativo. Falta pulir desambiguación guiada, parseo avanzado de cantidades, OCR y STT enchufados directo al webhook, y reemplazar `budget.html` por la plantilla final del cliente.

## Características

- **Modo Presupuesto** con lista de materiales por **texto**, **foto (OCR)** o **audio (STT)**.
- Matching contra **Shopify** con reglas de **precios** (Lista / Transferencia −5% / Efectivo −10% configurable).
- **Sesiones 24 h** con Redis (reanudación automática).
- **PDF** del presupuesto (Puppeteer) enviado por WhatsApp (WATI).
- Desambiguación (e.g. “*Hierro*” → 6/8/10/12) — *en progreso*.
- **Menú inicial**: `CATALOGO` y `PRESUPUESTO`.
- **Logs** con `pino`.

---

## Arquitectura

``` bash
WATI (WhatsApp)
   ↓ webhook (entrante)
Backend (Express) ──► matchService (glosario + Shopify)
   │                 └► priceService (reglas + formato ARS)
   ├─► Shopify Admin API (catálogo y precios)
   ├─► Redis (sesiones 24 h)
   ├─► OCR (Tesseract) [opcional en v1 del webhook]
   ├─► STT Whisper (OpenAI) [opcional/bajo demanda]
   └─► PDF (Puppeteer) → WATI sendSessionFile
```

**Convención de archivos**: cada archivo inicia con un comentario de ruta, por ejemplo `// src/services/watiService.js`.

---

## Requisitos

- Node.js 20+
- Docker / Docker Compose (recomendado para dev y prod)
- Cuenta Shopify con productos cargados (Admin API)
- Cuenta WATI (plan Growth o superior) y acceso a API
- (Opcional) Cuenta de OpenAI para Whisper STT

---

## Variables de entorno

Crear `.env` a partir de `.env.example`:

```dotenv
# App
NODE_ENV=development
PORT=3000
BASE_URL=http://localhost:3000

# Timezone / locale
TZ=America/Argentina/Buenos_Aires
CURRENCY_LOCALE=es-AR

# Redis
# En Docker: redis://redis:6379  |  Local sin Docker: redis://127.0.0.1:6379
REDIS_URL=redis://redis:6379

# WATI
# Usar el “Punto final de API” del panel + /api/v1
# Ej: https://live-mt-server.wati.io/1035566/api/v1
WATI_BASE_URL=replace_me
# Pegar solo el token, sin "Bearer "
WATI_API_KEY=replace_me
# Si activás firma HMAC de webhook (opcional)
WATI_WEBHOOK_SECRET=

# Shopify Admin API
# Usar SIEMPRE el subdominio .myshopify.com
SHOPIFY_SHOP=ryespq-qe.myshopify.com
SHOPIFY_API_VERSION=2024-10
SHOPIFY_ACCESS_TOKEN=replace_me

# OpenAI (Whisper STT) — opcional hasta habilitar audios
OPENAI_API_KEY=

# Discounts
DISCOUNT_CASH=0.10
DISCOUNT_TRANSFER=0.05

# Business
BUDGET_VALIDITY_DAYS=1
PDF_FOOTER_TEXT=Validez: 1 día. Precios sujetos a cambio sin previo aviso.
```

> **Nota Shopify**: aunque conectes `www.diezy90corralon.com`, la Admin API **siempre** usa `*.myshopify.com`.

---

## Arranque rápido

### Docker (recomendado)

```bash
cp .env.example .env
# completar WATI y Shopify
docker compose up --build
```

- Health: `GET http://localhost:3000/health` → `{ "ok": true }`
- Índice Shopify: `GET http://localhost:3000/debug/products`

### Local (sin Docker)

```bash
npm ci
npm run dev
``` bash
Asegurate de tener **Redis** corriendo (ej: `redis-server`) y ajustar `REDIS_URL=redis://127.0.0.1:6379`.

---

## Configuración Shopify Admin API

1. Ir a `https://<tu-tienda>.myshopify.com/admin`
2. **Configuración → Apps y canales de venta → Desarrollar apps para tu tienda**
3. Crear app personalizada `BotPresupuestos` y habilitar scopes:
   - ✅ `read_products`
   - (Opcional) `read_inventory`, `read_price_rules`, `read_locations`
4. **Instalar app** y copiar **Admin API access token** (`shpat_...`)
5. Pegar en `.env`:
   ```dotenv
   SHOPIFY_SHOP=ryespq-qe.myshopify.com
   SHOPIFY_API_VERSION=2024-10
   SHOPIFY_ACCESS_TOKEN=shpat_xxx
   ```

**Prueba rápida**:

```bash
curl -X GET "https://ryespq-qe.myshopify.com/admin/api/2024-10/products.json?limit=1" \
  -H "X-Shopify-Access-Token: shpat_xxx" -H "Content-Type: application/json"
```

---

## Configuración WATI (API + Webhook)

### API

En tu panel WATI:

- Copiar **Punto final de API** (ej.: `https://live-mt-server.wati.io/1035566`) y agregar `/api/v1`
- Copiar **Token de acceso** (sin la palabra `Bearer`)

```dotenv
WATI_BASE_URL=https://live-mt-server.wati.io/1035566/api/v1
WATI_API_KEY=eyJhbGciOi...
```

### Webhook (entrante)

En dev usá **ngrok** para exponer tu `localhost:3000`:

```bash
ngrok http 3000
```

Configurar en WATI **Webhook URL**:

``` bash
POST https://<tu-ngrok>.ngrok-free.app/webhook/wati
```

---

## OpenAI (Whisper) — Opcional

- Solo para **audios** (STT).
- Podés dejar la clave vacía hasta que el cliente apruebe el costo.
- Precio estimado: **USD 0.006 por minuto** (muy bajo).

```dotenv
OPENAI_API_KEY=sk-...
```

---

## Redis y sesiones

- Persistencia de conversación por **24 h**.
- TTL configurable en `src/services/sessionService.js`.
- Clave por usuario: `d90:sess:<phone>`.

---

## Rutas/Endpoints

- `GET /health` — ping del servicio
- `POST /webhook/wati` — webhook entrante de WATI
- `GET /debug/products` — índice minimo de Shopify (cacheado en Redis)
- `GET /debug/session/:phone` — ver estado de sesión

> **Webhook**: responde `200 { ok: true }` inmediatamente y procesa en segundo plano las acciones.

---

## Pruebas rápidas

### 1) Simular webhook (local)

```bash
curl -X POST "http://localhost:3000/webhook/wati" \
  -H "Content-Type: application/json" \
  -d '{"waId":"54911XXXXXXX","text":"PRESUPUESTO"}'
```

### 2) Enviar mensaje desde WATI API

```bash
curl -X POST "https://live-mt-server.wati.io/1035566/api/v1/sendSessionMessage/54911XXXXXXX" \
  -H "Authorization: Bearer <WATI_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"messageText":"Prueba desde API ✅"}'
```

---

## PDF y Plantilla

- Plantilla base: `src/templates/budget.html`
- Motor actual: reemplazo simple de placeholders (`{{NUMBER}}`, `{{DATE}}`, `<!--ROWS-->`, `{{FOOTER}}`)
- Generación: `src/services/pdfService.js` (Puppeteer, `A4`, `printBackground: true`)

**Para personalización** del cliente:

- Reemplazar `budget.html` por HTML/CSS que imite el PDF de referencia.
- Incluir fuentes/estilos inline o web-safe.

---

## Matching y Glosario

- Índice Shopify cacheado con `buildProductIndex()` (10 min).
- Glosario en `src/data/glossary.json` con alias: acentos, `m3/m³`, `1/2 → 0.5/medio`, `6/20 → 6-20`, etc.
- Servicio `matchFromText(text, index)` (*v1*): busca tokens y devuelve candidatos con `qty`.

---

## Estándar de comentarios de ruta

> **Obligatorio**: al inicio de cada archivo, incluir el **comentario de ruta** para facilitar navegación y revisión.  
Ej.:

```js
// src/services/watiService.js
```

---

## Despliegue a producción

- **Docker** recomendado (imagen `node:20-slim` + deps para Tesseract y Puppeteer).
- `NODE_ENV=production`
- SSL/HTTPS para el webhook.
- Variables reales en `.env` (no subir `.env` al repo).

### Puertos

- App: `3000`
- Redis: `6379` (si es externo, cerrar público y usar VPC/ACLs)
