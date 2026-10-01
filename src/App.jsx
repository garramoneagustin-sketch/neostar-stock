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
  'Gorras y sombreros',
  'Remeras y chombas',
  'Camperas y buzos',
  'Mochilas y bolsos',
  'Termos, mates y vasos',
  'Botellas',
  'Paraguas y camping',
  'Llaveros y pines',
  'Librería',
  'Powerbanks y cargadores',
  'Anteojos y relojes',
  'Limpieza vehicular',
  'Herramientas e infladores',
  'Roll banners',
  'Sillas',
  'Mesas',
  'Otros'
];

const BRANDS = ['Kia', 'Jeep', 'RAM', 'Nissan', 'BYD', 'Suzuki', 'Subaru', 'Honda', 'Neostar', 'Genérico'];
const LOCATIONS = ['Depo Central', 'Depósito Santa Fe', 'Punto de entrega'];

const emptyItem = {
  name: '',
  sku: '',
  kind: 'consumible',
  category: 'Otros',
  subcategory: '',
  scope: 'generico',
  brand: '',
  occasion: '',
  stock_nucleo: 0,
  stock_sf: 0,
  reorder_nucleo: 10,
  reorder_sf: 5,
  lead_time_days: 15,
  total_qty: 0
};

const emptyMove = {
  item_id: '',
  type: 'retiro',
  qty: 1,
  origin: 'Depo Central',
  destination: '',
  reason_type: 'operativo',
  reason_detail: '',
  recipient_last_name: '',
  vehicle_plate: '',
  notes: ''
};

export default function App() {
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState('dashboard');
  const [items, setItems] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Todas');
  const [brandFilter, setBrandFilter] = useState('Todas');
  const [showItemModal, setShowItemModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState(emptyItem);
  const [move, setMove] = useState(emptyMove);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    loadData();
    const channel = supabase
      .channel('neostar-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movements' }, loadData)
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [session]);

  async function loadData() {
    setLoading(true);
    setError('');

    const [itemsRes, destinationsRes, movementsRes] = await Promise.all([
      supabase.from('items').select('*').order('name', { ascending: true }),
      supabase.from('destinations').select('*').order('name', { ascending: true }),
      supabase.from('movements').select('*, items(name)').order('created_at', { ascending: false }).limit(200)
    ]);

    if (itemsRes.error) setError(itemsRes.error.message);
    if (destinationsRes.error) setError(destinationsRes.error.message);
    if (movementsRes.error) setError(movementsRes.error.message);

    setItems(itemsRes.data || []);
    setDestinations(destinationsRes.data || []);
    setMovements(movementsRes.data || []);
    setLoading(false);
  }

  async function handleSignIn(e) {
    e.preventDefault();
    const email = e.currentTarget.email.value;
    const password = e.currentTarget.password.value;
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) setError(signInError.message);
  }

  function openNewItem() {
    setEditingItem(null);
    setForm(emptyItem);
    setShowItemModal(true);
  }

  function openEditItem(item) {
    setEditingItem(item.id);
    setForm({ ...item });
    setShowItemModal(true);
  }

  async function saveItem(e) {
    e.preventDefault();
    setError('');

    if (!form.name.trim()) {
      setError('El nombre del material es obligatorio.');
      return;
    }

    const payload = {
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      stock_nucleo: Number(form.stock_nucleo) || 0,
      stock_sf: Number(form.stock_sf) || 0,
      reorder_nucleo: Number(form.reorder_nucleo) || 0,
      reorder_sf: Number(form.reorder_sf) || 0,
      lead_time_days: Number(form.lead_time_days) || 0,
      category: form.category || 'Otros',
      subcategory: form.subcategory || '',
      brand: form.brand || 'Genérico',
      kind: form.kind || 'consumible',
      occasion: form.occasion || '',
      scope: form.scope || 'generico'
    };

    let result;
    if (editingItem) {
      result = await supabase.from('items').update(payload).eq('id', editingItem);
    } else {
      result = await supabase.from('items').insert([payload]);
    }

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setShowItemModal(false);
    setForm(emptyItem);
    setEditingItem(null);
    loadData();
  }

  async function deleteItem(item) {
    if (!window.confirm(`¿Eliminar ${item.name}?`)) return;
    const { error: deleteError } = await supabase.from('items').delete().eq('id', item.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    loadData();
  }

  async function saveMovement(e) {
    e.preventDefault();
    setError('');

    if (!move.item_id || !move.reason_detail.trim()) {
      setError('Falta elegir un material y completar el detalle del motivo.');
      return;
    }

    if (move.reason_type === 'incidencia_cliente') {
      if (!move.recipient_last_name.trim()) {
        setError('Para incidencias con cliente, el apellido es obligatorio.');
        return;
      }
      if (!move.vehicle_plate.trim()) {
        setError('Para incidencias con cliente, la patente del vehículo es obligatoria.');
        return;
      }
    }

    const payload = {
      p_item_id: move.item_id,
      p_type: move.type,
      p_qty: Number(move.qty) || 1,
      p_fecha: new Date().toISOString().slice(0, 10),
      p_person: session?.user?.email || 'usuario',
      p_reason_type: move.reason_type,
      p_reason_detail: move.reason_detail.trim(),
      p_recipient_last_name: move.recipient_last_name.trim() || null,
      p_vehicle_plate: move.vehicle_plate.trim() || null,
      p_origin: move.origin,
      p_destination: move.destination || null
    };

    const { error: moveError } = await supabase.rpc('register_movement', payload);
    if (moveError) {
      setError(moveError.message);
      return;
    }

    setShowMoveModal(false);
    setMove(emptyMove);
    loadData();
  }

  const alerts = useMemo(
    () =>
      items.filter(
        (x) =>
          x.kind === 'consumible' &&
          ((Number(x.stock_nucleo) || 0) <= (Number(x.reorder_nucleo) || 0) ||
            (Number(x.stock_sf) || 0) <= (Number(x.reorder_sf) || 0))
      ),
    [items]
  );

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const hayQuery = `${item.name} ${item.sku || ''} ${item.brand || ''}`
        .toLowerCase()
        .includes(query.toLowerCase());
      const hayCategoria = categoryFilter === 'Todas' || item.category === categoryFilter;
      const hayMarca = brandFilter === 'Todas' || item.brand === brandFilter;
      return hayQuery && hayCategoria && hayMarca;
    });
  }, [items, query, categoryFilter, brandFilter]);

  if (!session) {
    return <Login onSubmit={handleSignIn} error={error} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          NEOSTAR
          <span>Control de stock</span>
        </div>

        {[
          ['dashboard', 'Dashboard'],
          ['stock', 'Materiales'],
          ['movimientos', 'Movimientos'],
          ['destinos', 'Puntos de entrega']
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'nav-btn active' : 'nav-btn'}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}

        <div className="sidebar-footer">
          <button className="logout-btn" onClick={() => supabase.auth.signOut()}>
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <small>Gestión de inventario</small>
            <h1>
              {tab === 'dashboard' && 'Dashboard'}
              {tab === 'stock' && 'Materiales'}
              {tab === 'movimientos' && 'Movimientos'}
              {tab === 'destinos' && 'Puntos de entrega'}
            </h1>
          </div>
          <button className="primary-btn" onClick={() => setShowMoveModal(true)}>
            + Registrar retiro
          </button>
        </header>

        {error && <div className="error-banner">{error}</div>}

        {loading ? (
          <div className="card">Cargando datos…</div>
        ) : tab === 'dashboard' ? (
          <Dashboard items={items} alerts={alerts} movements={movements} />
        ) : tab === 'stock' ? (
          <StockTable
            items={filteredItems}
            query={query}
            setQuery={setQuery}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            brandFilter={brandFilter}
            setBrandFilter={setBrandFilter}
            onNew={() => openNewItem()}
            onEdit={openEditItem}
            onDelete={deleteItem}
          />
        ) : tab === 'movimientos' ? (
          <MovementTable rows={movements} onNew={() => setShowMoveModal(true)} />
        ) : (
          <DestinationTable rows={destinations} />
        )}
      </main>

      {showItemModal && (
        <ItemModal
          form={form}
          setForm={setForm}
          editing={Boolean(editingItem)}
          onClose={() => setShowItemModal(false)}
          onSubmit={saveItem}
        />
      )}

      {showMoveModal && (
        <MovementModal
          move={move}
          setMove={setMove}
          items={items}
          destinations={destinations}
          onClose={() => setShowMoveModal(false)}
          onSubmit={saveMovement}
        />
      )}
    </div>
  );
}

function Login({ onSubmit, error }) {
  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand dark-brand">
          NEOSTAR
          <span>Control de stock</span>
        </div>
        <h2>Ingresar</h2>
        <input type="email" name="email" placeholder="Email" required />
        <input type="password" name="password" placeholder="Contraseña" required />
        <button className="primary-btn" type="submit">Ingresar</button>
        {error && <p className="error-banner">{error}</p>}
      </form>
    </div>
  );
}

function Dashboard({ items, alerts, movements }) {
  return (
    <>
      <section className="stats-grid">
        <Stat label="Materiales" value={items.length} />
        <Stat label="Alertas" value={alerts.length} tone="warning" />
        <Stat label="Movimientos" value={movements.length} />
        <Stat
          label="Unidades totales"
          value={items.reduce((sum, item) => sum + (Number(item.stock_nucleo) || 0) + (Number(item.stock_sf) || 0), 0)}
        />
      </section>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2>Alertas</h2>
          </div>
          {alerts.length ? (
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Central</th>
                  <th>Santa Fe</th>
                </tr>
              </thead>
              <tbody>
                {alerts.slice(0, 8).map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td className="warn">{item.stock_nucleo || 0} / {item.reorder_nucleo || 0}</td>
                    <td className="warn">{item.stock_sf || 0} / {item.reorder_sf || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No hay alertas por stock bajo.</p>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Últimos movimientos</h2>
          </div>
          <div className="timeline">
            {movements.slice(0, 8).map((move) => (
              <div key={move.id} className="timeline-row">
                <div>
                  <strong>{move.items?.name || 'Material'}</strong>
                  <span>
                    {move.type} · {move.qty} unidades
                  </span>
                </div>
                <small>{new Date(move.created_at).toLocaleDateString('es-AR')}</small>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function StockTable({
  items,
  query,
  setQuery,
  categoryFilter,
  setCategoryFilter,
  brandFilter,
  setBrandFilter,
  onNew,
  onEdit,
  onDelete
}) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Materiales</h2>
          <p className="muted">Clasificación por categoría, marca y SKU</p>
        </div>
        <button className="primary-btn" onClick={onNew}>+ Nuevo material</button>
      </div>

      <div className="filters-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre, SKU o marca…"
        />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option>Todas</option>
          {CATEGORIES.map((cat) => (
            <option key={cat}>{cat}</option>
          ))}
        </select>
        <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
          <option>Todas</option>
          {BRANDS.map((brand) => (
            <option key={brand}>{brand}</option>
          ))}
        </select>
      </div>

      <table>
        <thead>
          <tr>
            <th>Material</th>
            <th>Categoría</th>
            <th>Marca</th>
            <th>Central</th>
            <th>Santa Fe</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <strong>{item.name}</strong>
                <small>{item.sku || 'Sin SKU'}</small>
              </td>
              <td>
                {item.category}
                <small>{item.subcategory || 'Sin subcategoría'}</small>
              </td>
              <td>{item.brand || 'Genérico'}</td>
              <td>
                <StockBadge value={Number(item.stock_nucleo) || 0} min={Number(item.reorder_nucleo) || 0} />
              </td>
              <td>
                <StockBadge value={Number(item.stock_sf) || 0} min={Number(item.reorder_sf) || 0} />
              </td>
              <td className="actions-col">
                <button className="link-btn" onClick={() => onEdit(item)}>Editar</button>
                <button className="link-btn danger" onClick={() => onDelete(item)}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {!items.length && <p className="muted empty-state">No hay materiales con esos filtros.</p>}
    </section>
  );
}

function StockBadge({ value, min }) {
  return <span className={value <= min ? 'warn' : ''}>{value} <small>mín. {min}</small></span>;
}

function MovementTable({ rows, onNew }) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Historial de movimientos</h2>
          <p className="muted">Cada retiro debe especificar un motivo y, si corresponde, apellido del cliente y patente.</p>
        </div>
        <button className="primary-btn" onClick={onNew}>+ Registrar retiro</button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Material</th>
            <th>Cantidad</th>
            <th>Motivo</th>
            <th>Cliente</th>
            <th>Patente</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.created_at).toLocaleDateString('es-AR')}</td>
              <td>{row.items?.name || row.item_id}</td>
              <td>{row.qty}</td>
              <td>
                {row.reason_detail || 'Sin detalle'}
              </td>
              <td>{row.recipient_last_name || '—'}</td>
              <td>{row.vehicle_plate || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function DestinationTable({ rows }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Puntos de entrega</h2>
      </div>
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Marcas</th>
            <th>Abastecido por</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>{(row.marcas || []).join(', ')}</td>
              <td>{row.abastecido_por}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ItemModal({ form, setForm, editing, onClose, onSubmit }) {
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="modal-overlay">
      <form className="modal" onSubmit={onSubmit}>
        <div className="card-head">
          <h2>{editing ? 'Editar material' : 'Nuevo material'}</h2>
          <button type="button" className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="form-grid">
          <label>
            Nombre *
            <input required value={form.name} onChange={(e) => set('name', e.target.value)} />
          </label>

          <label>
            SKU
            <input value={form.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} placeholder="NIS-ACC-LLA01" />
          </label>

          <label>
            Macrocategoría
            <select value={form.category} onChange={(e) => set('category', e.target.value)}>
              {CATEGORIES.map((cat) => (
                <option key={cat}>{cat}</option>
              ))}
            </select>
          </label>

          <label>
            Subcategoría
            <select value={form.subcategory} onChange={(e) => set('subcategory', e.target.value)}>
              <option value="">Seleccionar</option>
              {SUBCATEGORIES.map((sub) => (
                <option key={sub}>{sub}</option>
              ))}
            </select>
          </label>

          <label>
            Marca
            <select value={form.brand} onChange={(e) => set('brand', e.target.value)}>
              <option value="">Genérico</option>
              {BRANDS.map((brand) => (
                <option key={brand}>{brand}</option>
              ))}
            </select>
          </label>

          <label>
            Tipo
            <select value={form.kind} onChange={(e) => set('kind', e.target.value)}>
              <option value="consumible">Consumible</option>
              <option value="equipamiento">Equipamiento</option>
            </select>
          </label>

          <label>
            Ocasión
            <input value={form.occasion} onChange={(e) => set('occasion', e.target.value)} placeholder="Nuevo, Service, Postventa…" />
          </label>

          <label>
            Stock central
            <input type="number" min="0" value={form.stock_nucleo} onChange={(e) => set('stock_nucleo', e.target.value)} />
          </label>

          <label>
            Mínimo central
            <input type="number" min="0" value={form.reorder_nucleo} onChange={(e) => set('reorder_nucleo', e.target.value)} />
          </label>

          <label>
            Stock Santa Fe
            <input type="number" min="0" value={form.stock_sf} onChange={(e) => set('stock_sf', e.target.value)} />
          </label>

          <label>
            Mínimo Santa Fe
            <input type="number" min="0" value={form.reorder_sf} onChange={(e) => set('reorder_sf', e.target.value)} />
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="primary-btn">Guardar</button>
        </div>
      </form>
    </div>
  );
}

function MovementModal({ move, setMove, items, destinations, onClose, onSubmit }) {
  const set = (key, value) => setMove((prev) => ({ ...prev, [key]: value }));
  const esIncidencia = move.reason_type === 'incidencia_cliente';

  return (
    <div className="modal-overlay">
      <form className="modal" onSubmit={onSubmit}>
        <div className="card-head">
          <h2>Registrar retiro</h2>
          <button type="button" className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="form-grid">
          <label>
            Material *
            <select required value={move.item_id} onChange={(e) => set('item_id', e.target.value)}>
              <option value="">Seleccionar</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>{item.name} · {item.brand || 'Genérico'}</option>
              ))}
            </select>
          </label>

          <label>
            Cantidad *
            <input type="number" min="1" required value={move.qty} onChange={(e) => set('qty', e.target.value)} />
          </label>

          <label>
            Origen
            <select value={move.origin} onChange={(e) => set('origin', e.target.value)}>
              {LOCATIONS.map((loc) => (
                <option key={loc}>{loc}</option>
              ))}
            </select>
          </label>

          <label>
            Destino
            <select value={move.destination} onChange={(e) => set('destination', e.target.value)}>
              <option value="">Uso interno</option>
              {destinations.map((d) => (
                <option key={d.id}>{d.name}</option>
              ))}
            </select>
          </label>

          <label>
            Motivo *
            <select required value={move.reason_type} onChange={(e) => set('reason_type', e.target.value)}>
              <option value="operativo">Operativo / reposición</option>
              <option value="incidencia_cliente">Incidencia con cliente</option>
              <option value="regalo_especial">Regalo corporativo o especial</option>
              <option value="visita">Visita importante</option>
              <option value="evento">Evento</option>
              <option value="otro">Otro</option>
            </select>
          </label>

          {esIncidencia && (
            <>
              <label>
                Apellido del cliente *
                <input
                  required
                  value={move.recipient_last_name}
                  onChange={(e) => set('recipient_last_name', e.target.value)}
                  placeholder="García, López, etc."
                />
              </label>

              <label>
                Patente del vehículo *
                <input
                  required
                  value={move.vehicle_plate}
                  onChange={(e) => set('vehicle_plate', e.target.value.toUpperCase())}
                  placeholder="ABC123, XYZ456"
                />
              </label>
            </>
          )}

          <label className="full-width">
            Descripción del motivo *
            <input
              required
              value={move.reason_detail}
              onChange={(e) => set('reason_detail', e.target.value)}
              placeholder={esIncidencia ? "Ej.: Defecto en entrega, cliente reportó falla" : "Ej.: Regalo futbolista Central retira BYD"}
            />
          </label>

          <label className="full-width">
            Notas
            <textarea value={move.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Información adicional (opcional)" />
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="primary-btn">Guardar retiro</button>
        </div>
      </form>
    </div>
  );
}
