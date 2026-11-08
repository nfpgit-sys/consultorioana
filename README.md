# consultorIA

Aplicación web para gestionar el **inventario, los consumos, las compras y los gastos** de un consultorio odontológico, con un **asistente de IA** que entiende instrucciones en español argentino (texto o voz) y **lectura automática de facturas**.

- Moneda ARS, zona horaria `America/Argentina/Buenos_Aires`, interfaz en español rioplatense.
- Pensada primero para celular; funciona igual en computadora.
- Ninguna operación del asistente se registra sin una confirmación explícita.

## Funcionalidades

| Área | Qué hace |
|---|---|
| Inventario | Alta con el botón «+», edición, archivo (sin borrar historia), presentaciones con equivalencia explícita (1 caja = 100 unidades), unidades físicas convertibles (g/kg, ml/l), estado suficiente / bajo / agotado, valor del stock con costo promedio ponderado. |
| Movimientos | Consumos, ingresos, ajustes por conteo, reversiones. Historial inmutable con producto, cantidad, tipo, fecha y hora, motivo, origen (manual, texto, voz, factura) y quién lo registró. Stock nunca negativo. |
| Asistente | «Hoy gasté 3 jeringas», «Compramos 5 tubos de pasta», «¿Cuántos guantes quedan?», «¿Qué productos están por agotarse?», «Mostrame cuánto gastamos este mes». Tarjetas de confirmación, advertencias de duplicado, confirmación reforzada para operaciones sensibles y «Deshacer». Dictado por voz (es-AR). Modo básico sin IA si no hay clave o si se agota el cupo gratuito. |
| Compras y gastos | Compras con varias líneas, proveedor, IVA y percepciones; compras pendientes de precio; anulación con reversión de stock. Gastos generales por categoría. Detección de comprobantes duplicados. |
| Facturas | Foto o PDF → extracción con IA → relación con el catálogo (seguras, dudosas, nuevas) → vista previa editable → confirmación. Alias aprendidos por proveedor. Sin IA: carga manual con el comprobante a la vista. |
| Lotes y vencimientos | Por producto (opcional). Consumo automático del lote que vence primero, alertas a 60/30 días y baja por vencimiento. |
| Panel y reportes | Indicadores, alertas, consumos del mes, evolución de gastos (6 meses), reportes por período / categoría / producto, exportación a Excel (.xlsx). |
| Respaldos | Descarga de respaldo completo (JSON) y restauración transaccional; recordatorio semanal. |

## Inicio rápido (desarrollo local)

Requisitos: Node.js 20.9 o superior.

```bash
npm install
```

```bash
npm run dev
```

Abrí http://localhost:3000. **No hace falta configurar nada**: los datos se guardan en una base PostgreSQL embebida (`.data/pglite`, persistente entre reinicios). Sin `CLAVE_CONSULTORIO` el acceso local queda abierto y la interfaz lo avisa; la versión publicada siempre pide la clave.

Para probar la IA en local, creá `.env.local` con `GEMINI_API_KEY=...` (ver `.env.example`).

## Configuración

Todas las variables están documentadas en [`.env.example`](.env.example).

| Variable | Producción | Para qué |
|---|---|---|
| `DATABASE_URL` | Obligatoria | PostgreSQL (Neon recomendado). Las migraciones se aplican solas al primer uso. |
| `CLAVE_CONSULTORIO` | Obligatoria | Clave de acceso compartida del consultorio. |
| `SESSION_SECRET` | Recomendada | Secreto aleatorio para firmar sesiones. |
| `GEMINI_API_KEY` | Opcional | Activa el asistente con IA y la lectura de facturas con Gemini (Google). Se obtiene en [Google AI Studio](https://aistudio.google.com/apikey). |
| `ANTHROPIC_API_KEY`, `IA_PROVEEDOR` | Opcional | Alternativa con Claude (Anthropic). Si hay clave de Gemini se usa Gemini, salvo `IA_PROVEEDOR=claude`. |
| `BLOB_READ_WRITE_TOKEN` | Opcional | Guarda una copia privada de cada factura (Vercel Blob). |
| `IA_MODELO_ASISTENTE`, `IA_MODELO_FACTURAS` | Opcional | Cambian los modelos. Con Gemini, por defecto `gemini-flash-lite-latest` y `gemini-flash-latest` (alias que Google actualiza solo); con Claude, `claude-haiku-5-5` y `claude-opus-5-5`. |

Si falta algo, la aplicación **no se bloquea**: muestra el problema en la sección afectada y en **Ajustes → Estado del sistema**. La única excepción deliberada es la clave de acceso: sin ella, la versión publicada no deja entrar (para no exponer datos).

## Despliegue en Vercel

1. Crear el proyecto en Vercel conectado a este repositorio (framework Next.js, sin configuración extra).
2. En **Storage**, crear una base **Neon (Postgres)** y conectarla al proyecto: define `DATABASE_URL`.
3. En **Storage**, crear un **Blob store privado** y conectarlo: define `BLOB_READ_WRITE_TOKEN`.
4. En **Settings → Environment Variables**: `CLAVE_CONSULTORIO`, `SESSION_SECRET` y, si se usa IA, `GEMINI_API_KEY` (marcada como *Sensitive*).
5. Desplegar y verificar: `GET /api/salud` debe responder `{"ok":true,"base":"ok",...}`; luego ingresar con la clave, crear un producto, recargar y comprobar que sigue ahí.

Cambiar `CLAVE_CONSULTORIO` y volver a desplegar cierra la sesión de todos los dispositivos.

## Pruebas

```bash
npm test
```

```bash
npm run test:pg
```

```bash
npm run build && npm run e2e
```

- `npm test`: unitarias e integración sobre PostgreSQL embebido (dominio, stock, compras, gastos, lotes, idempotencia, agente, facturas).
- `npm run test:pg`: las mismas pruebas de integración contra un PostgreSQL 16 real (incluye concurrencia). Requiere los binarios de PostgreSQL en el sistema (`PG_BIN`).
- `npm run e2e`: Playwright contra el build de producción, en vista de computadora y de celular.

## Documentación

- [Arquitectura, decisiones y seguridad](docs/ARQUITECTURA.md)

## Límites conocidos

- La IA usa Gemini. Su plan gratuito tiene un cupo chico por minuto y por día, y Google puede usar y revisar lo que se envía para mejorar sus productos: no cargar datos de pacientes (activando la facturación en Google eso deja de aplicarse). Sin clave, o con el cupo agotado, el asistente entiende frases simples y las facturas se cargan a mano.
- El dictado usa el reconocimiento de voz del navegador (Chrome, Edge, Safari); en Firefox no está disponible. En el celular también sirve el micrófono del teclado.
- El respaldo JSON no incluye las imágenes de facturas (quedan en el almacenamiento de archivos).
- Es una herramienta de gestión interna: no reemplaza la contabilidad ni emite comprobantes fiscales.
