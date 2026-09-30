# Neostar Stock

Aplicación multiusuario para gestión de depósito, construida con React, Vite y Supabase.

## Puesta en marcha

1. En Supabase, abrí **SQL Editor** y ejecutá `supabase/schema.sql` completo.
2. En Supabase, creá al menos un usuario desde **Authentication → Users → Add user**.
3. En Vercel, importá este repositorio.
4. Agregá las variables de entorno:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy.

Para ejecutarlo localmente:

```bash
npm install
cp .env.example .env
npm run dev
```

La primera versión incluye login, materiales, dashboard, alertas, movimientos de compra, puntos de entrega y sincronización en tiempo real. Las operaciones sensibles deben ampliarse con funciones SQL transaccionales antes de usarla como sistema definitivo.
