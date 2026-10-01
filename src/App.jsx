import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase';
import './styles.css';

const CATEGORIES = [
  'Indumentaria y textil',
  'Bazar y estilo de vida',
  'Accesorios y tecnología',
  'Car care / accesorios de auto',
  'Portapatentes',
  'Portadocumentos',
  'Stickers Domo',
  'Regalos',
  'Equipamiento de eventos',
  'Otros'
];

const SUBCATEGORIES = [
  'Gorras y sombreros', 'Remeras y chombas', 'Camperas y buzos', 'Mochilas y bolsos',
  'Termos, mates y vasos', 'Botellas', 'Paraguas y camping', 'Llaveros y pines',
  'Librería', 'Powerbanks y cargadores', 'Anteojos y relojes',
  'Limpieza vehicular', 'Herramientas e infladores', 'Roll banners', 'Sillas', 'Mesas', 'Otros'
];

const BRANDS = ['Kia', 'Jeep', 'RAM', 'Nissan', 'BYD', 'Suzuki', 'Subaru', 'Honda', 'Neostar', 'Genérico'];
const DESTINATIONS = ['Santa Fe', 'Cañada de Gómez', 'Funes', 'Nissan Rosario', 'Kia Rosario', 'BYD Rosario', 'Jeep Rosario', 'RAM Rosario', 'Honda Rosario', 'Suzuki Rosario', 'Subaru Rosario'];

const emptyItem = {
  name: '', sku: '', kind: 'consumible', category: 'Otros', subcategory: '',
  scope: 'generico', brand: '', occasion: '',
  stock_nucleo: 0, stock_sf: 0, stock_canada: 0, stock_funes: 0,
  reorder_nucleo: 10, reorder_sf: 5, lead_time_days: 15
};

export default function App() {
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState('dashboard');
  const [items, setItems] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [restocks, setRestocks] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [movements, setMovements] = useState([]);
  const [events, setEvents] = useState([]);
  const [eventItems, setEventItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Todas');
  const [brandFilter, setBrandFilter] = useState('Todas');
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState(emptyItem);
  const [activeModal, setActiveModal] = useState(null); // 'restock', 'withdrawal', 'movement', 'event'
  const [restock, setRestock] = useState({ item_id: '', qty: 1, source: 'proveedor', cost: '', notes: '' });
  const [withdrawal, setWithdrawal] = useState({ item_id: '', qty: 1, reason_type: 'regalo_corporativo', reason_detail: '', recipient_last_name: '', vehicle_plate: '', notes: '' });
  const [moveData, setMoveData] = useState({ item_id: '', qty: 1, destination: '', recipient_name: '', notes: '' });
  const [eventData, setEventData] = useState({ event_name: '', event_date: '', carried_by: '', notes: '' });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    loadData();
    const channel = supabase.channel('neostar-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restocks' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawals' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movements' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_items' }, loadData)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session]);

  async function loadData() {
    setLoading(true);
    setError('');

    const [itemsRes, restocksRes, withdrawalsRes, movementsRes, eventsRes, eventItemsRes, destRes] = await Promise.all([
      supabase.from('items').select('*').order('name'),
      supabase.from('restocks').select('*, items(name)').order('created_at', { ascending: false }).limit(100),
      supabase.from('withdrawals').select('*, items(name)').order('created_at', { ascending: false }).limit(100),
      supabase.from('movements').select('*, items(name)').order('created_at', { ascending: false }).limit(100),
      supabase.from('events').select('*').order('event_date', { ascending: false }),
      supabase.from('event_items').select('*, items(name), events(event_name)').order('created_at', { ascending: false }),
      supabase.from('destinations').select('*').order('name')
    ]);

    if (itemsRes.error) setError(itemsRes.error.message);
    setItems(itemsRes.data || []);
    setRestocks(restocksRes.data || []);
    setWithdrawals(withdrawalsRes.data || []);
    setMovements(movementsRes.data || []);
    setEvents(eventsRes.data || []);
    setEventItems(eventItemsRes.data || []);
    setDestinations(destRes.data || []);
    setLoading(false);
  }

  async function handleSignIn(e) {
    e.preventDefault();
    const { error: err } = await supabase.auth.signInWithPassword({
      email: e.currentTarget.email.value,
      password: e.currentTarget.password.value
    });
    if (err) setError(err.message);
  }

  async function saveItem(e) {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) { setError('Nombre obligatorio'); return; }

    const payload = {
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      category: form.category,
      subcategory: form.subcategory,
      brand: form.brand || 'Genérico',
      kind: form.kind,
      occasion: form.occasion,
      stock_nucleo: Number(form.stock_nucleo) || 0,
      stock_sf: Number(form.stock_sf) || 0,
      stock_canada: Number(form.stock_canada) || 0,
      stock_funes: Number(form.stock_funes) || 0,
      reorder_nucleo: Number(form.reorder_nucleo) || 0,
      reorder_sf: Number(form.reorder_sf) || 0,
      lead_time_days: Number(form.lead_time_days) || 0
    };

    const result = editingItem
      ? await supabase.from('items').update(payload).eq('id', editingItem)
      : await supabase.from('items').insert([payload]);

    if (result.error) { setError(result.error.message); return; }
    setShowItemModal(false);
    setForm(emptyItem);
    setEditingItem(null);
    loadData();
  }

  async function saveRestock(e) {
    e.preventDefault();
    setError('');
    if (!restock.item_id || restock.qty < 1) { setError('Falta material o cantidad'); return; }

    const { error: err } = await supabase.rpc('register_restock', {
      p_item_id: restock.item_id,
      p_qty: Number(restock.qty),
      p_source: restock.source,
      p_cost: restock.cost ? Number(restock.cost) : null,
      p_person: session?.user?.email,
      p_notes: restock.notes
    });

    if (err) { setError(err.message); return; }
    setActiveModal(null);
    setRestock({ item_id: '', qty: 1, source: 'proveedor', cost: '', notes: '' });
    loadData();
  }

  async function saveWithdrawal(e) {
    e.preventDefault();
    setError('');
    if (!withdrawal.item_id || withdrawal.qty < 1 || !withdrawal.reason_detail.trim()) {
      setError('Falta información'); return;
    }
    if (withdrawal.reason_type === 'incidencia_cliente' && (!withdrawal.recipient_last_name.trim() || !withdrawal.vehicle_plate.trim())) {
      setError('Para incidencia: apellido y patente obligatorios'); return;
    }

    const { error: err } = await supabase.rpc('register_withdrawal', {
      p_item_id: withdrawal.item_id,
      p_qty: Number(withdrawal.qty),
      p_reason_type: withdrawal.reason_type,
      p_reason_detail: withdrawal.reason_detail.trim(),
      p_recipient_last_name: withdrawal.recipient_last_name.trim() || null,
      p_vehicle_plate: withdrawal.vehicle_plate.trim() || null,
      p_person: session?.user?.email,
      p_notes: withdrawal.notes
    });

    if (err) { setError(err.message); return; }
    setActiveModal(null);
    setWithdrawal({ item_id: '', qty: 1, reason_type: 'regalo_corporativo', reason_detail: '', recipient_last_name: '', vehicle_plate: '', notes: '' });
    loadData();
  }

  async function saveMovement(e) {
    e.preventDefault();
    setError('');
    if (!moveData.item_id || moveData.qty < 1 || !moveData.destination) {
      setError('Falta información'); return;
    }

    const { error: err } = await supabase.rpc('register_movement_transfer', {
      p_item_id: moveData.item_id,
      p_qty: Number(moveData.qty),
      p_destination: moveData.destination,
      p_recipient_name: moveData.recipient_name || null,
      p_person: session?.user?.email,
      p_notes: moveData.notes
    });

    if (err) { setError(err.message); return; }
    setActiveModal(null);
    setMoveData({ item_id: '', qty: 1, destination: '', recipient_name: '', notes: '' });
    loadData();
  }

  async function saveEvent(e) {
    e.preventDefault();
    setError('');
    if (!eventData.event_name.trim() || !eventData.event_date || !eventData.carried_by.trim()) {
      setError('Falta información del evento'); return;
    }

    const { error: err } = await supabase.rpc('open_event', {
      p_event_name: eventData.event_name.trim(),
      p_event_date: eventData.event_date,
      p_carried_by: eventData.carried_by.trim(),
      p_notes: eventData.notes
    });

    if (err) { setError(err.message); return; }
    setActiveModal(null);
    setEventData({ event_name: '', event_date: '', carried_by: '', notes: '' });
    loadData();
  }

  const alerts = useMemo(() =>
    items.filter(x => x.kind === 'consumible' && (
      (Number(x.stock_nucleo) || 0) <= (Number(x.reorder_nucleo) || 0) ||
      (Number(x.stock_sf) || 0) <= (Number(x.reorder_sf) || 0)
    )), [items]);

  const filteredItems = useMemo(() =>
    items.filter(item => {
      const hayQuery = `${item.name} ${item.sku || ''} ${item.brand || ''}`
        .toLowerCase().includes(query.toLowerCase());
      const hayCategoria = categoryFilter === 'Todas' || item.category === categoryFilter;
      const hayMarca = brandFilter === 'Todas' || item.brand === brandFilter;
      return hayQuery && hayCategoria && hayMarca;
    }), [items, query, categoryFilter, brandFilter]);

  if (!session) return <Login onSubmit={handleSignIn} error={error} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">NEOSTAR<span>Control de stock</span></div>
        {[
          ['dashboard', 'Dashboard'],
          ['stock', 'Materiales'],
          ['ingresos', 'Ingresos'],
          ['retiros', 'Retiros'],
          ['movimientos', 'Movimientos'],
          ['eventos', 'Eventos'],
          ['historial', 'Historial']
        ].map(([key, label]) => (
          <button key={key} className={tab === key ? 'nav-btn active' : 'nav-btn'} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
        <div className="sidebar-footer">
          <button className="logout-btn" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <small>Gestión de inventario</small>
            <h1>
              {tab === 'dashboard' && 'Dashboard'}
              {tab === 'stock' && 'Materiales'}
              {tab === 'ingresos' && 'Ingresos'}
              {tab === 'retiros' && 'Retiros'}
              {tab === 'movimientos' && 'Movimientos'}
              {tab === 'eventos' && 'Eventos'}
              {tab === 'historial' && 'Historial'}
            </h1>
          </div>
          {tab === 'stock' && <button className="primary-btn" onClick={() => { setEditingItem(null); setForm(emptyItem); setShowItemModal(true); }}>+ Nuevo material</button>}
          {tab === 'ingresos' && <button className="primary-btn" onClick={() => setActiveModal('restock')}>+ Registrar ingreso</button>}
          {tab === 'retiros' && <button className="primary-btn" onClick={() => setActiveModal('withdrawal')}>+ Registrar retiro</button>}
          {tab === 'movimientos' && <button className="primary-btn" onClick={() => setActiveModal('movement')}>+ Nuevo movimiento</button>}
          {tab === 'eventos' && <button className="primary-btn" onClick={() => setActiveModal('event')}>+ Nuevo evento</button>}
        </header>

        {error && <div className="error-banner">{error}</div>}

        {loading ? <div className="card">Cargando...</div> : 
          tab === 'dashboard' ? <Dashboard items={items} alerts={alerts} movements={movements} withdrawals={withdrawals} restocks={restocks} events={events} /> :
          tab === 'stock' ? <StockTable items={filteredItems} query={query} setQuery={setQuery} categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} brandFilter={brandFilter} setBrandFilter={setBrandFilter} onEdit={(item) => { setEditingItem(item.id); setForm({...item}); setShowItemModal(true); }} onDelete={(item) => { if (window.confirm(`¿Eliminar ${item.name}?`)) supabase.from('items').delete().eq('id', item.id).then(loadData); }} /> :
          tab === 'ingresos' ? <RestockTable rows={restocks} /> :
          tab === 'retiros' ? <WithdrawalTable rows={withdrawals} /> :
          tab === 'movimientos' ? <MovementTable rows={movements} /> :
          tab === 'eventos' ? <EventsTable events={events} eventItems={eventItems} items={items} /> :
          tab === 'historial' ? <HistoryTab restocks={restocks} withdrawals={withdrawals} movements={movements} /> : null
        }
      </main>

      {showItemModal && <ItemModal form={form} setForm={setForm} editing={Boolean(editingItem)} onClose={() => setShowItemModal(false)} onSubmit={saveItem} />}
      
      {activeModal === 'restock' && <RestockModal restock={restock} setRestock={setRestock} items={items} onClose={() => setActiveModal(null)} onSubmit={saveRestock} />}
      {activeModal === 'withdrawal' && <WithdrawalModal withdrawal={withdrawal} setWithdrawal={setWithdrawal} items={items} onClose={() => setActiveModal(null)} onSubmit={saveWithdrawal} />}
      {activeModal === 'movement' && <MovementModal moveData={moveData} setMoveData={setMoveData} items={items} onClose={() => setActiveModal(null)} onSubmit={saveMovement} />}
      {activeModal === 'event' && <EventModal eventData={eventData} setEventData={setEventData} onClose={() => setActiveModal(null)} onSubmit={saveEvent} />}
    </div>
  );
}

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

function Dashboard({ items, alerts, movements, withdrawals, restocks, events }) {
  return (
    <>
      <section className="stats-grid">
        <Stat label="Materiales" value={items.length} />
        <Stat label="Alertas" value={alerts.length} tone="warning" />
        <Stat label="Eventos abiertos" value={events.filter(e => e.status === 'abierto').length} />
        <Stat label="Total stock" value={items.reduce((s, i) => s + (Number(i.stock_nucleo) || 0), 0)} />
      </section>

      <div className="two-col">
        <section className="card">
          <h2>Alertas</h2>
          {alerts.length ? <table><thead><tr><th>Material</th><th>Central</th><th>Santa Fe</th></tr></thead><tbody>{alerts.slice(0, 5).map(i => <tr key={i.id}><td>{i.name}</td><td className="warn">{i.stock_nucleo || 0}</td><td className="warn">{i.stock_sf || 0}</td></tr>)}</tbody></table> : <p className="muted">Sin alertas</p>}
        </section>

        <section className="card">
          <h2>Últimas operaciones</h2>
          <div className="timeline">
            {[...restocks, ...withdrawals, ...movements].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 8).map(op => <div key={op.id} className="timeline-row"><strong>{op.items?.name || 'Item'}</strong><small>{new Date(op.created_at).toLocaleDateString('es-AR')}</small></div>)}
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, tone }) {
  return <div className={`stat ${tone || ''}`}><strong>{value}</strong><span>{label}</span></div>;
}

function StockTable({ items, query, setQuery, categoryFilter, setCategoryFilter, brandFilter, setBrandFilter, onEdit, onDelete }) {
  return (
    <section className="card">
      <div className="card-head"><h2>Materiales</h2></div>
      <div className="filters-row">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar..." />
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option>Todas</option>{['Indumentaria y textil', 'Bazar y estilo de vida', 'Accesorios y tecnología', 'Car care / accesorios de auto', 'Portapatentes', 'Portadocumentos', 'Stickers Domo', 'Regalos', 'Equipamiento de eventos', 'Otros'].map(c => <option key={c}>{c}</option>)}</select>
        <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}><option>Todas</option>{['Kia', 'Jeep', 'RAM', 'Nissan', 'BYD', 'Suzuki', 'Subaru', 'Honda', 'Neostar', 'Genérico'].map(b => <option key={b}>{b}</option>)}</select>
      </div>
      <table>
        <thead><tr><th>Material</th><th>Categoría</th><th>Marca</th><th>Central</th><th>SF</th><th>Cañada</th><th>Funes</th><th></th></tr></thead>
        <tbody>{items.map(i => <tr key={i.id}><td><strong>{i.name}</strong><small>{i.sku || 'Sin SKU'}</small></td><td>{i.category}</td><td>{i.brand}</td><td className={Number(i.stock_nucleo) <= Number(i.reorder_nucleo) ? 'warn' : ''}>{i.stock_nucleo || 0}</td><td>{i.stock_sf || 0}</td><td>{i.stock_canada || 0}</td><td>{i.stock_funes || 0}</td><td><button className="link-btn" onClick={() => onEdit(i)}>Editar</button> <button className="link-btn danger" onClick={() => onDelete(i)}>Eliminar</button></td></tr>)}</tbody>
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
        <tbody>{rows.map(r => <tr key={r.id}><td>{new Date(r.created_at).toLocaleDateString('es-AR')}</td><td>{r.items?.name}</td><td>{r.qty}</td><td>{r.source}</td><td>${r.cost || '—'}</td><td>{r.person}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

function WithdrawalTable({ rows }) {
  return (
    <section className="card">
      <h2>Retiros / Uso</h2>
      <table>
        <thead><tr><th>Fecha</th><th>Material</th><th>Cantidad</th><th>Motivo</th><th>Cliente</th><th>Patente</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}><td>{new Date(r.created_at).toLocaleDateString('es-AR')}</td><td>{r.items?.name}</td><td>{r.qty}</td><td>{r.reason_detail}</td><td>{r.recipient_last_name || '—'}</td><td>{r.vehicle_plate || '—'}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

function MovementTable({ rows }) {
  return (
    <section className="card">
      <h2>Movimientos a otros depósitos</h2>
      <table>
        <thead><tr><th>Fecha</th><th>Material</th><th>Cantidad</th><th>Destino</th><th>Recibido por</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}><td>{new Date(r.created_at).toLocaleDateString('es-AR')}</td><td>{r.items?.name}</td><td>{r.qty}</td><td>{r.destination}</td><td>{r.notes || '—'}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

function EventsTable({ events, eventItems, items }) {
  return (
    <section className="card">
      <h2>Eventos</h2>
      {events.length ? (
        <div className="events-list">
          {events.map(e => (
            <div key={e.id} className="event-card">
              <h3>{e.event_name}</h3>
              <p><strong>Fecha:</strong> {new Date(e.event_date).toLocaleDateString('es-AR')} | <strong>Llevado por:</strong> {e.carried_by} | <strong>Estado:</strong> <span className={`badge ${e.status}`}>{e.status}</span></p>
              <table style={{marginTop: '10px'}}>
                <thead><tr><th>Material</th><th>Cantidad</th><th>Remito salida</th><th>Remito llegada</th><th>Usado</th></tr></thead>
                <tbody>
                  {eventItems.filter(ei => ei.event_id === e.id).map(ei => <tr key={ei.id}><td>{ei.items?.name}</td><td>{ei.qty_allocated}</td><td className={ei.remito_salida_date ? 'ok' : 'pending'}>{ei.remito_salida_date ? '✓' : '✗'}</td><td className={ei.remito_llegada_ok ? 'ok' : 'pending'}>{ei.remito_llegada_ok ? '✓' : '✗'}</td><td>{ei.qty_used}</td></tr>)}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ) : <p className="muted">No hay eventos</p>}
    </section>
  );
}

function HistoryTab({ restocks, withdrawals, movements }) {
  const all = [...restocks, ...withdrawals, ...movements].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return (
    <section className="card">
      <h2>Historial completo</h2>
      <table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Material</th><th>Cantidad</th><th>Detalle</th><th>Usuario</th></tr></thead>
        <tbody>{all.slice(0, 200).map((op, i) => <tr key={i}><td>{new Date(op.created_at).toLocaleDateString('es-AR')}</td><td>{op.source ? 'Ingreso' : op.reason_type ? 'Retiro' : 'Movimiento'}</td><td>{op.items?.name}</td><td>{op.qty}</td><td>{op.reason_detail || op.notes || op.source || '—'}</td><td>{op.person}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

function ItemModal({ form, setForm, editing, onClose, onSubmit }) {
  const set = (k, v) => setForm(p => ({...p, [k]: v}));
  return (
    <div className="modal-overlay">
      <form className="modal" onSubmit={onSubmit}>
        <div className="card-head"><h2>{editing ? 'Editar' : 'Nuevo'} material</h2><button type="button" className="close-btn" onClick={onClose}>×</button></div>
        <div className="form-grid">
          <label>Nombre *<input required value={form.name} onChange={e => set('name', e.target.value)} /></label>
          <label>SKU<input value={form.sku} onChange={e => set('sku', e.target.value.toUpperCase())} /></label>
          <label>Categoría<select value={form.category} onChange={e => set('category', e.target.value)}>{['Indumentaria y textil', 'Bazar y estilo de vida', 'Accesorios y tecnología', 'Car care / accesorios de auto', 'Portapatentes', 'Portadocumentos', 'Stickers Domo', 'Regalos', 'Equipamiento de eventos', 'Otros'].map(c => <option key={c}>{c}</option>)}</select></label>
          <label>Marca<select value={form.brand} onChange={e => set('brand', e.target.value)}><option>Genérico</option>{['Kia', 'Jeep', 'RAM', 'Nissan', 'BYD', 'Suzuki', 'Subaru', 'Honda', 'Neostar'].map(b => <option key={b}>{b}</option>)}</select></label>
          <label>Stock Central<input type="number" min="0" value={form.stock_nucleo} onChange={e => set('stock_nucleo', e.target.value)} /></label>
          <label>Mín. Central<input type="number" min="0" value={form.reorder_nucleo} onChange={e => set('reorder_nucleo', e.target.value)} /></label>
        </div>
        <div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button type="submit" className="primary-btn">Guardar</button></div>
      </form>
    </div>
  );
}

function RestockModal({ restock, setRestock, items, onClose, onSubmit }) {
  const set = (k, v) => setRestock(p => ({...p, [k]: v}));
  return (
    <div className="modal-overlay">
      <form className="modal" onSubmit={onSubmit}>
        <div className="card-head"><h2>Registrar ingreso</h2><button type="button" className="close-btn" onClick={onClose}>×</button></div>
        <div className="form-grid">
          <label>Material *<select required value={restock.item_id} onChange={e => set('item_id', e.target.value)}><option value="">Seleccionar</option>{items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
          <label>Cantidad *<input type="number" min="1" required value={restock.qty} onChange={e => set('qty', e.target.value)} /></label>
          <label>Origen<select value={restock.source} onChange={e => set('source', e.target.value)}><option value="proveedor">Proveedor</option><option value="devolucion">Devolución</option><option value="ajuste">Ajuste</option></select></label>
          <label>Costo<input type="number" step="0.01" value={restock.cost} onChange={e => set('cost', e.target.value)} /></label>
        </div>
        <div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button type="submit" className="primary-btn">Guardar ingreso</button></div>
      </form>
    </div>
  );
}

function WithdrawalModal({ withdrawal, setWithdrawal, items, onClose, onSubmit }) {
  const set = (k, v) => setWithdrawal(p => ({...p, [k]: v}));
  const esIncidencia = withdrawal.reason_type === 'incidencia_cliente';
  return (
    <div className="modal-overlay">
      <form className="modal" onSubmit={onSubmit}>
        <div className="card-head"><h2>Registrar retiro</h2><button type="button" className="close-btn" onClick={onClose}>×</button></div>
        <div className="form-grid">
          <label>Material *<select required value={withdrawal.item_id} onChange={e => set('item_id', e.target.value)}><option value="">Seleccionar</option>{items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
          <label>Cantidad *<input type="number" min="1" required value={withdrawal.qty} onChange={e => set('qty', e.target.value)} /></label>
          <label>Motivo<select value={withdrawal.reason_type} onChange={e => set('reason_type', e.target.value)}><option value="regalo_corporativo">Regalo corporativo</option><option value="incidencia_cliente">Incidencia con cliente</option><option value="uso_interno">Uso interno</option><option value="otro">Otro</option></select></label>
          {esIncidencia && <><label>Apellido cliente *<input required value={withdrawal.recipient_last_name} onChange={e => set('recipient_last_name', e.target.value)} /></label><label>Patente *<input required value={withdrawal.vehicle_plate} onChange={e => set('vehicle_plate', e.target.value.toUpperCase())} /></label></>
          }
          <label className="full-width">Descripción *<input required value={withdrawal.reason_detail} onChange={e => set('reason_detail', e.target.value)} placeholder={esIncidencia ? 'Motivo de la incidencia' : 'Descripción del retiro'} /></label>
        </div>
        <div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button type="submit" className="primary-btn">Guardar retiro</button></div>
      </form>
    </div>
  );
}

function MovementModal({ moveData, setMoveData, items, onClose, onSubmit }) {
  const set = (k, v) => setMoveData(p => ({...p, [k]: v}));
  return (
    <div className="modal-overlay">
      <form className="modal" onSubmit={onSubmit}>
        <div className="card-head"><h2>Nuevo movimiento</h2><button type="button" className="close-btn" onClick={onClose}>×</button></div>
        <div className="form-grid">
          <label>Material *<select required value={moveData.item_id} onChange={e => set('item_id', e.target.value)}><option value="">Seleccionar</option>{items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
          <label>Cantidad *<input type="number" min="1" required value={moveData.qty} onChange={e => set('qty', e.target.value)} /></label>
          <label>Destino *<select required value={moveData.destination} onChange={e => set('destination', e.target.value)}><option value="">Seleccionar</option>{['Santa Fe', 'Cañada de Gómez', 'Funes', 'Nissan Rosario', 'Kia Rosario', 'BYD Rosario', 'Jeep Rosario', 'RAM Rosario', 'Honda Rosario'].map(d => <option key={d}>{d}</option>)}</select></label>
          <label className="full-width">Recibido por<input value={moveData.recipient_name} onChange={e => set('recipient_name', e.target.value)} placeholder="Nombre de quién recibe" /></label>
        </div>
        <div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button type="submit" className="primary-btn">Registrar movimiento</button></div>
      </form>
    </div>
  );
}

function EventModal({ eventData, setEventData, onClose, onSubmit }) {
  const set = (k, v) => setEventData(p => ({...p, [k]: v}));
  return (
    <div className="modal-overlay">
      <form className="modal" onSubmit={onSubmit}>
        <div className="card-head"><h2>Nuevo evento</h2><button type="button" className="close-btn" onClick={onClose}>×</button></div>
        <div className="form-grid">
          <label>Nombre del evento *<input required value={eventData.event_name} onChange={e => set('event_name', e.target.value)} placeholder="Ej: Activación BYD Rosario" /></label>
          <label>Fecha del evento *<input type="date" required value={eventData.event_date} onChange={e => set('event_date', e.target.value)} /></label>
          <label>Llevado por *<input required value={eventData.carried_by} onChange={e => set('carried_by', e.target.value)} placeholder="Nombre de quién lleva el stock" /></label>
          <label className="full-width">Notas<textarea value={eventData.notes} onChange={e => set('notes', e.target.value)} placeholder="Información adicional" /></label>
        </div>
        <div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button type="submit" className="primary-btn">Crear evento</button></div>
      </form>
    </div>
  );
}