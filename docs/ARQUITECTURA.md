# Arquitectura de consultorIA

Documento de decisiones técnicas. Resume qué se eligió, por qué, y qué alternativas se descartaron.

## 1. Vista general

```
Navegador (celular / computadora)
  │  HTTPS · cookie de sesión firmada (clave del consultorio)
  ▼
Next.js 16 en Vercel (App Router, Node.js)
  ├─ proxy.ts ............ exige sesión válida en todas las rutas salvo /ingresar y /api/salud
  ├─ Páginas (Server Components) ── leen datos con los servicios
  ├─ Server Actions / Route Handlers ── escriben siempre a través de los servicios
  ├─ src/lib/services ..... reglas de negocio + transacciones (única puerta a la base)
  ├─ src/lib/agent ........ asistente (Claude con herramientas, o intérprete local)
  └─ src/lib/invoices ..... extracción y revisión de facturas
        │                        │                       │
        ▼                        ▼                       ▼
  PostgreSQL (Neon)        Vercel Blob privado     API de Anthropic
  datos + historial        archivos de facturas    (solo desde el servidor)
```

Principios:

1. **La base es la única fuente de verdad** y se accede solo desde el servidor. El navegador nunca recibe credenciales de la base ni claves de IA.
2. **El modelo de IA solo interpreta**: propone operaciones; el servidor las valida con las mismas reglas que los formularios y la persona confirma.
3. **El historial es inmutable**: los errores se corrigen con reversiones o ajustes, nunca borrando.
4. **La aplicación degrada con elegancia**: si falta la IA o el almacenamiento, el resto funciona; los problemas se muestran donde corresponden.

## 2. Almacenamiento: alternativas evaluadas

| Opción | Ventajas | Desventajas | Decisión |
|---|---|---|---|
| localStorage / IndexedDB | Cero configuración | No comparte datos entre dispositivos; se pierde al borrar datos del navegador | Descartada como fuente de verdad (solo se usa para la conversación del asistente en la pestaña) |
| Supabase (PostgreSQL) | Base + archivos + panel | El plan gratuito pausa el proyecto tras ~7 días sin uso y no incluye backups; exponer la API REST requiere RLS bien diseñado | Compatible (basta su `DATABASE_URL`), no elegida por defecto |
| **Neon (PostgreSQL) vía Vercel** | Se conecta desde Vercel y crea `DATABASE_URL`; se "duerme" sin perder datos y despierta con la primera consulta; PITR | Archivos aparte | **Elegida** |
| Turso (SQLite) | Barato y simple | Menos herramientas | Descartada |

En desarrollo y en las pruebas se usa **PGlite** (PostgreSQL compilado a WebAssembly): es el mismo motor, así que las migraciones, restricciones y triggers se prueban de verdad, y `npm run dev` funciona sin configurar nada. En producción se usa `node-postgres`. Las pruebas de integración corren con ambos drivers.

Las migraciones (`src/lib/db/migrations`) se aplican automáticamente al primer uso, dentro de una transacción con un *advisory lock* (seguro con varias instancias en paralelo). Nunca se edita una migración publicada: se agrega una nueva.

## 3. Acceso y seguridad

**Por qué no "sin clave"**: una URL pública sin protección permitiría que cualquiera vea y modifique el inventario y consuma créditos de IA a tu cargo. Se eligió la **clave del consultorio** (opción B de la propuesta):

- Se escribe una vez por dispositivo; la sesión dura 90 días (cookie `httpOnly`, `Secure`, `SameSite=Lax`).
- El token se firma con HMAC-SHA256 e incluye una huella de la clave: **cambiar la clave invalida todas las sesiones**.
- Límite de intentos fallidos por IP (10 cada 15 minutos) y global; comparación en tiempo constante.
- `proxy.ts` protege todo; además cada acción y API vuelve a verificar la sesión (doble barrera).
- Opcionalmente se registra el **nombre de quien usa el dispositivo** para el historial (no es autenticación).
- Evolución posible: login con Google o enlace por email para una lista de correos permitidos.

Otras medidas:

- **RLS habilitado en todas las tablas sin políticas**: el rol dueño (el servidor) opera normalmente, pero si alguna vez se expone la base mediante una API pública, los roles anónimos no ven ni modifican nada.
- Claves privadas (`ANTHROPIC_API_KEY`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`) solo en variables del servidor; nunca `NEXT_PUBLIC_*`.
- Archivos de facturas en Blob **privado**, servidos solo a sesiones válidas.
- Encabezados de seguridad (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`), `robots: noindex`.
- Los textos que vienen de facturas o de nombres de productos se tratan como datos, no como instrucciones (mitigación de *prompt injection*); además ninguna salida del modelo se ejecuta sin confirmación humana.

## 4. Modelo de datos

Tablas principales (ver `0001_esquema_inicial.ts`):

- `products` (stock en `numeric(14,3)` en la unidad base, `current_stock >= 0`), `product_presentations` (equivalencias), `product_aliases` (nombres aprendidos de facturas, por proveedor), `lots` (lote + vencimiento).
- `stock_movements`: **inmutable** (trigger que rechaza UPDATE/DELETE). Cada fila guarda tipo, cantidad con signo, stock antes/después (con `check stock_after = stock_before + quantity`), unidad de entrada, costo, motivo, origen, quién, fecha del hecho (hora AR) y fecha de registro. Una reversión apunta al movimiento original (índice único: se revierte una sola vez).
- `purchases` + `purchase_items`, `expenses`, `suppliers` (CUIT con dígito verificador).
- `documents` + `document_files` (facturas, hash SHA-256 para detectar repetidos).
- `operations`: clave de idempotencia única por acción (un doble clic o un reintento no duplica).
- `audit_log`: auditoría inmutable de altas, ediciones, archivos, anulaciones y restauraciones.

### Unidades y conversiones

- Cada producto tiene **una unidad base** (unidad, par, g, mg, kg, ml, l, cm, m) y el stock se guarda siempre en ella.
- Solo se convierten automáticamente unidades físicas de la misma magnitud (g ↔ kg, ml ↔ l).
- Las presentaciones (caja, tubo, frasco…) requieren una **equivalencia definida** en el producto. Si alguien dice "2 cajas" y la caja no está definida, el sistema pregunta: nunca supone.
- La unidad base no se puede cambiar si el producto ya tiene movimientos.

### Concurrencia

Las operaciones de stock bloquean las filas de productos (`SELECT … FOR UPDATE`, en orden de id para evitar interbloqueos) y validan el stock dentro de la transacción. Probado con dos consumos simultáneos sobre PostgreSQL real: solo uno se registra.

## 5. Asistente

```
texto o voz ──► /api/asistente ──► ¿IA configurada?
                                   ├─ sí: Claude (modelo rápido) + herramientas
                                   │     · consulta: buscar_productos, listar_stock_bajo, resumen_gastos,
                                   │       consumos, movimientos_recientes, vencimientos, buscar_proveedores
                                   │     · propuesta (no escriben): proponer_movimientos, proponer_compra,
                                   │       proponer_gasto, proponer_producto, proponer_ajuste,
                                   │       proponer_reversion, proponer_presentacion
                                   └─ no (o si la IA falla): intérprete local de frases frecuentes
          ◄── respuesta + tarjetas de propuesta (validadas, con advertencias)
tarjeta "Confirmar" ──► misma acción de servidor que los formularios (con idempotencia y origen texto/voz)
```

- Las herramientas de propuesta ejecutan la **misma planificación** que el registro real (conversiones, stock suficiente, duplicados en 10 minutos, stock en cero, cantidades inusuales) y devuelven errores al modelo para que pregunte en vez de inventar.
- Confirmación reforzada (casilla adicional) cuando hay advertencias: posible duplicado, stock que queda en cero, cantidad inusual, producto con nombre parecido, ajustes grandes.
- El historial de la conversación incluye el estado de cada propuesta (confirmada, cancelada, deshecha) para que el modelo no repita operaciones.
- Voz: Web Speech API (es-AR). El texto dictado se muestra para revisarlo antes de enviarlo.

## 6. Facturas

1. Fotos (comprimidas en el navegador a JPEG ≤ 2000 px) o un PDF (≤ 4 MB por el límite de las funciones de Vercel).
2. Se guarda una copia privada y se calcula el hash (archivo repetido → aviso).
3. Claude (modelo potente) extrae los datos con **salidas estructuradas** (esquema estricto; null cuando no se lee) y con respaldo automático del servidor si el modelo declina.
4. Revisión: cada línea se compara con el catálogo (alias aprendidos del proveedor primero). Solo es "segura" con alias o nombre idéntico o un candidato muy superior; las dudosas exigen confirmación; las nuevas proponen crear el producto con detección de casi duplicados. Si la factura declara el contenido ("caja x100"), se usa esa equivalencia y se muestra la cuenta.
5. Al confirmar se registra la compra (o el gasto general) y se aprenden los alias.

## 7. Costos de IA (estimados)

| Uso | Modelo por defecto | Orden de magnitud |
|---|---|---|
| Instrucción al asistente | `claude-haiku-5-5` ($0,10 / $0,50 por millón de tokens de entrada/salida) | ~US$ 0,001–0,003 por instrucción (1 a 3 llamadas al modelo) |
| Lectura de factura | `claude-opus-5-5` ($4 / $20 por millón) | ~US$ 0,05–0,15 por factura según páginas y nitidez |

Con 50 instrucciones diarias y 100 facturas al mes, el costo estimado ronda los US$ 8–20 por mes. Para bajarlo, se puede usar `IA_MODELO_FACTURAS=claude-sonnet-5-5` ($2 / $10 por millón), probando antes con facturas reales que la calidad siga siendo buena. Los modelos se cambian con `IA_MODELO_ASISTENTE` e `IA_MODELO_FACTURAS`. Precios a confirmar en la página de precios de Anthropic.

## 8. Respaldos

- Proveedor: Neon conserva historial para restauración en el tiempo según el plan.
- Propio: **Ajustes → Descargar respaldo** (JSON con todas las tablas, lectura consistente). La restauración reemplaza todo en una sola transacción (si algo falla, no cambia nada) y exige escribir "RESTAURAR". El panel recuerda el respaldo semanal.

## 9. Separación de entornos

| Entorno | Base | Archivos | Acceso |
|---|---|---|---|
| Desarrollo local (`npm run dev`) | PGlite en `.data/pglite` | `.data/archivos` | Abierto (aviso visible) |
| Pruebas (`npm test`, `npm run e2e`) | PGlite en memoria/temporal y PostgreSQL 16 temporal | carpeta temporal | Clave de prueba |
| Producción (Vercel) | Neon (`DATABASE_URL`) | Vercel Blob privado | `CLAVE_CONSULTORIO` |

`GET /api/salud` permite verificar un despliegue sin exponer datos: indica si la base responde y qué versión del esquema tiene.

## 10. Próximos pasos sugeridos

- Login con Google o enlace por email para identificar a cada integrante.
- Transcripción de voz en el servidor para navegadores sin dictado.
- Respaldo automático semanal a un almacenamiento externo.
- Reportes por proveedor y alertas de precios.
