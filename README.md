# Neostar Stock

Aplicación multiusuario para inventario de merchandising multimarca.

## Clasificación
Los materiales se clasifican por **macrocategoría + subcategoría + marca + SKU**. Las marcas son atributos filtrables: Kia, Jeep, RAM, Nissan, BYD, Suzuki, Subaru, Honda y Neostar.

## Registro de retiros
Todo retiro exige un detalle. Los motivos disponibles incluyen operación/reposición, incidencia con cliente, regalo corporativo o especial, visita importante y evento. Para una incidencia con cliente el apellido es obligatorio. Ejemplos: “Regalo futbolista Central retira BYD” o “Presente por visita corporativa directores Nissan”.

## Puesta en marcha
1. Ejecutar `supabase/schema.sql` si todavía no se hizo.
2. Ejecutar `supabase/upgrade.sql` en Supabase SQL Editor.
3. Confirmar en Vercel que las variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` estén configuradas.
4. Cada push a `main` dispara un nuevo deployment.

La interfaz incluye login, dashboard, alertas, CRUD de materiales con búsqueda y filtros, puntos de entrega y registro/historial de retiros.
