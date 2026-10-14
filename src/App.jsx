import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase';
import './styles.css';
import './styles-extra.css';

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
  occasion: '', stock_nucleo: 0, reorder_nucleo: 0, lead_time_days: 15
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
  const [eventData, setEventData] = useState({ event_name: '', event_date: '', carried_by: '', notes: '' });

  const role = profile?.role || 'none';
  const isStaff = role === 'admin' || role === 'editor';
  const isPunto = role === 'punto';

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Perfil (rol y depósito asignado)
  useEffect(() => {
    if (!session) { setProfile(undefined); return; }
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => {
        setProfile(data || null);
        if (data?.role === 'punto') setTab('mideposito');
      });
  }, [session]);

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
  }, [profile]);

  useEffect(() => {
    if (!session || !profile) return;
    loadData();
    const reload = () => loadData(true);
    let ch = supabase.channel('neostar-live');
    ['items', 'restocks', 'withdrawals', 'movements', 'events', 'event_items', 'destination_stock', 'shipments'].forEach((table) => {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, reload);
    });
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session, profile, loadData]);

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
    if (err) { setError(err.message); return false; }
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
      lead_time_days: Number(form.lead_time_days) || 0
    };
    // El stock NO se edita acá: al crear se carga el inicial; después solo con Ingreso/Retiro/Movimiento/Ajuste.
    const payload = editingItem ? base : { ...base, stock_nucleo: Number(form.stock_nucleo) || 0 };
    const req = editingItem
      ? supabase.from('items').update(payload).eq('id', editingItem)
      : supabase.from('items').insert([payload]);
    const ok = await run(req, editingItem ? 'Material actualizado' : 'Material creado');
    if (ok) { setForm(emptyItem); setEditingItem(null); }
  }

  function deleteItem(item) {
    if (!window.confirm(`¿Eliminar "${item.name}"?\n\nSi ya tuvo movimientos se archiva (deja de verse pero se conserva el historial). Tiene que estar en 0.`)) return;
    run(supabase.rpc('delete_item', { p_item_id: item.id }), (res) => `Material ${res}`);
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

  function saveEvent(e) {
    e.preventDefault();
    if (!eventData.event_name.trim() || !eventData.event_date || !eventData.carried_by.trim()) { setError('Falta información del evento'); return; }
    run(supabase.rpc('open_event', {
      p_event_name: eventData.event_name.trim(), p_event_date: eventData.event_date,
      p_carried_by: eventData.carried_by.trim(), p_notes: eventData.notes || null
    }), 'Evento creado', () => setEventData({ event_name: '', event_date: '', carried_by: '', notes: '' }));
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

  const pointAlerts = useMemo(() => pointStatus.filter(p => p.status !== 'ok'), [pointStatus]);

  const filteredItems = useMemo(() =>
    items.filter(item => {
      const hayQuery = `${item.name} ${item.sku || ''} ${item.brand || ''}`.toLowerCase().includes(query.toLowerCase());
      return hayQuery
        && (categoryFilter === 'Todas' || item.category === categoryFilter)
        && (brandFilter === 'Todas' || item.brand === brandFilter);
    }), [items, query, categoryFilter, brandFilter]);

  const history = useMemo(() => {
    const rows = [];
    restocks.forEach(r => rows.push({ id: 'r' + r.id, at: r.created_at, tipo: 'Ingreso a Depo Central', item: r.items?.name, qty: r.qty, detalle: [r.source, r.cost ? `$${r.cost}` : null, r.notes].filter(Boolean).join(' · '), quien: r.person }));
    withdrawals.forEach(w => rows.push({ id: 'w' + w.id, at: w.created_at, tipo: 'Retiro de Depo Central', item: w.items?.name, qty: w.qty, detalle: [w.reason_detail, w.recipient_last_name, w.vehicle_plate].filter(Boolean).join(' · '), quien: w.person }));
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
  if (profile === undefined) return <div className="login-screen"><div className="login-card">Cargando...</div></div>;
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
  const myDest = destById[selectedDest];
  const roleLabel = { admin: 'Administrador', editor: 'Editor', punto: 'Depósito', viewer: 'Solo lectura' }[role];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">NEOSTAR<span>Control de stock</span></div>
        {nav.map(([key, label]) => (
          <button key={key} className={tab === key ? 'nav-btn active' : 'nav-btn'} onClick={() => { setTab(key); setError(''); setNotice(''); }}>{label}</button>
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
          </div>
          <div className="topbar-actions">
            {isStaff && tab === 'stock' && <button className="primary-btn" onClick={() => { setEditingItem(null); setForm(emptyItem); setModal({ type: 'item' }); }}>+ Nuevo material</button>}
            {isStaff && tab === 'ingresos' && <button className="primary-btn" onClick={() => setModal({ type: 'restock' })}>+ Registrar ingreso</button>}
            {isStaff && tab === 'retiros' && <button className="primary-btn" onClick={() => setModal({ type: 'withdrawal' })}>+ Registrar retiro</button>}
            {isStaff && tab === 'movimientos' && <button className="primary-btn" onClick={() => setModal({ type: 'hub' })}>+ Nuevo movimiento</button>}
            {isStaff && tab === 'eventos' && <button className="primary-btn" onClick={() => setModal({ type: 'event' })}>+ Nuevo evento</button>}
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}
        {notice && <div className="notice-banner">{notice}</div>}

        {loading ? <div className="card">Cargando...</div> :
          tab === 'dashboard' ? <Dashboard items={items} centralAlerts={centralAlerts} pointAlerts={pointAlerts} inTransit={inTransit} toReview={toReview} linesByShipment={linesByShipment} onReview={reviewShipment} events={events} history={history} onGo={setTab} /> :
          tab === 'stock' ? <StockTable items={filteredItems} inDepots={inDepots} isStaff={isStaff} query={query} setQuery={setQuery} categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} brandFilter={brandFilter} setBrandFilter={setBrandFilter}
              onEdit={(item) => { setEditingItem(item.id); setForm({ ...emptyItem, ...item, brand: item.brand || 'Genérico', occasion: item.occasion || '', sku: item.sku || '' }); setModal({ type: 'item' }); }}
              onAdjust={(item) => setModal({ type: 'adjust', item_id: item.id, name: item.name, destination_id: null, current: item.stock_nucleo, new_qty: item.stock_nucleo, reason: '', place: 'Depo Central' })}
              onDelete={deleteItem} /> :
          tab === 'depositos' || tab === 'mideposito' ? (
            <DepositoView
              isPunto={isPunto} canOperate={isStaff || isPunto} destinations={destinations} selectedDest={selectedDest} setSelectedDest={setSelectedDest}
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
          tab === 'movimientos' ? <MovementTable rows={shipments} lines={linesByShipment} canReview={isStaff} onReview={reviewShipment} /> :
          tab === 'eventos' ? <EventsTable events={events} eventItems={eventItems} /> :
          tab === 'historial' ? <HistoryTab rows={history} /> : null
        }
      </main>

      {modal?.type === 'item' && <ItemModal form={form} setForm={setForm} editing={Boolean(editingItem)} onClose={() => setModal(null)} onSubmit={saveItem} />}
      {modal?.type === 'restock' && <RestockModal restock={restock} setRestock={setRestock} items={items} onClose={() => setModal(null)} onSubmit={saveRestock} />}
      {modal?.type === 'withdrawal' && <WithdrawalModal withdrawal={withdrawal} setWithdrawal={setWithdrawal} items={items} onClose={() => setModal(null)} onSubmit={saveWithdrawal} />}
      {modal?.type === 'hub' && <MovementHub pending={inTransit} lines={linesByShipment} onClose={() => setModal(null)} onSend={() => setModal({ type: 'send', destination_id: '', recipient_name: '', notes: '', lines: [{ item_id: '', qty: 1 }] })} onReceive={openReception} />}
      {modal?.type === 'send' && <SendModal modal={modal} setModal={setModal} items={items} destinations={destinations} onClose={() => setModal(null)} onSubmit={saveShipment} />}
      {modal?.type === 'event' && <EventModal eventData={eventData} setEventData={setEventData} onClose={() => setModal(null)} onSubmit={saveEvent} />}
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
    <div className="login-screen">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand dark-brand">NEOSTAR<span>Control de stock</span></div>
        <h2>Ingresar</h2>
        <input type="email" name="email" placeholder="Email" required />
        <input type="password" name="password" placeholder="Contraseña" required />
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
        <div className="brand dark-brand">NEOSTAR<span>Control de stock</span></div>
        <h2>Sin acceso</h2>
        <p className="muted">{message || 'Tu usuario todavía no tiene permisos asignados. Pedile a un administrador que te dé acceso.'}</p>
        <button className="primary-btn" onClick={onSignOut}>Cerrar sesión</button>
      </div>
    </div>
  );
}

function Dashboard({ items, centralAlerts, pointAlerts, inTransit, toReview, linesByShipment, onReview, events, history, onGo }) {
  const urgent = inTransit.filter(m => daysSince(m.created_at) > 5).length;
  return (
    <>
      <section className="stats-grid">
        <Stat label="Materiales" value={items.length} />
        <Stat label="Alertas de stock" value={centralAlerts.length + pointAlerts.length} tone="warning" />
        <Stat label={urgent ? `Envíos en camino (${urgent} hace +5 días)` : 'Envíos en camino'} value={inTransit.length} tone={urgent ? 'warning' : ''} onClick={() => onGo('recepcion')} />
        <Stat label="Eventos abiertos" value={events.filter(e => e.status === 'abierto').length} />
      </section>

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
              <h3 className="sub">Recomprar al proveedor (Depo Central)</h3>
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
  return <div className={`stat ${tone || ''} ${onClick ? 'clickable' : ''}`} onClick={onClick}><strong>{value}</strong><span>{label}</span></div>;
}

function StockTable({ items, inDepots, isStaff, query, setQuery, categoryFilter, setCategoryFilter, brandFilter, setBrandFilter, onEdit, onAdjust, onDelete }) {
  return (
    <section className="card">
      <div className="card-head"><h2>Materiales</h2></div>
      <div className="filters-row">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar..." />
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option>Todas</option>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
        <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}><option>Todas</option><option>Genérico</option>{BRANDS.map(b => <option key={b}>{b}</option>)}</select>
      </div>
      <table>
        <thead><tr><th>Material</th><th>Categoría</th><th>Marca</th><th>Depo Central</th><th>En depósitos y puntos</th>{isStaff && <th></th>}</tr></thead>
        <tbody>
          {items.map(i => {
            const low = Number(i.reorder_nucleo) > 0 && Number(i.stock_nucleo) <= Number(i.reorder_nucleo);
            return (
              <tr key={i.id}>
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
          {!items.length && <tr><td colSpan="6" className="muted">No hay materiales</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

function DepositoView({ isPunto, canOperate, destinations, selectedDest, setSelectedDest, rows, status, itemById, inTransit, onGoReceive, onDeliver, onStockIn, onMin, onAdjust }) {
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
      {inTransit.length > 0 && (
        <div className="notice-banner clickable" onClick={onGoReceive}>
          Hay {inTransit.length} envío(s) en camino para {dest?.name || 'este depósito'}. Tocá acá para confirmarlos cuando lleguen.
        </div>
      )}
      <section className="card">
        <div className="card-head">
          <h2>{dest?.name || 'Depósito'}</h2>
          {canOperate && <button className="primary-btn" onClick={onStockIn}>+ Cargar stock</button>}
        </div>
        <p className="muted small">El stock sube cuando confirmás la recepción de un envío o cuando cargás stock propio. Baja con cada entrega. El punto de restock sugerido se calcula con tus entregas de los últimos 90 días.</p>
        <table>
          <thead><tr><th>Material</th><th>Stock</th><th>Punto de restock</th><th>Reponer</th><th>Estado</th>{canOperate && <th></th>}</tr></thead>
          <tbody>
            {rows.map(r => {
              const s = statusByItem[r.item_id];
              const st = s?.status || 'ok';
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
      <h2>Retiros / Uso (Depo Central)</h2>
      <table>
        <thead><tr><th>Fecha</th><th>Material</th><th>Cantidad</th><th>Motivo</th><th>Cliente</th><th>Patente</th><th>Registrado por</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}><td>{fmtDate(r.created_at)}</td><td>{r.items?.name}</td><td>{r.qty}</td><td>{r.reason_detail}</td><td>{r.recipient_last_name || '—'}</td><td>{r.vehicle_plate || '—'}</td><td>{r.person}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

function MovementTable({ rows, lines, canReview, onReview }) {
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
            <td><span className={`chip ${chip[sh.status]}`}>{label[sh.status]}</span>
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

function EventsTable({ events, eventItems }) {
  return (
    <section className="card">
      <h2>Eventos</h2>
      {events.length ? (
        <div className="events-list">
          {events.map(e => (
            <div key={e.id} className="event-card">
              <h3>{e.event_name}</h3>
              <p><strong>Fecha:</strong> {fmtDate(e.event_date)} | <strong>Llevado por:</strong> {e.carried_by} | <strong>Estado:</strong> <span className={`chip ${e.status}`}>{e.status}</span></p>
              <table style={{ marginTop: '10px' }}>
                <thead><tr><th>Material</th><th>Cantidad</th><th>Remito salida</th><th>Remito llegada</th><th>Usado</th></tr></thead>
                <tbody>
                  {eventItems.filter(ei => ei.event_id === e.id).map(ei => <tr key={ei.id}><td>{ei.items?.name}</td><td>{ei.qty_allocated}</td><td className={ei.remito_salida_date ? 'ok' : 'pending'}>{ei.remito_salida_date ? '✓' : '✗'}</td><td className={ei.remito_llegada_ok ? 'ok' : 'pending'}>{ei.remito_llegada_ok ? '✓' : '✗'}</td><td>{ei.remito_llegada_ok ? ei.qty_used : '—'}</td></tr>)}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ) : <p className="muted">No hay eventos</p>}
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
        {!editing && <label>Stock inicial en Depo Central<input type="number" min="0" value={form.stock_nucleo} onChange={e => set('stock_nucleo', e.target.value)} /></label>}
        <label>Mínimo Depo Central (recompra)<input type="number" min="0" value={form.reorder_nucleo} onChange={e => set('reorder_nucleo', e.target.value)} /></label>
        <label>Demora del proveedor (días)<input type="number" min="0" value={form.lead_time_days} onChange={e => set('lead_time_days', e.target.value)} /></label>
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
            <button type="button" className="hub-btn" onClick={onSend}><strong>Enviar</strong><span>Armá la lista de materiales y mandala a Santa Fe, Cañada, Funes o un concesionario.</span></button>
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
      <p className="muted small">Todo sale del Depo Central ahora y queda «en camino». Se suma al stock del destino cuando lo reciban y lo controlen.</p>
    </Modal>
  );
}

function EventModal({ eventData, setEventData, onClose, onSubmit }) {
  const set = (k, v) => setEventData(p => ({ ...p, [k]: v }));
  return (
    <Modal title="Nuevo evento" onClose={onClose} onSubmit={onSubmit} submitLabel="Crear evento">
      <div className="form-grid">
        <label>Nombre del evento *<input required value={eventData.event_name} onChange={e => set('event_name', e.target.value)} placeholder="Ej: Activación BYD Rosario" /></label>
        <label>Fecha del evento *<input type="date" required value={eventData.event_date} onChange={e => set('event_date', e.target.value)} /></label>
        <label>Llevado por *<input required value={eventData.carried_by} onChange={e => set('carried_by', e.target.value)} placeholder="Nombre de quién lleva el stock" /></label>
        <label className="full-width">Notas<textarea value={eventData.notes} onChange={e => set('notes', e.target.value)} placeholder="Información adicional" /></label>
      </div>
    </Modal>
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
