# NEOSTAR STOCK - Sistema de Gestión de Inventario

## Características

### Flujos principales

**INGRESOS:** Recompra a proveedores, devoluciones, ajustes. Suma stock a Depo Central.

**RETIROS/USO:** Regalos corporativos, incidencias, uso interno. Resta stock.

**MOVIMIENTOS:** Envíos a Santa Fe, Cañada, Funes, Concesionarios. Resta de Central, suma en destino.

**EVENTOS:** Activaciones con remito de salida (Marketing firmando) y remito de llegada. Control de devoluciones.

### Seguridad

- Cada retiro de cliente requiere: apellido + patente
- Eventos requieren firma de Marketing en remitos
- Auditoría completa: quién, qué, cuándo

### Integración futura

- [ ] API de Trello para eventos programados
- [ ] Reportes automáticos
- [ ] Alertas por email
- [ ] Exportación a Excel

## Cómo usar

1. **Ejecutar SQL:** `supabase/schema-complete.sql`
2. **Deploy:** Push a main, Vercel despliega automáticamente
3. **Login:** Usar credenciales Supabase
4. **Comenzar:** Dashboard → Ingresos/Retiros/Movimientos/Eventos

## URLs

- **App:** https://neostar-stock-3v1g.vercel.app
- **Supabase:** https://supabase.com
- **GitHub:** garramoneagustin-sketch/neostar-stock
