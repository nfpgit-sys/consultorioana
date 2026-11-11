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
  ├─ src/lib/agent ........ asistente (Gemini o Claude con herramientas, o intérprete local)
  └─ src/lib/invoices ..... extracción y revisión de facturas
        │                        │                       │
        ▼                        ▼                       ▼
  PostgreSQL (Neon)        Vercel Blob privado     API de Gemini (Google)
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
- Claves privadas (`GEMINI_API_KEY` o `ANTHROPIC_API_KEY`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`) solo en variables del servidor; nunca `NEXT_PUBLIC_*`.
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
                                   ├─ sí: Gemini Flash-Lite (o Claude) + herramientas
                                   │     · consulta: buscar_productos, listar_stock_bajo, resumen_gastos,
                                   │       consumos, movimientos_recientes, vencimientos, buscar_proveedores
                                   │     · propuesta (no escriben): proponer_movimientos, proponer_compra,
                                   │       proponer_gasto, proponer_producto, proponer_ajuste,
                                   │       proponer_reversion, proponer_presentacion
                                   └─ no (o si la IA falla o se agotó el cupo): intérprete local de frases frecuentes
          ◄── respuesta + tarjetas de propuesta (validadas, con advertencias)
tarjeta "Confirmar" ──► misma acción de servidor que los formularios (con idempotencia y origen texto/voz)
```

- Las herramientas de propuesta ejecutan la **misma planificación** que el registro real (conversiones, stock suficiente, duplicados en 10 minutos, stock en cero, cantidades inusuales) y devuelven errores al modelo para que pregunte en vez de inventar.
- Confirmación reforzada (casilla adicional) cuando hay advertencias: posible duplicado, stock que queda en cero, cantidad inusual, producto con nombre parecido, ajustes grandes.
- El historial de la conversación incluye el estado de cada propuesta (confirmada, cancelada, deshecha) para que el modelo no repita operaciones.
- Voz: Web Speech API (es-AR). El texto dictado se muestra para revisarlo antes de enviarlo.
- Las herramientas se definen una sola vez (`src/lib/agent/tools.ts`, esquema JSON) y se adaptan a cada proveedor: Claude las recibe como esquemas estrictos; Gemini, convertidas a su formato OpenAPI con `nullable` (`src/lib/ai/gemini-schema.ts`).
- Con Gemini, la respuesta del modelo se devuelve tal cual en el turno siguiente (incluye las *firmas de pensamiento* que exige al usar herramientas), la ejecución automática del SDK está desactivada y no se reintenta ante un 429: si se agotó el cupo, se responde al instante con el modo básico y un aviso.

## 6. Facturas

1. Fotos o un PDF (≤ 4 MB por el límite de las funciones de Vercel). Las imágenes chicas se suben tal cual; las fotos grandes se pasan a JPEG en el navegador respetando la orientación de la cámara, con la mayor resolución que entre en el límite (hasta 2600 px).
2. Se guarda una copia privada y se calcula el hash (archivo repetido → aviso).
3. **Lectura con IA** (`src/lib/invoices/extract.ts`). Las instrucciones son genéricas: no hay plantillas por emisor; el modelo ubica cada dato por su etiqueta y su contenido (emisor vs. receptor, tablas con columnas variables, renglones de varias líneas, fotos rotadas o de baja calidad). El esquema (`schema.ts`) cubre emisor y receptor (nombre, CUIT/DNI, domicilio, condición de IVA), tipo, letra y número, CAE, emisión, vencimiento y período, conceptos (código, cantidad, unidad, precio, descuento, alícuota, importe), detalle de impuestos, percepciones y retenciones, subtotal y total. Lo que no figura va en null; lo que figura pero no se lee con seguridad se anota en `campos_dudosos`. Nada se completa por suposición.
   - **Plazo y reintentos**: todo ocurre en ≤ 100 s (la función tiene 120 s), para que siempre quede guardado el resultado o el error. Si el modelo principal está saturado, sin cupo, demora o corta la respuesta, se prueba con `IA_MODELO_FACTURAS_RESPALDO` (por defecto `gemini-flash-lite-latest`); si el servicio rechaza el esquema, se repite en modo JSON con la forma descripta en el texto. Máximo tres consultas; con la clave inválida o sin permiso no se reintenta. Cada consulta se cuenta en el uso de IA.
   - **Normalización tolerante** (`coerceExtraction`): importes escritos como texto («$ 350.000,00»), fechas DD/MM/AAAA y valores desconocidos se interpretan o se marcan como dudosos, en lugar de descartar toda la lectura. Las lecturas guardadas con versiones anteriores se normalizan al abrirlas.
   - Con Claude se usa además el respaldo automático del servidor si el modelo declina. El texto del comprobante se trata como datos, no como instrucciones.
4. **Controles automáticos** (`validate.ts`), independientes del diseño de la factura: cantidad × precio − descuento = importe por línea; la suma de los conceptos contra el subtotal o el total; subtotal − descuentos + IVA + percepciones = total (admite IVA incluido y el «IVA contenido» informativo); detalle de impuestos contra los totales y contra base × alícuota; fecha de emisión no futura ni muy vieja; vencimiento posterior a la emisión; dígito verificador del CUIT; letra coherente con el IVA (A sin IVA, C con IVA); datos esenciales faltantes; varios comprobantes distintos en una misma subida. Lo que no cierra se muestra y se resalta para revisar; nunca se corrige solo.
5. Revisión: se muestran todos los datos leídos (con los dudosos resaltados) y el resultado de los controles. Cada línea se compara con el catálogo (alias aprendidos del proveedor primero). Solo es "segura" con alias o nombre idéntico o un candidato muy superior; las dudosas exigen confirmación; las nuevas proponen crear el producto con detección de casi duplicados. Si la factura declara el contenido ("caja x100"), se usa esa equivalencia y se muestra la cuenta. Los datos sin campo propio (período, vencimiento, inmueble, CAE) se proponen como notas del gasto o la compra. Los tipos que la app no registra por separado (factura sin letra, E, nota de débito, liquidación) se cargan como «Otro comprobante».
6. Al confirmar se registra la compra (o el gasto general) y se aprenden los alias. Si la lectura se interrumpió, el comprobante muestra el aviso y permite reintentar.

## 7. Proveedor de IA, costos y privacidad

**Proveedor elegido: Gemini (Google)**, por su plan gratuito. La app elige el proveedor así: si hay `GEMINI_API_KEY` (o `GOOGLE_API_KEY`) usa Gemini; si solo hay `ANTHROPIC_API_KEY`, Claude; `IA_PROVEEDOR=gemini|claude` fuerza uno. **Ajustes → Estado del sistema** muestra el proveedor y los modelos en uso.

| Uso | Modelo por defecto (Gemini) | Por qué |
|---|---|---|
| Instrucción al asistente | `gemini-flash-lite-latest` | El de mayor cupo gratuito diario; alcanza para interpretar pedidos cortos con herramientas. |
| Lectura de factura | `gemini-flash-latest` | Mejor lectura de imágenes y PDF; las facturas son menos frecuentes que las instrucciones. |
| Respaldo de facturas | `gemini-flash-lite-latest` | Si el principal está saturado o sin cupo (tiene cupo propio). |

Los alias `-latest` apuntan siempre al modelo vigente, así un retiro de versión no deja la app sin IA (Google avisa antes de cambiarlos). Si se prefiere fijar versiones, se usan `IA_MODELO_ASISTENTE`, `IA_MODELO_FACTURAS` e `IA_MODELO_FACTURAS_RESPALDO` (este último acepta «ninguno» para no usar respaldo).

**Plan gratuito de Gemini — lo que hay que saber:**

- **Cupo**: pocas consultas por minuto y por día por proyecto de Google, y Google lo cambia sin aviso (en 2025-2026 lo redujo varias veces). Cada instrucción al asistente usa de 1 a 3 consultas. Cuando se agota, el asistente sigue en **modo básico** y las facturas se cargan a mano hasta que se renueve. El cupo vigente se ve en Google AI Studio.
- **Privacidad**: en el plan gratuito, Google puede usar lo enviado (instrucciones y facturas) para mejorar sus productos, y personas de Google pueden revisarlo. Por eso la app avisa en el asistente y en Facturas que no se incluyan datos de pacientes (atención con las órdenes de laboratorio, que suelen traer el nombre del paciente).
- **Si el uso crece**: activar la facturación en el proyecto de Google AI Studio quita los límites gratuitos y hace que los datos no se usen para mejorar productos. Con el uso de un consultorio, el costo con Flash-Lite y Flash debería rondar centavos de dólar por día. Consultar precios vigentes en la página de precios de Gemini.

**Alternativa con Claude (Anthropic)**, pago por uso: `claude-haiku-5-5` para el asistente (~US$ 0,001–0,003 por instrucción) y `claude-opus-5-5` para facturas (~US$ 0,05–0,15 por factura); con 50 instrucciones diarias y 100 facturas al mes, unos US$ 8–20 por mes. Anthropic no usa los datos de la API para entrenar modelos.

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
