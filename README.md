# Clínica Clara

Aplicación web para administrar inventario, compras, gastos y movimientos de un consultorio odontológico. La interfaz está en español y usa ARS y `America/Argentina/Buenos_Aires` por defecto. Es una herramienta administrativa, no un sistema de contabilidad fiscal certificado.

## Arquitectura actual

- Next.js Pages Router, React y JavaScript, conservando la arquitectura que ya tenía el repositorio.
- Supabase Auth en cookies seguras y Supabase PostgreSQL con RLS para separar consultorios.
- Zod valida entradas de las API. Las operaciones que cambian stock o dinero llaman funciones PostgreSQL con transacciones.
- `NUMERIC` guarda cantidades y dinero; los totales del dashboard se suman en centavos con `BigInt`.
- Las tablas expuestas tienen RLS. El navegador no recibe una clave `service_role`.

Migración inicial: `supabase/migrations/202610260001_inventory_core.sql`.

## Requisitos

- Node.js 20.9 o posterior y npm.
- Proyecto Supabase propio con PostgreSQL y Auth.
- Git para versionar migraciones y configuración.

## Instalación local

```bash
npm install
cp .env.example .env.local
```

Completa `.env.local` con la URL del proyecto y la clave pública `anon`/publishable de Supabase. No pongas `service_role`, claves de IA ni otros secretos en variables `NEXT_PUBLIC_*`.

En Supabase, aplica la migración desde SQL Editor o con Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase db push
```

La migración no inserta productos de muestra. En Authentication, habilita Email/Password y crea/invita usuarios desde el panel de Supabase. La primera persona autenticada que configure el consultorio queda como propietaria. Los nuevos usuarios deben ser agregados a `clinic_members` por un administrador con un flujo administrativo seguro; no se ofrece aún una pantalla de invitaciones.

El bucket privado para comprobantes todavía no se crea porque la carga/revisión de facturas no está implementada. No cargues documentos en buckets públicos.

## Ejecutar y verificar

```bash
npm run dev
npm test
npm run build
npm start
```

`npm test` ejecuta pruebas unitarias de esquemas de entrada y aritmética decimal. La migración no ha sido aplicada ni probada contra un proyecto Supabase desde este entorno sin credenciales.

## Funcionalidades implementadas

- Inicio de sesión, cierre de sesión y creación inicial del espacio del consultorio.
- Dashboard con datos consultados en PostgreSQL, alertas agotado/bajo, gastos del mes y actividad reciente.
- Catálogo con búsqueda, unidades base, stock inicial auditado, edición de metadatos y archivado lógico. La unidad base no puede cambiar si ya existe historial.
- Entradas manuales, consumos sin gasto asociado y ajustes a cantidad absoluta, con bloqueo de stock negativo y registro del antes/después.
- Registro de compra de una línea en unidad base: crea compra, línea, gasto único y entrada de stock en una transacción. Incluye idempotencia para reintentos con la misma clave.
- Gastos manuales independientes, proveedores básicos e historial de movimientos.
- Exportación CSV de los gastos mostrados, con neutralización de fórmulas.
- Consultas sencillas locales por texto y dictado del navegador cuando la API de voz está disponible. Las operaciones mutativas no las ejecuta el asistente.
- Layout responsive, mensajes de error, etiquetas accesibles y controles manuales disponibles sin IA.

## Límites conocidos y siguientes etapas

Esta entrega es una base integrada, no cubre todo el alcance del prompt. No se implementaron aún: gestión de roles e invitaciones desde UI, filtros de período/proveedor/categoría en informes, gráficos, reversión compensatoria, lotes y vencimientos, conversiones comerciales configurables, adjuntos y extracción/revisión de facturas, almacenamiento privado, transcripción/procesamiento IA de servidor, edición completa de compras, ni pruebas de integración/RLS/concurrencia. El formulario de compra actual registra una línea y cantidades exclusivamente en unidad base. No se deben cargar compras ambiguas ni documentos hasta incorporar el flujo de borrador y revisión.

No se declara configurado el proveedor IA porque no está implementado el cliente de IA. La variable `OPENAI_API_KEY` del ejemplo está reservada para una etapa futura y no altera el comportamiento actual. El dictado del navegador puede transmitir audio al proveedor del navegador según su implementación; para un entorno con requisitos estrictos de privacidad, desactivalo hasta integrar transcripción del lado servidor.

## Despliegue

En Vercel, configura `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` en los entornos correspondientes, aplica la migración al proyecto Supabase y ejecuta el build de producción. Mantén activas las copias de seguridad de PostgreSQL y conserva las migraciones versionadas. No se ejecutó un despliegue durante esta tarea.

## Variables

Ver `.env.example`. Las claves privadas de proveedores externos deben permanecer en el servidor y no están requeridas por las funciones actuales.