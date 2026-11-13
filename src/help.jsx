import React, { useMemo, useState } from 'react';
import { Modal } from './ui';

// ============================================================================
// Ayuda «¿Cómo hago…?»
// Cada guía explica un proceso de la plataforma. Es contenido fijo (no usa IA):
// responde siempre lo mismo que el manual de uso.
//   roles:  'staff' (Admin/Editor y Solo lectura), 'punto' (usuario de depósito),
//           'admin' (solo Administradores), 'all' (todos)
//   action: botón que abre el formulario o la pantalla correcta (lo resuelve App.jsx)
//   choices: guías de decisión («¿cuál de estos casos es el tuyo?»)
// ============================================================================
export const GUIDES = [
  // ---------------------------------------------------------------- decisiones
  {
    id: 'sale-y-vuelve', roles: ['staff'], title: 'Algo sale de Rosario y después vuelve (lonas, gazebos, banners…)',
    keywords: 'vuelve vuelven volver regresa regresan prestar presto prestamo préstamo temporal sale y vuelve llevar traer lona lonas santa fe cañada evento deposito',
    strong: 'van y vuelven prestamo préstamo prestar temporal',
    intro: 'Depende de para qué sale. Elegí tu caso:',
    choices: [
      { label: 'Va a un evento (activación, feria, muestra) y vuelve al terminar', guide: 'evento' },
      { label: 'Se queda un tiempo en el Depósito Santa Fe o en Cañada y después vuelve', guide: 'envio-deposito', then: 'devolver' },
      { label: 'Lo dejo en un concesionario y después vuelve', guide: 'envio-conce', then: 'devolver' }
    ]
  },
  // ---------------------------------------------------------------- Rosario
  {
    id: 'compra', roles: ['staff'], title: 'Registrar una compra o mercadería que llega al Depósito Rosario',
    keywords: 'compra compré compramos proveedor llego llegó mercaderia mercadería ingreso entrada remito factura entra sumar reponer recibimos pedido',
    steps: ['Tocá «+ Nuevo» → «Ingreso de mercadería».', 'Elegí el origen: Proveedor u Otro (si es Otro, aclaralo en notas).', 'En Notas poné el remito o el proveedor.', 'Agregá cada material con su cantidad. El costo es opcional (lo que costó toda la línea).', 'Tocá «Guardar ingreso». Se suma al stock de Rosario.'],
    notes: ['Si un depósito o concesionario devuelve algo, no va acá: usá «Devolver a Rosario».'],
    action: 'restock', actionLabel: 'Abrir «Ingreso de mercadería»', related: ['devolver', 'material']
  },
  {
    id: 'retiro', roles: ['staff'], title: 'Registrar un regalo, un uso interno o algo que sale de Rosario y no vuelve',
    keywords: 'regalo regalar regale regalé obsequio retiro retirar sacar saco uso interno salida consumo consumir entregar entrego dar doy sale no vuelve gasto',
    steps: ['Tocá «+ Nuevo» → «Retiro».', 'Elegí el motivo: Regalo corporativo, Incidencia con cliente, Uso interno u Otro.', 'Escribí la descripción: para quién o para qué (es obligatoria).', 'Agregá los materiales y cantidades. Podés sacar varios juntos.', 'Tocá «Guardar retiro». Se descuenta de Rosario.'],
    notes: ['Lo reservado para eventos no se puede retirar.', 'Si a uno de los materiales le falta stock, no se registra ninguno.'],
    action: 'withdrawal', actionLabel: 'Abrir «Retiro»', related: ['incidencia', 'sale-y-vuelve']
  },
  {
    id: 'incidencia', roles: ['staff'], title: 'Darle algo a un cliente por una incidencia o reclamo',
    keywords: 'cliente reclamo incidencia queja compensar compensacion patente apellido dominio',
    steps: ['Tocá «+ Nuevo» → «Retiro».', 'Motivo: «Incidencia con cliente».', 'Completá el apellido del cliente y la patente (son obligatorios).', 'Escribí la descripción, agregá los materiales y guardá.'],
    action: 'withdrawal', actionLabel: 'Abrir «Retiro»', related: ['retiro']
  },
  // ---------------------------------------------------------------- Eventos
  {
    id: 'evento', roles: ['staff'], title: 'Armar un evento: reservar, entregar y registrar el regreso',
    keywords: 'evento eventos activacion activación feria exposicion exposición expo muestra stand lanzamiento reservar reserva llevar evento',
    steps: ['Tocá «+ Nuevo» → «Evento».', 'Completá nombre, fecha de inicio, fecha de fin, marca y responsable (quién se lleva las cosas).', 'Agregá los elementos y cantidades y guardá. Quedan reservados para esas fechas (todavía no se descuentan).', 'Cuando se los llevan: en la tarjeta del evento, «Entregar materiales». Ahí salen de Rosario.', 'Imprimí el comprobante con «Retiro para imprimir» para que firme quien se lleva todo.', 'Cuando vuelven: «Registrar regreso» (o «Marcar como realizado»). Indicás cuánto volvió; lo que no volvió queda como consumido.'],
    notes: ['Lo reservado no se puede retirar ni enviar a otro lado.', 'El máximo de cada elemento tiene en cuenta otros eventos que se pisan en fechas.'],
    action: 'event', actionLabel: 'Abrir «Nuevo evento»', related: ['evento-entregar', 'evento-cerrar', 'evento-cancelar']
  },
  {
    id: 'evento-entregar', roles: ['staff'], title: 'Entregar los materiales de un evento e imprimir el retiro',
    keywords: 'retiro imprimir firma firmar entregar entrega evento remito comprobante word pdf se llevan salen',
    steps: ['Andá a Eventos.', 'En la tarjeta del evento tocá «Entregar materiales», escribí quién retira y confirmá. Se descuenta de Rosario.', 'Tocá «Retiro para imprimir» → «Imprimir / Guardar PDF» o «Descargar Word».'],
    action: 'goto:eventos', actionLabel: 'Ir a Eventos', related: ['evento', 'evento-cerrar']
  },
  {
    id: 'evento-cerrar', roles: ['staff'], title: 'Registrar el regreso de un evento o marcarlo como realizado',
    keywords: 'regreso volvio volvió volvieron vuelta termino terminó realizado cerrar finalizar evento falto faltó perdio perdió consumido',
    steps: ['Andá a Eventos.', 'En la tarjeta tocá «Registrar regreso» (o «Marcar como realizado» si ya pasó la fecha de fin).', 'Indicá cuánto volvió de cada elemento y confirmá.'],
    notes: ['Lo que vuelve se suma a Rosario. Lo que no vuelve queda registrado como «Consumido en evento».', 'Si figuran materiales sin entregar, primero entregalos (si el evento se hizo) o sacalos con «Editar evento».'],
    action: 'goto:eventos', actionLabel: 'Ir a Eventos', related: ['evento']
  },
  {
    id: 'evento-cancelar', roles: ['staff'], title: 'Cancelar un evento que no se hizo',
    strong: 'cancelar cancelado cancelo suspendio suspendió suspender',
    keywords: 'cancelar cancelado suspender suspendido no se hizo anular evento',
    steps: ['Andá a Eventos.', 'En la tarjeta tocá «Cancelar evento» y confirmá. Se liberan las reservas.'],
    notes: ['Solo se puede si todavía no se entregó nada. Si ya se entregó, registrá el regreso.'],
    action: 'goto:eventos', actionLabel: 'Ir a Eventos', related: ['evento-cerrar']
  },
  {
    id: 'evento-editar', roles: ['staff'], title: 'Cambiar fechas o elementos de un evento, o repetirlo',
    keywords: 'editar modificar cambiar fecha fechas agregar sacar elemento evento duplicar repetir copiar',
    steps: ['Andá a Eventos.', 'En la tarjeta: «Editar evento» para cambiar fechas, responsable, notas o lo que todavía está solo reservado.', 'Para hacer el mismo evento en otra fecha: «Duplicar para otras fechas».'],
    notes: ['Lo ya entregado queda bloqueado y la marca no se puede cambiar.'],
    action: 'goto:eventos', actionLabel: 'Ir a Eventos', related: ['evento']
  },
  // ---------------------------------------------------------------- Envíos
  {
    id: 'envio-deposito', roles: ['staff'], title: 'Mandar materiales al Depósito Santa Fe o a Cañada de Gómez',
    keywords: 'enviar envio envío mandar mando mandamos santa fe cañada canada deposito depósito despachar llevar',
    steps: ['Tocá «+ Nuevo» → «Envío».', 'Sale desde: Depósito Rosario.', 'Destino: Depósito Santa Fe o Multimarca – Cañada de Gómez.', 'Poné quién lo recibe, agregá los materiales y tocá «Registrar envío».', 'Queda «En camino» hasta que el depósito lo recibe y controla. Recién ahí se suma a su stock.'],
    notes: ['El equipamiento (lonas, gazebos, sillas…) le aparece al depósito como «Equipamiento en préstamo».'],
    action: 'send', actionLabel: 'Abrir «Envío»', related: ['pendientes', 'diferencia', 'devolver']
  },
  {
    id: 'envio-conce', roles: ['staff'], title: 'Mandar materiales a un concesionario',
    keywords: 'concesionario concesionaria sucursal agencia kia nissan byd jeep ram subaru suzuki honda funes rosario enviar mandar',
    steps: ['Tocá «+ Nuevo» → «Envío».', 'Sale desde: Depósito Rosario (o Depósito Santa Fe para los concesionarios de Santa Fe).', 'Elegí el concesionario, agregá los materiales y tocá «Registrar envío».'],
    notes: ['A los concesionarios no se les controla la recepción: queda el registro de lo enviado.', 'Lo que el concesionario va usando se descuenta con «Ajustar» en Depósitos y puntos.'],
    action: 'send', actionLabel: 'Abrir «Envío»', related: ['excepcional', 'devolver']
  },
  {
    id: 'excepcional', roles: ['staff'], title: 'Mandar desde Rosario a un concesionario de Santa Fe (envío excepcional)',
    keywords: 'excepcional excepcion excepción urgente otro deposito no corresponde santa fe desde rosario',
    steps: ['Tocá «+ Nuevo» → «Envío».', 'Sale desde: Depósito Rosario. Elegí el concesionario.', 'Tildá «Envío excepcional» y escribí el motivo.', 'Agregá los materiales y registrá el envío.'],
    notes: ['Solo Administradores y Editores. Queda registrado quién lo hizo y por qué.'],
    action: 'send', actionLabel: 'Abrir «Envío»', related: ['envio-conce']
  },
  {
    id: 'devolver', roles: ['staff'], title: 'Registrar que algo vuelve a Rosario desde un depósito o concesionario',
    strong: 'devolver devolucion devolución devuelve devuelven devolvieron',
    keywords: 'devolver devolucion devolución devuelve devuelven volvio volvió vuelve regresa rosario traer trajeron',
    steps: ['Andá a «Depósitos y puntos» y elegí el depósito o concesionario de donde vuelve.', 'En el material, menú «⋯» → «Devolver a Rosario».', 'Poné la cantidad y confirmá. Se descuenta de ahí y se suma a Rosario en el momento.'],
    notes: ['Lo registran Administradores y Editores. Si sos usuario de depósito, avisale a Marketing.', 'No lo cargues como «Ingreso de mercadería»: quedaría contado dos veces.'],
    action: 'goto:depositos', actionLabel: 'Ir a Depósitos y puntos', related: ['envio-deposito']
  },
  {
    id: 'cargar-deposito', roles: ['staff'], title: 'Cargar stock en Santa Fe o Cañada que no vino desde Rosario',
    keywords: 'cargar carga stock deposito depósito santa fe cañada canada ya estaba llego por otro lado proveedor directo',
    steps: ['Andá a «Depósitos y puntos» y elegí el depósito.', 'Tocá «+ Cargar stock», elegí el material, la cantidad y el motivo.'],
    notes: ['No lo uses para lo que manda Rosario: eso se suma solo cuando el depósito recibe el envío. Si no, queda contado dos veces.'],
    action: 'goto:depositos', actionLabel: 'Ir a Depósitos y puntos', related: ['envio-deposito']
  },
  {
    id: 'pendientes', roles: ['staff'], title: 'Ver qué envíos siguen en camino o tienen diferencias',
    keywords: 'en camino pendiente pendientes llego llegó recibieron recibido seguimiento transito tránsito demorado',
    steps: ['Andá a Envíos y tocá «Pendientes de recibir».'],
    notes: ['Si un envío lleva más de 5 días en camino, también aparece en el Dashboard.'],
    action: 'goto:pendientes', actionLabel: 'Ver pendientes de recibir', related: ['diferencia']
  },
  {
    id: 'diferencia', roles: ['staff'], title: 'Resolver un envío que llegó con diferencia',
    strong: 'diferencia falta faltaron faltaba faltan falto faltó faltante dañado dañados roto rotos sobrante sobraron',
    keywords: 'envio envío diferencia diferencias falto faltó faltante faltan llego menos llegó de más sobrante dañado danado roto equivocado resolver',
    steps: ['En el Dashboard (cartel rojo) o en Envíos, tocá «Resolver diferencia».', 'Para cada faltante elegí qué pasó: va en el próximo envío, nunca salió del origen, se perdió o rompió, error de conteo en destino o sobrante.', 'Si pasó más de una cosa, usá «+ Dividir en otra opción».', 'Confirmá. Cada opción ajusta el stock donde corresponde.'],
    action: 'goto:dashboard', actionLabel: 'Ir al Dashboard', related: ['pendientes']
  },
  // ---------------------------------------------------------------- Stock y materiales
  {
    id: 'buscar', roles: ['staff'], title: 'Saber cuánto hay de un material y dónde está',
    keywords: 'cuanto cuánto hay stock donde dónde esta está buscar ver consultar disponible reservado cantidad tenemos queda quedan',
    steps: ['Andá a Materiales y escribí el nombre o la marca en «Buscar».', 'Tocá el nombre para abrir la ficha: stock en Rosario, reservado, disponible, en qué depósitos hay y qué eventos lo tienen reservado.'],
    action: 'goto:stock', actionLabel: 'Ir a Materiales', related: ['historial']
  },
  {
    id: 'ajuste', roles: ['staff'], title: 'Corregir el stock de un material (rotura, error, no coincide)',
    strong: 'rompio rompió rompieron roto rotura ajustar ajuste corregir coincide',
    keywords: 'ajustar ajuste corregir corrijo error equivoque equivoqué rompio rompió roto rotura perdido perdio no coincide numero número mal cargado stock real',
    steps: ['Andá a Materiales (o a Depósitos y puntos si es de otro depósito).', 'En el material, menú «⋯» → «Ajustar stock».', 'Poné la cantidad real y el motivo (es obligatorio). Guardá.'],
    notes: ['El stock no se cambia desde «Editar»: así todo cambio queda registrado con motivo.', 'Para corregir muchos materiales juntos, usá «Conteo físico».'],
    action: 'goto:stock', actionLabel: 'Ir a Materiales', related: ['conteo']
  },
  {
    id: 'conteo', roles: ['staff'], title: 'Contar el depósito y corregir todo junto',
    keywords: 'conteo contar inventario control fisico físico relevamiento auditoria auditoría estante',
    steps: ['Tocá «+ Nuevo» → «Conteo físico».', 'Elegí qué depósito contás y escribí el motivo (por ejemplo, «conteo mensual»).', 'Cargá lo contado en «Contado». Lo que no contaste dejalo en blanco.', 'Tocá «Guardar conteo». Solo se registran los materiales que cambiaron.'],
    action: 'count', actionLabel: 'Abrir «Conteo físico»', related: ['ajuste']
  },
  {
    id: 'material', roles: ['staff'], title: 'Dar de alta un material nuevo',
    keywords: 'nuevo material alta crear agregar producto articulo artículo cargar material',
    steps: ['Tocá «+ Nuevo» → «Material nuevo».', 'Nombre (tipo + detalle, sin la marca), tipo, categoría y marca.', 'Opcional: stock inicial en Rosario, mínimo para la alerta, demora del proveedor y fotos.', 'Tocá «Guardar». Si existe para otra marca, «Guardar y crear otra marca».'],
    notes: ['No puede haber dos materiales con el mismo nombre y la misma marca.'],
    action: 'item', actionLabel: 'Abrir «Material nuevo»', related: ['importar', 'editar-material']
  },
  {
    id: 'editar-material', roles: ['staff'], title: 'Cambiar nombre, categoría, marca, foto o mínimo de un material',
    keywords: 'editar modificar cambiar nombre categoria categoría marca foto fotos imagen mínimo minimo material',
    steps: ['Andá a Materiales y buscá el material.', 'Menú «⋯» → «Editar». Cambiá lo que necesites y guardá.'],
    notes: ['Si la foto aparece con ❓, está en Drive y no se puede abrir: compartila como «Cualquier persona con el enlace» o reemplazala acá.'],
    action: 'goto:stock', actionLabel: 'Ir a Materiales', related: ['ajuste']
  },
  {
    id: 'archivar', roles: ['staff'], title: 'Dar de baja un material que ya no se usa',
    keywords: 'eliminar borrar baja archivar ya no se usa discontinuado sacar material',
    steps: ['Dejalo en 0 (con un ajuste o un retiro, según corresponda).', 'En Materiales, menú «⋯» → «Eliminar o archivar».'],
    notes: ['Si tuvo movimientos se archiva: deja de verse pero se conserva todo su historial.'],
    action: 'goto:stock', actionLabel: 'Ir a Materiales', related: ['ajuste']
  },
  {
    id: 'importar', roles: ['staff'], title: 'Cargar muchos materiales desde una planilla',
    keywords: 'importar planilla excel csv carga masiva muchos plantilla',
    steps: ['Tocá «+ Nuevo» → «Importar planilla» → «Bajar plantilla».', 'Completala: Material, Categoría, Marca, Depósito, Cantidad y Mínimo.', 'Guardala como CSV (delimitado por comas) y subila.', 'Revisá la vista previa y tocá «Importar».'],
    notes: ['Lo que ya existe no se pisa: no duplica stock.'],
    action: 'import', actionLabel: 'Abrir «Importar planilla»', related: ['material']
  },
  {
    id: 'alertas', roles: ['staff'], title: 'Saber qué hay que recomprar o reponer',
    keywords: 'alerta alertas recomprar comprar reponer reposicion reposición poco bajo se acaba acabando falta minimo mínimo',
    steps: ['Mirá el Dashboard, bloque «Alertas»: «Recomprar al proveedor» (Rosario) y «Reponer en depósitos».', 'Desde ahí podés «Registrar compra» o «Enviar desde Rosario».'],
    notes: ['Un material entra en alerta cuando baja de su mínimo o del punto calculado con lo consumido en los últimos 90 días.'],
    action: 'goto:dashboard', actionLabel: 'Ir al Dashboard', related: ['minimo']
  },
  {
    id: 'minimo', roles: ['staff'], title: 'Configurar el aviso de stock bajo (mínimo)',
    keywords: 'minimo mínimo aviso alerta punto de pedido restock reponer configurar avisar',
    steps: ['Rosario: en Materiales, «⋯» → «Editar» y completá el mínimo.', 'Otro depósito: en Depósitos y puntos, en el material, menú «⋯» → «Cambiar mínimo».'],
    action: 'goto:stock', actionLabel: 'Ir a Materiales', related: ['alertas']
  },
  {
    id: 'historial', roles: ['staff', 'punto'], title: 'Ver quién movió algo o sacar un reporte',
    keywords: 'historial reporte informe excel exportar quien quién movio movió cuando cuándo registro movimientos',
    steps: ['Andá a Historial.', 'Filtrá por texto, tipo, depósito, marca o fechas.', 'Con «Exportar Excel (CSV)» bajás lo filtrado.'],
    action: 'goto:historial', actionLabel: 'Ir a Historial'
  },
  {
    id: 'usuario', roles: ['admin'], title: 'Dar acceso a una persona nueva o quitárselo',
    keywords: 'usuario usuarios acceso alta baja permiso rol invitar persona nueva empleado deja equipo',
    steps: ['La persona se invita desde Supabase → Authentication → Users.', 'Cuando entra por primera vez aparece en Usuarios como «Sin acceso».', 'El Dueño le asigna el rol (y el depósito, si es usuario de depósito).', 'Si alguien deja el equipo: rol «Sin acceso». No se borra nada de lo que registró.'],
    action: 'goto:usuarios', actionLabel: 'Ir a Usuarios'
  },
  // ---------------------------------------------------------------- Usuarios de depósito
  {
    id: 'p-recibir', roles: ['punto'], title: 'Recibir un envío que llegó a mi depósito',
    keywords: 'recibir recepcion recepción llego llegó envio envío controlar paquete caja',
    steps: ['Andá a «Por recibir» y tocá «Recibir» en el envío.', 'Marcá ✓ en cada material que llegó bien (o «Marcar todo ✓»).', 'Tocá «Confirmar recepción». Lo que llegó bien se suma a tu stock al instante.'],
    action: 'goto:recepcion', actionLabel: 'Ir a Por recibir', related: ['p-diferencia']
  },
  {
    id: 'p-diferencia', roles: ['punto'], title: 'Llegó menos, dañado o algo distinto',
    strong: 'falta faltaron faltaba falto faltó faltante dañado roto diferencia',
    keywords: 'falto faltó faltante menos dañado danado roto distinto otro equivocado de más diferencia',
    steps: ['Al recibir, marcá ✗ en ese material.', 'Elegí el motivo (faltante, dañado, otro material, de más) y la cantidad que llegó bien.', 'Confirmá. Marketing ve la diferencia y la resuelve.'],
    action: 'goto:recepcion', actionLabel: 'Ir a Por recibir', related: ['p-recibir']
  },
  {
    id: 'p-entregar', roles: ['punto'], title: 'Registrar algo que entregué desde mi depósito',
    keywords: 'entregar entregue entregué regalo cliente dar di uso interno salida sacar evento sucursal',
    steps: ['Andá a «Mi depósito».', 'En el material, tocá «Entregar».', 'Poné la cantidad, el motivo y a quién o para qué. Si es incidencia con cliente, también apellido y patente.'],
    action: 'goto:mideposito', actionLabel: 'Ir a Mi depósito', related: ['p-ajustar']
  },
  {
    id: 'p-enviar', roles: ['punto'], title: 'Mandar materiales a un concesionario que abastezco',
    keywords: 'enviar mandar concesionario sucursal kia byd honda subaru suzuki santa fe',
    steps: ['En «Mi depósito», tocá «Enviar a concesionario».', 'Elegí el concesionario, agregá los materiales y registrá el envío.'],
    notes: ['Solo si tu depósito abastece concesionarios (Depósito Santa Fe).'],
    action: 'send-own', actionLabel: 'Abrir «Envío»'
  },
  {
    id: 'p-devolver', roles: ['punto'], title: 'Algo de mi depósito vuelve a Rosario',
    strong: 'devolver devolucion devolución devuelve',
    keywords: 'devolver devolucion devolución vuelve volver rosario regresa mandar a rosario ya no se usa',
    steps: ['Avisale a Marketing qué vuelve y cuánto.', 'Marketing lo registra con «Devolver a Rosario»: se descuenta de tu depósito y se suma a Rosario.'],
    notes: ['Los usuarios de depósito no registran devoluciones: las carga Marketing.']
  },
  {
    id: 'p-ajustar', roles: ['punto'], title: 'El stock de mi depósito no coincide con el estante',
    keywords: 'ajustar corregir no coincide error conteo contar inventario numero número mal',
    steps: ['Uno solo: en «Mi depósito», en el material, menú «⋯» → «Ajustar stock», con la cantidad real y el motivo.', 'Varios: tocá «Conteo físico» y cargá lo contado.'],
    notes: ['Marketing revisa los ajustes que hacen los depósitos.'],
    action: 'count-own', actionLabel: 'Abrir «Conteo físico»'
  },
  {
    id: 'p-cargar', roles: ['punto'], title: 'Cargar stock que no vino desde Rosario',
    keywords: 'cargar agregar sumar stock llego por otro lado proveedor directo encontre encontré',
    steps: ['Avisale a Marketing qué llegó, cuánto y de dónde.', 'Marketing lo carga con «+ Cargar stock» en tu depósito.'],
    notes: ['Lo que manda Rosario no hace falta cargarlo: se suma solo cuando recibís el envío.']
  },
  {
    id: 'p-minimo', roles: ['punto'], title: 'Que me avise cuando algo se está acabando',
    keywords: 'minimo mínimo aviso alerta acabando acaba poco reponer pedir',
    steps: ['En «Mi depósito», en el material, menú «⋯» → «Cambiar mínimo», y poné la cantidad a la que querés que avise.'],
    action: 'goto:mideposito', actionLabel: 'Ir a Mi depósito'
  },
  // ---------------------------------------------------------------- Todos
  {
    id: 'contrasena', roles: ['all'], title: 'Cambiar mi contraseña o recuperarla',
    strong: 'contraseña contrasena clave password',
    keywords: 'contraseña contrasena clave password olvide olvidé cambiar entrar ingresar acceso',
    steps: ['Cerrá sesión.', 'En la pantalla de ingreso escribí tu email y tocá «Olvidé mi contraseña».', 'Abrí el correo y tocá el link: se abre la pantalla para poner una contraseña nueva.']
  }
];

const STOP = new Set('a al como cómo con de del el en es hago hacer la las lo los me mi mis para por que qué se si su sus un una unos unas y o va van voy vamos tengo quiero puedo necesito registro registrar cargo cargar'.split(' '));
// Nombres de lugares y marcas: ayudan a desempatar, pero no definen qué querés hacer
const LOW = new Set('santa fe canada cañada rosario funes gomez deposito kia nissan byd jeep ram subaru suzuki honda neostar'.split(' '));
const clean = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ');
const tokens = (s) => clean(s).split(/\s+/).filter(t => t.length > 1 && !STOP.has(t));
// Compara por raíz (primeras 5 letras) para que «vuelven» encuentre «vuelve» y «lonas» encuentre «lona»
const stem = (t) => t.slice(0, Math.max(4, Math.min(5, t.length)));

export function searchGuides(query, list) {
  const q = tokens(query);
  if (!q.length) return list;
  const scored = list.map(g => {
    const title = tokens(g.title), kw = tokens(g.keywords), strong = tokens(g.strong), body = tokens([g.intro, ...(g.steps || []), ...(g.notes || [])].join(' '));
    const has = (arr, t) => arr.some(x => x === t || stem(x) === stem(t));
    let score = 0, hits = 0;
    q.forEach(t => {
      let s = 0;
      if (has(strong, t)) s += 6;
      if (has(title, t)) s += 3;
      if (has(kw, t)) s += 2;
      if (has(body, t)) s += 1;
      if (s && LOW.has(t)) s = 1;
      if (s) hits++;
      score += s;
    });
    if (g.choices) score += hits >= 2 ? 2 : 0; // las guías de decisión suben si coinciden varias palabras
    return { g, score, hits };
  }).filter(x => x.score > 0);
  scored.sort((a, b) => b.score - a.score || b.hits - a.hits);
  return scored.map(x => x.g);
}

// Guías que aparecen primero según la pantalla donde está el usuario
const BY_TAB = {
  dashboard: ['alertas', 'diferencia', 'pendientes', 'evento-cerrar'],
  ingresos: ['compra', 'devolver'], retiros: ['retiro', 'incidencia'],
  movimientos: ['envio-deposito', 'envio-conce', 'diferencia', 'pendientes'],
  eventos: ['evento', 'evento-entregar', 'evento-cerrar', 'evento-cancelar'],
  stock: ['buscar', 'material', 'ajuste', 'editar-material'], depositos: ['devolver', 'envio-conce', 'minimo'],
  historial: ['historial'], usuarios: ['usuario'],
  mideposito: ['p-entregar', 'p-ajustar', 'p-cargar'], recepcion: ['p-recibir', 'p-diferencia']
};
const POPULAR_STAFF = ['sale-y-vuelve', 'compra', 'retiro', 'envio-deposito', 'evento', 'ajuste', 'buscar'];
const POPULAR_PUNTO = ['p-recibir', 'p-entregar', 'p-diferencia', 'p-devolver', 'p-ajustar'];

export function guidesForRole({ role, isPunto, canSendOwn }) {
  return GUIDES.filter(g => {
    if (g.id === 'p-enviar' && !canSendOwn) return false;
    if (g.roles.includes('all')) return true;
    if (isPunto) return g.roles.includes('punto');
    if (g.roles.includes('admin')) return role === 'admin';
    return g.roles.includes('staff');
  });
}

export function HelpModal({ tab, role, isPunto, canOperate, canSendOwn, onAction, onClose }) {
  const list = useMemo(() => guidesForRole({ role, isPunto, canSendOwn }), [role, isPunto, canSendOwn]);
  const byId = useMemo(() => Object.fromEntries(list.map(g => [g.id, g])), [list]);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const [trail, setTrail] = useState(null); // guía siguiente sugerida desde una decisión

  // Solo los más relevantes: con frases largas coinciden muchas guías por palabras sueltas
  const results = useMemo(() => searchGuides(q, list).slice(0, 5), [q, list]);
  const suggested = useMemo(() => {
    const ids = [...(BY_TAB[tab] || []), ...(isPunto ? POPULAR_PUNTO : POPULAR_STAFF)];
    return [...new Set(ids)].map(id => byId[id]).filter(Boolean).slice(0, 7);
  }, [tab, isPunto, byId]);
  const shown = q.trim() ? results : suggested;

  const open = (id, then = null) => { setOpenId(id); setTrail(then); setTimeout(() => document.getElementById('help-' + id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30); };
  const ensureVisible = (id) => { if (!shown.some(g => g.id === id)) setQ(byId[id]?.title || ''); };

  return (
    <Modal title="¿Cómo hago…?" onClose={onClose} onSubmit={(e) => e.preventDefault()} hideSubmit cancelLabel="Cerrar" wide>
      <p className="muted small help-intro">Escribí lo que querés hacer con tus palabras. Por ejemplo: «lonas que van a Santa Fe y vuelven», «regalé gorras», «llegó una compra».</p>
      <input className="help-search" type="search" value={q} onChange={(e) => { setQ(e.target.value); setOpenId(null); setTrail(null); }} placeholder="¿Qué querés hacer?" aria-label="Buscar en la ayuda" autoFocus />
      {!q.trim() && <p className="help-section-label">Sugerencias para esta pantalla</p>}
      {q.trim() && !results.length && (
        <div className="help-empty">
          <p><strong>No encontré una guía para eso.</strong> Probá con otras palabras (por ejemplo «enviar», «regalo», «evento», «devolver»), o consultá con el equipo de Marketing.</p>
        </div>
      )}
      <div className="help-list">
        {shown.map(g => {
          const isOpen = openId === g.id || (q.trim() && results[0]?.id === g.id && openId === null);
          return (
            <div key={g.id} id={'help-' + g.id} className={`help-item${isOpen ? ' open' : ''}${g.choices ? ' decision' : ''}`}>
              <button type="button" className="help-title" aria-expanded={!!isOpen} onClick={() => { setOpenId(isOpen ? '' : g.id); setTrail(null); }}>
                <span>{g.choices ? '🧭 ' : ''}{g.title}</span><span className="help-caret" aria-hidden="true">{isOpen ? '–' : '+'}</span>
              </button>
              {isOpen && (
                <div className="help-body">
                  {g.intro && <p className="help-lead">{g.intro}</p>}
                  {g.choices && (
                    <div className="help-choices">
                      {g.choices.filter(c => byId[c.guide]).map(c => (
                        <button type="button" key={c.label} className="secondary-btn help-choice" onClick={() => { ensureVisible(c.guide); open(c.guide, c.then || null); }}>{c.label} →</button>
                      ))}
                    </div>
                  )}
                  {g.steps && <ol className="help-steps">{g.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
                  {g.notes && <ul className="help-notes">{g.notes.map((s, i) => <li key={i}>{s}</li>)}</ul>}
                  {trail && openId === g.id && byId[trail] && (
                    <p className="help-then">Cuando vuelve: <button type="button" className="link-btn" onClick={() => { ensureVisible(trail); open(trail); }}>{byId[trail].title} →</button></p>
                  )}
                  <div className="help-actions">
                    {g.action && (canOperate || g.action.startsWith('goto:')) && (
                      <button type="button" className="primary-btn small-btn" onClick={() => onAction(g.action)}>{g.actionLabel}</button>
                    )}
                    {g.action && !canOperate && !g.action.startsWith('goto:') && <span className="muted small">Tu usuario es de solo lectura: pedile a Marketing que lo registre.</span>}
                    {(g.related || []).filter(id => byId[id] && !(trail && openId === g.id && id === trail)).map(id => (
                      <button type="button" key={id} className="link-btn small" onClick={() => { ensureVisible(id); open(id); }}>{byId[id].title}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="muted small help-foot">Esta ayuda resume el manual de uso. Si algo no coincide con lo que ves en pantalla, avisale a Marketing.</p>
    </Modal>
  );
}
