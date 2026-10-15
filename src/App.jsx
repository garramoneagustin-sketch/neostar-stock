import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase';
import './styles.css';
import './styles-extra.css';
import './styles-pro.css';

const CATEGORIES = [
  'Alfombras',
  'Carpetas',
  'Llaveros',
  'Merchandising institucional',
  'Portadocumentos',
  'Portapatentes',
  'Stickers y Calcomanías',
  'Accesorios de armado',
  'Carpas y Gazebos',
  'Cartelería y estructuras',
  'Flagbanners',
  'Mesas',
  'Roll Banners',
  'Sillas',
  'Sombrillas',
  'Otros'
];

const driveId = (u) => (String(u).match(/\/d\/([\w-]+)/) || [])[1];
const photoThumb = (u, w = 160) => (driveId(u) ? `https://drive.google.com/thumbnail?id=${driveId(u)}&sz=w${w}` : u);
function Thumb({ url, alt, w = 160 }) {
  const [tries, setTries] = useState(0);
  if (tries > 2) return <span className="thumb-fail" title="Foto no disponible: el archivo no se encuentra o no se puede abrir">❓</span>;
  const src = photoThumb(url, w) + (tries ? `${driveId(url) ? '&' : '?'}r=${tries}` : '');
  return <img key={tries} src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer"
    onError={() => setTimeout(() => setTries(t => t + 1), 800 * (tries + 1))} />;
}
const photoFull = (u) => (driveId(u) ? `https://drive.google.com/file/d/${driveId(u)}/view` : u);
const slug = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const friendlyError = (m) => {
  const t = String(m || '');
  if (/row-level security|permission denied|not authorized/i.test(t)) return 'No tenés permiso para hacer esto con tu usuario.';
  if (/jwt expired|invalid jwt|refresh token/i.test(t)) return 'Tu sesión venció. Volvé a iniciar sesión.';
  if (/failed to fetch|networkerror|load failed/i.test(t)) return 'No hay conexión con el servidor. Revisá tu internet y probá de nuevo.';
  if (/duplicate key/i.test(t)) return 'Ya existe un registro igual.';
  if (/Bucket not found|The resource was not found/i.test(t)) return 'Falta configurar el almacenamiento de fotos (PASO 4 en Supabase).';
  return t;
};
// Íconos simples en línea (sin librerías)
const NAV_ICONS = {
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  stock: 'M3 8l9-5 9 5-9 5-9-5zM3 8v8l9 5 9-5V8M12 13v8',
  depositos: 'M3 10l9-6 9 6v10H3zM9 20v-6h6v6',
  mideposito: 'M3 10l9-6 9 6v10H3zM9 20v-6h6v6',
  recepcion: 'M2 6h11v9H2zM13 9h4l3 3v3h-7zM6 18.5a1.5 1.5 0 1 0 0 .01M16 18.5a1.5 1.5 0 1 0 0 .01',
  ingresos: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  retiros: 'M12 15V3M7 8l5-5 5 5M4 20h16',
  movimientos: 'M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4',
  eventos: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  historial: 'M12 7v5l3 2M3 12a9 9 0 1 0 3-6.7M3 4v4h4'
};
function NavIcon({ name }) {
  return <svg className="nav-ico" viewBox="0 0 24 24" aria-hidden="true"><path d={NAV_ICONS[name] || NAV_ICONS.dashboard} /></svg>;
}
// Número que sube hasta su valor (una sola vez, liviano)
function CountUp({ value }) {
  const n = Number(value);
  const [v, setV] = useState(Number.isFinite(n) ? 0 : value);
  useEffect(() => {
    if (!Number.isFinite(n)) { setV(value); return; }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || n === 0) { setV(n); return; }
    let raf; const t0 = performance.now(); const dur = 700;
    const tick = (t) => { const k = Math.min(1, (t - t0) / dur); setV(Math.round(n * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [n, value]);
  return <>{v}</>;
}
const BRANDS = ['Kia', 'Jeep', 'RAM', 'Nissan', 'BYD', 'Suzuki', 'Subaru', 'Honda', 'Neostar'];

const REASONS = [
  ['regalo_corporativo', 'Regalo corporativo'],
  ['incidencia_cliente', 'Incidencia con cliente'],
  ['uso_interno', 'Uso interno'],
  ['otro', 'Otro']
];

const MOVE_LABELS = {
  envio_destino: 'Envío a depósito',
  entrega: 'Entrega',
  ingreso_punto: 'Carga en depósito',
  ajuste: 'Ajuste de stock',
  stock_inicial: 'Stock inicial',
  compra: 'Compra'
};

const STATE_LABELS = {
  en_transito: 'En camino',
  recibido: 'Recibido',
  recibido_con_diferencia: 'Recibido con diferencia',
  entregado: 'Entregado',
  ajustado: 'Ajustado'
};

const emptyItem = {
  name: '', sku: '', kind: 'consumible', category: 'Otros', brand: 'Genérico',
  occasion: '', stock_nucleo: 0, reorder_nucleo: 0, lead_time_days: 15, photoFiles: []
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('es-AR') : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const daysSince = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(undefined); // undefined = cargando, null = sin perfil
  const [tab, setTab] = useState('dashboard');
  const [items, setItems] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [destStock, setDestStock] = useState([]);
  const [pointStatus, setPointStatus] = useState([]);
  const [restocks, setRestocks] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [movements, setMovements] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [events, setEvents] = useState([]);
  const [eventItems, setEventItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Todas');
  const [brandFilter, setBrandFilter] = useState('Todas');
  const [selectedDest, setSelectedDest] = useState('');
  const [modal, setModal] = useState(null); // { type, ...datos }
  const [form, setForm] = useState(emptyItem);
  const [editingItem, setEditingItem] = useState(null);
  const [restock, setRestock] = useState({ item_id: '', qty: 1, source: 'proveedor', cost: '', notes: '' });
  const [withdrawal, setWithdrawal] = useState({ item_id: '', qty: 1, reason_type: 'regalo_corporativo', reason_detail: '', recipient_last_name: '', vehicle_plate: '', notes: '' });
  
  const role = profile?.role || 'none';
  const isStaff = role === 'admin' || role === 'editor';
  const isPunto = role === 'punto';

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(prev => ((prev?.user?.id || null) === (next?.user?.id || null) ? prev : next)));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Perfil (rol y depósito asignado)
  useEffect(() => {
    if (!session) { setProfile(undefined); return; }
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => {
        setProfile(prev => (prev && data && prev.id === data.id && prev.role === data.role && prev.destination_id === data.destination_id ? prev : (data || null)));
        if (data?.role === 'punto') setTab('mideposito');
      });
  }, [session?.user?.id]);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const errs = [];
    const q = async (promise) => {
      const { data, error: e } = await promise;
      if (e) errs.push(e.message);
      return data || [];
    };
    const [it, ds, dst, ps, mv] = await Promise.all([
      q(supabase.from('items').select('*').eq('active', true).order('name')),
      q(supabase.from('destinations').select('*').order('name')),
      q(supabase.from('destination_stock').select('*')),
      q(supabase.from('point_restock_status').select('*')),
      q(supabase.from('movements').select('*, items(name)').order('created_at', { ascending: false }).limit(600))
    ]);
    const sh = await q(supabase.from('shipments').select('*').order('created_at', { ascending: false }).limit(300));
    setItems(it); setDestinations(ds); setDestStock(dst); setPointStatus(ps); setMovements(mv); setShipments(sh);

    if (profile?.role !== 'punto') {
      const [rs, wd, ev, evi] = await Promise.all([
        q(supabase.from('restocks').select('*, items(name)').order('created_at', { ascending: false }).limit(200)),
        q(supabase.from('withdrawals').select('*, items(name)').order('created_at', { ascending: false }).limit(200)),
        q(supabase.from('events').select('*').order('event_date', { ascending: false })),
        q(supabase.from('event_items').select('*, items(name), events(event_name)').order('created_at', { ascending: false }))
      ]);
      setRestocks(rs); setWithdrawals(wd); setEvents(ev); setEventItems(evi);
    }
    setError(errs[0] || '');
    setLoading(false);
  }, [profile?.role]);

  useEffect(() => {
    if (!session || !profile) return;
    loadData();
    let t; const reload = () => { clearTimeout(t); t = setTimeout(() => loadData(true), 500); };
    let ch = supabase.channel('neostar-live');
    ['items', 'restocks', 'withdrawals', 'movements', 'events', 'event_items', 'destination_stock', 'shipments'].forEach((table) => {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, reload);
    });
    ch.subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(ch); };
  }, [session?.user?.id, profile?.id, profile?.role, loadData]);

  // Depósito seleccionado por defecto
  useEffect(() => {
    if (!destinations.length) return;
    if (isPunto) setSelectedDest(profile.destination_id || '');
    else if (!selectedDest) setSelectedDest(destinations[0].id);
  }, [destinations, isPunto, profile, selectedDest]);

  async function handleSignIn(e) {
    e.preventDefault();
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({
      email: e.currentTarget.email.value,
      password: e.currentTarget.password.value
    });
    if (err) setError(err.message);
  }

  // Ejecuta una operación del servidor, muestra errores/avisos y refresca
  async function run(promise, okMessage, onOk) {
    setError(''); setNotice('');
    const { data, error: err } = await promise;
    if (err) { setError(friendlyError(err.message)); return false; }
    setModal(null);
    if (okMessage) setNotice(typeof okMessage === 'function' ? okMessage(data) : okMessage);
    if (onOk) onOk(data);
    loadData(true);
    return true;
  }

  async function saveItem(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Nombre obligatorio'); return; }
    const base = {
      name: form.name.trim(),
      sku: form.sku?.trim() || null,
      category: form.category,
      kind: form.kind,
      brand: form.brand || 'Genérico',
      occasion: form.category === 'Regalos' ? (form.occasion || null) : null,
      reorder_nucleo: Number(form.reorder_nucleo) || 0,
      lead_time_days: Number(form.lead_time_days) || 0,
      ...(editingItem ? { photo_urls: form.photo_urls || [] } : {})
    };
    // El stock NO se edita acá: al crear se carga el inicial; después solo con Ingreso/Retiro/Movimiento/Ajuste.
    const payload = editingItem ? base : { ...base, stock_nucleo: Number(form.stock_nucleo) || 0 };
    const files = form.photoFiles || [];
    const existing = editingItem ? (form.photo_urls || []) : [];
    const req = editingItem
      ? supabase.from('items').update(payload).eq('id', editingItem).select().single()
      : supabase.from('items').insert([payload]).select().single();
    setError(''); setNotice('');
    const { data: saved, error: err } = await req;
    if (err) { setError(friendlyError(err.message)); return; }
    let msg = editingItem ? 'Material actualizado' : 'Material creado';
    if (files.length) {
      const urls = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
        const path = `${slug(saved.name)}${saved.brand && saved.brand !== 'Genérico' ? '-' + slug(saved.brand) : ''}-${existing.length + i + 1}-${Date.now().toString(36)}.${ext}`;
        const up = await supabase.storage.from('item-photos').upload(path, f, { upsert: false, contentType: f.type });
        if (up.error) { setError(`El material se guardó pero la foto no se pudo subir: ${friendlyError(up.error.message)}`); break; }
        urls.push(supabase.storage.from('item-photos').getPublicUrl(path).data.publicUrl);
      }
      if (urls.length) {
        const u = await supabase.from('items').update({ photo_urls: [...existing, ...urls] }).eq('id', saved.id);
        if (u.error) setError(u.error.message); else msg += ` con ${urls.length} foto(s)`;
      }
    }
    setModal(null); setNotice(msg); setForm(emptyItem); setEditingItem(null); loadData(true);
  }

  function deleteItem(item) {
    setModal({
      type: 'confirm', title: 'Eliminar material', danger: true, yes: 'Sí, eliminar',
      text: `¿Seguro que querés eliminar «${item.name}»${item.brand && item.brand !== 'Genérico' ? ` (${item.brand})` : ''}? Si ya tuvo movimientos se archiva (deja de verse pero se conserva el historial). Tiene que estar en 0.`,
      onYes: () => run(supabase.rpc('delete_item', { p_item_id: item.id }), (res) => `Material ${res}`)
    });
  }

  function saveRestock(e) {
    e.preventDefault();
    if (!restock.item_id || Number(restock.qty) < 1) { setError('Falta material o cantidad'); return; }
    run(supabase.rpc('register_restock', {
      p_item_id: restock.item_id, p_qty: Number(restock.qty), p_source: restock.source,
      p_cost: restock.cost ? Number(restock.cost) : null, p_notes: restock.notes || null
    }), 'Ingreso registrado', () => setRestock({ item_id: '', qty: 1, source: 'proveedor', cost: '', notes: '' }));
  }

  function saveWithdrawal(e) {
    e.preventDefault();
    const w = withdrawal;
    if (!w.item_id || Number(w.qty) < 1 || !w.reason_detail.trim()) { setError('Falta información'); return; }
    run(supabase.rpc('register_withdrawal', {
      p_item_id: w.item_id, p_qty: Number(w.qty), p_reason_type: w.reason_type, p_reason_detail: w.reason_detail.trim(),
      p_recipient_last_name: w.recipient_last_name.trim() || null, p_vehicle_plate: w.vehicle_plate.trim() || null,
      p_notes: w.notes || null
    }), 'Retiro registrado', () => setWithdrawal({ item_id: '', qty: 1, reason_type: 'regalo_corporativo', reason_detail: '', recipient_last_name: '', vehicle_plate: '', notes: '' }));
  }

  function saveShipment(e) {
    e.preventDefault();
    const d = modal;
    const lines = d.lines.filter(l => l.item_id && Number(l.qty) > 0);
    if (!d.destination_id) { setError('Elegí el destino del envío'); return; }
    if (!lines.length) { setError('Agregá al menos un material con su cantidad'); return; }
    run(supabase.rpc('create_shipment', {
      p_destination_id: d.destination_id,
      p_items: lines.map(l => ({ item_id: l.item_id, qty: Number(l.qty) })),
      p_recipient_name: d.recipient_name || null, p_notes: d.notes || null
    }), 'Envío registrado. Queda «en camino» hasta que lo reciban y lo controlen.');
  }

  function saveReception(e) {
    e.preventDefault();
    const m = modal;
    if (m.lines.some(l => l.ok === null)) { setError('Marcá ✓ o ✗ en todos los materiales'); return; }
    const bad = m.lines.some(l => l.ok === false);
    if (bad && !m.notes?.trim()) { setError('Contanos qué pasó en Observaciones: hay materiales marcados con ✗'); return; }
    run(supabase.rpc('receive_shipment', {
      p_shipment_id: m.shipment.id,
      p_lines: m.lines.map(l => ({ movement_id: l.movement_id, ok: l.ok, qty_received: l.ok ? null : Number(l.qty_received) || 0, note: l.note || null })),
      p_notes: m.notes?.trim() || null
    }), bad ? 'Recepción enviada con diferencias. El administrador ya lo ve en su panel.' : 'Recepción confirmada: el stock ya figura en el depósito');
  }

  function openReception(sh) {
    const lines = (linesByShipment[sh.id] || []).map(m => ({ movement_id: m.id, name: m.items?.name, qty: m.qty, ok: null, qty_received: 0, note: '' }));
    setError(''); setNotice('');
    setModal({ type: 'receive', shipment: sh, lines, notes: '' });
  }

  function reviewShipment(sh) {
    run(supabase.rpc('review_shipment', { p_shipment_id: sh.id, p_note: null }), 'Marcado como revisado');
  }

  function savePointWithdrawal(e) {
    e.preventDefault();
    const w = modal;
    if (Number(w.qty) < 1 || !w.reason_detail?.trim()) { setError('Falta información'); return; }
    run(supabase.rpc('register_point_withdrawal', {
      p_destination_id: w.destination_id, p_item_id: w.item_id, p_qty: Number(w.qty), p_reason_type: w.reason_type,
      p_reason_detail: w.reason_detail.trim(), p_recipient_last_name: w.recipient_last_name?.trim() || null,
      p_vehicle_plate: w.vehicle_plate?.trim() || null, p_notes: w.notes || null
    }), 'Entrega registrada');
  }

  function savePointStockIn(e) {
    e.preventDefault();
    if (!modal.item_id || Number(modal.qty) < 1) { setError('Falta material o cantidad'); return; }
    run(supabase.rpc('register_point_stock_in', {
      p_destination_id: modal.destination_id, p_item_id: modal.item_id, p_qty: Number(modal.qty), p_notes: modal.notes || null
    }), 'Carga registrada');
  }

  function saveMin(e) {
    e.preventDefault();
    run(supabase.rpc('set_point_min', {
      p_destination_id: modal.destination_id, p_item_id: modal.item_id, p_min: Number(modal.min)
    }), 'Punto de restock actualizado');
  }

  function saveAdjust(e) {
    e.preventDefault();
    if (!modal.reason?.trim()) { setError('El motivo del ajuste es obligatorio'); return; }
    run(supabase.rpc('adjust_stock', {
      p_item_id: modal.item_id, p_destination_id: modal.destination_id || null,
      p_new_qty: Number(modal.new_qty), p_reason: modal.reason.trim()
    }), 'Ajuste registrado');
  }

  const emptyEvent = () => ({ type: 'event', event_name: '', start_date: '', end_date: '', brand: '', carried_by: '', notes: '', lines: [{ item_id: '', qty: 1 }] });

  // Disponible = stock del DEPOSITO MARKETING ROSARIO - reservado por otros eventos abiertos que se pisan en fechas
  function availableOf(itemId, start, end, excludeEventId) {
    const it = itemById[itemId];
    if (!it) return 0;
    const evById = Object.fromEntries(events.map(ev => [ev.id, ev]));
    const reserved = eventItems.filter(ei => {
      const ev = evById[ei.event_id];
      if (!ev || ev.status !== 'abierto' || ei.item_id !== itemId || ei.remito_salida_date || ev.id === excludeEventId) return false;
      if (!start || !end) return true;
      return (ev.start_date || ev.event_date) <= end && (ev.end_date || ev.event_date) >= start;
    }).reduce((acc, ei) => acc + ei.qty_allocated, 0);
    return Math.max(0, Number(it.stock_nucleo) - reserved);
  }

  function saveEvent(e) {
    e.preventDefault();
    const d = modal;
    const lines = d.lines.filter(l => l.item_id && Number(l.qty) > 0);
    if (!d.event_name.trim() || !d.start_date || !d.end_date || !d.brand) { setError('Completá nombre, fechas y marca del evento'); return; }
    if (d.end_date < d.start_date) { setError('La fecha de fin no puede ser anterior a la de inicio'); return; }
    if (!lines.length) { setError('Agregá al menos un elemento con su cantidad'); return; }
    run(supabase.rpc('create_event', {
      p_event_name: d.event_name.trim(), p_start_date: d.start_date, p_end_date: d.end_date, p_brand: d.brand,
      p_items: lines.map(l => ({ item_id: l.item_id, qty: Number(l.qty) })),
      p_carried_by: d.carried_by?.trim() || null, p_notes: d.notes || null
    }), 'Evento creado. Los elementos quedaron reservados (el stock sale cuando los entregues).');
  }

  function saveWithdrawEvent(e) {
    e.preventDefault();
    if (!modal.by.trim()) { setError('Indicá quién retira los materiales'); return; }
    run(supabase.rpc('withdraw_event', { p_event_id: modal.event.id, p_withdrawn_by: modal.by.trim() }),
      'Materiales entregados: ya salieron del DEPOSITO MARKETING ROSARIO. Podés imprimir el retiro para firmar.');
  }

  function saveReturnEvent(e) {
    e.preventDefault();
    const m = modal;
    const job = (async () => {
      for (const l of m.lines) {
        const r = await supabase.rpc('close_event_item', {
          p_event_item_id: l.id, p_qty_returned: Number(l.qty_returned), p_remito_llegada_date: null,
          p_remito_llegada_signed_by: m.by?.trim() || null
        });
        if (r.error) return r;
      }
      return supabase.rpc('close_event', { p_event_id: m.event.id });
    })();
    run(job, 'Regreso registrado. Lo devuelto volvió al DEPOSITO MARKETING ROSARIO.');
  }

  function cancelEvent(ev) {
    setModal({
      type: 'confirm', title: 'Cancelar evento', danger: true, yes: 'Sí, cancelar evento',
      text: `¿Seguro que querés cancelar «${ev.event_name}»? Se libera lo que tenía reservado.`,
      onYes: () => run(supabase.rpc('cancel_event', { p_event_id: ev.id }), 'Evento cancelado')
    });
  }

  // ---------- Derivados ----------
  const destById = useMemo(() => Object.fromEntries(destinations.map(d => [d.id, d])), [destinations]);
  const itemById = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items]);

  const inDepots = useMemo(() => {
    const acc = {};
    destStock.forEach(r => { acc[r.item_id] = (acc[r.item_id] || 0) + r.qty; });
    return acc;
  }, [destStock]);

  const linesByShipment = useMemo(() => {
    const acc = {};
    movements.filter(m => m.shipment_id).forEach(m => { (acc[m.shipment_id] = acc[m.shipment_id] || []).push(m); });
    Object.values(acc).forEach(a => a.sort((x, y) => new Date(x.created_at) - new Date(y.created_at)));
    return acc;
  }, [movements]);

  const inTransit = useMemo(() => shipments.filter(x => x.status === 'en_transito'), [shipments]);
  const toReview = useMemo(() => shipments.filter(x => x.status === 'recibido_con_diferencias' && !x.reviewed), [shipments]);

  const centralAlerts = useMemo(() =>
    items.filter(x => x.kind === 'consumible' && Number(x.reorder_nucleo) > 0 && Number(x.stock_nucleo) <= Number(x.reorder_nucleo)),
  [items]);

  // Último envío por destino y material (seguimiento de lo enviado a concesionarios)
  const lastSent = useMemo(() => {
    const o = {};
    movements.filter(m => m.type === 'envio_destino').forEach(m => {
      const k = `${m.destino_id}|${m.item_id}`;
      if (!o[k] || new Date(m.created_at) > new Date(o[k].created_at)) o[k] = m;
    });
    return o;
  }, [movements]);
  const depotIds = useMemo(() => new Set(destinations.filter(d => d.is_depot).map(d => d.id)), [destinations]);
  // Solo los depósitos (no los concesionarios) generan avisos de reposición en la plataforma
  const pointAlerts = useMemo(() => pointStatus.filter(p => p.status !== 'ok' && depotIds.has(p.destination_id)), [pointStatus, depotIds]);

  const filteredItems = useMemo(() =>
    items.filter(item => {
      const hayQuery = `${item.name} ${item.sku || ''} ${item.brand || ''}`.toLowerCase().includes(query.toLowerCase());
      return hayQuery
        && (categoryFilter === 'Todas' || item.category === categoryFilter)
        && (brandFilter === 'Todas' || item.brand === brandFilter);
    }), [items, query, categoryFilter, brandFilter]);

  const history = useMemo(() => {
    const rows = [];
    restocks.forEach(r => rows.push({ id: 'r' + r.id, at: r.created_at, tipo: 'Ingreso a DEPOSITO MARKETING ROSARIO', item: r.items?.name, qty: r.qty, detalle: [r.source, r.cost ? `$${r.cost}` : null, r.notes].filter(Boolean).join(' · '), quien: r.person }));
    withdrawals.forEach(w => rows.push({ id: 'w' + w.id, at: w.created_at, tipo: 'Retiro de DEPOSITO MARKETING ROSARIO', item: w.items?.name, qty: w.qty, detalle: [w.reason_detail, w.recipient_last_name, w.vehicle_plate].filter(Boolean).join(' · '), quien: w.person }));
    movements.forEach(m => {
      if (m.type === 'stock_inicial' || m.type === 'compra') {
        rows.push({ id: 'm' + m.id, at: m.created_at, tipo: MOVE_LABELS[m.type], item: m.items?.name, qty: m.qty, detalle: m.notes || '', quien: m.person });
        return;
      }
      let detalle = '';
      if (m.type === 'envio_destino') detalle = `→ ${m.destination || destById[m.destino_id]?.name || ''} · ${STATE_LABELS[m.estado] || m.estado}${m.recipient_name ? ' · recibe ' + m.recipient_name : ''}${m.received_by_name ? ' · recibió ' + m.received_by_name : ''}${m.reception_ok === false ? ' · ✗ llegó ' + (m.qty_received ?? 0) + (m.reception_note ? ' (' + m.reception_note + ')' : '') : ''}`;
      else if (m.type === 'entrega') detalle = [m.origen, m.reason_detail, m.recipient_last_name, m.vehicle_plate].filter(Boolean).join(' · ');
      else if (m.type === 'ingreso_punto') detalle = [m.destination, m.notes].filter(Boolean).join(' · ');
      else if (m.type === 'ajuste') detalle = [m.origen, m.notes, m.reason_detail].filter(Boolean).join(' · ');
      else detalle = m.notes || '';
      rows.push({ id: 'm' + m.id, at: m.created_at, tipo: MOVE_LABELS[m.type] || m.type, item: m.items?.name, qty: m.qty, detalle, quien: m.person });
    });
    return rows.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 300);
  }, [restocks, withdrawals, movements, destById]);

  // ---------- Render ----------
  if (!session) return <Login onSubmit={handleSignIn} error={error} />;
  if (profile === undefined) return <div className="login-screen"><div className="skeleton-wrap" aria-busy="true" style={{ width: 'min(420px, 90vw)' }}><div className="skeleton sk-row" /><div className="skeleton sk-block" /></div></div>;
  if (!profile || role === 'none') return <NoAccess onSignOut={() => supabase.auth.signOut()} />;
  if (isPunto && !profile.destination_id) return <NoAccess onSignOut={() => supabase.auth.signOut()} message="Tu usuario todavía no tiene un depósito asignado. Pedile a un administrador que lo configure." />;

  const nav = isPunto
    ? [['mideposito', 'Mi depósito'], ['recepcion', `Por recibir${inTransit.length ? ` (${inTransit.length})` : ''}`], ['historial', 'Historial']]
    : [
        ['dashboard', 'Dashboard'], ['stock', 'Materiales'], ['depositos', 'Depósitos y puntos'],
        ['recepcion', `En camino${inTransit.length ? ` (${inTransit.length})` : ''}`],
        ['ingresos', 'Ingresos'], ['retiros', 'Retiros'], ['movimientos', 'Movimientos'], ['eventos', 'Eventos'], ['historial', 'Historial']
      ];

  const titles = { dashboard: 'Dashboard', stock: 'Materiales', depositos: 'Depósitos y puntos', mideposito: 'Mi depósito', recepcion: isPunto ? 'Por recibir' : 'Envíos en camino', ingresos: 'Ingresos', retiros: 'Retiros', movimientos: 'Movimientos', eventos: 'Eventos', historial: 'Historial' };
  const helps = {
    dashboard: 'Resumen de lo que necesita atención hoy: alertas de stock, envíos en camino, eventos y diferencias de recepción.',
    stock: 'Catálogo de materiales con su stock en el DEPOSITO MARKETING ROSARIO. Buscá o elegí una categoría para ver la lista. Con «Ajustar stock» corregís cantidades dejando motivo.',
    depositos: 'Stock de cada depósito y concesionario. Santa Fe y Cañada controlan lo que reciben; en los demás concesionarios solo queda el registro de lo enviado.',
    mideposito: 'El stock de tu depósito. Sube cuando confirmás la recepción de un envío y baja con cada entrega.',
    recepcion: isPunto ? 'Envíos que salieron hacia tu depósito. Tocá Recibir y marcá ✓ si llegó todo bien o ✗ si falta algo.' : 'Envíos que salieron del DEPOSITO MARKETING ROSARIO y todavía no fueron recibidos por Santa Fe o Cañada.',
    ingresos: 'Mercadería que entra al DEPOSITO MARKETING ROSARIO (compras o devoluciones). Suma al stock.',
    retiros: 'Salidas del DEPOSITO MARKETING ROSARIO por regalos, usos internos o incidencias. Descuenta del stock.',
    movimientos: 'Todos los envíos desde Rosario. «Nuevo movimiento» sirve para enviar o para recibir.',
    eventos: 'Cada evento reserva materiales para sus fechas. El stock recién sale al tocar «Entregar materiales» y vuelve al registrar el regreso.',
    historial: 'Registro de todo lo que entró, salió o se movió, con fecha y responsable.'
  };
  const myDest = destById[selectedDest];
  const roleLabel = { admin: 'Administrador', editor: 'Editor', punto: 'Depósito', viewer: 'Solo lectura' }[role];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><img src="/logo.webp" alt="" width="40" height="40" /><div>MARKETING<span>Control de stock</span></div></div>
        {nav.map(([key, label]) => (
          <button key={key} className={tab === key ? 'nav-btn active' : 'nav-btn'} onClick={() => { setTab(key); setError(''); setNotice(''); }}><NavIcon name={key} />{label}</button>
        ))}
        <div className="sidebar-footer">
          <div className="whoami"><strong>{profile.full_name || session.user.email}</strong><small>{roleLabel}{isPunto && myDest ? ` · ${myDest.name}` : ''}</small></div>
          <button className="logout-btn" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <small>Gestión de inventario</small>
            <h1>{titles[tab]}</h1>
            {helps[tab] && <p className="screen-help">{helps[tab]}</p>}
          </div>
          <div className="topbar-actions">
            {isStaff && tab === 'stock' && <button className="primary-btn" onClick={() => { setEditingItem(null); setForm(emptyItem); setModal({ type: 'item' }); }}>+ Nuevo material</button>}
            {isStaff && tab === 'ingresos' && <button className="primary-btn" onClick={() => setModal({ type: 'restock' })}>+ Registrar ingreso</button>}
            {isStaff && tab === 'retiros' && <button className="primary-btn" onClick={() => setModal({ type: 'withdrawal' })}>+ Registrar retiro</button>}
            {isStaff && tab === 'movimientos' && <button className="primary-btn" onClick={() => setModal({ type: 'hub' })}>+ Nuevo movimiento</button>}
            {isStaff && tab === 'eventos' && <button className="primary-btn" onClick={() => { setError(''); setNotice(''); setModal(emptyEvent()); }}>+ Nuevo evento</button>}
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}
        {notice && <div className="notice-banner">{notice}</div>}

        {loading ? <div className="skeleton-wrap" aria-busy="true"><div className="skeleton sk-row" /><div className="skeleton sk-row" /><div className="skeleton sk-block" /></div> :
          tab === 'dashboard' ? <Dashboard eventItems={eventItems} items={items} centralAlerts={centralAlerts} pointAlerts={pointAlerts} inTransit={inTransit} toReview={toReview} linesByShipment={linesByShipment} onReview={reviewShipment} events={events} history={history} onGo={setTab} /> :
          tab === 'stock' ? <StockTable items={filteredItems} inDepots={inDepots} isStaff={isStaff} query={query} setQuery={setQuery} categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} brandFilter={brandFilter} setBrandFilter={setBrandFilter}
              onEdit={(item) => { setEditingItem(item.id); setForm({ ...emptyItem, ...item, brand: item.brand || 'Genérico', occasion: item.occasion || '', sku: item.sku || '' }); setModal({ type: 'item' }); }}
              onAdjust={(item) => setModal({ type: 'adjust', item_id: item.id, name: item.name, destination_id: null, current: item.stock_nucleo, new_qty: item.stock_nucleo, reason: '', place: 'DEPOSITO MARKETING ROSARIO' })}
              onDelete={deleteItem} onPhotos={(item) => setModal({ type: 'photos', item })} /> :
          tab === 'depositos' || tab === 'mideposito' ? (
            <DepositoView
              sentList={shipments.filter(x => x.destination_id === selectedDest)} linesByShipment={linesByShipment} lastSent={lastSent} isDepot={Boolean(destById[selectedDest]?.is_depot)} isPunto={isPunto} canOperate={isStaff || isPunto} destinations={destinations} selectedDest={selectedDest} setSelectedDest={setSelectedDest}
              rows={destStock.filter(r => r.destination_id === selectedDest)} status={pointStatus.filter(p => p.destination_id === selectedDest)}
              itemById={itemById} inTransit={inTransit.filter(m => m.destination_id === selectedDest)} onGoReceive={() => setTab('recepcion')}
              onDeliver={(r) => setModal({ type: 'pwithdraw', destination_id: selectedDest, item_id: r.item_id, name: itemById[r.item_id]?.name, available: r.qty, qty: 1, reason_type: 'regalo_corporativo', reason_detail: '', recipient_last_name: '', vehicle_plate: '', notes: '' })}
              onStockIn={() => setModal({ type: 'pstockin', destination_id: selectedDest, item_id: '', qty: 1, notes: '' })}
              onMin={(r) => setModal({ type: 'pmin', destination_id: selectedDest, item_id: r.item_id, name: itemById[r.item_id]?.name, min: r.min_qty })}
              onAdjust={(r) => setModal({ type: 'adjust', item_id: r.item_id, name: itemById[r.item_id]?.name, destination_id: selectedDest, current: r.qty, new_qty: r.qty, reason: '', place: destById[selectedDest]?.name })} />
          ) :
          tab === 'recepcion' ? <ReceptionTable rows={inTransit} lines={linesByShipment} canReceive={isStaff || isPunto} onReceive={openReception} /> :
          tab === 'ingresos' ? <RestockTable rows={restocks} /> :
          tab === 'retiros' ? <WithdrawalTable rows={withdrawals} /> :
          tab === 'movimientos' ? <MovementTable rows={shipments} lines={linesByShipment} canReview={isStaff} onReview={reviewShipment} destById={destById} /> :
          tab === 'eventos' ? <EventsTable events={events} eventItems={eventItems} itemById={itemById} isStaff={isStaff} onNew={() => { setError(''); setNotice(''); setModal(emptyEvent()); }} onPrint={(ev) => setModal({ type: 'retiro', event: ev })} onWithdraw={(ev) => setModal({ type: 'withdrawEvent', event: ev, by: ev.carried_by || '' })} onReturn={(ev) => setModal({ type: 'returnEvent', event: ev, by: '', lines: eventItems.filter(ei => ei.event_id === ev.id && ei.remito_salida_date && !ei.remito_llegada_ok).map(ei => ({ id: ei.id, name: ei.items?.name, qty: ei.qty_allocated, qty_returned: ei.qty_allocated })) })} onCancel={cancelEvent} /> :
          tab === 'historial' ? <HistoryTab rows={history} /> : null
        }
      </main>

      {modal?.type === 'confirm' && <ConfirmModal modal={modal} onClose={() => setModal(null)} />}
      {modal?.type === 'photos' && <PhotoViewer item={modal.item} onClose={() => setModal(null)} />}
      {modal?.type === 'item' && <ItemModal form={form} setForm={setForm} editing={Boolean(editingItem)} onClose={() => setModal(null)} onSubmit={saveItem} />}
      {modal?.type === 'restock' && <RestockModal restock={restock} setRestock={setRestock} items={items} onClose={() => setModal(null)} onSubmit={saveRestock} />}
      {modal?.type === 'withdrawal' && <WithdrawalModal withdrawal={withdrawal} setWithdrawal={setWithdrawal} items={items} onClose={() => setModal(null)} onSubmit={saveWithdrawal} />}
      {modal?.type === 'hub' && <MovementHub pending={inTransit} lines={linesByShipment} onClose={() => setModal(null)} onSend={() => setModal({ type: 'send', destination_id: '', recipient_name: '', notes: '', lines: [{ item_id: '', qty: 1 }] })} onReceive={openReception} />}
      {modal?.type === 'send' && <SendModal modal={modal} setModal={setModal} items={items} destinations={destinations} onClose={() => setModal(null)} onSubmit={saveShipment} />}
      {modal?.type === 'event' && <EventModal modal={modal} setModal={setModal} items={items} availableOf={availableOf} onClose={() => setModal(null)} onSubmit={saveEvent} />}
      {modal?.type === 'withdrawEvent' && <WithdrawEventModal modal={modal} setModal={setModal} onClose={() => setModal(null)} onSubmit={saveWithdrawEvent} />}
      {modal?.type === 'returnEvent' && <ReturnEventModal modal={modal} setModal={setModal} onClose={() => setModal(null)} onSubmit={saveReturnEvent} />}
      {modal?.type === 'retiro' && <RetiroView event={modal.event} lines={eventItems.filter(ei => ei.event_id === modal.event.id)} itemById={itemById} onClose={() => setModal(null)} />}
      {modal?.type === 'receive' && <ReceiveModal modal={modal} setModal={setModal} onClose={() => setModal(null)} onSubmit={saveReception} />}
      {modal?.type === 'pwithdraw' && <PointWithdrawModal modal={modal} setModal={setModal} onClose={() => setModal(null)} onSubmit={savePointWithdrawal} />}
      {modal?.type === 'pstockin' && <PointStockInModal modal={modal} setModal={setModal} items={items} onClose={() => setModal(null)} onSubmit={savePointStockIn} />}
      {modal?.type === 'pmin' && <PointMinModal modal={modal} setModal={setModal} onClose={() => setModal(null)} onSubmit={saveMin} />}
      {modal?.type === 'adjust' && <AdjustModal modal={modal} setModal={setModal} onClose={() => setModal(null)} onSubmit={saveAdjust} />}
    </div>
  );
}

/* ---------------- Pantallas ---------------- */

function Login({ onSubmit, error }) {
  return (
    <div className="login-screen pro-login">
      <section className="login-hero" aria-hidden="true">
        <div className="hero-figure">
          <img src="/hero.webp" alt="" width="720" height="405" />
          <div className="hero-rings"><i /><i /><i /></div>
        </div>
        <h2>Todo el material de marketing, a la vista.</h2>
      </section>
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand dark-brand">MARKETING<span>Control de stock</span></div>
        <h2>Ingresar</h2>
        <input type="email" name="email" placeholder="Email" autoComplete="username" required />
        <input type="password" name="password" placeholder="Contraseña" autoComplete="current-password" required />
        <button className="primary-btn" type="submit">Ingresar</button>
        {error && <p className="error-banner">{error}</p>}
      </form>
    </div>
  );
}

function NoAccess({ onSignOut, message }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand dark-brand">MARKETING<span>Control de stock</span></div>
        <h2>Sin acceso</h2>
        <p className="muted">{message || 'Tu usuario todavía no tiene permisos asignados. Pedile a un administrador que te dé acceso.'}</p>
        <button className="primary-btn" onClick={onSignOut}>Cerrar sesión</button>
      </div>
    </div>
  );
}

function Dashboard({ eventItems, items, centralAlerts, pointAlerts, inTransit, toReview, linesByShipment, onReview, events, history, onGo }) {
  const urgent = inTransit.filter(m => daysSince(m.created_at) > 5).length;
  return (
    <>
      <section className="stats-grid">
        <Stat label="Materiales" value={items.length} />
        <Stat label="Alertas de stock" value={centralAlerts.length + pointAlerts.length} tone={centralAlerts.length + pointAlerts.length > 0 ? "warning" : ""} />
        <Stat label={urgent ? `Envíos en camino (${urgent} hace +5 días)` : 'Envíos en camino'} value={inTransit.length} tone={urgent ? 'warning' : ''} onClick={() => onGo('recepcion')} />
        <Stat label="Eventos abiertos" value={events.filter(e => e.status === 'abierto').length} />
      </section>

      {(() => {
        const todo = events.map(e => ({ e, st: eventState(e, eventItems.filter(l => l.event_id === e.id)) })).filter(x => x.st?.alert);
        return todo.length > 0 && (
          <section className="card review-card">
            <h2>Eventos que necesitan acción ({todo.length})</h2>
            {todo.map(({ e, st }) => (
              <div key={e.id} className="review-item">
                <div className="review-head"><strong>{e.event_name}</strong><small>{fmtRange(e)}</small></div>
                <span className={`evt-state ${st.cls}`}>{st.text}</span>
                <button className="secondary-btn small-btn" onClick={() => onGo('eventos')}>Ir a Eventos</button>
              </div>
            ))}
          </section>
        );
      })()}

      {toReview.length > 0 && (
        <section className="card review-card">
          <h2>Recepciones con diferencias ({toReview.length})</h2>
          <p className="muted small">Lo que reportaron los depósitos al recibir. Revisalo y marcalo como revisado.</p>
          {toReview.map(sh => (
            <div key={sh.id} className="review-item">
              <div className="review-head"><strong>{sh.destination_name}</strong><small>recibió {sh.received_by_name} · {fmtDateTime(sh.received_at)}</small></div>
              <ShipmentLines lines={linesByShipment[sh.id] || []} onlyProblems />
              {sh.reception_notes && <p className="obs-text">“{sh.reception_notes}”</p>}
              <button className="secondary-btn small-btn" onClick={() => onReview(sh)}>Marcar como revisado</button>
            </div>
          ))}
        </section>
      )}

      <div className="two-col">
        <section className="card">
          <h2>Alertas</h2>
          {centralAlerts.length + pointAlerts.length === 0 && <p className="muted">Sin alertas</p>}
          {centralAlerts.length > 0 && (
            <>
              <h3 className="sub">Recomprar al proveedor (DEPOSITO MARKETING ROSARIO)</h3>
              <table><thead><tr><th>Material</th><th>Stock</th><th>Mínimo</th></tr></thead>
                <tbody>{centralAlerts.slice(0, 8).map(i => <tr key={i.id}><td>{i.name}</td><td className="warn">{i.stock_nucleo}</td><td>{i.reorder_nucleo}</td></tr>)}</tbody></table>
            </>
          )}
          {pointAlerts.length > 0 && (
            <>
              <h3 className="sub">Reponer en depósitos y puntos</h3>
              <table><thead><tr><th>Depósito</th><th>Material</th><th>Stock</th><th>Reponer</th></tr></thead>
                <tbody>{pointAlerts.slice(0, 8).map(p => <tr key={p.destination_id + p.item_id}><td>{p.destination_name}</td><td>{p.item_name}</td><td className="warn">{p.qty}</td><td>{p.suggested_qty > 0 ? `+${p.suggested_qty}` : '—'}</td></tr>)}</tbody></table>
            </>
          )}
        </section>

        <section className="card">
          <h2>Últimas operaciones</h2>
          <div className="timeline">
            {history.slice(0, 8).map(op => <div key={op.id} className="timeline-row"><div><strong>{op.item || 'Material'}</strong><small>{op.tipo} · {op.qty}</small></div><small>{fmtDate(op.at)}</small></div>)}
            {!history.length && <p className="muted">Todavía no hay movimientos</p>}
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, tone, onClick }) {
  return <div className={`stat ${tone || ''} ${onClick ? 'clickable' : ''}`} onClick={onClick}><strong><CountUp value={value} /></strong><span>{label}</span></div>;
}

function StockTable({ items: allItems, inDepots, isStaff, query, setQuery, categoryFilter, setCategoryFilter, brandFilter, setBrandFilter, onEdit, onAdjust, onDelete, onPhotos }) {
  const PAGE = 25;
  const [page, setPage] = useState(0);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setPage(0); }, [query, categoryFilter, brandFilter]);
  // La lista (y sus fotos) no se carga hasta que se busca, se filtra o se pide ver todo
  const searching = showAll || query.trim() !== '' || categoryFilter !== 'Todas' || brandFilter !== 'Todas';
  const catCounts = CATEGORIES.map(c => [c, allItems.filter(i => i.category === c).length]).filter(x => x[1] > 0);
  const pages = Math.max(1, Math.ceil(allItems.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const items = searching ? allItems.slice(cur * PAGE, cur * PAGE + PAGE) : [];
  return (
    <section className="card">
      <div className="card-head"><h2>Materiales</h2></div>
      <div className="filters-row">
        <label className="filter-label">Buscar<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nombre, SKU o marca…" /></label>
        <label className="filter-label">Categoría<select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option>Todas</option>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="filter-label">Marca<select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}><option>Todas</option><option>Genérico</option>{BRANDS.map(b => <option key={b}>{b}</option>)}</select></label>
      </div>
      {!searching && (
        <div className="empty-state">
          <p><strong>{allItems.length} materiales cargados.</strong> Buscá por nombre, SKU o marca, o elegí una categoría:</p>
          <div className="cat-chips">
            {catCounts.map(([c, n]) => <button type="button" key={c} className="chip-btn" onClick={() => setCategoryFilter(c)}>{c} <span>{n}</span></button>)}
          </div>
          <button type="button" className="link-btn" onClick={() => setShowAll(true)}>Ver todo el listado</button>
        </div>
      )}
      {searching && (<>
      <table>
        <thead><tr><th></th><th>Material</th><th>Categoría</th><th>Marca</th><th>DEPOSITO MARKETING ROSARIO</th><th>En depósitos y puntos</th>{isStaff && <th></th>}</tr></thead>
        <tbody>
          {items.map(i => {
            const low = Number(i.reorder_nucleo) > 0 && Number(i.stock_nucleo) <= Number(i.reorder_nucleo);
            return (
              <tr key={i.id}>
                <td className="photo-col">{i.photo_urls?.length ? (
                  <button type="button" className="thumb-btn" onClick={() => onPhotos(i)} title="Ver fotos">
                    <Thumb url={i.photo_urls[0]} alt={i.name} />
                    {i.photo_urls.length > 1 && <span className="thumb-count">{i.photo_urls.length}</span>}
                  </button>) : null}</td>
                <td><strong>{i.name}</strong><small>{i.sku || 'Sin SKU'}</small></td>
                <td>{i.category}</td><td>{i.brand}</td>
                <td className={low ? 'warn' : ''}>{i.stock_nucleo || 0}{Number(i.reorder_nucleo) > 0 && <small>mín. {i.reorder_nucleo}</small>}</td>
                <td>{inDepots[i.id] || 0}</td>
                {isStaff && <td className="actions-col">
                  <button className="link-btn" onClick={() => onEdit(i)}>Editar</button>
                  <button className="link-btn" onClick={() => onAdjust(i)}>Ajustar stock</button>
                  <button className="link-btn danger" onClick={() => onDelete(i)}>Eliminar</button>
                </td>}
              </tr>
            );
          })}
          {!items.length && <tr><td colSpan="7" className="muted">No hay materiales</td></tr>}
        </tbody>
      </table>
      <p className="muted small photo-legend">❓ = la foto no está disponible (el archivo no se encuentra en Drive o no se puede abrir). Sin ícono = ese material no tiene foto cargada. Podés reemplazarla con «Editar».</p>
      {pages > 1 && (
        <div className="pager">
          <button type="button" className="secondary-btn" disabled={cur === 0} onClick={() => setPage(cur - 1)}>← Anterior</button>
          <span className="muted">Página {cur + 1} de {pages} · {allItems.length} materiales</span>
          <button type="button" className="secondary-btn" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Siguiente →</button>
        </div>
      )}
      </>)}
    </section>
  );
}

function DepositoView({ sentList, linesByShipment, lastSent, isDepot, isPunto, canOperate, destinations, selectedDest, setSelectedDest, rows, status, itemById, inTransit, onGoReceive, onDeliver, onStockIn, onMin, onAdjust }) {
  const statusByItem = Object.fromEntries(status.map(s => [s.item_id, s]));
  const dest = destinations.find(d => d.id === selectedDest);
  return (
    <>
      {!isPunto && (
        <section className="card" style={{ marginBottom: 18 }}>
          <label className="inline-label">Depósito / punto
            <select value={selectedDest} onChange={e => setSelectedDest(e.target.value)}>
              {destinations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        </section>
      )}
      {!isDepot && (
        <section className="card" style={{ marginBottom: 18 }}>
          <h2>Envíos registrados</h2>
          <table>
            <thead><tr><th>Fecha</th><th>Materiales enviados</th><th>Recibe</th><th>Enviado por</th></tr></thead>
            <tbody>
              {sentList.map(sh => (
                <tr key={sh.id}>
                  <td>{fmtDate(sh.created_at)}</td>
                  <td><ul className="ship-lines">{(linesByShipment[sh.id] || []).map(l => <li key={l.id}><span className="tick">•</span><span>{l.items?.name} × {l.qty}</span></li>)}</ul></td>
                  <td>{sh.recipient_name || '—'}</td><td>{sh.created_by_name}</td>
                </tr>
              ))}
              {!sentList.length && <tr><td colSpan="4" className="muted">Todavía no se registraron envíos a este concesionario.</td></tr>}
            </tbody>
          </table>
        </section>
      )}
      {inTransit.length > 0 && (
        <div className="notice-banner clickable" onClick={onGoReceive}>
          Hay {inTransit.length} envío(s) en camino para {dest?.name || 'este depósito'}. Tocá acá para confirmarlos cuando lleguen.
        </div>
      )}
      <section className="card">
        <div className="card-head">
          <h2>{dest?.name || 'Depósito'}</h2>
          {canOperate && isDepot && <button className="primary-btn" onClick={onStockIn}>+ Cargar stock</button>}
        </div>
        {isDepot
          ? <p className="muted small">El stock sube cuando confirmás la recepción de un envío o cuando cargás stock propio. Baja con cada entrega. El punto de restock sugerido se calcula con tus entregas de los últimos 90 días.</p>
          : <p className="muted small">Concesionario: acá queda el registro de lo que se le envió, con fecha y cantidad. Lo que el concesionario va usando se descuenta a mano con «Ajustar», y la reposición se pide por mensaje (no genera alertas en la plataforma).</p>}
        <table>
          <thead>{isDepot
            ? <tr><th>Material</th><th>Stock</th><th>Punto de restock</th><th>Reponer</th><th>Estado</th>{canOperate && <th></th>}</tr>
            : <tr><th>Material</th><th>Total enviado (menos lo ajustado)</th><th>Último envío</th>{canOperate && <th></th>}</tr>}</thead>
          <tbody>
            {rows.map(r => {
              const s = statusByItem[r.item_id];
              const st = s?.status || 'ok';
              const ls = lastSent[`${selectedDest}|${r.item_id}`];
              if (!isDepot) return (
                <tr key={r.item_id}>
                  <td><strong>{itemById[r.item_id]?.name || 'Material'}</strong><small>{itemById[r.item_id]?.category}</small></td>
                  <td>{r.qty}</td>
                  <td>{ls ? `${ls.qty} el ${fmtDate(ls.created_at)}` : '—'}</td>
                  {canOperate && <td className="actions-col"><button className="link-btn" onClick={() => onAdjust(r)}>Ajustar</button></td>}
                </tr>
              );
              return (
                <tr key={r.item_id}>
                  <td><strong>{itemById[r.item_id]?.name || 'Material'}</strong><small>{itemById[r.item_id]?.category}</small></td>
                  <td className={st !== 'ok' ? 'warn' : ''}>{r.qty}</td>
                  <td>{s?.restock_point || r.min_qty || '—'}{r.min_qty > 0 && <small>mínimo cargado: {r.min_qty}</small>}</td>
                  <td>{s?.suggested_qty > 0 && st !== 'ok' ? `+${s.suggested_qty}` : '—'}</td>
                  <td><span className={`chip ${st}`}>{st === 'ok' ? 'OK' : st === 'sin_stock' ? 'Sin stock' : 'Reponer'}</span></td>
                  {canOperate && <td className="actions-col">
                    <button className="link-btn" disabled={r.qty < 1} onClick={() => onDeliver(r)}>Entregar</button>
                    <button className="link-btn" onClick={() => onMin(r)}>Mínimo</button>
                    <button className="link-btn" onClick={() => onAdjust(r)}>Ajustar</button>
                  </td>}
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan="6" className="muted">Todavía no hay stock en este depósito. Cuando llegue un envío, confirmá la recepción y va a aparecer acá.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}

function ShipmentLines({ lines, onlyProblems }) {
  const rows = onlyProblems ? lines.filter(l => l.reception_ok === false) : lines;
  return (
    <ul className="ship-lines">
      {rows.map(l => (
        <li key={l.id}>
          {l.reception_ok === true && <span className="tick ok">✓</span>}
          {l.reception_ok === false && <span className="tick bad">✗</span>}
          {l.reception_ok == null && <span className="tick">•</span>}
          <span>{l.items?.name} · enviado {l.qty}{l.reception_ok === false ? ` · llegó ${l.qty_received ?? 0}` : ''}{l.reception_note ? ` · ${l.reception_note}` : ''}</span>
        </li>
      ))}
    </ul>
  );
}

function ReceptionTable({ rows, lines, canReceive, onReceive }) {
  return (
    <section className="card">
      <h2>{canReceive ? 'Envíos pendientes de recepción' : 'Envíos en camino'}</h2>
      <p className="muted small">Cuando llega la mercadería, tocá Recibir y controlá cada material: ✓ si llegó todo bien, ✗ si falta algo. Recién ahí se suma al stock del depósito.</p>
      <table>
        <thead><tr><th>Enviado</th><th>Materiales</th><th>Destino</th><th>Recibe</th><th>Enviado por</th>{canReceive && <th></th>}</tr></thead>
        <tbody>
          {rows.map(sh => {
            const d = daysSince(sh.created_at);
            return (
              <tr key={sh.id}>
                <td>{fmtDate(sh.created_at)}<small className={d > 5 ? 'warn' : ''}>{d === 0 ? 'hoy' : `hace ${d} día(s)`}{d > 5 ? ' · urgente' : ''}</small></td>
                <td><ShipmentLines lines={lines[sh.id] || []} /></td>
                <td>{sh.destination_name}</td><td>{sh.recipient_name || '—'}</td><td>{sh.created_by_name}</td>
                {canReceive && <td><button className="primary-btn small-btn" onClick={() => onReceive(sh)}>Recibir</button></td>}
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan="6" className="muted">No hay envíos pendientes</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

function RestockTable({ rows }) {
  return (
    <section className="card">
      <h2>Ingresos de stock</h2>
      <table>
        <thead><tr><th>Fecha</th><th>Material</th><th>Cantidad</th><th>Origen</th><th>Costo</th><th>Registrado por</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}><td>{fmtDate(r.created_at)}</td><td>{r.items?.name}</td><td>{r.qty}</td><td>{r.source}</td><td>{r.cost ? `$${r.cost}` : '—'}</td><td>{r.person}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

function WithdrawalTable({ rows }) {
  return (
    <section className="card">
      <h2>Retiros / Uso (DEPOSITO MARKETING ROSARIO)</h2>
      <table>
        <thead><tr><th>Fecha</th><th>Material</th><th>Cantidad</th><th>Motivo</th><th>Cliente</th><th>Patente</th><th>Registrado por</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}><td>{fmtDate(r.created_at)}</td><td>{r.items?.name}</td><td>{r.qty}</td><td>{r.reason_detail}</td><td>{r.recipient_last_name || '—'}</td><td>{r.vehicle_plate || '—'}</td><td>{r.person}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

function MovementTable({ rows, lines, canReview, onReview, destById }) {
  const label = { en_transito: 'En camino', recibido: 'Recibido ✓', recibido_con_diferencias: 'Con diferencias' };
  const chip = { en_transito: 'en_transito', recibido: 'recibido', recibido_con_diferencias: 'recibido_con_diferencia' };
  return (
    <section className="card">
      <h2>Envíos a depósitos y puntos</h2>
      <table>
        <thead><tr><th>Fecha</th><th>Destino</th><th>Materiales</th><th>Estado</th><th>Recibió</th><th>Enviado por</th></tr></thead>
        <tbody>{rows.map(sh => (
          <tr key={sh.id}>
            <td>{fmtDate(sh.created_at)}</td><td>{sh.destination_name}</td>
            <td><ShipmentLines lines={lines[sh.id] || []} />{sh.reception_notes && <small className="obs-text">“{sh.reception_notes}”</small>}</td>
            <td><span className={`chip ${chip[sh.status]}`}>{destById?.[sh.destination_id]?.is_depot === false ? 'Registrado' : label[sh.status]}</span>
              {sh.status === 'recibido_con_diferencias' && (sh.reviewed ? <small>revisado por {sh.reviewed_by_name}</small> : canReview && <button className="link-btn" onClick={() => onReview(sh)}>Marcar revisado</button>)}</td>
            <td>{sh.received_by_name ? <>{sh.received_by_name}<small>{fmtDateTime(sh.received_at)}</small></> : '—'}</td>
            <td>{sh.created_by_name}</td>
          </tr>))}
          {!rows.length && <tr><td colSpan="6" className="muted">Todavía no hay envíos</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// Estado práctico de un evento abierto y qué falta hacer
function eventState(e, lines) {
  if (e.status !== 'abierto') return null;
  const t = todayStr();
  const start = e.start_date || e.event_date, end = e.end_date || e.start_date || e.event_date;
  const out = lines.filter(l => l.remito_salida_date);
  const pendingOut = lines.some(l => !l.remito_salida_date);
  const outNow = out.some(l => !l.remito_llegada_ok);
  if (pendingOut && start && start <= t) return { cls: 'alerta', text: start === t ? 'Empieza hoy y falta entregar los materiales' : 'Ya empezó y falta entregar los materiales', alert: true };
  if (pendingOut) return { cls: 'reservado', text: 'Reservado · próximo paso: entregar los materiales' };
  if (outNow && end && end < t) return { cls: 'alerta', text: 'Ya terminó y faltan registrar los materiales devueltos', alert: true };
  if (outNow) return { cls: 'entregado', text: 'Entregado · próximo paso: registrar el regreso al terminar' };
  return null;
}
const EVENT_LABELS = { abierto: 'Abierto', cerrado: 'Cerrado', cancelado: 'Cancelado' };
const fmtRange = (e) => {
  const a = e.start_date || e.event_date, b = e.end_date || e.event_date;
  return a === b ? fmtDate(a + 'T12:00:00') : `${fmtDate(a + 'T12:00:00')} al ${fmtDate(b + 'T12:00:00')}`;
};

function EventsTable({ events, eventItems, itemById, isStaff, onNew, onPrint, onWithdraw, onReturn, onCancel }) {
  return (
    <section className="card">
      <h2>Eventos</h2>
      {events.length ? (
        <div className="events-list">
          {events.map(e => {
            const lines = eventItems.filter(ei => ei.event_id === e.id);
            const pendingOut = lines.some(l => !l.remito_salida_date);
            const outNow = lines.some(l => l.remito_salida_date && !l.remito_llegada_ok);
            return (
              <div key={e.id} className="event-card">
                <div className="event-head">
                  <div>
                    <h3>{e.event_name}</h3>
                    <p className="muted small">{fmtRange(e)}{e.brand ? ` · ${e.brand}` : ''}{e.carried_by ? ` · Responsable: ${e.carried_by}` : ''}</p>
                  </div>
                  <span className={`chip ${e.status}`}>{EVENT_LABELS[e.status] || e.status}</span>
                </div>
                {(() => { const st = eventState(e, lines); return st ? <span className={`evt-state ${st.cls}`}>{st.text}</span> : null; })()}
                <table>
                  <thead><tr><th>Elemento</th><th>Cantidad</th><th>Entrega</th><th>Regreso</th></tr></thead>
                  <tbody>
                    {lines.map(ei => (
                      <tr key={ei.id}>
                        <td>{ei.items?.name}{itemById[ei.item_id]?.brand && itemById[ei.item_id].brand !== 'Genérico' ? <small>{itemById[ei.item_id].brand}</small> : null}</td>
                        <td>{ei.qty_allocated}</td>
                        <td className={ei.remito_salida_date ? 'ok' : 'pending'}>{ei.remito_salida_date ? `✓ ${ei.remito_salida_signed_by || ''}` : 'Reservado'}</td>
                        <td>{ei.remito_llegada_ok ? `✓ volvieron ${ei.qty_returned}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="event-actions">
                  <button className="secondary-btn small-btn" onClick={() => onPrint(e)}>Retiro para imprimir</button>
                  {isStaff && e.status === 'abierto' && pendingOut && <button className="primary-btn small-btn" onClick={() => onWithdraw(e)}>Entregar materiales</button>}
                  {isStaff && e.status === 'abierto' && outNow && <button className="primary-btn small-btn" onClick={() => onReturn(e)}>Registrar regreso</button>}
                  {isStaff && e.status === 'abierto' && !lines.some(l => l.remito_salida_date) && <button className="link-btn danger" onClick={() => onCancel(e)}>Cancelar evento</button>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state"><p className="muted">Todavía no hay eventos.</p>{isStaff && <button className="primary-btn" onClick={onNew}>+ Nuevo evento</button>}</div>
      )}
    </section>
  );
}

function HistoryTab({ rows }) {
  return (
    <section className="card">
      <h2>Historial completo</h2>
      <table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Material</th><th>Cantidad</th><th>Detalle</th><th>Usuario</th></tr></thead>
        <tbody>{rows.map(op => <tr key={op.id}><td>{fmtDateTime(op.at)}</td><td>{op.tipo}</td><td>{op.item}</td><td>{op.qty}</td><td>{op.detalle || '—'}</td><td>{op.quien}</td></tr>)}
          {!rows.length && <tr><td colSpan="6" className="muted">Sin movimientos</td></tr>}</tbody>
      </table>
    </section>
  );
}

/* ---------------- Modales ---------------- */

function Modal({ title, onClose, onSubmit, submitLabel, children }) {
  return (
    <div className="modal-overlay">
      <form className="modal" onSubmit={onSubmit}>
        <div className="card-head"><h2>{title}</h2><button type="button" className="close-btn" onClick={onClose}>×</button></div>
        {children}
        <div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button type="submit" className="primary-btn">{submitLabel}</button></div>
      </form>
    </div>
  );
}

function ConfirmModal({ modal, onClose }) {
  return (
    <div className="modal-overlay">
      <div className="modal confirm-modal">
        <div className="card-head"><h2>{modal.title}</h2><button type="button" className="close-btn" onClick={onClose}>×</button></div>
        <p>{modal.text}</p>
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button>
          <button type="button" className={modal.danger ? 'primary-btn danger-btn' : 'primary-btn'} onClick={() => { const f = modal.onYes; onClose(); f(); }}>{modal.yes || 'Confirmar'}</button>
        </div>
      </div>
    </div>
  );
}

function PhotoViewer({ item, onClose }) {
  const [cur, setCur] = useState(0);
  const list = item.photo_urls || [];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal photo-modal" onClick={e => e.stopPropagation()}>
        <div className="card-head"><h2>{item.name}{item.brand && item.brand !== 'Genérico' ? ` · ${item.brand}` : ''}</h2><button type="button" className="close-btn" onClick={onClose}>×</button></div>
        <div className="photo-main">
          <Thumb url={list[cur]} alt={item.name} w={900} />
        </div>
        {list.length > 1 && <div className="photo-strip">{list.map((u, i) => (
          <button type="button" key={u} className={i === cur ? 'on' : ''} onClick={() => setCur(i)}><Thumb url={u} alt="" w={120} /></button>
        ))}</div>}
        <div className="modal-actions">
          <a className="secondary-btn" href={photoFull(list[cur])} target="_blank" rel="noreferrer">Abrir original</a>
          <button type="button" className="primary-btn" onClick={onClose}>Cerrar</button>
        </div>
        <p className="muted small">Si la foto no aparece, es porque el archivo de Drive no está compartido con tu cuenta: abrilo con «Abrir original».</p>
      </div>
    </div>
  );
}

function ItemModal({ form, setForm, editing, onClose, onSubmit }) {
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  return (
    <Modal title={`${editing ? 'Editar' : 'Nuevo'} material`} onClose={onClose} onSubmit={onSubmit} submitLabel="Guardar">
      <div className="form-grid">
        <label>Nombre *<input required value={form.name} onChange={e => set('name', e.target.value)} /></label>
        <label>SKU<input value={form.sku} onChange={e => set('sku', e.target.value.toUpperCase())} /></label>
        <label>Tipo<select value={form.kind} onChange={e => set('kind', e.target.value)}><option value="consumible">Consumible (se entrega)</option><option value="equipamiento">Equipamiento (se presta y vuelve)</option></select></label>
        <label>Categoría<select value={form.category} onChange={e => set('category', e.target.value)}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Marca<select value={form.brand} onChange={e => set('brand', e.target.value)}><option>Genérico</option>{BRANDS.map(b => <option key={b}>{b}</option>)}</select></label>
        {form.category === 'Regalos' && (
          <label>Ocasión<select value={form.occasion} onChange={e => set('occasion', e.target.value)}><option value="">—</option><option>Nuevo</option><option>Usado</option><option>Service</option><option>Postventa</option></select></label>
        )}
        {!editing && <label>Stock inicial en DEPOSITO MARKETING ROSARIO<input type="number" min="0" value={form.stock_nucleo} onChange={e => set('stock_nucleo', e.target.value)} /></label>}
        <label>Mínimo DEPOSITO MARKETING ROSARIO (recompra)<input type="number" min="0" value={form.reorder_nucleo} onChange={e => set('reorder_nucleo', e.target.value)} /></label>
        <label>Demora del proveedor (días)<input type="number" min="0" value={form.lead_time_days} onChange={e => set('lead_time_days', e.target.value)} /></label>
      </div>
      <div className="full-width photo-upload">
        <label>Fotos del material (se guardan con el nombre del material)
          <input type="file" accept="image/*" multiple onChange={e => set('photoFiles', Array.from(e.target.files || []))} />
        </label>
        {form.photoFiles?.length > 0 && <small className="muted">{form.photoFiles.length} foto(s) para subir: {form.photoFiles.map(f => f.name).join(', ')}</small>}
        {editing && form.photo_urls?.length > 0 && (
          <div className="photo-edit">
            {form.photo_urls.map(u => (
              <span key={u} className="photo-edit-item">
                <Thumb url={u} alt="" w={120} />
                <button type="button" title="Quitar esta foto" onClick={() => set('photo_urls', form.photo_urls.filter(x => x !== u))}>×</button>
              </span>
            ))}
            <small className="muted">Las fotos nuevas se suman. Con × quitás una (se aplica al guardar).</small>
          </div>
        )}
      </div>
      {editing && <p className="muted small">El stock no se edita acá. Para corregirlo usá «Ajustar stock» (queda registrado con motivo).</p>}
    </Modal>
  );
}

function ItemSelect({ items, value, onChange, label = 'Material *' }) {
  return <label>{label}<select required value={value} onChange={e => onChange(e.target.value)}><option value="">Seleccionar</option>{items.map(i => <option key={i.id} value={i.id}>{i.name} (Central: {i.stock_nucleo})</option>)}</select></label>;
}

function RestockModal({ restock, setRestock, items, onClose, onSubmit }) {
  const set = (k, v) => setRestock(p => ({ ...p, [k]: v }));
  return (
    <Modal title="Registrar ingreso" onClose={onClose} onSubmit={onSubmit} submitLabel="Guardar ingreso">
      <div className="form-grid">
        <ItemSelect items={items} value={restock.item_id} onChange={v => set('item_id', v)} />
        <label>Cantidad *<input type="number" min="1" required value={restock.qty} onChange={e => set('qty', e.target.value)} /></label>
        <label>Origen<select value={restock.source} onChange={e => set('source', e.target.value)}><option value="proveedor">Proveedor</option><option value="devolucion">Devolución</option></select></label>
        <label>Costo<input type="number" step="0.01" value={restock.cost} onChange={e => set('cost', e.target.value)} /></label>
        <label className="full-width">Notas<input value={restock.notes} onChange={e => set('notes', e.target.value)} placeholder="Remito, proveedor, etc." /></label>
      </div>
    </Modal>
  );
}

function WithdrawalModal({ withdrawal, setWithdrawal, items, onClose, onSubmit }) {
  const set = (k, v) => setWithdrawal(p => ({ ...p, [k]: v }));
  const esIncidencia = withdrawal.reason_type === 'incidencia_cliente';
  return (
    <Modal title="Registrar retiro" onClose={onClose} onSubmit={onSubmit} submitLabel="Guardar retiro">
      <div className="form-grid">
        <ItemSelect items={items} value={withdrawal.item_id} onChange={v => set('item_id', v)} />
        <label>Cantidad *<input type="number" min="1" required value={withdrawal.qty} onChange={e => set('qty', e.target.value)} /></label>
        <label>Motivo<select value={withdrawal.reason_type} onChange={e => set('reason_type', e.target.value)}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {esIncidencia && <>
          <label>Apellido cliente *<input required value={withdrawal.recipient_last_name} onChange={e => set('recipient_last_name', e.target.value)} /></label>
          <label>Patente *<input required value={withdrawal.vehicle_plate} onChange={e => set('vehicle_plate', e.target.value.toUpperCase())} /></label>
        </>}
        <label className="full-width">Descripción *<input required value={withdrawal.reason_detail} onChange={e => set('reason_detail', e.target.value)} placeholder={esIncidencia ? 'Motivo de la incidencia' : 'Descripción del retiro'} /></label>
      </div>
    </Modal>
  );
}

function MovementHub({ pending, lines, onClose, onSend, onReceive }) {
  const [view, setView] = useState('menu');
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="card-head"><h2>{view === 'menu' ? 'Nuevo movimiento' : 'Recibir un envío'}</h2><button type="button" className="close-btn" onClick={onClose}>×</button></div>
        {view === 'menu' ? (
          <div className="hub-choices">
            <button type="button" className="hub-btn" onClick={onSend}><strong>Enviar</strong><span>Armá la lista de materiales y mandala a un depósito (Santa Fe, Cañada) o registrá lo que se le entregó a un concesionario.</span></button>
            <button type="button" className="hub-btn" onClick={() => setView('recibir')}><strong>Recibir{pending.length ? ` (${pending.length})` : ''}</strong><span>Controlá lo que llegó: ✓ si está bien, ✗ si falta algo.</span></button>
          </div>
        ) : (
          <>
            {!pending.length && <p className="muted">No hay envíos esperando recepción.</p>}
            {pending.map(sh => (
              <div key={sh.id} className="review-item">
                <div className="review-head"><strong>{sh.destination_name}</strong><small>enviado {fmtDate(sh.created_at)} por {sh.created_by_name}</small></div>
                <ShipmentLines lines={lines[sh.id] || []} />
                <button type="button" className="primary-btn small-btn" onClick={() => onReceive(sh)}>Recibir</button>
              </div>
            ))}
            <div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setView('menu')}>Volver</button></div>
          </>
        )}
      </div>
    </div>
  );
}

function SendModal({ modal, setModal, items, destinations, onClose, onSubmit }) {
  const set = (k, v) => setModal(p => ({ ...p, [k]: v }));
  const setLine = (i, k, v) => setModal(p => ({ ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const addLine = () => setModal(p => ({ ...p, lines: [...p.lines, { item_id: '', qty: 1 }] }));
  const delLine = (i) => setModal(p => ({ ...p, lines: p.lines.length > 1 ? p.lines.filter((_, j) => j !== i) : p.lines }));
  const used = new Set(modal.lines.map(l => l.item_id));
  return (
    <Modal title="Enviar materiales" onClose={onClose} onSubmit={onSubmit} submitLabel="Registrar envío">
      <div className="form-grid">
        <label>Destino *<select required value={modal.destination_id} onChange={e => set('destination_id', e.target.value)}><option value="">Seleccionar</option>{destinations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Quién lo recibe<input value={modal.recipient_name} onChange={e => set('recipient_name', e.target.value)} placeholder="Nombre de quién recibe" /></label>
      </div>
      <h3 className="sub">Materiales del envío</h3>
      <div className="send-lines">
        {modal.lines.map((l, i) => {
          const it = items.find(x => x.id === l.item_id);
          return (
            <div key={i} className="send-line">
              <select value={l.item_id} onChange={e => setLine(i, 'item_id', e.target.value)} required>
                <option value="">Elegir material…</option>
                {items.filter(x => x.id === l.item_id || !used.has(x.id)).map(x => <option key={x.id} value={x.id}>{x.name}{x.brand && x.brand !== 'Genérico' ? ` · ${x.brand}` : ''} (Central: {x.stock_nucleo})</option>)}
              </select>
              <input type="number" min="1" max={it?.stock_nucleo || undefined} value={l.qty} onChange={e => setLine(i, 'qty', e.target.value)} aria-label="Cantidad" required />
              <button type="button" className="link-btn danger" onClick={() => delLine(i)} disabled={modal.lines.length === 1}>Quitar</button>
            </div>
          );
        })}
      </div>
      <button type="button" className="secondary-btn add-line-btn" onClick={addLine}>+ Agregar otro material</button>
      <label className="full-width notes-label">Notas<input value={modal.notes} onChange={e => set('notes', e.target.value)} placeholder="Opcional" /></label>
      {destinations.find(d => d.id === modal.destination_id)?.is_depot === false
        ? <p className="muted small">Concesionario: se descuenta del DEPOSITO MARKETING ROSARIO y queda registrado con la fecha de hoy y las cantidades. Es solo un registro: no necesita recepción.</p>
        : <p className="muted small">Se descuenta del DEPOSITO MARKETING ROSARIO ahora y queda «en camino». Cuando llegue, quien recibe controla cada material (✓ o ✗) y las cantidades se suman a su stock.</p>}
    </Modal>
  );
}

function EventModal({ modal, setModal, items, availableOf, onClose, onSubmit }) {
  const set = (k, v) => setModal(p => ({ ...p, [k]: v }));
  const setLine = (i, k, v) => setModal(p => ({ ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const addLine = () => setModal(p => ({ ...p, lines: [...p.lines, { item_id: '', qty: 1 }] }));
  const delLine = (i) => setModal(p => ({ ...p, lines: p.lines.length > 1 ? p.lines.filter((_, j) => j !== i) : p.lines }));
  const setBrand = (brand) => setModal(p => ({
    ...p, brand,
    lines: p.lines.map(l => {
      const it = items.find(x => x.id === l.item_id);
      const ok = it && (it.brand === brand || it.brand === 'Genérico' || it.brand === 'Neostar');
      return ok ? l : { item_id: '', qty: 1 };
    })
  }));
  const pool = items.filter(i => modal.brand && (i.brand === modal.brand || i.brand === 'Genérico' || i.brand === 'Neostar'));
  const used = new Set(modal.lines.map(l => l.item_id));
  const cats = [...new Set(pool.map(i => i.category))].sort();
  const avail = (id) => availableOf(id, modal.start_date, modal.end_date);
  return (
    <Modal title="Nuevo evento" onClose={onClose} onSubmit={onSubmit} submitLabel="Guardar evento">
      <div className="form-grid">
        <label className="full-width">Nombre del evento *<input required value={modal.event_name} onChange={e => set('event_name', e.target.value)} placeholder="Ej: Activación BYD Rosario" /></label>
        <label>Fecha de inicio *<input type="date" required value={modal.start_date} onChange={e => setModal(p => ({ ...p, start_date: e.target.value, end_date: p.end_date && p.end_date >= e.target.value ? p.end_date : e.target.value }))} /></label>
        <label>Fecha de fin *<input type="date" required min={modal.start_date || undefined} value={modal.end_date} onChange={e => set('end_date', e.target.value)} /></label>
        <label>Marca *<select required value={modal.brand} onChange={e => setBrand(e.target.value)}><option value="">Seleccionar</option>{BRANDS.map(b => <option key={b}>{b}</option>)}</select></label>
        <label>Responsable (opcional)<input value={modal.carried_by} onChange={e => set('carried_by', e.target.value)} placeholder="Quién se lleva los elementos" /></label>
      </div>
      <h3 className="sub">Elementos a llevar</h3>
      {!modal.brand && <p className="muted small">Elegí la marca y te muestro los elementos de esa marca y los genéricos.</p>}
      {modal.brand && (
        <>
          <div className="send-lines">
            {modal.lines.map((l, i) => {
              const max = l.item_id ? avail(l.item_id) : undefined;
              return (
                <div key={i} className="send-line">
                  <select value={l.item_id} onChange={e => setLine(i, 'item_id', e.target.value)} required>
                    <option value="">Elegir elemento…</option>
                    {cats.map(c => (
                      <optgroup key={c} label={c}>
                        {pool.filter(x => x.category === c && (x.id === l.item_id || !used.has(x.id))).map(x => {
                          const a = avail(x.id);
                          return <option key={x.id} value={x.id} disabled={a <= 0 && x.id !== l.item_id}>{x.name}{x.brand && x.brand !== 'Genérico' ? ` · ${x.brand}` : ''} (disponibles: {a})</option>;
                        })}
                      </optgroup>
                    ))}
                  </select>
                  <input type="number" min="1" max={max || undefined} disabled={!l.item_id} value={l.qty} onChange={e => setLine(i, 'qty', e.target.value)} aria-label="Cantidad" required />
                  <button type="button" className="link-btn danger" onClick={() => delLine(i)} disabled={modal.lines.length === 1}>Quitar</button>
                  {l.item_id && <small className="line-hint">Máximo {max}{modal.start_date ? ' para esas fechas' : ''}</small>}
                </div>
              );
            })}
          </div>
          <button type="button" className="secondary-btn add-line-btn" onClick={addLine}>+ Agregar otro elemento</button>
        </>
      )}
      <label className="full-width notes-label">Notas<input value={modal.notes} onChange={e => set('notes', e.target.value)} placeholder="Opcional" /></label>
      <p className="muted small">Guardar reserva los elementos para esas fechas: nadie más puede usarlos en otro evento que se pise. El stock sale del DEPOSITO MARKETING ROSARIO recién cuando tocás «Entregar materiales».</p>
    </Modal>
  );
}

function WithdrawEventModal({ modal, setModal, onClose, onSubmit }) {
  return (
    <Modal title="Entregar materiales del evento" onClose={onClose} onSubmit={onSubmit} submitLabel="Entregar y descontar stock">
      <p><strong>{modal.event.event_name}</strong></p>
      <label className="full-width notes-label">Quién retira los materiales *<input required value={modal.by} onChange={e => setModal(p => ({ ...p, by: e.target.value }))} placeholder="Nombre y apellido" /></label>
      <p className="muted small">Los elementos reservados salen ahora del DEPOSITO MARKETING ROSARIO. Después podés imprimir el retiro para que lo firmen.</p>
    </Modal>
  );
}

function ReturnEventModal({ modal, setModal, onClose, onSubmit }) {
  const setLine = (i, v) => setModal(p => ({ ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, qty_returned: v } : l)) }));
  return (
    <Modal title="Registrar regreso del evento" onClose={onClose} onSubmit={onSubmit} submitLabel="Confirmar regreso">
      <p className="muted small">Indicá cuánto volvió de cada elemento. Lo que vuelve se suma al DEPOSITO MARKETING ROSARIO.</p>
      <div className="send-lines">
        {modal.lines.map((l, i) => (
          <div key={l.id} className="send-line">
            <div><strong>{l.name}</strong><small className="line-hint">Salieron {l.qty}</small></div>
            <input type="number" min="0" max={l.qty} required value={l.qty_returned} onChange={e => setLine(i, e.target.value)} aria-label="Cantidad devuelta" />
            <span />
          </div>
        ))}
      </div>
      <label className="full-width notes-label">Quién lo entrega de vuelta<input value={modal.by} onChange={e => setModal(p => ({ ...p, by: e.target.value }))} placeholder="Nombre y apellido" /></label>
    </Modal>
  );
}

/* Documento de retiro para imprimir o bajar en Word */
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function retiroHtml(event, rows) {
  const today = new Date().toLocaleDateString('es-AR');
  const trs = rows.map((r, i) => `<tr><td class="c">${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.brand)}</td><td class="c">${r.qty}</td><td class="c">☐ Correcto &nbsp; ☐ Con observaciones</td></tr>`).join('');
  return `<style>
.retiro{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:12px;line-height:1.4}
.retiro h1{font-size:20px;margin:0 0 2px;letter-spacing:.02em}
.retiro .sub{color:#555;margin:0 0 14px}
.retiro table{border-collapse:collapse;width:100%;margin:8px 0 14px}
.retiro th,.retiro td{border:1px solid #444;padding:6px 8px;text-align:left;vertical-align:top}
.retiro th{background:#eee;font-size:11px;text-transform:uppercase}
.retiro td.c,.retiro th.c{text-align:center}
.retiro .info td{border:1px solid #999}
.retiro .info td:nth-child(odd){background:#f3f3f3;font-weight:bold;width:18%}
.retiro .sign td{height:64px;vertical-align:bottom;width:50%}
.retiro h2{font-size:13px;margin:14px 0 4px;text-transform:uppercase}
.retiro p{margin:6px 0}
</style>
<div class="retiro">
<h1>NEOSTAR · Retiro de elementos de marketing</h1>
<p class="sub">DEPOSITO MARKETING ROSARIO · Nº ${esc(String(event.id).slice(0, 8).toUpperCase())} · Emitido el ${today}</p>
<table class="info"><tr><td>Evento</td><td colspan="3">${esc(event.event_name)}</td></tr>
<tr><td>Marca</td><td>${esc(event.brand || '—')}</td><td>Responsable</td><td>${esc(event.carried_by || '')}</td></tr>
<tr><td>Fecha de inicio</td><td>${fmtDate((event.start_date || event.event_date) + 'T12:00:00')}</td><td>Fecha de fin</td><td>${fmtDate((event.end_date || event.event_date) + 'T12:00:00')}</td></tr></table>
<h2>Elementos retirados</h2>
<table><tr><th class="c" style="width:5%">#</th><th>Elemento</th><th style="width:16%">Marca</th><th class="c" style="width:10%">Cantidad</th><th class="c" style="width:30%">Estado al retirar</th></tr>${trs}</table>
<p>Quien firma recibe los elementos detallados, se compromete a cuidarlos y a devolverlos en la fecha indicada, o a informar a Marketing dónde quedan si los conserva para un próximo evento. Cualquier faltante o daño debe informarse a Marketing.</p>
<table class="sign"><tr><td>ENTREGA (Marketing)<br><br>Firma:<br>Aclaración:<br>Fecha:</td><td>RECIBE<br><br>Firma:<br>Aclaración y DNI:<br>Marca / sucursal:<br>Fecha:</td></tr></table>
<h2>Devolución</h2>
<table class="sign"><tr><td>Fecha de devolución:<br><br>Devuelve (firma y aclaración):</td><td>Recibe Marketing (firma y aclaración):<br><br>Observaciones:</td></tr></table>
</div>`;
}

function RetiroView({ event, lines, itemById, onClose }) {
  const rows = lines.map(l => ({ name: l.items?.name || itemById[l.item_id]?.name, brand: itemById[l.item_id]?.brand || '', qty: l.qty_allocated }));
  const html = retiroHtml(event, rows);
  const [msg, setMsg] = useState('');
  function toWord() {
    try {
      const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Retiro</title></head><body>${html}</body></html>`;
      const url = URL.createObjectURL(new Blob(['\ufeff', doc], { type: 'application/msword' }));
      const a = document.createElement('a');
      a.href = url; a.download = `Retiro - ${event.event_name}.doc`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) { setMsg('No se pudo generar el archivo de Word'); }
  }
  function toPrint() { try { window.print(); } catch (err) { setMsg('No se pudo abrir la impresión'); } }
  return (
    <div className="modal-overlay print-overlay">
      <div className="modal retiro-modal">
        <div className="card-head no-print"><h2>Retiro de elementos</h2><button type="button" className="close-btn" onClick={onClose}>×</button></div>
        <div className="no-print retiro-actions">
          <button type="button" className="primary-btn" onClick={toPrint}>Imprimir / Guardar PDF</button>
          <button type="button" className="secondary-btn" onClick={toWord}>Descargar Word</button>
          {msg && <span className="warn small">{msg}</span>}
        </div>
        {!rows.length && <p className="warn small no-print">Este evento todavía no tiene elementos cargados.</p>}
        <div className="print-doc" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

function ReceiveModal({ modal, setModal, onClose, onSubmit }) {
  const sh = modal.shipment;
  const setLine = (i, patch) => setModal(p => ({ ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const allOk = () => setModal(p => ({ ...p, lines: p.lines.map(l => ({ ...l, ok: true })) }));
  const bad = modal.lines.some(l => l.ok === false);
  return (
    <Modal title="Controlar y recibir el envío" onClose={onClose} onSubmit={onSubmit} submitLabel="Confirmar recepción">
      <p className="muted small">Envío a <strong>{sh.destination_name}</strong> · {fmtDate(sh.created_at)} · enviado por {sh.created_by_name}. Marcá ✓ si el material llegó bien o ✗ si falta algo.</p>
      <div className="check-lines">
        {modal.lines.map((l, i) => (
          <div key={l.movement_id} className={`check-line ${l.ok === true ? 'is-ok' : l.ok === false ? 'is-bad' : ''}`}>
            <div className="check-name"><strong>{l.name}</strong><small>Enviado: {l.qty}</small></div>
            <div className="check-btns">
              <button type="button" className={`check-btn yes ${l.ok === true ? 'on' : ''}`} onClick={() => setLine(i, { ok: true })} aria-label="Correcto">✓</button>
              <button type="button" className={`check-btn no ${l.ok === false ? 'on' : ''}`} onClick={() => setLine(i, { ok: false })} aria-label="Falta algo">✗</button>
            </div>
            {l.ok === false && (
              <div className="check-extra">
                <label>Cantidad que llegó<input type="number" min="0" max={l.qty} value={l.qty_received} onChange={e => setLine(i, { qty_received: e.target.value })} /></label>
                <label>Detalle<input value={l.note} onChange={e => setLine(i, { note: e.target.value })} placeholder="Ej: caja golpeada" /></label>
              </div>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="secondary-btn add-line-btn" onClick={allOk}>Marcar todo ✓</button>
      <label className="full-width notes-label">Observaciones{bad ? ' *' : ''}<textarea value={modal.notes} onChange={e => setModal(p => ({ ...p, notes: e.target.value }))} placeholder={bad ? 'Contá qué faltó o qué llegó mal. Le llega directo al administrador.' : 'Opcional'} /></label>
      {bad && <p className="warn small">Hay materiales con ✗: queda «recibido con diferencias» y se le avisa al administrador. Se suma al stock solo lo que llegó.</p>}
    </Modal>
  );
}

function PointWithdrawModal({ modal, setModal, onClose, onSubmit }) {
  const set = (k, v) => setModal(p => ({ ...p, [k]: v }));
  const esIncidencia = modal.reason_type === 'incidencia_cliente';
  return (
    <Modal title="Registrar entrega" onClose={onClose} onSubmit={onSubmit} submitLabel="Registrar entrega">
      <p><strong>{modal.name}</strong> · disponible: {modal.available}</p>
      <div className="form-grid">
        <label>Cantidad *<input type="number" min="1" max={modal.available} required value={modal.qty} onChange={e => set('qty', e.target.value)} /></label>
        <label>Motivo<select value={modal.reason_type} onChange={e => set('reason_type', e.target.value)}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {esIncidencia && <>
          <label>Apellido cliente *<input required value={modal.recipient_last_name} onChange={e => set('recipient_last_name', e.target.value)} /></label>
          <label>Patente *<input required value={modal.vehicle_plate} onChange={e => set('vehicle_plate', e.target.value.toUpperCase())} /></label>
        </>}
        <label className="full-width">A quién / para qué *<input required value={modal.reason_detail} onChange={e => set('reason_detail', e.target.value)} placeholder="Ej: entrega 0km a cliente, evento en concesionaria" /></label>
      </div>
    </Modal>
  );
}

function PointStockInModal({ modal, setModal, items, onClose, onSubmit }) {
  const set = (k, v) => setModal(p => ({ ...p, [k]: v }));
  return (
    <Modal title="Cargar stock en este depósito" onClose={onClose} onSubmit={onSubmit} submitLabel="Cargar">
      <div className="form-grid">
        <label>Material *<select required value={modal.item_id} onChange={e => set('item_id', e.target.value)}><option value="">Seleccionar</option>{items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
        <label>Cantidad *<input type="number" min="1" required value={modal.qty} onChange={e => set('qty', e.target.value)} /></label>
        <label className="full-width">Motivo / notas<input value={modal.notes} onChange={e => set('notes', e.target.value)} placeholder="Ej: stock inicial, sobrante de evento" /></label>
      </div>
      <p className="muted small">Para mercadería que te manda Rosario usá «Por recibir». Esta carga es para stock que ya tenías o que llegó por otra vía.</p>
    </Modal>
  );
}

function PointMinModal({ modal, setModal, onClose, onSubmit }) {
  return (
    <Modal title="Punto de restock" onClose={onClose} onSubmit={onSubmit} submitLabel="Guardar">
      <p><strong>{modal.name}</strong></p>
      <div className="form-grid">
        <label>Avisarme cuando el stock llegue a<input type="number" min="0" required value={modal.min} onChange={e => setModal(p => ({ ...p, min: e.target.value }))} /></label>
      </div>
      <p className="muted small">Si tenés entregas registradas, el sistema también calcula un mínimo sugerido y usa el mayor de los dos.</p>
    </Modal>
  );
}

function AdjustModal({ modal, setModal, onClose, onSubmit }) {
  const set = (k, v) => setModal(p => ({ ...p, [k]: v }));
  return (
    <Modal title="Ajustar stock" onClose={onClose} onSubmit={onSubmit} submitLabel="Registrar ajuste">
      <p><strong>{modal.name}</strong> · {modal.place} · stock actual: {modal.current}</p>
      <div className="form-grid">
        <label>Stock real contado *<input type="number" min="0" required value={modal.new_qty} onChange={e => set('new_qty', e.target.value)} /></label>
        <label>Motivo *<input required value={modal.reason} onChange={e => set('reason', e.target.value)} placeholder="Ej: conteo físico, rotura, error de carga" /></label>
      </div>
      <p className="muted small">Queda registrado quién lo hizo, cuándo y de cuánto a cuánto.</p>
    </Modal>
  );
}
