# NEOSTAR STOCK — Control de stock del depósito de marketing

La plataforma es la **única fuente de verdad** del stock de marketing. La planilla de Google no se sincroniza:
se carga una sola vez, el día de corte, y después se archiva.

Stack: React + Vite + Supabase (base de datos, usuarios, fotos). Se publica en Vercel desde la rama `main`
(https://stockmarketing.vercel.app).

## Qué hace

- **Materiales:** catálogo con categorías (tabla `categories`), marcas, fotos y stock en DEPOSITO MARKETING ROSARIO.
- **Ingresos / Retiros:** entradas por compra y salidas (regalos, incidencias, uso interno). Un retiro puede llevar varios materiales.
- **Envíos:** cada destino tiene un abastecedor (`destinations.supplied_by_id`; vacío = Rosario). Un envío fuera de esa regla es un
  *envío excepcional*: solo Marketing, con motivo obligatorio.
- **En camino / recepción:** el depósito destino controla cada material (✓ / ✗); las diferencias se resuelven contra el depósito de origen real.
- **Depósitos y puntos:** stock por depósito (consumibles y equipamiento en préstamo) y registro de lo enviado a concesionarios.
- **Eventos:** reservan materiales por fechas; se pueden editar mientras estén abiertos; el regreso se registra en una sola operación.
- **Historial:** todo con fecha y responsable, con filtros y exportación a Excel (CSV).
- **Usuarios:** solo el Dueño cambia roles y depósitos.

## Roles

`admin`, `editor` (Marketing), `punto` (un depósito), `viewer` (solo lectura), `none` (sin acceso).
Hay un único **Dueño** (`profiles.is_owner`), siempre administrador; solo se transfiere desde el SQL Editor.

## Seguridad

- Todo el stock cambia únicamente a través de funciones del servidor (RPC `SECURITY DEFINER`) con RLS; un disparador impide editar stock a mano.
- Los ajustes de stock de un depósito quedan marcados «para revisar» hasta que Marketing los ve.
- Nadie borra filas: «Eliminar» un material con historial lo archiva.

## Base de datos

- `supabase/migrations/001…017`: historial de cambios, en orden.
- `supabase/manual/A_pegar_antes_de_mergear.sql`: pasos con `DROP`/`DELETE` que se pegan a mano en el SQL Editor **antes** de mergear la ronda 2.
- `supabase/manual/B_pegar_despues_de_mergear.sql`: limpieza y endurecimiento (fotos, funciones y columnas viejas, políticas), **después** de mergear.
- `supabase/schema-complete.sql` es el esquema original; el estado real de producción es el resultado de aplicar las migraciones.

## Desarrollo

```
npm install
npm run dev      # desarrollo
npm run build    # build de producción
```

Variables de entorno (Vercel): `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.

## Autenticación

Recuperar contraseña usa el correo de Supabase. En Supabase → Authentication → URL Configuration:
*Site URL* `https://stockmarketing.vercel.app` y *Redirect URLs* `https://stockmarketing.vercel.app/**`.
