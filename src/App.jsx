import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase';
import { UiCtx, Modal, MaterialPicker, useScrollLock, norm, compressImage, downloadCsv, parseCsv } from './ui';
import './styles.css';
import './styles-extra.css';
import './styles-pro.css';
import './styles-ronda2.css';

const driveId = (u) => (String(u).match(/\/d\/([\w-]+)/) || [])[1];
const photoThumb = (u, w = 160) => (driveId(u) ? `https://drive.google.com/thumbnail?id=${driveId(u)}&sz=w${w}` : u);
function Thumb({ url, alt, w = 160 }) {
  const [st, setSt] = useState({ loaded: false, failed: false, tries: 0 });
  const src = photoThumb(url, w) + (st.tries ? `${driveId(url) ? '&' : '?'}r=${st.tries}` : '');
  // Si falla, se marca ❓ al instante y se reintenta una sola vez en segundo plano
  const onError = () => {
    setSt(x => ({ ...x, failed: true }));
    if (st.tries < 1) setTimeout(() => setSt(x => ({ ...x, tries: x.tries + 1 })), 1500);
  };
  return (
    <span className="thumb-box">
      {!st.loaded && (st.failed
        ? <span className="thumb-fail" title="Foto no disponible: el archivo no se encuentra o no se puede abrir">❓</span>
        : <span className="thumb-wait" />)}
      <img key={st.tries} src={src} alt="" aria-label={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer"
        className={st.loaded ? 'is-loaded' : 'is-pending'}
        onLoad={() => setSt(x => ({ ...x, loaded: true, failed: false }))} onError={onError} />
    </span>
  );
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
  historial: 'M12 7v5l3 2M3 12a9 9 0 1 0 3-6.7M3 4v4h4',
  usuarios: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM4 21c0-4 4-6 8-6s8 2 8 6'
};
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
const EXTRA_ICONS = { menu: 'M4 6h16M4 12h16M4 18h16', open: 'M9 6l6 6-6 6', close: 'M15 6l-6 6 6 6', logout: 'M9 4H5v16h4M16 8l4 4-4 4M20 12H9' };
function NavIcon({ name }) {
  return <svg className="nav-ico" viewBox="0 0 24 24" aria-hidden="true"><path d={NAV_ICONS[name] || EXTRA_ICONS[name] || NAV_ICONS.dashboard} /></svg>;
}
const BRANDS = ['Kia', 'Jeep', 'RAM', 'Nissan', 'BYD', 'Suzuki', 'Subaru', 'Honda', 'Neostar'];

const REASONS = [
  ['regalo_corporativo', 'Regalo corporativo'],
  ['incidencia_cliente', 'Incidencia con cliente'],
  ['uso_interno', 'Uso interno'],
  ['otro', 'Otro']
];

const ROSARIO = 'Depósito Rosario';
// En la base los depósitos se llaman «DEPOSITO MARKETING SANTA FE», etc.: en pantalla se muestran como «Depósito Santa Fe»
const dn = (s) => {
  const m = /^DEPOSITO MARKETING\s+(.+)$/i.exec(String(s ?? '').trim());
  return m ? `Depósito ${m[1].toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase())}` : s;
};
const dnDest = (d) => ({ ...d, name: dn(d.name) });
const dnMov = (m) => ({ ...m, origen: dn(m.origen), destination: dn(m.destination) });
const dnShip = (x) => ({ ...x, origin_name: dn(x.origin_name), destination_name: dn(x.destination_name) });
// Ningún tipo crudo se muestra: lo desconocido aparece como «Otro movimiento»
const MOVE_LABELS = {
  stock_inicial: 'Stock inicial',
  envio_destino: 'Envío',
  ingreso_punto: 'Carga en depósito',
  entrega: 'Entrega en depósito',
  devolucion: 'Devolución a Rosario',
  ajuste: 'Ajuste de stock',
  salida_evento: 'Salida a evento',
  retorno_evento: 'Regreso de evento',
  consumo_evento: 'Consumido en evento',
  resolucion_diferencia: 'Resolución de diferencia',
  retiro: `Retiro de ${ROSARIO}`,
  compra: 'Compra'
};
const SOURCE_LABELS = { proveedor: 'Proveedor', otro: 'Otro', devolucion: 'Devolución', ajuste: 'Ajuste' };

const DIFF_REASONS = [
  ['faltante', 'Faltante (llegó menos)'],
  ['danado', 'Llegó dañado'],
  ['otro_material', 'Llegó otro material'],
  ['de_mas', 'Llegó de más']
];
const DIFF_LABEL = Object.fromEntries(DIFF_REASONS);
// Las opciones usan el nombre del origen real del envío (Rosario o un depósito)
const resOptions = (org) => [
  ['proximo_envio', 'Va en el próximo envío (sigue en camino)'],
  ['no_salio', `Nunca salió de ${org} (error de carga: vuelve a ${org})`],
  ['perdida', 'Se perdió / se rompió (baja definitiva)'],
  ['error_conteo', 'Error de conteo en destino (se suma al destino)']
];
const resSobrante = (org) => [['sobrante', `Sobrante: se descuenta de ${org} y se suma al destino`]];
const RES_LABEL = { proximo_envio: 'Va en el próximo envío', no_salio: 'Nunca salió (volvió al stock de origen)', perdida: 'Pérdida / rotura', error_conteo: 'Error de conteo en destino', sobrante: 'Sobrante sumado al destino' };

const STATE_LABELS = {
  en_transito: 'En camino',
  recibido: 'Recibido',
  recibido_con_diferencia: 'Recibido con diferencia',
  con_diferencia: 'Con diferencia – pendiente',
  parcial: 'Parcial: el resto sigue en camino',
  entregado: 'Entregado',
  ajustado: 'Ajustado'
};

const emptyItem = {
  name: '', kind: 'consumible', category: '', brand: 'Genérico',
  occasion: '', stock_nucleo: 0, reorder_nucleo: 0, lead_time_days: 15, photoFiles: []
};
const ROLE_LABELS = { admin: 'Administrador', editor: 'Editor', punto: 'Depósito', viewer: 'Solo lectura', none: 'Sin acceso' };
const addDays = (s, n) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const byName = (a, b) => a.name.localeCompare(b.name);
const isStorageUrl = (u) => /\/storage\/v1\/object\/public\/item-photos\//.test(String(u));

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('es-AR') : '—');
const fmtMoney = (n) => `$ ${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const reasonLabel = (v) => (REASONS.find(r => r[0] === v) || [v, v])[1];
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const daysSince = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(undefined); // undefined = cargando, null = sin perfil
  const [tab, setTab] = useState('dashboard');
  // Menú lateral: expandido o solo íconos. En pantallas angostas queda siempre en íconos y se abre encima del contenido.
  const [navCollapsed, setNavCollapsed] = useState(() => { try { return localStorage.getItem('navCollapsed') === '1'; } catch { return false; } });
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const f = () => { setNarrow(mq.matches); setNavOpen(false); };
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  const toggleNav = () => {
    if (narrow) { setNavOpen(o => !o); return; }
    setNavCollapsed(c => { try { localStorage.setItem('navCollapsed', c ? '0' : '1'); } catch { /* sin almacenamiento */ } return !c; });
  };
  const rail = narrow ? !navOpen : navCollapsed;
  const [items, setItems] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [destStock, setDestStock] = useState([]);
  const [pointStatus, setPointStatus] = useState([]);
  const [restocks, setRestocks] = useState([]);
  const [reserved, setReserved] = useState({});
  const [withdrawals, setWithdrawals] = useState([]);
  const [movements, setMovements] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [shipLines, setShipLines] = useState([]); // renglones de TODOS los envíos cargados (no dependen del límite de movimientos)
  const [categories, setCategories] = useState([]);
  const [centralStatus, setCentralStatus] = useState([]); // materiales de Rosario a recomprar (consumo real de 90 días)
  const [reviewAdj, setReviewAdj] = useState([]); // ajustes de depósitos pendientes de revisión
  const [users, setUsers] = useState([]);
  const [events, setEvents] = useState([]);
  const [eventItems, setEventItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false); // llegó desde el link de «Olvidé mi contraseña»
  const [authMsg, setAuthMsg] = useState('');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Todas');
  const [brandFilter, setBrandFilter] = useState('Todas');
  const [photoFilter, setPhotoFilter] = useState(false);
  const [selectedDest, setSelectedDest] = useState('');
  const [shipFilter, setShipFilter] = useState('todos'); // Envíos: todos | pendientes de recibir
  const [depView, setDepView] = useState('uno'); // Depósitos y puntos: un depósito | vista general
  const [modal, setModal] = useState(null); // { type, ...datos }
  useEffect(() => {
    if (!modal) return undefined;
    const onKey = e => { if (e.key === 'Escape') setModal(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);
  // Al abrir o cerrar una ventana se limpia el error anterior
  useEffect(() => { setError(''); }, [modal?.type]);
  const [form, setForm] = useState(emptyItem);
  const [editingItem, setEditingItem] = useState(null);
  const emptyRestock = () => ({ lines: [{ item_id: '', qty: 1, cost: '' }], source: 'proveedor', notes: '' });
  const [restock, setRestock] = useState(emptyRestock);
  const emptyWithdrawal = () => ({ lines: [{ item_id: '', qty: 1 }], reason_type: '', reason_detail: '', recipient_last_name: '', vehicle_plate: '', notes: '' });
  const [withdrawal, setWithdrawal] = useState(emptyWithdrawal);

  const role = profile?.role || 'none';
  const isStaff = role === 'admin' || role === 'editor';
  const isPunto = role === 'punto';
  const isOwner = Boolean(profile?.is_owner);

  useEffect(() => {
    // Si el link de recuperación venció, Supabase lo informa en la dirección (#error_code=otp_expired)
    try {
      const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const code = h.get('error_code');
      if (code) {
        setAuthMsg(code === 'otp_expired'
          ? 'El enlace venció o ya se usó. Pedí uno nuevo con «Olvidé mi contraseña». (A veces el programa de correo abre el enlace antes que vos y lo gasta.)'
          : (h.get('error_description') || 'No se pudo validar el enlace.').replace(/\+/g, ' '));
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch { /* sin acceso a la dirección */ }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(prev => ((prev?.user?.id || null) === (next?.user?.id || null) ? prev : next));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Perfil (rol y depósito asignado)
  useEffect(() => {
    if (!session) { setProfile(undefined); return; }
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => {
        setProfile(prev => (prev && data && prev.id === data.id && prev.role === data.role && prev.destination_id === data.destination_id && prev.is_owner === data.is_owner ? prev : (data || null)));
        if (data?.role === 'punto') setTab('mideposito');
        else if (data?.destination_id) setTab('depositos'); // quien tiene un depósito asignado (ej. Santiago en Santa Fe) abre directo en él
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
    const [it, ds, dst, ps, mv, cats] = await Promise.all([
      q(supabase.from('items').select('*').eq('active', true).order('name')),
      q(supabase.from('destinations').select('*').order('name')),
      q(supabase.from('destination_stock').select('*')),
      q(supabase.from('point_restock_status').select('*')),
      q(supabase.from('movements').select('*, items(name, brand)').order('created_at', { ascending: false }).limit(600)),
      q(supabase.from('categories').select('*').eq('active', true).order('sort').order('name'))
    ]);
    const sh = await q(supabase.from('shipments').select('*').order('created_at', { ascending: false }).limit(300));
    // Los materiales de cada envío se piden por envío: así no se pierden cuando el movimiento sale de los últimos 600
    const ids = sh.map(x => x.id);
    const chunks = [];
    for (let i = 0; i < ids.length; i += 60) chunks.push(ids.slice(i, i + 60));
    const lines = (await Promise.all(chunks.map(c => q(supabase.from('movements').select('*, items(name, brand)').in('shipment_id', c).eq('type', 'envio_destino'))))).flat();
    setItems(it); setDestinations(ds.map(dnDest)); setDestStock(dst); setPointStatus(ps.map(p => ({ ...p, destination_name: dn(p.destination_name) }))); setMovements(mv.map(dnMov)); setShipments(sh.map(dnShip)); setCategories(cats); setShipLines(lines.map(dnMov));

    if (profile?.role !== 'punto') {
      const [rs, wd, ev, evi, rsv, rev, us, cst] = await Promise.all([
        q(supabase.from('restocks').select('*, items(name)').order('created_at', { ascending: false }).limit(200)),
        q(supabase.from('withdrawals').select('*, items(name)').order('created_at', { ascending: false }).limit(200)),
        q(supabase.from('events').select('*').order('event_date', { ascending: false })),
        q(supabase.from('event_items').select('*, items(name), events(event_name)').order('created_at', { ascending: false })),
        q(supabase.rpc('reserved_by_item')),
        q(supabase.from('movements').select('*, items(name)').eq('needs_review', true).order('created_at', { ascending: false })),
        profile?.role === 'admin' ? q(supabase.from('profiles').select('*').order('full_name')) : Promise.resolve([]),
        q(supabase.from('central_restock_status').select('*').neq('status', 'ok'))
      ]);
      setRestocks(rs); setWithdrawals(wd); setEvents(ev); setEventItems(evi); setReviewAdj(rev.map(dnMov)); setUsers(us); setCentralStatus(cst);
      setReserved(Object.fromEntries((rsv || []).map(r => [r.item_id, r.reserved])));
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
    const onVis = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', reload);
    const poll = setInterval(() => { if (document.visibilityState === 'visible') loadData(true); }, 60000);
    return () => { clearTimeout(t); clearInterval(poll); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', reload); supabase.removeChannel(ch); };
  }, [session?.user?.id, profile?.id, profile?.role, loadData]);

  // Depósito seleccionado por defecto: el asignado al usuario; si no, el último que miró; si no, DEPOSITO MARKETING SANTA FE
  useEffect(() => {
    if (!destinations.length) return;
    if (isPunto) { setSelectedDest(profile.destination_id || ''); return; }
    if (selectedDest && destinations.some(d => d.id === selectedDest)) return;
    let last = null;
    try { last = localStorage.getItem('lastDest'); } catch { /* sin almacenamiento */ }
    const pick = [profile?.destination_id, last, destinations.find(d => d.supplies_dealers)?.id, destinations[0].id]
      .find(id => id && destinations.some(d => d.id === id));
    setSelectedDest(pick || '');
  }, [destinations, isPunto, profile, selectedDest]);
  const chooseDest = (id) => {
    setSelectedDest(id);
    try { localStorage.setItem('lastDest', id); } catch { /* sin almacenamiento */ }
  };

  async function handleSignIn(e) {
    e.preventDefault();
    setError(''); setAuthMsg('');
    const { error: err } = await supabase.auth.signInWithPassword({
      email: e.currentTarget.email.value,
      password: e.currentTarget.password.value
    });
    if (err) setError(/invalid login/i.test(err.message) ? 'Email o contraseña incorrectos.' : friendlyError(err.message));
  }

  async function handleForgot(email) {
    setError(''); setAuthMsg('');
    if (!email?.trim()) { setError('Escribí tu email arriba y volvé a tocar «Olvidé mi contraseña».'); return; }
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/` });
    if (err) setError(friendlyError(err.message));
    else setAuthMsg('Si ese email tiene una cuenta, te mandamos un enlace para elegir una contraseña nueva. Revisá también la carpeta de spam. El enlace dura poco: abrilo en cuanto llegue.');
  }

  async function handleNewPassword(e) {
    e.preventDefault();
    const f = e.currentTarget;
    const p1 = f.password.value, p2 = f.password2.value;
    setError('');
    if (p1.length < 10) { setError('La contraseña tiene que tener al menos 10 caracteres.'); return; }
    if (p1 !== p2) { setError('Las dos contraseñas no coinciden.'); return; }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password: p1 });
    setBusy(false);
    if (err) { setError(friendlyError(err.message)); return; }
    setRecovery(false);
    setNotice('Contraseña actualizada. Ya podés usar la plataforma con tu contraseña nueva.');
  }

  // Ejecuta una operación del servidor, muestra errores/avisos y refresca.
  // Mientras corre, los botones quedan bloqueados (evita operaciones duplicadas por doble clic).
  async function run(promise, okMessage, onOk) {
    setBusy(true); setError(''); setNotice('');
    try {
      const { data, error: err } = await promise;
      if (err) { setError(friendlyError(err.message)); return false; }
      setModal(null);
      if (okMessage) setNotice(typeof okMessage === 'function' ? okMessage(data) : okMessage);
      if (onOk) onOk(data);
      loadData(true);
      return true;
    } catch (e) {
      setError(friendlyError(e?.message || 'No se pudo completar la operación'));
      return false;
    } finally { setBusy(false); }
  }

  async function saveItem(e) {
    e.preventDefault();
    if (busy) return;
    const another = e.nativeEvent?.submitter?.dataset?.another === '1';
    if (!form.name.trim()) { setError('Nombre obligatorio'); return; }
    if (!form.category) { setError('Elegí la categoría del material'); return; }
    const base = {
      name: form.name.trim(),
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
    setBusy(true); setError(''); setNotice('');
    try {
      // Las fotos se achican y validan ANTES de guardar, así un archivo inválido no deja el material a medias
      const blobs = [];
      for (const f of files) blobs.push(await compressImage(f));
      const req = editingItem
        ? supabase.from('items').update(payload).eq('id', editingItem).select().single()
        : supabase.from('items').insert([payload]).select().single();
      const { data: saved, error: err } = await req;
      if (err) { setError(friendlyError(err.message)); return; }
      let msg = editingItem ? 'Material actualizado' : 'Material creado';
      let warn = '';
      // Fotos quitadas: se borra el archivo del almacenamiento (si no se puede, la foto igual deja de mostrarse)
      if (editingItem) {
        const before = items.find(x => x.id === editingItem)?.photo_urls || [];
        const gone = before.filter(u => !existing.includes(u) && isStorageUrl(u)).map(u => decodeURIComponent(String(u).split('/item-photos/')[1] || '').split('?')[0]).filter(Boolean);
        if (gone.length) { try { await supabase.storage.from('item-photos').remove(gone); } catch { /* sin permiso: se ignora */ } }
      }
      if (blobs.length) {
        const urls = [];
        for (let i = 0; i < blobs.length; i++) {
          const path = `${slug(saved.name)}${saved.brand && saved.brand !== 'Genérico' ? '-' + slug(saved.brand) : ''}-${existing.length + i + 1}-${Date.now().toString(36)}.jpg`;
          const up = await supabase.storage.from('item-photos').upload(path, blobs[i], { upsert: false, contentType: 'image/jpeg' });
          if (up.error) { warn = `El material se guardó pero una foto no se pudo subir: ${friendlyError(up.error.message)}`; break; }
          urls.push(supabase.storage.from('item-photos').getPublicUrl(path).data.publicUrl);
        }
        if (urls.length) {
          const u = await supabase.from('items').update({ photo_urls: [...existing, ...urls] }).eq('id', saved.id);
          if (u.error) warn = u.error.message; else msg += ` con ${urls.length} foto(s) nueva(s)`;
        }
      }
      if (another) {
        // Misma ficha para otra marca: se conserva nombre, tipo, categoría y mínimos; la marca y el stock se vuelven a elegir
        const used = new Set(items.filter(x => x.name.trim().toLowerCase() === saved.name.trim().toLowerCase()).map(x => x.brand || 'Genérico'));
        used.add(saved.brand || 'Genérico');
        const nextBrand = ['Genérico', ...BRANDS].find(b => !used.has(b)) || 'Genérico';
        setForm({ ...emptyItem, name: saved.name, kind: saved.kind, category: saved.category, brand: nextBrand, occasion: saved.occasion || '', reorder_nucleo: saved.reorder_nucleo || 0, lead_time_days: saved.lead_time_days ?? 15, photoFiles: [] });
        setEditingItem(null); setNotice(`${warn ? `${msg}. Atención: ${warn}` : msg}. Elegí la marca y el stock de la siguiente.`); loadData(true);
      } else {
        setModal(null); setNotice(warn ? `${msg}. Atención: ${warn}` : msg); setForm(emptyItem); setEditingItem(null); loadData(true);
      }
    } catch (err) {
      setError(friendlyError(err?.message || 'No se pudo guardar el material'));
    } finally { setBusy(false); }
  }

  function deleteItem(item) {
    setModal({
      type: 'confirm', title: 'Eliminar o archivar material', danger: true, yes: 'Sí, continuar',
      text: `¿Seguro que querés eliminar «${item.name}»${item.brand && item.brand !== 'Genérico' ? ` (${item.brand})` : ''}? Si ya tuvo movimientos no se borra: se archiva (deja de verse pero se conserva todo el historial). Para eso tiene que estar en 0.`,
      onYes: () => run(supabase.rpc('delete_item', { p_item_id: item.id }), (res) => `Material ${res}`)
    });
  }

  function saveRestock(e) {
    e.preventDefault();
    if (busy) return;
    const lines = restock.lines.filter(l => l.item_id);
    if (!lines.length) { setError('Elegí al menos un material'); return; }
    if (lines.some(l => !(Number(l.qty) >= 1))) { setError('Todas las cantidades tienen que ser de 1 o más'); return; }
    if (lines.some(l => l.cost !== '' && l.cost != null && !(Number(l.cost) >= 0))) { setError('El costo no puede ser negativo'); return; }
    run(supabase.rpc('register_restocks', {
      p_lines: lines.map(l => ({ item_id: l.item_id, qty: Number(l.qty), cost: l.cost === '' || l.cost == null ? null : Number(l.cost) })),
      p_source: restock.source, p_notes: restock.notes?.trim() || null
    }), lines.length > 1 ? `Ingreso registrado (${lines.length} materiales)` : 'Ingreso registrado', () => setRestock(emptyRestock()));
  }

  // ----- Conteo físico
  function openCount(destId = '') {
    setError(''); setNotice('');
    setModal({ type: 'count', destination_id: destId, counts: {}, reason: '', q: '', confirmLow: false });
  }
  function saveCount(e) {
    e.preventDefault();
    if (busy) return;
    const m = modal;
    const dest = m.destination_id || '';
    if (!m.reason?.trim()) { setError('Escribí el motivo del conteo'); return; }
    const counted = Object.entries(m.counts || {}).filter(([, v]) => v !== '' && v != null);
    if (counted.some(([, v]) => !/^\d+$/.test(String(v).trim()))) { setError('Las cantidades contadas tienen que ser números enteros (0 o más)'); return; }
    const sys = (id) => (dest ? (destStock.find(r => r.destination_id === dest && r.item_id === id)?.qty || 0) : (itemById[id]?.stock_nucleo || 0));
    const diffs = counted.filter(([id, v]) => Number(v) !== sys(id));
    if (!diffs.length) { setError('No hay diferencias entre lo contado y lo que dice el sistema: no hay nada para registrar.'); return; }
    if (!dest && !m.confirmLow && diffs.some(([id, v]) => Number(v) < (reserved[id] || 0))) { setError(''); setModal(p => ({ ...p, confirmLow: true })); return; }
    run(supabase.rpc('register_stock_count', {
      p_destination_id: dest || null,
      p_lines: counted.map(([id, v]) => ({ item_id: id, counted: Number(v) })),
      p_reason: m.reason.trim()
    }), (r) => `Conteo registrado: ${r?.adjusted ?? diffs.length} ajuste(s)${r?.unchanged ? ` y ${r.unchanged} material(es) sin diferencia` : ''}.${isPunto ? ' Marketing los va a revisar.' : ''}`);
  }

  // ----- Importar materiales desde planilla
  function saveImport(rows) {
    if (busy) return;
    run(supabase.rpc('import_materials', { p_rows: rows }), (r) => {
      const sk = r?.skipped || [];
      return `Importación lista: ${r?.created ?? 0} material(es) nuevo(s) y ${r?.loaded ?? 0} carga(s) de stock.${sk.length ? ` Se omitieron ${sk.length}: ${sk.slice(0, 4).map(x => `${x.name} (${x.reason})`).join('; ')}${sk.length > 4 ? '…' : ''}` : ''}`;
    });
  }

  // ----- Atajos desde las alertas del Dashboard
  function buyFor(a) {
    setError(''); setNotice('');
    setRestock({ lines: [{ item_id: a.item_id, qty: Math.max(1, a.suggested_qty || 1), cost: '' }], source: 'proveedor', notes: '' });
    setModal({ type: 'restock' });
  }
  function sendFor(p) {
    const it = itemById[p.item_id];
    const avail = Math.max(0, (it?.stock_nucleo || 0) - (reserved[p.item_id] || 0));
    setError(''); setNotice('');
    setModal({ type: 'send', origin_id: '', destination_id: p.destination_id, exceptional: false, exception_reason: '', recipient_name: '', notes: '', lines: [{ item_id: p.item_id, qty: Math.max(1, Math.min(p.suggested_qty || 1, avail || 1)) }] });
  }

  function duplicateEvent(ev) {
    const lines = eventItems.filter(ei => ei.event_id === ev.id).map(ei => ({ item_id: ei.item_id, qty: ei.qty_allocated }));
    setError(''); setNotice('');
    setModal({ ...emptyEvent(), event_name: ev.event_name || '', brand: ev.brand || '', carried_by: ev.carried_by || '', notes: ev.notes || '', lines: lines.length ? lines : [{ item_id: '', qty: 1 }], duplicatedFrom: ev.event_name });
  }

  function saveWithdrawal(e) {
    e.preventDefault();
    if (busy) return;
    const w = withdrawal;
    const lines = w.lines.filter(l => l.item_id);
    if (!lines.length) { setError('Elegí al menos un material'); return; }
    if (!w.reason_type) { setError('Elegí el motivo del retiro'); return; }
    if (lines.some(l => !(Number(l.qty) >= 1))) { setError('Todas las cantidades tienen que ser de 1 o más'); return; }
    if (!w.reason_detail.trim()) { setError('Falta la descripción del retiro'); return; }
    run(supabase.rpc('register_withdrawals', {
      p_lines: lines.map(l => ({ item_id: l.item_id, qty: Number(l.qty) })),
      p_reason_type: w.reason_type, p_reason_detail: w.reason_detail.trim(),
      p_recipient_last_name: w.recipient_last_name.trim() || null, p_vehicle_plate: w.vehicle_plate.trim() || null,
      p_notes: w.notes || null
    }), lines.length > 1 ? `Retiro registrado (${lines.length} materiales)` : 'Retiro registrado', () => setWithdrawal(emptyWithdrawal()));
  }

  function openSend(originId = '') {
    setError(''); setNotice('');
    setModal({ type: 'send', origin_id: originId, destination_id: '', exceptional: false, exception_reason: '', recipient_name: '', notes: '', lines: [{ item_id: '', qty: 1 }] });
  }

  function saveShipment(e) {
    e.preventDefault();
    if (busy) return;
    const d = modal;
    const lines = d.lines.filter(l => l.item_id && Number(l.qty) > 0);
    if (!d.destination_id) { setError('Elegí el destino del envío'); return; }
    if (!lines.length) { setError('Agregá al menos un material con su cantidad'); return; }
    if (d.exceptional && !d.exception_reason?.trim()) { setError('Contá el motivo del envío excepcional'); return; }
    const dealer = destinations.find(x => x.id === d.destination_id)?.is_depot === false;
    run(supabase.rpc('create_shipment', {
      p_destination_id: d.destination_id,
      p_items: lines.map(l => ({ item_id: l.item_id, qty: Number(l.qty) })),
      p_recipient_name: d.recipient_name || null, p_notes: d.notes || null,
      p_origin_id: d.origin_id || null,
      p_exception_reason: d.exceptional ? d.exception_reason.trim() : null
    }), dealer ? 'Envío registrado. Quedó como registro de lo enviado al concesionario.' : 'Envío registrado. Queda «en camino» hasta que lo reciban y lo controlen.');
  }

  function ackMovement(m) {
    run(supabase.rpc('ack_movement', { p_movement_id: m.id }), 'Marcado como visto');
  }

  function changeUser(u, patch) {
    if ((patch.role || u.role) === 'punto' && !(('destination_id' in patch) ? patch.destination_id : u.destination_id)) {
      setError('Un usuario con rol «Depósito» necesita un depósito asignado: elegí primero el depósito.'); return;
    }
    run(supabase.from('profiles').update(patch).eq('id', u.id), `Usuario «${u.full_name || u.email}» actualizado`);
  }

  function saveReception(e) {
    e.preventDefault();
    const m = modal;
    if (m.lines.some(l => l.ok === null)) { setError('Marcá ✓ o ✗ en todos los materiales'); return; }
    for (const l of m.lines.filter(x => x.ok === false)) {
      const q = Number(l.qty_received);
      if (!l.reason) { setError(`Elegí el motivo de la diferencia en "${l.name}"`); return; }
      if (l.qty_received === '' || Number.isNaN(q) || q < 0) { setError(`Cargá la cantidad que llegó de "${l.name}"`); return; }
      if (l.reason === 'de_mas' && q <= l.qty) { setError(`Si llegó de más, la cantidad de "${l.name}" tiene que ser mayor a ${l.qty}`); return; }
      if (l.reason !== 'de_mas' && q >= l.qty) { setError(`La cantidad que llegó de "${l.name}" tiene que ser menor a ${l.qty}. Si llegó todo bien, marcá ✓`); return; }
    }
    const bad = m.lines.some(l => l.ok === false);
    run(supabase.rpc('receive_shipment', {
      p_shipment_id: m.shipment.id,
      p_lines: m.lines.map(l => ({ movement_id: l.movement_id, ok: l.ok, qty_received: l.ok ? null : Number(l.qty_received), reason: l.ok ? null : l.reason, note: l.note?.trim() || null })),
      p_notes: m.notes?.trim() || null
    }), bad ? 'Recepción enviada con diferencia. Queda una alerta en rojo para Marketing hasta que se resuelva; lo que llegó bien ya está en tu stock.' : 'Recepción confirmada: el stock ya figura en el depósito');
  }

  function openReception(sh) {
    const parcial = sh.status === 'parcial';
    const lines = (linesByShipment[sh.id] || [])
      .filter(m => !parcial || m.in_transit_qty > 0)
      .map(m => ({ movement_id: m.id, name: `${m.items?.name || ''}${m.items?.brand ? ' · ' + m.items.brand : ''}`, qty: parcial ? m.in_transit_qty : m.qty, ok: null, qty_received: '', reason: '', note: '' }));
    setError(''); setNotice('');
    setModal({ type: 'receive', shipment: sh, lines, notes: '', parcial });
  }

  function openResolve(sh) {
    const lines = (linesByShipment[sh.id] || []).filter(m => m.pending_qty > 0).map(m => ({
      movement_id: m.id, name: `${m.items?.name || ''}${m.items?.brand ? ' · ' + m.items.brand : ''}`, qty: m.qty, diff_reason: m.diff_reason, pending: m.pending_qty,
      rows: [{ action: '', qty: m.pending_qty, note: '' }]
    }));
    setError(''); setNotice('');
    setModal({ type: 'resolve', shipment: sh, lines });
  }

  function saveResolution(e) {
    e.preventDefault();
    const m = modal;
    const out = [];
    for (const l of m.lines) {
      let sum = 0;
      for (const r of l.rows) {
        const q = Number(r.qty) || 0;
        if (!r.action) { setError(`Elegí qué pasó con "${l.name}"`); return; }
        if (q < 1) { setError(`La cantidad de "${l.name}" tiene que ser al menos 1`); return; }
        if (r.action === 'perdida' && !r.note?.trim()) { setError(`Contá el motivo de la pérdida de "${l.name}"`); return; }
        sum += q;
        out.push({ movement_id: l.movement_id, action: r.action, qty: q, note: r.note?.trim() || null });
      }
      if (sum > l.pending) { setError(`Para "${l.name}" solo hay ${l.pending} unidad(es) sin explicar`); return; }
    }
    run(supabase.rpc('resolve_shipment_difference', { p_shipment_id: m.shipment.id, p_resolutions: out }),
      (sh) => (sh?.status === 'con_diferencia' ? 'Resolución guardada. Todavía quedan unidades sin explicar.' : sh?.status === 'parcial' ? 'Resuelto. Lo que sigue en camino quedó pendiente de recepción.' : 'Diferencia resuelta: el envío quedó cerrado.'));
  }

  function savePointWithdrawal(e) {
    e.preventDefault();
    const w = modal;
    if (!w.reason_type) { setError('Elegí el motivo de la entrega'); return; }
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
    if (!modal.notes?.trim()) { setError('Contá el motivo de la carga (no es para envíos de Rosario)'); return; }
    run(supabase.rpc('register_point_stock_in', {
      p_destination_id: modal.destination_id, p_item_id: modal.item_id, p_qty: Number(modal.qty), p_notes: modal.notes || null
    }), 'Carga registrada');
  }

  function saveReturn(e) {
    e.preventDefault();
    const r = modal;
    if (Number(r.qty) < 1 || Number(r.qty) > r.available) { setError(`La cantidad tiene que estar entre 1 y ${r.available}`); return; }
    run(supabase.rpc('register_return', { p_destination_id: r.destination_id, p_item_id: r.item_id, p_qty: Number(r.qty), p_notes: r.notes?.trim() || null }),
      'Devolución registrada: se descontó de ' + r.place + ' y volvió a Depósito Rosario');
  }

  function saveMin(e) {
    e.preventDefault();
    run(supabase.rpc('set_point_min', {
      p_destination_id: modal.destination_id, p_item_id: modal.item_id, p_min: Number(modal.min)
    }), 'Punto de restock actualizado');
  }

  function saveAdjust(e) {
    e.preventDefault();
    if (busy) return;
    if (!modal.reason?.trim()) { setError('El motivo del ajuste es obligatorio'); return; }
    // Dejar el stock por debajo de lo reservado para eventos pide una confirmación explícita
    if (modal.isRosario && modal.reserved > 0 && Number(modal.new_qty) < modal.reserved && !modal.confirmLow) {
      setError(''); setModal(p => ({ ...p, confirmLow: true })); return;
    }
    run(supabase.rpc('adjust_stock', {
      p_item_id: modal.item_id, p_destination_id: modal.destination_id || null,
      p_new_qty: Number(modal.new_qty), p_reason: modal.reason.trim()
    }), 'Ajuste registrado');
  }

  const emptyEvent = () => ({ type: 'event', editing: null, event_name: '', start_date: '', end_date: '', brand: '', carried_by: '', notes: '', lines: [{ item_id: '', qty: 1 }] });
  // Editar un evento abierto: lo ya entregado queda bloqueado (locked) y solo se puede sumar o ajustar lo reservado
  function editEvent(ev) {
    const lines = eventItems.filter(ei => ei.event_id === ev.id).map(ei => ({ item_id: ei.item_id, qty: ei.qty_allocated, locked: Boolean(ei.remito_salida_date) }));
    setError(''); setNotice('');
    setModal({
      type: 'event', editing: ev.id, anyDelivered: lines.some(l => l.locked), event_name: ev.event_name || '',
      start_date: ev.start_date || ev.event_date || '', end_date: ev.end_date || ev.event_date || '', brand: ev.brand || '',
      carried_by: ev.carried_by || '', notes: ev.notes || '', lines: lines.length ? lines : [{ item_id: '', qty: 1 }]
    });
  }

  // Disponible = stock del Depósito Rosario - reservado por otros eventos abiertos que se pisan en fechas
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
    if (busy) return;
    const d = modal;
    const lines = d.lines.filter(l => l.item_id && Number(l.qty) > 0);
    if (!d.event_name.trim() || !d.start_date || !d.end_date || !d.brand) { setError('Completá nombre, fechas y marca del evento'); return; }
    if (d.end_date < d.start_date) { setError('La fecha de fin no puede ser anterior a la de inicio'); return; }
    if (!lines.length) { setError('Agregá al menos un elemento con su cantidad'); return; }
    if (d.editing) {
      run(supabase.rpc('update_event', {
        p_event_id: d.editing, p_event_name: d.event_name.trim(), p_start_date: d.start_date, p_end_date: d.end_date, p_brand: d.brand,
        p_carried_by: d.carried_by?.trim() || null, p_notes: d.notes || null,
        p_items: lines.map(l => ({ item_id: l.item_id, qty: Number(l.qty) }))
      }), 'Evento actualizado');
      return;
    }
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
      'Materiales entregados: ya salieron del Depósito Rosario. Podés imprimir el retiro para firmar.');
  }

  function saveReturnEvent(e) {
    e.preventDefault();
    if (busy) return;
    const m = modal;
    // Una sola operación en el servidor: o se registra todo el regreso o no se registra nada
    run(supabase.rpc('return_event', {
      p_event_id: m.event.id,
      p_returns: m.lines.map(l => ({ event_item_id: l.id, qty_returned: Number(l.qty_returned) })),
      p_signed_by: m.by?.trim() || null
    }), 'Regreso registrado. Lo devuelto volvió al Depósito Rosario.');
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

  const depotIds = useMemo(() => new Set(destinations.filter(d => d.is_depot).map(d => d.id)), [destinations]);
  const inDepots = useMemo(() => {
    const acc = {};
    destStock.filter(r => depotIds.has(r.destination_id)).forEach(r => { acc[r.item_id] = (acc[r.item_id] || 0) + r.qty; });
    return acc;
  }, [destStock, depotIds]);

  const linesByShipment = useMemo(() => {
    const acc = {};
    shipLines.filter(m => m.shipment_id && m.type === 'envio_destino').forEach(m => { (acc[m.shipment_id] = acc[m.shipment_id] || []).push(m); });
    Object.values(acc).forEach(a => a.sort((x, y) => new Date(x.created_at) - new Date(y.created_at)));
    return acc;
  }, [shipLines]);

  const inTransit = useMemo(() => shipments.filter(x => x.status === 'en_transito' || x.status === 'parcial'), [shipments]);
  const diffShipments = useMemo(() => shipments.filter(x => x.status === 'con_diferencia'), [shipments]);

  const centralAlerts = centralStatus;

  // Último envío por destino y material (seguimiento de lo enviado a concesionarios)
  const lastSent = useMemo(() => {
    const o = {};
    shipLines.filter(m => m.type === 'envio_destino').forEach(m => {
      const k = `${m.destino_id}|${m.item_id}`;
      if (!o[k] || new Date(m.created_at) > new Date(o[k].created_at)) o[k] = m;
    });
    return o;
  }, [shipLines]);
  // Solo los depósitos (no los concesionarios) generan avisos de reposición en la plataforma
  const pointAlerts = useMemo(() => pointStatus.filter(p => p.status !== 'ok' && depotIds.has(p.destination_id)), [pointStatus, depotIds]);

  const filteredItems = useMemo(() => {
    const tokens = norm(query.trim()).split(/\s+/).filter(Boolean);
    return items.filter(item => {
      const hay = norm(`${item.name} ${item.sku || ''} ${item.brand || ''}`);
      return tokens.every(t => hay.includes(t))
        && (categoryFilter === 'Todas' || item.category === categoryFilter)
        && (brandFilter === 'Todas' || item.brand === brandFilter)
        && (!photoFilter || (item.photo_urls || []).some(u => !isStorageUrl(u)));
    });
  }, [items, query, categoryFilter, brandFilter, photoFilter]);

  const history = useMemo(() => {
    const rows = [];
    restocks.forEach(r => rows.push({ id: 'r' + r.id, at: r.created_at, tipo: 'Ingreso a ' + ROSARIO, item_id: r.item_id, item: r.items?.name, brand: '', place: ROSARIO, qty: r.qty, detalle: [SOURCE_LABELS[r.source] || r.source, r.cost ? fmtMoney(r.cost) : null, r.notes].filter(Boolean).join(' · '), quien: r.person }));
    withdrawals.forEach(w => rows.push({ id: 'w' + w.id, at: w.created_at, tipo: MOVE_LABELS.retiro, item_id: w.item_id, item: w.items?.name, brand: '', place: ROSARIO, qty: w.qty, detalle: [reasonLabel(w.reason_type), w.reason_detail, w.recipient_last_name, w.vehicle_plate].filter(Boolean).join(' · '), quien: w.person }));
    movements.forEach(m => {
      const base = { brand: m.items?.brand || '', place: m.origen || '', placeId: m.origen_id || m.destino_id || null, destId: m.destino_id || null, originId: m.origen_id || null, destName: m.destination || destById[m.destino_id]?.name || '' };
      if (m.type === 'stock_inicial' || m.type === 'compra') {
        rows.push({ id: 'm' + m.id, at: m.created_at, tipo: MOVE_LABELS[m.type], item_id: m.item_id, item: m.items?.name, qty: m.qty, detalle: m.notes || '', quien: m.person, ...base, place: ROSARIO });
        return;
      }
      let detalle = '';
      if (m.type === 'envio_destino') detalle = `${m.origen && m.origen !== 'Depósito Rosario' && m.origen !== 'Depo Central' ? m.origen + ' ' : ''}→ ${m.destination || destById[m.destino_id]?.name || ''} · ${STATE_LABELS[m.estado] || m.estado}${m.recipient_name ? ' · recibe ' + m.recipient_name : ''}${m.received_by_name ? ' · recibió ' + m.received_by_name : ''}${m.reception_ok === false ? ' · ✗ ' + (DIFF_LABEL[m.diff_reason] || 'diferencia') + (m.diff_reason === 'de_mas' ? '' : ' · llegó ' + (m.qty_received ?? 0)) + (m.reception_note ? ' (' + m.reception_note + ')' : '') : ''}`;
      else if (m.type === 'resolucion_diferencia') detalle = `→ ${m.destination || ''} · ${RES_LABEL[m.reason_type] || m.reason_type}${m.reason_detail ? ' · ' + m.reason_detail : ''}`;
      else if (m.type === 'entrega') detalle = [m.origen, m.reason_detail, m.recipient_last_name, m.vehicle_plate].filter(Boolean).join(' · ');
      else if (m.type === 'ingreso_punto') detalle = [m.destination, m.notes].filter(Boolean).join(' · ');
      else if (m.type === 'ajuste') detalle = [m.origen, m.qty_after != null ? `de ${m.qty_before} a ${m.qty_after}` : m.notes, m.reason_detail].filter(Boolean).join(' · ');
      else if (m.type === 'devolucion') detalle = `${m.origen} → ${m.destination || 'Depósito Rosario'}${m.notes ? ' · ' + m.notes : ''}`;
      else if (m.type === 'salida_evento' || m.type === 'retorno_evento' || m.type === 'consumo_evento') detalle = m.notes || '';
      else detalle = m.notes || '';
      const signed = m.type === 'ajuste' && m.qty_after != null ? `${m.qty_after - m.qty_before > 0 ? '+' : '−'}${m.qty}` : m.qty;
      const review = m.type === 'ajuste' && (m.needs_review ? 'pendiente' : (m.reviewed_by_name ? `visto por ${m.reviewed_by_name}` : ''));
      const exceptional = m.type === 'envio_destino' && /Envío excepcional/i.test(m.notes || '');
      rows.push({ id: 'm' + m.id, at: m.created_at, tipo: MOVE_LABELS[m.type] || 'Otro movimiento', item_id: m.item_id, item: m.items?.name, qty: signed, detalle, quien: m.person, ...base, review: review || '', exceptional });
    });
    return rows.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 1000);
  }, [restocks, withdrawals, movements, destById]);

  // ---------- Render ----------
  if (!session) return <Login onSubmit={handleSignIn} onForgot={handleForgot} error={error} message={authMsg} />;
  if (recovery) return <SetPassword onSubmit={handleNewPassword} error={error} busy={busy} />;
  if (profile === undefined) return <div className="login-screen"><div className="skeleton-wrap" aria-busy="true" style={{ width: 'min(420px, 90vw)' }}><div className="skeleton sk-row" /><div className="skeleton sk-block" /></div></div>;
  if (!profile || role === 'none') return <NoAccess onSignOut={() => supabase.auth.signOut()} />;
  if (isPunto && !profile.destination_id) return <NoAccess onSignOut={() => supabase.auth.signOut()} message="Tu usuario todavía no tiene un depósito asignado. Pedile a un administrador que lo configure." />;

  // Menú ordenado por tarea: primero lo que se hace (Operar) y después lo que se consulta
  const nav = isPunto
    ? [['mideposito', 'Mi depósito'], ['recepcion', 'Por recibir', inTransit.length, false], ['historial', 'Historial']]
    : [
        ['dashboard', 'Dashboard'],
        ['__sec', 'Operar'],
        ['ingresos', 'Ingresos'], ['retiros', 'Retiros'],
        ['movimientos', 'Envíos', inTransit.length + diffShipments.length, diffShipments.length > 0],
        ['eventos', 'Eventos'],
        ['__sec', 'Consultar'],
        ['stock', 'Materiales'], ['depositos', 'Depósitos y puntos'], ['historial', 'Historial'],
        ...(role === 'admin' ? [['__sec', 'Administrar'], ['usuarios', 'Usuarios']] : [])
      ];
  // «En camino» ya no es una pantalla aparte: es el filtro «Pendientes de recibir» de Envíos
  const goTab = (k) => {
    if (k === 'recepcion' && !isPunto) { setShipFilter('pendientes'); setTab('movimientos'); } else setTab(k);
    setError(''); setNotice('');
  };

  const titles = { dashboard: 'Dashboard', stock: 'Materiales', depositos: 'Depósitos y puntos', mideposito: 'Mi depósito', recepcion: 'Por recibir', ingresos: 'Ingresos', retiros: 'Retiros', movimientos: 'Envíos', eventos: 'Eventos', historial: 'Historial', usuarios: 'Usuarios' };
  const helps = {
    dashboard: 'Resumen de lo que necesita atención hoy: diferencias de recepción, ajustes para revisar, envíos demorados y eventos.',
    stock: 'Catálogo de materiales con su stock en el Depósito Rosario. Buscá o elegí una categoría para ver la lista. Con «Ajustar stock» corregís cantidades dejando motivo.',
    depositos: 'Stock de cada depósito y concesionario. Santa Fe y Cañada controlan lo que reciben; en los demás concesionarios solo queda el registro de lo enviado.',
    mideposito: 'El stock de tu depósito. Sube cuando confirmás la recepción de un envío y baja con cada entrega.',
    recepcion: isPunto ? 'Envíos que salieron hacia tu depósito. Tocá Recibir y marcá ✓ si llegó todo bien o ✗ si hay una diferencia (elegís el motivo y la cantidad). Lo que llegó bien se suma a tu stock al instante.' : 'Envíos que salieron de un depósito y todavía no fueron recibidos. Si el destino reporta una diferencia, queda en rojo hasta que la resuelvas.',
    ingresos: 'Mercadería que entra al Depósito Rosario por compras a proveedores u otras fuentes. Suma al stock. Las devoluciones desde depósitos se registran con «Devolver a Rosario».',
    retiros: 'Salidas del Depósito Rosario por regalos, usos internos o incidencias. Descuenta del stock. Podés retirar varios materiales juntos.',
    movimientos: 'Todos los envíos a depósitos y concesionarios. Con «Pendientes de recibir» ves los que todavía están en camino o tienen una diferencia por resolver. Para mandar materiales usá «Nuevo envío».',
    eventos: 'Cada evento reserva materiales para sus fechas. El stock recién sale al tocar «Entregar materiales» y vuelve al registrar el regreso.',
    historial: 'Registro de todo lo que entró, salió o se movió, con fecha y responsable. Filtrá por depósito, fechas o marca y exportalo a Excel.',
    usuarios: 'Quién puede entrar a la plataforma y con qué permisos.'
  };
  const myDest = destById[selectedDest];
  const roleLabel = isOwner ? 'Dueño' : { admin: 'Administrador', editor: 'Editor', punto: 'Depósito', viewer: 'Solo lectura' }[role];
  const myOwnDest = destById[profile.destination_id];
  const defaultOrigin = myOwnDest?.supplies_dealers ? myOwnDest.id : '';

  return (
    <UiCtx.Provider value={{ busy, error: modal ? error : '' }}>
    <div className={`app-shell ${rail ? 'nav-rail' : 'nav-wide'}${narrow ? ' nav-narrow' : ''}`}>
      {narrow && navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
      <aside className="sidebar" aria-label="Menú principal">
        <div className="brand-row">
          <div className="brand"><img src="/logo.webp" alt="" width="40" height="40" /><div>MARKETING<span>Control de stock</span></div></div>
          <button type="button" className="side-toggle" onClick={toggleNav} title={narrow ? (navOpen ? 'Cerrar menú' : 'Abrir menú') : (rail ? 'Expandir menú' : 'Contraer menú')} aria-label="Mostrar u ocultar el menú">
            <NavIcon name={narrow ? (navOpen ? 'close' : 'menu') : (rail ? 'open' : 'close')} />
          </button>
        </div>
        {nav.map(([key, label, badge, bad], idx) => key === '__sec' ? (
          <div key={`sec-${idx}`} className="nav-section" role="presentation"><span>{label}</span></div>
        ) : (
          <button key={key} className={tab === key ? 'nav-btn active' : 'nav-btn'} title={label} aria-label={label}
            onClick={() => { setTab(key); setError(''); setNotice(''); if (key === 'movimientos') setShipFilter('todos'); if (narrow) setNavOpen(false); }}>
            <NavIcon name={key} /><span className="nav-label">{label}</span>
            {badge > 0 && <span className={`nav-badge${bad ? ' bad' : ''}`}>{badge}</span>}
          </button>
        ))}
        <div className="sidebar-footer">
          <div className="avatar" title={profile.full_name || session.user.email}>{(profile.full_name || session.user.email || '?').trim().charAt(0).toUpperCase()}</div>
          <div className="whoami"><strong>{profile.full_name || session.user.email}</strong><small>{roleLabel}{isPunto && myDest ? ` · ${myDest.name}` : ''}</small></div>
          <button className="logout-btn" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={() => supabase.auth.signOut()}><NavIcon name="logout" /><span className="nav-label">Cerrar sesión</span></button>
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
            {isStaff && (
              <RowMenu label="+ Nuevo ▾" btnClass="primary-btn new-menu-btn" ariaLabel="Registrar un movimiento nuevo" align="right">
                <button type="button" role="menuitem" onClick={() => { setError(''); setNotice(''); setRestock(emptyRestock()); setModal({ type: 'restock' }); }}>Ingreso de mercadería</button>
                <button type="button" role="menuitem" onClick={() => { setError(''); setNotice(''); setWithdrawal(emptyWithdrawal()); setModal({ type: 'withdrawal' }); }}>Retiro</button>
                <button type="button" role="menuitem" onClick={() => openSend(defaultOrigin)}>Envío</button>
                <button type="button" role="menuitem" onClick={() => { setError(''); setNotice(''); setModal(emptyEvent()); }}>Evento</button>
                <button type="button" role="menuitem" onClick={() => { setEditingItem(null); setForm(emptyItem); setError(''); setNotice(''); setModal({ type: 'item' }); }}>Material nuevo</button>
                <button type="button" role="menuitem" onClick={() => openCount('')}>Conteo físico</button>
                <button type="button" role="menuitem" onClick={() => { setError(''); setNotice(''); setModal({ type: 'import' }); }}>Importar planilla</button>
              </RowMenu>
            )}
            {isStaff && tab === 'stock' && <button className="primary-btn" onClick={() => { setEditingItem(null); setForm(emptyItem); setModal({ type: 'item' }); }}>+ Nuevo material</button>}
            {isStaff && tab === 'ingresos' && <button className="primary-btn" onClick={() => { setError(''); setNotice(''); setRestock(emptyRestock()); setModal({ type: 'restock' }); }}>+ Registrar ingreso</button>}
            {isStaff && tab === 'retiros' && <button className="primary-btn" onClick={() => { setError(''); setNotice(''); setWithdrawal(emptyWithdrawal()); setModal({ type: 'withdrawal' }); }}>+ Registrar retiro</button>}
            {isStaff && tab === 'movimientos' && <button className="primary-btn" onClick={() => openSend(defaultOrigin)}>+ Nuevo envío</button>}
            {isStaff && tab === 'eventos' && <button className="primary-btn" onClick={() => { setError(''); setNotice(''); setModal(emptyEvent()); }}>+ Nuevo evento</button>}
          </div>
        </header>

        {error && !modal && <div className="error-banner" role="alert">{error}</div>}
        {notice && <div className="notice-banner" role="status">{notice}</div>}

        {loading ? <div className="skeleton-wrap" aria-busy="true"><div className="skeleton sk-row" /><div className="skeleton sk-row" /><div className="skeleton sk-block" /></div> :
          tab === 'dashboard' ? <Dashboard eventItems={eventItems} items={items} centralAlerts={centralAlerts} pointAlerts={pointAlerts} inTransit={inTransit} diffs={diffShipments} linesByShipment={linesByShipment} canResolve={isStaff} onResolve={openResolve} events={events} history={history} reviewAdj={reviewAdj} onAck={ackMovement} busy={busy} onGo={goTab}
            canOperate={isStaff} availOf={(id) => Math.max(0, (itemById[id]?.stock_nucleo || 0) - (reserved[id] || 0))} onBuy={buyFor} onSendFor={sendFor}
            onSetMin={(p) => setModal({ type: 'pmin', destination_id: p.destination_id, item_id: p.item_id, name: p.item_name, min: p.min_qty })} /> :
          tab === 'stock' ? <StockTable items={filteredItems} totalItems={items.length} categories={categories} inDepots={inDepots} reserved={reserved} isStaff={isStaff} query={query} setQuery={setQuery} categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} brandFilter={brandFilter} setBrandFilter={setBrandFilter} photoFilter={photoFilter} setPhotoFilter={setPhotoFilter} allItems={items}
              onOpen={(item) => setModal({ type: 'sheet', item_id: item.id })} onCount={() => openCount('')} onImport={() => { setError(''); setNotice(''); setModal({ type: 'import' }); }}
              onEdit={(item) => { setEditingItem(item.id); setForm({ ...emptyItem, ...item, brand: item.brand || 'Genérico', occasion: item.occasion || '', photoFiles: [] }); setError(''); setNotice(''); setModal({ type: 'item' }); }}
              onAdjust={(item) => { setError(''); setNotice(''); setModal({ type: 'adjust', item_id: item.id, name: item.name, destination_id: null, current: item.stock_nucleo, new_qty: item.stock_nucleo, reserved: reserved[item.id] || 0, reason: '', place: ROSARIO, isRosario: true }); }}
              onDelete={deleteItem} onPhotos={(item) => setModal({ type: 'photos', item })} /> :
          tab === 'usuarios' ? <UsersTab users={users} destinations={destinations} isOwner={isOwner} meId={profile.id} busy={busy} onChange={changeUser} /> :
          tab === 'depositos' && !isPunto && depView === 'general' ? (
            <OverviewView destinations={destinations} destStock={destStock} items={items} pointStatus={pointStatus} shipments={shipments}
              onOpen={(id) => { chooseDest(id); setDepView('uno'); }}
              toggle={<SegControl value={depView} onChange={setDepView} options={[['uno', 'Un depósito'], ['general', 'Vista general']]} />} />
          ) :
          tab === 'depositos' || tab === 'mideposito' ? (
            <DepositoView
              viewToggle={!isPunto ? <SegControl value={depView} onChange={setDepView} options={[['uno', 'Un depósito'], ['general', 'Vista general']]} /> : null}
              onCount={() => openCount(selectedDest)}
              sentList={shipments.filter(x => x.destination_id === selectedDest)} madeList={shipments.filter(x => x.origin_id === selectedDest)} linesByShipment={linesByShipment} lastSent={lastSent} isDepot={Boolean(destById[selectedDest]?.is_depot)} isPunto={isPunto} canOperate={isStaff || isPunto} destinations={destinations} selectedDest={selectedDest} setSelectedDest={chooseDest}
              onSend={() => openSend(selectedDest)}
              rows={destStock.filter(r => r.destination_id === selectedDest)} status={pointStatus.filter(p => p.destination_id === selectedDest)}
              itemById={itemById} inTransit={inTransit.filter(m => m.destination_id === selectedDest)} onGoReceive={() => goTab('recepcion')}
              onReturn={(r) => setModal({ type: 'return', destination_id: selectedDest, item_id: r.item_id, name: itemById[r.item_id]?.name, available: r.qty, qty: 1, notes: '', place: destById[selectedDest]?.name })}
              onDeliver={(r) => setModal({ type: 'pwithdraw', destination_id: selectedDest, item_id: r.item_id, name: itemById[r.item_id]?.name, available: r.qty, qty: 1, reason_type: '', reason_detail: '', recipient_last_name: '', vehicle_plate: '', notes: '' })}
              onStockIn={() => setModal({ type: 'pstockin', destination_id: selectedDest, item_id: '', qty: 1, notes: '' })}
              onMin={(r) => setModal({ type: 'pmin', destination_id: selectedDest, item_id: r.item_id, name: itemById[r.item_id]?.name, min: r.min_qty })}
              onAdjust={(r) => setModal({ type: 'adjust', item_id: r.item_id, name: itemById[r.item_id]?.name, destination_id: selectedDest, current: r.qty, new_qty: r.qty, reason: '', place: destById[selectedDest]?.name })} />
          ) :
          tab === 'recepcion' ? <ReceptionTable rows={inTransit} diffRows={isPunto ? diffShipments.filter(x => x.destination_id === profile.destination_id) : diffShipments} lines={linesByShipment} canReceive={isStaff || isPunto} canResolve={isStaff} onReceive={openReception} onResolve={openResolve} /> :
          tab === 'ingresos' ? <RestockTable rows={restocks} /> :
          tab === 'retiros' ? <WithdrawalTable rows={withdrawals} /> :
          tab === 'movimientos' ? (
            <>
              <section className="card" style={{ marginBottom: 18 }}>
                <SegControl value={shipFilter} onChange={setShipFilter} options={[['todos', `Todos (${shipments.length})`], ['pendientes', `Pendientes de recibir (${inTransit.length + diffShipments.length})`]]} />
              </section>
              {shipFilter === 'pendientes'
                ? <ReceptionTable rows={inTransit} diffRows={diffShipments} lines={linesByShipment} canReceive={isStaff} canResolve={isStaff} onReceive={openReception} onResolve={openResolve} />
                : <MovementTable rows={shipments} lines={linesByShipment} canResolve={isStaff} onResolve={openResolve} destById={destById} />}
            </>
          ) :
          tab === 'eventos' ? <EventsTable events={events} eventItems={eventItems} itemById={itemById} isStaff={isStaff} onNew={() => { setError(''); setNotice(''); setModal(emptyEvent()); }} onPrint={(ev) => setModal({ type: 'retiro', event: ev })} onWithdraw={(ev) => setModal({ type: 'withdrawEvent', event: ev, by: ev.carried_by || '' })} onReturn={(ev) => setModal({ type: 'returnEvent', event: ev, by: '', lines: eventItems.filter(ei => ei.event_id === ev.id && ei.remito_salida_date && !ei.remito_llegada_ok).map(ei => ({ id: ei.id, name: ei.items?.name, qty: ei.qty_allocated, qty_returned: ei.qty_allocated })) })} onCancel={cancelEvent} onEdit={editEvent} onDuplicate={duplicateEvent} /> :
          tab === 'historial' ? <HistoryTab rows={history} destinations={destinations} loaded={{ mov: movements.length, ret: withdrawals.length, ing: restocks.length }} canAck={isStaff} /> : null
        }
      </main>

      {modal?.type === 'confirm' && <ConfirmModal modal={modal} onClose={() => setModal(null)} />}
      {modal?.type === 'photos' && <PhotoViewer item={modal.item} onClose={() => setModal(null)} />}
      {modal?.type === 'item' && <ItemModal categories={categories} form={form} setForm={setForm} editing={Boolean(editingItem)} onClose={() => setModal(null)} onSubmit={saveItem} />}
      {modal?.type === 'count' && <CountModal modal={modal} setModal={setModal} items={items} destStock={destStock} destinations={destinations} reserved={reserved} canPick={!isPunto} onClose={() => setModal(null)} onSubmit={saveCount} />}
      {modal?.type === 'import' && <ImportModal categories={categories} destinations={destinations} items={items} onClose={() => setModal(null)} onSubmit={saveImport} />}
      {modal?.type === 'sheet' && itemById[modal.item_id] && (
        <ItemSheet item={itemById[modal.item_id]} reserved={reserved} destStock={destStock} destinations={destinations} isStaff={isStaff}
          openEvents={eventItems.filter(ei => ei.item_id === modal.item_id && !ei.remito_salida_date).map(ei => ({ ...ei, ev: events.find(v => v.id === ei.event_id) })).filter(x => x.ev && x.ev.status === 'abierto')}
          history={history.filter(h => h.item_id === modal.item_id).slice(0, 8)}
          onClose={() => setModal(null)}
          onPhotos={(item) => setModal({ type: 'photos', item })}
          onEdit={(item) => { setEditingItem(item.id); setForm({ ...emptyItem, ...item, brand: item.brand || 'Genérico', occasion: item.occasion || '', photoFiles: [] }); setError(''); setNotice(''); setModal({ type: 'item' }); }}
          onAdjust={(item) => { setError(''); setNotice(''); setModal({ type: 'adjust', item_id: item.id, name: item.name, destination_id: null, current: item.stock_nucleo, new_qty: item.stock_nucleo, reserved: reserved[item.id] || 0, reason: '', place: ROSARIO, isRosario: true }); }}
          onDelete={deleteItem} />
      )}
      {modal?.type === 'restock' && <RestockModal restock={restock} setRestock={setRestock} items={items} onClose={() => setModal(null)} onSubmit={saveRestock} />}
      {modal?.type === 'withdrawal' && <WithdrawalModal withdrawal={withdrawal} setWithdrawal={setWithdrawal} items={items} reserved={reserved} onClose={() => setModal(null)} onSubmit={saveWithdrawal} />}
      {modal?.type === 'send' && <SendModal modal={modal} setModal={setModal} items={items} destinations={destinations} destStock={destStock} reserved={reserved} isStaff={isStaff} ownDestId={profile.destination_id} onClose={() => setModal(null)} onSubmit={saveShipment} />}
      {modal?.type === 'event' && <EventModal modal={modal} setModal={setModal} items={items} availableOf={availableOf} onClose={() => setModal(null)} onSubmit={saveEvent} />}
      {modal?.type === 'withdrawEvent' && <WithdrawEventModal modal={modal} setModal={setModal} onClose={() => setModal(null)} onSubmit={saveWithdrawEvent} />}
      {modal?.type === 'returnEvent' && <ReturnEventModal modal={modal} setModal={setModal} onClose={() => setModal(null)} onSubmit={saveReturnEvent} />}
      {modal?.type === 'retiro' && <RetiroView event={modal.event} lines={eventItems.filter(ei => ei.event_id === modal.event.id)} itemById={itemById} onClose={() => setModal(null)} />}
      {modal?.type === 'receive' && <ReceiveModal modal={modal} setModal={setModal} onClose={() => setModal(null)} onSubmit={saveReception} />}
      {modal?.type === 'resolve' && <ResolveModal modal={modal} setModal={setModal} onClose={() => setModal(null)} onSubmit={saveResolution} />}
      {modal?.type === 'pwithdraw' && <PointWithdrawModal modal={modal} setModal={setModal} onClose={() => setModal(null)} onSubmit={savePointWithdrawal} />}
      {modal?.type === 'return' && (
        <Modal title="Devolver a Depósito Rosario" onClose={() => setModal(null)} onSubmit={saveReturn} submitLabel="Registrar devolución">
          <p><strong>{modal.name}</strong> · en {modal.place}: {modal.available}</p>
          <div className="form-grid">
            <label>Cantidad que vuelve *<input type="number" min="1" max={modal.available} required value={modal.qty} onChange={e => setModal(p => ({ ...p, qty: e.target.value }))} /></label>
            <label>Nota (opcional)<input value={modal.notes} onChange={e => setModal(p => ({ ...p, notes: e.target.value }))} placeholder="Ej: sobrante de campaña" /></label>
          </div>
          <p className="muted small">Se descuenta de {modal.place} y se suma al stock de Depósito Rosario. Registralo cuando la mercadería ya llegó a Rosario.</p>
        </Modal>
      )}
      {modal?.type === 'pstockin' && <PointStockInModal modal={modal} setModal={setModal} items={items} qtyOf={(id) => (destStock.find(r => r.destination_id === modal.destination_id && r.item_id === id)?.qty || 0)} onClose={() => setModal(null)} onSubmit={savePointStockIn} />}
      {modal?.type === 'pmin' && <PointMinModal modal={modal} setModal={setModal} onClose={() => setModal(null)} onSubmit={saveMin} />}
      {modal?.type === 'adjust' && <AdjustModal willReview={!isStaff} modal={modal} setModal={setModal} onClose={() => setModal(null)} onSubmit={saveAdjust} />}
    </div>
    </UiCtx.Provider>
  );
}

/* ---------------- Pantallas ---------------- */

function Login({ onSubmit, onForgot, error, message }) {
  const [email, setEmail] = useState('');
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
        <input type="email" name="email" placeholder="Email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
        <input type="password" name="password" placeholder="Contraseña" autoComplete="current-password" required />
        <button className="primary-btn" type="submit">Ingresar</button>
        <button type="button" className="link-btn forgot-link" onClick={() => onForgot(email)}>Olvidé mi contraseña</button>
        {message && <p className="notice-banner" role="status">{message}</p>}
        {error && <p className="error-banner" role="alert">{error}</p>}
      </form>
    </div>
  );
}

function SetPassword({ onSubmit, error, busy }) {
  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand dark-brand">MARKETING<span>Control de stock</span></div>
        <h2>Elegí tu contraseña nueva</h2>
        <p className="muted small">Usá al menos 10 caracteres. Mejor si mezclás letras, números y símbolos.</p>
        <input type="password" name="password" placeholder="Contraseña nueva" autoComplete="new-password" minLength={10} required />
        <input type="password" name="password2" placeholder="Repetí la contraseña" autoComplete="new-password" minLength={10} required />
        <button className="primary-btn" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button>
        {error && <p className="error-banner" role="alert">{error}</p>}
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

function Dashboard({ eventItems, items, centralAlerts, pointAlerts, inTransit, diffs, linesByShipment, canResolve, onResolve, events, history, reviewAdj, onAck, busy, onGo, canOperate, availOf, onBuy, onSendFor, onSetMin }) {
  const urgent = inTransit.filter(m => daysSince(m.created_at) > 5);
  const t = todayStr();
  const soon = addDays(t, 3);
  const evTodo = events.map(e => ({ e, st: eventState(e, eventItems.filter(l => l.event_id === e.id)) }))
    .filter(({ e, st }) => st && (st.alert || (st.cls === 'reservado' && (e.start_date || e.event_date) <= soon)))
    .map(({ e, st }) => (st.alert ? { e, st } : { e, st: { ...st, text: `Entrega en los próximos 3 días · ${st.text.replace('Reservado · ', '')}` } }));
  const adjs = reviewAdj || [];
  const nothing = !diffs.length && !adjs.length && !urgent.length && !evTodo.length;
  const nAlerts = centralAlerts.length + pointAlerts.length;
  return (
    <>
      {diffs.length > 0 && (
        <section className="card diff-card" role="alert">
          <h2>⚠ Envíos con diferencia – pendientes de resolver ({diffs.length})</h2>
          <p className="muted small">No se cierran solos: hay que explicar cada unidad de diferencia (próximo envío, error de carga, pérdida, error de conteo o sobrante).</p>
          {diffs.map(sh => (
            <div key={sh.id} className="review-item">
              <div className="review-head"><strong>{sh.destination_name}</strong><small>recibió {sh.received_by_name} · {fmtDateTime(sh.received_at)}</small></div>
              <ShipmentLines lines={linesByShipment[sh.id] || []} onlyProblems />
              {sh.reception_notes && <p className="obs-text">“{sh.reception_notes}”</p>}
              {canResolve && <button className="primary-btn small-btn" onClick={() => onResolve(sh)}>Resolver diferencia</button>}
            </div>
          ))}
        </section>
      )}

      <section className="stats-grid">
        <Stat label="Materiales" value={items.length} onClick={() => onGo('stock')} />
        <Stat label="Alertas de stock" value={nAlerts} tone={nAlerts > 0 ? 'warning' : ''} onClick={() => onGo('depositos')} />
        <Stat label={urgent.length ? `Envíos en camino (${urgent.length} hace +5 días)` : 'Envíos en camino'} value={inTransit.length} tone={urgent.length ? 'warning' : ''} onClick={() => onGo('recepcion')} />
        <Stat label="Eventos abiertos" value={events.filter(e => e.status === 'abierto').length} onClick={() => onGo('eventos')} />
      </section>

      <section className="card review-card">
        <h2>Para revisar{!nothing ? ` (${adjs.length + urgent.length + evTodo.length})` : ''}</h2>
        {nothing && <p className="muted">Todo al día: no hay ajustes, envíos demorados ni eventos que necesiten acción.</p>}
        {adjs.length > 0 && (
          <>
            <h3 className="sub">Ajustes de stock hechos por depósitos</h3>
            {adjs.map(m => (
              <div key={m.id} className="review-item">
                <div className="review-head"><strong>{m.items?.name}</strong><small>{m.origen} · {fmtDateTime(m.created_at)} · {m.person}</small></div>
                <p className="obs-text">{m.qty_after != null ? `De ${m.qty_before} a ${m.qty_after}` : m.notes}{m.reason_detail ? ` · «${m.reason_detail}»` : ''}</p>
                {canResolve && <button className="secondary-btn small-btn" disabled={busy} onClick={() => onAck(m)}>Visto</button>}
              </div>
            ))}
          </>
        )}
        {urgent.length > 0 && (
          <>
            <h3 className="sub">Envíos en camino hace más de 5 días</h3>
            {urgent.map(sh => (
              <div key={sh.id} className="review-item">
                <div className="review-head"><strong>{sh.destination_name}</strong><small>salió {fmtDate(sh.created_at)} · hace {daysSince(sh.created_at)} días{sh.origin_name ? ` · desde ${sh.origin_name}` : ''}</small></div>
                <button className="secondary-btn small-btn" onClick={() => onGo('recepcion')}>Ver en camino</button>
              </div>
            ))}
          </>
        )}
        {evTodo.length > 0 && (
          <>
            <h3 className="sub">Eventos</h3>
            {evTodo.map(({ e, st }) => (
              <div key={e.id} className="review-item">
                <div className="review-head"><strong>{e.event_name}</strong><small>{fmtRange(e)}</small></div>
                <span className={`evt-state ${st.cls}`}>{st.text}</span>
                <button className="secondary-btn small-btn" onClick={() => onGo('eventos')}>Ir a Eventos</button>
              </div>
            ))}
          </>
        )}
      </section>

      <div className="two-col">
        <section className="card">
          <h2>Alertas</h2>
          {nAlerts === 0 && <p className="muted">Sin alertas</p>}
          {centralAlerts.length > 0 && (
            <>
              <h3 className="sub">Recomprar al proveedor (Depósito Rosario)</h3>
              <p className="muted small">El punto de recompra es el mínimo cargado o, si es mayor, el que sale del consumo de los últimos 90 días.</p>
              <table><thead><tr><th>Material</th><th>Stock</th><th>Recomprar a las</th><th>Sugerido</th>{canOperate && <th></th>}</tr></thead>
                <tbody>{centralAlerts.slice(0, 8).map(a => (
                  <tr key={a.item_id}>
                    <td>{a.item_name}{a.brand && a.brand !== 'Genérico' ? <small>{a.brand}</small> : null}</td>
                    <td className="warn">{a.qty}</td><td>{a.restock_point > 0 ? a.restock_point : '—'}</td>
                    <td>{a.suggested_qty > 0 ? `+${a.suggested_qty}` : '—'}</td>
                    {canOperate && <td><button type="button" className="secondary-btn small-btn" onClick={() => onBuy(a)}>Registrar compra</button></td>}
                  </tr>))}</tbody></table>
              {centralAlerts.length > 8 && <p className="muted small">y {centralAlerts.length - 8} más: están en Materiales.</p>}
            </>
          )}
          {pointAlerts.length > 0 && (
            <>
              <h3 className="sub">Reponer en depósitos y puntos</h3>
              <p className="muted small">Si el material no tiene mínimo cargado, se usa lo que se entregó en los últimos 90 días; si tampoco hay consumo, definí el mínimo a mano.</p>
              <table><thead><tr><th>Depósito</th><th>Material</th><th>Stock</th><th>Reponer</th>{canOperate && <th></th>}</tr></thead>
                <tbody>{pointAlerts.slice(0, 8).map(p => {
                  const av = availOf(p.item_id);
                  return (
                    <tr key={p.destination_id + p.item_id}><td>{p.destination_name}</td><td>{p.item_name}</td><td className="warn">{p.qty}</td>
                      <td>{p.suggested_qty > 0 ? `+${p.suggested_qty}` : 'Sin dato'}</td>
                      {canOperate && <td>
                        {p.suggested_qty > 0
                          ? <button type="button" className="secondary-btn small-btn" disabled={av < 1} title={av < 1 ? 'No hay stock disponible en Rosario' : ''} onClick={() => onSendFor(p)}>Enviar desde Rosario</button>
                          : <button type="button" className="secondary-btn small-btn" onClick={() => onSetMin(p)}>Fijar mínimo</button>}
                      </td>}
                    </tr>);
                })}</tbody></table>
              {pointAlerts.length > 8 && <p className="muted small">y {pointAlerts.length - 8} más: están en Depósitos y puntos.</p>}
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
  const inner = <><strong><CountUp value={value} /></strong><span>{label}</span></>;
  return onClick
    ? <button type="button" className={`stat clickable ${tone || ''}`} onClick={onClick}>{inner}</button>
    : <div className={`stat ${tone || ''}`}>{inner}</div>;
}
function RowMenu({ children, label = '⋯', btnClass = 'menu-btn', ariaLabel = 'Más acciones', align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="row-menu" ref={ref}>
      <button type="button" className={btnClass} aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen(o => !o)}>{label}</button>
      {open && <div className={`menu-list${align === 'left' ? ' menu-left' : ''}`} role="menu" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

function StockTable({ items: filtered, allItems, categories, inDepots, reserved, isStaff, query, setQuery, categoryFilter, setCategoryFilter, brandFilter, setBrandFilter, photoFilter, setPhotoFilter, onOpen, onEdit, onAdjust, onDelete, onPhotos, onCount, onImport }) {
  const PAGE = 25;
  const [page, setPage] = useState(0);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setPage(0); }, [query, categoryFilter, brandFilter, photoFilter]);
  // La lista (y sus fotos) no se carga hasta que se busca, se filtra o se pide ver todo
  const searching = showAll || query.trim() !== '' || categoryFilter !== 'Todas' || brandFilter !== 'Todas' || photoFilter;
  // Los chips suman exactamente el total de materiales: lo que no tenga categoría conocida va a «Sin categoría»
  const known = new Set(categories.map(c => c.name));
  const catCounts = [
    ...categories.map(c => [c.name, allItems.filter(i => i.category === c.name).length]),
    ['Sin categoría', allItems.filter(i => !known.has(i.category)).length]
  ].filter(x => x[1] > 0);
  const driveCount = allItems.filter(i => (i.photo_urls || []).some(u => !isStorageUrl(u))).length;
  // Mismo nombre y misma marca más de una vez = material repetido (conviene dejar uno solo antes de la carga definitiva)
  const dupes = useMemo(() => {
    const m = new Map();
    allItems.forEach(i => { const k = `${norm(i.name.trim())}|${i.brand || 'Genérico'}`; m.set(k, [...(m.get(k) || []), i]); });
    return [...m.values()].filter(a => a.length > 1);
  }, [allItems]);
  // Se ordena por nombre y marca: las marcas de un mismo material quedan juntas, bajo un encabezado con el total
  const sorted = useMemo(() => [...filtered].sort((a, b) => norm(a.name.trim()).localeCompare(norm(b.name.trim())) || String(a.brand || '').localeCompare(String(b.brand || ''))), [filtered]);
  const groupOf = useMemo(() => {
    const g = {};
    sorted.forEach(i => { const k = norm(i.name.trim()); (g[k] = g[k] || []).push(i); });
    return g;
  }, [sorted]);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const items = searching ? sorted.slice(cur * PAGE, cur * PAGE + PAGE) : [];
  const catNames = categories.map(c => c.name);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Materiales</h2>
        {isStaff && (
          <div className="head-actions">
            <button type="button" className="secondary-btn" onClick={onCount}>Conteo físico</button>
            <button type="button" className="secondary-btn" onClick={onImport}>Importar planilla</button>
          </div>
        )}
      </div>
      <div className="filters-row">
        <label className="filter-label">Buscar<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nombre o marca…" /></label>
        <label className="filter-label">Categoría<select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option>Todas</option>{catNames.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="filter-label">Marca<select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}><option>Todas</option><option>Genérico</option>{BRANDS.map(b => <option key={b}>{b}</option>)}</select></label>
        {isStaff && driveCount > 0 && (
          <label className="check-filter"><input type="checkbox" checked={photoFilter} onChange={e => setPhotoFilter(e.target.checked)} /> Fotos de Drive a revisar ({driveCount})</label>
        )}
      </div>
      {isStaff && dupes.length > 0 && (
        <details className="dupes-box">
          <summary>⚠ {dupes.length} material(es) repetido(s): mismo nombre y misma marca</summary>
          <p className="muted small">Conviene dejar uno solo antes de la carga definitiva: pasá el stock al que se queda (con «Ajustar stock») y archivá el otro con «Eliminar o archivar».</p>
          <ul>{dupes.map(a => <li key={a[0].id}><button type="button" className="link-btn" onClick={() => { setQuery(a[0].name); }}>{a[0].name}</button> · {a[0].brand || 'Genérico'} · {a.length} veces ({a.map(x => `${x.stock_nucleo || 0} u.`).join(' y ')})</li>)}</ul>
        </details>
      )}
      {!searching && (
        <div className="empty-state">
          <p><strong>{allItems.length} materiales cargados.</strong> Buscá por nombre o marca, o elegí una categoría:</p>
          <div className="cat-chips">
            {catCounts.map(([c, n]) => <button type="button" key={c} className="chip-btn" onClick={() => c !== 'Sin categoría' && setCategoryFilter(c)}>{c} <span>{n}</span></button>)}
          </div>
          <button type="button" className="link-btn" onClick={() => setShowAll(true)}>Ver todo el listado</button>
        </div>
      )}
      {searching && (<>
      <p className="muted small">{filtered.length} material(es){filtered.length !== allItems.length ? ` de ${allItems.length}` : ''} · tocá el nombre para ver la ficha con el stock en cada depósito</p>
      <table className="stack-table">
        <thead><tr><th></th><th>Material</th><th>Categoría</th><th>Marca</th><th>Depósito Rosario</th><th>En depósitos y puntos</th>{isStaff && <th></th>}</tr></thead>
        <tbody>
          {items.map((i, idx) => {
            const low = Number(i.reorder_nucleo) > 0 && Number(i.stock_nucleo) <= Number(i.reorder_nucleo);
            const k = norm(i.name.trim());
            const grp = groupOf[k];
            const prev = items[idx - 1];
            const newGroup = grp.length > 1 && (!prev || norm(prev.name.trim()) !== k);
            return (
              <React.Fragment key={i.id}>
                {newGroup && <tr className="group-row"><td colSpan="7"><strong>{i.name}</strong> · {grp.length} marcas · {grp.reduce((a, x) => a + (x.stock_nucleo || 0), 0)} u. en Rosario</td></tr>}
              <tr>
                <td className="photo-col">{i.photo_urls?.length ? (
                  <button type="button" className="thumb-btn" onClick={() => onPhotos(i)} title="Ver fotos">
                    <Thumb url={i.photo_urls[0]} alt={i.name} />
                    {i.photo_urls.length > 1 && <span className="thumb-count">{i.photo_urls.length}</span>}
                  </button>) : null}</td>
                <td className="cell-main"><button type="button" className="name-link" onClick={() => onOpen(i)}><strong>{i.name}</strong></button></td>
                <td data-label="Categoría">{i.category}</td><td data-label="Marca">{i.brand}</td>
                <td data-label="Rosario" className={low ? 'warn' : ''}>{i.stock_nucleo || 0}{reserved?.[i.id] > 0 && <small>reservado {reserved[i.id]} · disponible {Math.max(0, (i.stock_nucleo || 0) - reserved[i.id])}</small>}{Number(i.reorder_nucleo) > 0 && <small>mín. {i.reorder_nucleo}</small>}</td>
                <td data-label="En depósitos">{inDepots[i.id] || 0}</td>
                {isStaff && <td className="actions-col">
                  <RowMenu>
                    <button type="button" role="menuitem" onClick={() => onOpen(i)}>Ver ficha</button>
                    <button type="button" role="menuitem" onClick={() => onEdit(i)}>Editar</button>
                    <button type="button" role="menuitem" onClick={() => onAdjust(i)}>Ajustar stock</button>
                    <button type="button" role="menuitem" className="danger" onClick={() => onDelete(i)}>Eliminar o archivar</button>
                  </RowMenu>
                </td>}
              </tr>
              </React.Fragment>
            );
          })}
          {!items.length && <tr><td colSpan="7" className="muted">No hay materiales con esos filtros</td></tr>}
        </tbody>
      </table>
      <p className="muted small photo-legend">❓ = la foto no está disponible (el archivo no se encuentra en Drive o no se puede abrir). Sin ícono = ese material no tiene foto cargada. Podés reemplazarla con «Editar».</p>
      {pages > 1 && (
        <div className="pager">
          <button type="button" className="secondary-btn" disabled={cur === 0} onClick={() => setPage(cur - 1)}>← Anterior</button>
          <span className="muted">Página {cur + 1} de {pages} · {filtered.length} materiales</span>
          <button type="button" className="secondary-btn" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Siguiente →</button>
        </div>
      )}
      </>)}
    </section>
  );
}
function DestSelect({ destinations, value, onChange }) {
  const byId = Object.fromEntries(destinations.map(d => [d.id, d]));
  const shown = destinations.filter(d => d.active !== false || d.id === value);
  const depots = shown.filter(d => d.is_depot);
  const groups = {};
  shown.filter(d => !d.is_depot).forEach(d => { const k = d.supplied_by_id || ''; (groups[k] = groups[k] || []).push(d); });
  const keys = Object.keys(groups).sort((a, b) => (a === '' ? -1 : b === '' ? 1 : (byId[a]?.name || '').localeCompare(byId[b]?.name || '')));
  return (
    <select value={value} onChange={e => onChange(e.target.value)} aria-label="Depósito o punto">
      {depots.length > 0 && <optgroup label="Depósitos">{depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>}
      {keys.map(k => (
        <optgroup key={k || 'ros'} label={k ? `Concesionarios que abastece ${byId[k]?.name || 'otro depósito'}` : 'Concesionarios que abastece Rosario'}>
          {groups[k].map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function DepositoView({ viewToggle, onCount, sentList, madeList, linesByShipment, lastSent, isDepot, isPunto, canOperate, destinations, selectedDest, setSelectedDest, onSend, rows, status, itemById, inTransit, onGoReceive, onDeliver, onStockIn, onReturn, onMin, onAdjust }) {
  const statusByItem = Object.fromEntries(status.map(s => [s.item_id, s]));
  const dest = destinations.find(d => d.id === selectedDest);
  const canSend = canOperate && isDepot && dest?.supplies_dealers;
  const isEquip = (r) => itemById[r.item_id]?.kind === 'equipamiento';
  const consum = rows.filter(r => !isEquip(r));
  const equip = rows.filter(isEquip);
  const nameCell = (r) => <td className="cell-main"><strong>{itemById[r.item_id]?.name || 'Material'}</strong><small>{itemById[r.item_id]?.category}</small></td>;
  return (
    <>
      {!isPunto && (
        <section className="card" style={{ marginBottom: 18 }}>
          {viewToggle}
          <label className="inline-label">Depósito / punto
            <DestSelect destinations={destinations} value={selectedDest} onChange={setSelectedDest} />
          </label>
        </section>
      )}
      {!isDepot && (
        <section className="card" style={{ marginBottom: 18 }}>
          <h2>Envíos registrados</h2>
          <table className="stack-table">
            <thead><tr><th>Fecha</th><th>Materiales enviados</th><th>Recibe</th><th>Enviado por</th></tr></thead>
            <tbody>
              {sentList.map(sh => (
                <tr key={sh.id}>
                  <td className="cell-main">{fmtDate(sh.created_at)}{sh.origin_name && <small>desde {sh.origin_name}</small>}</td>
                  <td data-label="Materiales"><ul className="ship-lines">{(linesByShipment[sh.id] || []).map(l => <li key={l.id}><span className="tick">•</span><span>{l.items?.name} × {l.qty}</span></li>)}</ul></td>
                  <td data-label="Recibe">{sh.recipient_name || '—'}</td><td data-label="Enviado por">{sh.created_by_name}</td>
                </tr>
              ))}
              {!sentList.length && <tr><td colSpan="4" className="muted">Todavía no se le envió material a este concesionario.</td></tr>}
            </tbody>
          </table>
        </section>
      )}
      {canSend && (
        <section className="card" style={{ marginBottom: 18 }}>
          <div className="card-head"><h2>Envíos realizados desde {dest.name}</h2><button className="primary-btn" onClick={onSend}>Enviar a concesionario</button></div>
          <table className="stack-table">
            <thead><tr><th>Fecha</th><th>Destino</th><th>Materiales</th><th>Recibe</th><th>Enviado por</th></tr></thead>
            <tbody>
              {madeList.slice(0, 30).map(sh => (
                <tr key={sh.id}>
                  <td className="cell-main">{fmtDate(sh.created_at)}{sh.exception_reason && <small><span className="chip excepcional" title={sh.exception_reason}>Excepcional</span></small>}</td>
                  <td data-label="Destino">{sh.destination_name}</td>
                  <td data-label="Materiales"><ul className="ship-lines">{(linesByShipment[sh.id] || []).map(l => <li key={l.id}><span className="tick">•</span><span>{l.items?.name} × {l.qty}</span></li>)}</ul></td>
                  <td data-label="Recibe">{sh.recipient_name || '—'}</td><td data-label="Enviado por">{sh.created_by_name}</td>
                </tr>
              ))}
              {!madeList.length && <tr><td colSpan="5" className="muted">Todavía no se hicieron envíos a concesionarios desde acá.</td></tr>}
            </tbody>
          </table>
          {madeList.length > 30 && <p className="muted small">Se muestran los últimos 30 envíos. El resto está en «Envíos».</p>}
        </section>
      )}
      {inTransit.length > 0 && (
        <button type="button" className="notice-banner clickable" onClick={onGoReceive}>
          Hay {inTransit.length} envío(s) en camino para {dest?.name || 'este depósito'}. Tocá acá para confirmarlos cuando lleguen.
        </button>
      )}
      <section className="card">
        <div className="card-head">
          <h2>{isDepot ? 'Consumibles' : (dest?.name || 'Concesionario')}{isDepot ? ` · ${dest?.name || ''}` : ''}</h2>
          {canOperate && (
            <div className="head-actions">
              <button type="button" className="secondary-btn" onClick={onCount}>Conteo físico</button>
              {isDepot && !isPunto && <button className="primary-btn" onClick={onStockIn}>+ Cargar stock</button>}
            </div>
          )}
        </div>
        {isDepot
          ? <p className="muted small">El stock sube cuando se confirma la recepción de un envío. Baja con cada entrega, envío o devolución a Rosario. El punto de restock sugerido se calcula con las entregas y los envíos a concesionarios de los últimos 90 días.</p>
          : <p className="muted small">Concesionario: acá queda el registro de lo que se le envió, con fecha y cantidad. Lo que el concesionario va usando se descuenta a mano con «Ajustar», y la reposición se pide por mensaje (no genera alertas en la plataforma).</p>}
        <table className="stack-table">
          <thead>{isDepot
            ? <tr><th>Material</th><th>Stock</th><th>Punto de restock</th><th>Reponer</th><th>Estado</th>{canOperate && <th></th>}</tr>
            : <tr><th>Material</th><th>Total enviado (menos lo ajustado)</th><th>Último envío</th>{canOperate && <th></th>}</tr>}</thead>
          <tbody>
            {(isDepot ? consum : rows).map(r => {
              const s = statusByItem[r.item_id];
              const st = s?.status || 'ok';
              const ls = lastSent[`${selectedDest}|${r.item_id}`];
              if (!isDepot) return (
                <tr key={r.item_id}>
                  {nameCell(r)}
                  <td data-label="Total enviado">{r.qty}</td>
                  <td data-label="Último envío">{ls ? `${ls.qty} el ${fmtDate(ls.created_at)}` : '—'}</td>
                  {canOperate && <td className="actions-col"><RowMenu>
                    {!isPunto && <button type="button" role="menuitem" disabled={r.qty < 1} onClick={() => onReturn(r)}>Devolver a Rosario</button>}
                    <button type="button" role="menuitem" onClick={() => onAdjust(r)}>Ajustar</button>
                  </RowMenu></td>}
                </tr>
              );
              return (
                <tr key={r.item_id}>
                  {nameCell(r)}
                  <td data-label="Stock" className={st !== 'ok' ? 'warn' : ''}>{r.qty}</td>
                  <td data-label="Punto de restock">{s?.restock_point || r.min_qty || '—'}{r.min_qty > 0 && <small>mínimo cargado: {r.min_qty}</small>}</td>
                  <td data-label="Reponer">{s?.suggested_qty > 0 && st !== 'ok' ? `+${s.suggested_qty}` : '—'}</td>
                  <td data-label="Estado"><span className={`chip ${st}`}>{st === 'ok' ? 'OK' : st === 'sin_stock' ? 'Sin stock' : 'Reponer'}</span></td>
                  {canOperate && <td className="actions-col">
                    <button className="secondary-btn small-btn" disabled={r.qty < 1} onClick={() => onDeliver(r)}>Entregar</button>
                    <RowMenu>
                      {!isPunto && <button type="button" role="menuitem" disabled={r.qty < 1} onClick={() => onReturn(r)}>Devolver a Rosario</button>}
                      <button type="button" role="menuitem" onClick={() => onMin(r)}>Cambiar mínimo</button>
                      <button type="button" role="menuitem" onClick={() => onAdjust(r)}>Ajustar stock</button>
                    </RowMenu>
                  </td>}
                </tr>
              );
            })}
            {!(isDepot ? consum : rows).length && <tr><td colSpan="6" className="muted">{isDepot ? 'No hay consumibles en este depósito. Cuando llegue un envío, confirmá la recepción y va a aparecer acá.' : 'Todavía no hay stock registrado en este concesionario.'}</td></tr>}
          </tbody>
        </table>
      </section>
      {isDepot && (
        <section className="card" style={{ marginTop: 18 }}>
          <h2>Equipamiento en préstamo</h2>
          <p className="muted small">Son elementos que se prestan y vuelven (no se consumen), por eso no tienen punto de restock. Cuando ya no se usan en este depósito, devolvelos a Rosario.</p>
          <table className="stack-table">
            <thead><tr><th>Equipo</th><th>Cantidad</th>{canOperate && <th></th>}</tr></thead>
            <tbody>
              {equip.map(r => (
                <tr key={r.item_id}>
                  {nameCell(r)}
                  <td data-label="Cantidad">{r.qty}</td>
                  {canOperate && <td className="actions-col"><RowMenu>
                    {!isPunto && <button type="button" role="menuitem" disabled={r.qty < 1} onClick={() => onReturn(r)}>Devolver a Rosario</button>}
                    <button type="button" role="menuitem" onClick={() => onAdjust(r)}>Ajustar stock</button>
                  </RowMenu></td>}
                </tr>
              ))}
              {!equip.length && <tr><td colSpan="3" className="muted">No hay equipamiento prestado en este depósito.</td></tr>}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
function ShipmentLines({ lines, onlyProblems }) {
  const rows = onlyProblems ? lines.filter(l => l.pending_qty > 0 || l.in_transit_qty > 0) : lines;
  return (
    <ul className="ship-lines">
      {rows.map(l => {
        const name = `${l.items?.name || ''}${l.items?.brand ? ' · ' + l.items.brand : ''}`;
        const mark = l.pending_qty > 0 ? <span className="tick bad">✗</span>
          : l.in_transit_qty > 0 ? <span className="tick">⏳</span>
          : l.reception_ok === true ? <span className="tick ok">✓</span>
          : l.reception_ok === false ? <span className="tick ok">✓</span>
          : <span className="tick">•</span>;
        return (
          <li key={l.id}>
            {mark}
            <span>{name} · enviado {l.qty}
              {l.reception_ok === false && l.diff_reason ? ` · ${DIFF_LABEL[l.diff_reason]}` : ''}
              {l.pending_qty > 0 ? ` · ${l.pending_qty} sin explicar` : ''}
              {l.in_transit_qty > 0 ? ` · ${l.in_transit_qty} siguen en camino` : ''}
              {l.reception_note ? ` · ${l.reception_note}` : ''}</span>
          </li>
        );
      })}
    </ul>
  );
}

function ReceptionTable({ rows, diffRows, lines, canReceive, canResolve, onReceive, onResolve }) {
  return (
    <>
      {diffRows.length > 0 && (
        <section className="card diff-card" role="alert">
          <h2>⚠ Con diferencia – pendiente de resolver ({diffRows.length})</h2>
          <p className="muted small">{canResolve ? 'Elegí qué pasó con cada unidad de diferencia. El envío se cierra cuando no queda nada sin explicar.' : 'Marketing está resolviendo estas diferencias. Lo que llegó bien ya está sumado a tu stock.'}</p>
          {diffRows.map(sh => (
            <div key={sh.id} className="review-item">
              <div className="review-head"><strong>{sh.destination_name}</strong><small>recibió {sh.received_by_name} · {fmtDateTime(sh.received_at)}</small></div>
              <ShipmentLines lines={lines[sh.id] || []} onlyProblems />
              {sh.reception_notes && <p className="obs-text">“{sh.reception_notes}”</p>}
              {canResolve && <button className="primary-btn small-btn" onClick={() => onResolve(sh)}>Resolver diferencia</button>}
            </div>
          ))}
        </section>
      )}
      <section className="card">
        <h2>{canReceive ? 'Envíos pendientes de recepción' : 'Envíos en camino'}</h2>
        <p className="muted small">Cuando llega la mercadería, tocá Recibir y controlá cada material: ✓ si llegó todo bien, ✗ si hay una diferencia (elegís el motivo y cuántas llegaron). Lo que llegó bien se suma al stock del depósito en ese momento.</p>
        <table>
          <thead><tr><th>Enviado</th><th>Materiales</th><th>Destino</th><th>Recibe</th><th>Enviado por</th>{canReceive && <th></th>}</tr></thead>
          <tbody>
            {rows.map(sh => {
              const d = daysSince(sh.created_at);
              const parcial = sh.status === 'parcial';
              return (
                <tr key={sh.id}>
                  <td>{fmtDate(sh.created_at)}<small className={d > 5 ? 'warn' : ''}>{d === 0 ? 'hoy' : `hace ${d} día(s)`}{d > 5 ? ' · urgente' : ''}</small></td>
                  <td>{parcial && <small className="obs-text">Parcial: solo falta lo que sigue en camino</small>}<ShipmentLines lines={lines[sh.id] || []} onlyProblems={parcial} /></td>
                  <td>{sh.destination_name}{sh.origin_name && <small>desde {sh.origin_name}</small>}{sh.exception_reason && <small><span className="chip excepcional" title={sh.exception_reason}>Excepcional</span></small>}</td><td>{sh.recipient_name || '—'}</td><td>{sh.created_by_name}</td>
                  {canReceive && <td><button className="primary-btn small-btn" onClick={() => onReceive(sh)}>Recibir</button></td>}
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan="6" className="muted">No hay envíos pendientes</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}

function RestockTable({ rows }) {
  // Los ingresos con varios materiales comparten batch_id: se muestran como un solo ingreso
  const groups = useMemo(() => {
    const map = new Map();
    rows.forEach(r => {
      const k = r.batch_id || r.id;
      if (!map.has(k)) map.set(k, { key: k, first: r, lines: [] });
      map.get(k).lines.push(r);
    });
    return [...map.values()];
  }, [rows]);
  return (
    <section className="card">
      <h2>Ingresos al Depósito Rosario</h2>
      <table className="stack-table">
        <thead><tr><th>Fecha</th><th>Materiales</th><th>Unidades</th><th>Origen</th><th>Costo</th><th>Notas</th><th>Registrado por</th></tr></thead>
        <tbody>{groups.map(({ key, first: r, lines }) => {
          const cost = lines.reduce((a, l) => a + (Number(l.cost) || 0), 0);
          return (
            <tr key={key}>
              <td className="cell-main">{fmtDate(r.created_at)}</td>
              <td data-label="Materiales">{lines.length > 1 ? <ul className="ship-lines">{lines.map(l => <li key={l.id}><span className="tick">•</span><span>{l.items?.name} × {l.qty}</span></li>)}</ul> : r.items?.name}</td>
              <td data-label="Unidades">{lines.reduce((a, l) => a + l.qty, 0)}</td>
              <td data-label="Origen">{SOURCE_LABELS[r.source] || r.source}</td>
              <td data-label="Costo">{cost > 0 ? fmtMoney(cost) : '—'}</td>
              <td data-label="Notas">{r.notes || '—'}</td>
              <td data-label="Registrado por">{r.person}</td>
            </tr>
          );
        })}
          {!groups.length && <tr><td colSpan="7" className="muted">Todavía no hay ingresos</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

function WithdrawalTable({ rows }) {
  // Los retiros con varios materiales comparten batch_id: se muestran como un solo retiro
  const groups = useMemo(() => {
    const map = new Map();
    rows.forEach(r => {
      const k = r.batch_id || r.id;
      if (!map.has(k)) map.set(k, { key: k, first: r, lines: [] });
      map.get(k).lines.push(r);
    });
    return [...map.values()];
  }, [rows]);
  return (
    <section className="card">
      <h2>Retiros / Uso (Depósito Rosario)</h2>
      <table className="stack-table">
        <thead><tr><th>Fecha</th><th>Materiales</th><th>Unidades</th><th>Motivo</th><th>Detalle</th><th>Cliente</th><th>Patente</th><th>Registrado por</th></tr></thead>
        <tbody>{groups.map(({ key, first: r, lines }) => (
          <tr key={key}>
            <td className="cell-main">{fmtDate(r.created_at)}</td>
            <td data-label="Materiales">{lines.length > 1 ? <ul className="ship-lines">{lines.map(l => <li key={l.id}><span className="tick">•</span><span>{l.items?.name} × {l.qty}</span></li>)}</ul> : r.items?.name}</td>
            <td data-label="Unidades">{lines.reduce((a, l) => a + l.qty, 0)}</td>
            <td data-label="Motivo">{reasonLabel(r.reason_type)}</td><td data-label="Detalle">{r.reason_detail}</td>
            <td data-label="Cliente">{r.recipient_last_name || '—'}</td><td data-label="Patente">{r.vehicle_plate || '—'}</td><td data-label="Registrado por">{r.person}</td>
          </tr>))}
          {!groups.length && <tr><td colSpan="8" className="muted">Todavía no hay retiros</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
function MovementTable({ rows, lines, canResolve, onResolve, destById }) {
  const label = { en_transito: 'En camino', parcial: 'Parcial: resto en camino', con_diferencia: 'Con diferencia – pendiente', recibido: 'Recibido ✓', recibido_con_diferencias: 'Recibido (diferencia resuelta)', recibido_con_diferencia: 'Recibido (diferencia resuelta)' };
  const chip = { en_transito: 'en_transito', parcial: 'en_transito', con_diferencia: 'con_diferencia', recibido: 'recibido', recibido_con_diferencias: 'recibido_con_diferencia', recibido_con_diferencia: 'recibido_con_diferencia' };
  return (
    <section className="card">
      <h2>Envíos a depósitos y concesionarios</h2>
      <table className="stack-table">
        <thead><tr><th>Fecha</th><th>Sale desde</th><th>Destino</th><th>Materiales</th><th>Estado</th><th>Recibió</th><th>Enviado por</th></tr></thead>
        <tbody>{rows.map(sh => (
          <tr key={sh.id}>
            <td className="cell-main">{fmtDate(sh.created_at)}</td>
            <td data-label="Sale desde">{sh.origin_name || ROSARIO}
              {sh.exception_reason && <small><span className="chip excepcional" title={sh.exception_reason}>Excepcional</span> {sh.exception_reason}</small>}</td>
            <td data-label="Destino">{sh.destination_name}</td>
            <td data-label="Materiales"><ShipmentLines lines={lines[sh.id] || []} />{sh.reception_notes && <small className="obs-text">“{sh.reception_notes}”</small>}</td>
            <td data-label="Estado"><span className={`chip ${chip[sh.status] || ''}`}>{destById?.[sh.destination_id]?.is_depot === false ? 'Registrado' : (label[sh.status] || 'Otro estado')}</span>
              {sh.status === 'con_diferencia' && canResolve && <button className="link-btn" onClick={() => onResolve(sh)}>Resolver</button>}
              {(sh.status === 'recibido_con_diferencias' || sh.status === 'recibido_con_diferencia') && sh.reviewed_by_name && <small>resuelto por {sh.reviewed_by_name}</small>}</td>
            <td data-label="Recibió">{sh.received_by_name ? <>{sh.received_by_name}<small>{fmtDateTime(sh.received_at)}</small></> : '—'}</td>
            <td data-label="Enviado por">{sh.created_by_name}</td>
          </tr>))}
          {!rows.length && <tr><td colSpan="7" className="muted">Todavía no hay envíos</td></tr>}
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

function EventsTable({ events, eventItems, itemById, isStaff, onNew, onPrint, onWithdraw, onReturn, onCancel, onEdit, onDuplicate }) {
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
                  {isStaff && e.status === 'abierto' && <button className="secondary-btn small-btn" onClick={() => onEdit(e)}>Editar evento</button>}
                  {isStaff && lines.length > 0 && <button className="secondary-btn small-btn" onClick={() => onDuplicate(e)}>Duplicar para otras fechas</button>}
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

const dayOf = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function HistoryTab({ rows, destinations, loaded, canAck }) {
  const PAGE = 50;
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState('Todos');
  const [place, setPlace] = useState('Todos');
  const [brand, setBrand] = useState('Todas');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [q, tipo, place, brand, from, to]);
  const tipos = useMemo(() => Array.from(new Set(rows.map(r => r.tipo).filter(Boolean))).sort(), [rows]);
  const brands = useMemo(() => Array.from(new Set(rows.map(r => r.brand).filter(Boolean))).sort(), [rows]);
  const places = useMemo(() => [ROSARIO, ...destinations.filter(d => d.name !== ROSARIO).map(d => d.name)], [destinations]);
  const filtered = useMemo(() => {
    const toks = norm(q.trim()).split(/\s+/).filter(Boolean);
    return rows.filter(r => {
      if (tipo !== 'Todos' && r.tipo !== tipo) return false;
      if (place !== 'Todos' && r.place !== place && r.destName !== place) return false;
      if (brand !== 'Todas' && r.brand !== brand) return false;
      if (from && dayOf(r.at) < from) return false;
      if (to && dayOf(r.at) > to) return false;
      if (!toks.length) return true;
      const hay = norm([r.item, r.detalle, r.quien, r.tipo, r.place].join(' '));
      return toks.every(t => hay.includes(t));
    });
  }, [rows, q, tipo, place, brand, from, to]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const visible = filtered.slice(cur * PAGE, cur * PAGE + PAGE);
  const exportCsv = () => downloadCsv(
    `historial-${todayStr()}.csv`,
    ['Fecha', 'Tipo', 'Material', 'Marca', 'Cantidad', 'Depósito', 'Detalle', 'Usuario', 'Revisión'],
    filtered.map(r => [fmtDateTime(r.at), r.tipo, r.item || '', r.brand || '', r.qty, r.place || '', r.detalle || '', r.quien || '', r.review ? (r.review === 'pendiente' ? 'Pendiente de revisión' : r.review) : ''])
  );
  const clear = () => { setQ(''); setTipo('Todos'); setPlace('Todos'); setBrand('Todas'); setFrom(''); setTo(''); };
  const filtering = q || tipo !== 'Todos' || place !== 'Todos' || brand !== 'Todas' || from || to;
  return (
    <section className="card">
      <div className="card-head"><h2>Historial completo</h2><button type="button" className="secondary-btn" onClick={exportCsv} disabled={!filtered.length}>Exportar Excel (CSV)</button></div>
      <div className="filters-row">
        <label className="filter-label">Buscar<input value={q} onChange={e => setQ(e.target.value)} placeholder="Material, detalle o usuario…" /></label>
        <label className="filter-label">Tipo<select value={tipo} onChange={e => setTipo(e.target.value)}><option>Todos</option>{tipos.map(t => <option key={t}>{t}</option>)}</select></label>
        <label className="filter-label">Depósito / punto<select value={place} onChange={e => setPlace(e.target.value)}><option>Todos</option>{places.map(t => <option key={t}>{t}</option>)}</select></label>
        <label className="filter-label">Marca<select value={brand} onChange={e => setBrand(e.target.value)}><option>Todas</option>{brands.map(t => <option key={t}>{t}</option>)}</select></label>
        <label className="filter-label">Desde<input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></label>
        <label className="filter-label">Hasta<input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
        {filtering && <button type="button" className="link-btn" onClick={clear}>Limpiar filtros</button>}
      </div>
      <table className="stack-table">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Material</th><th>Cantidad</th><th>Detalle</th><th>Usuario</th></tr></thead>
        <tbody>{visible.map(op => (
          <tr key={op.id}>
            <td className="cell-main">{fmtDateTime(op.at)}</td>
            <td data-label="Tipo">{op.tipo}
              {op.review === 'pendiente' && <small><span className="chip pendiente">Pendiente de revisión</span></small>}
              {op.review && op.review !== 'pendiente' && <small><span className="chip visto">{op.review[0].toUpperCase() + op.review.slice(1)}</span></small>}
              {op.exceptional && <small><span className="chip excepcional">Envío excepcional</span></small>}</td>
            <td data-label="Material">{op.item}{op.brand && op.brand !== 'Genérico' ? <small>{op.brand}</small> : null}</td>
            <td data-label="Cantidad">{op.qty}</td><td data-label="Detalle">{op.detalle || '—'}</td><td data-label="Usuario">{op.quien}</td>
          </tr>))}
          {!visible.length && <tr><td colSpan="6" className="muted">Sin movimientos con esos filtros</td></tr>}</tbody>
      </table>
      {pages > 1 && (
        <div className="pager">
          <button type="button" className="secondary-btn" disabled={cur === 0} onClick={() => setPage(cur - 1)}>← Anterior</button>
          <span className="muted">Página {cur + 1} de {pages} · {filtered.length} registros</span>
          <button type="button" className="secondary-btn" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Siguiente →</button>
        </div>
      )}
      <p className="muted small">Se cargan los últimos {loaded?.mov ?? 0} movimientos, {loaded?.ing ?? 0} ingresos y {loaded?.ret ?? 0} retiros (hasta 600, 200 y 200). Lo más viejo no aparece acá; la exportación incluye lo que ves con los filtros aplicados.</p>
    </section>
  );
}

function UsersTab({ users, destinations, isOwner, meId, busy, onChange }) {
  const depots = destinations.filter(d => d.active !== false);
  return (
    <section className="card">
      <h2>Usuarios</h2>
      <p className="muted small">Las personas nuevas se invitan desde Supabase → Authentication → Users; cuando entran por primera vez aparecen acá sin acceso hasta que les asignes un rol.{!isOwner && ' Solo el Dueño puede cambiar roles y depósitos.'}</p>
      <table className="stack-table">
        <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Depósito asignado</th></tr></thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td className="cell-main"><strong>{u.full_name || '—'}</strong>{u.is_owner && <small><span className="chip visto">Dueño</span></small>}{u.id === meId && <small>(vos)</small>}</td>
              <td data-label="Email">{u.email}</td>
              <td data-label="Rol">{isOwner && !u.is_owner
                ? <select value={u.role} disabled={busy} onChange={e => onChange(u, { role: e.target.value })} aria-label={`Rol de ${u.full_name || u.email}`}>
                    {Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                : (u.is_owner ? 'Dueño (administrador)' : ROLE_LABELS[u.role] || u.role)}</td>
              <td data-label="Depósito">{isOwner && !u.is_owner
                ? <select value={u.destination_id || ''} disabled={busy} onChange={e => onChange(u, { destination_id: e.target.value || null })} aria-label={`Depósito de ${u.full_name || u.email}`}>
                    <option value="">Ninguno</option>
                    {depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                : (destinations.find(d => d.id === u.destination_id)?.name || '—')}</td>
            </tr>
          ))}
          {!users.length && <tr><td colSpan="4" className="muted">No hay usuarios cargados</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
/* ---------------- Modales ---------------- */

function ConfirmModal({ modal, onClose }) {
  useScrollLock();
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
  useScrollLock();
  const [cur, setCur] = useState(0);
  const list = item.photo_urls || [];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal photo-modal" onClick={e => e.stopPropagation()}>
        <div className="card-head"><h2>{item.name}{item.brand && item.brand !== 'Genérico' ? ` · ${item.brand}` : ''}</h2><button type="button" className="close-btn" onClick={onClose}>×</button></div>
        <div className="photo-main">
          <Thumb key={list[cur]} url={list[cur]} alt={item.name} w={900} />
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

function ItemModal({ categories, form, setForm, editing, onClose, onSubmit }) {
  const { busy } = React.useContext(UiCtx);
  const [fileMsg, setFileMsg] = useState('');
  const brandInName = nameHasBrand(form.name);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  // La categoría depende del tipo (consumible / equipamiento): al cambiar el tipo se vuelve a elegir
  const cats = categories.filter(c => c.kind === form.kind);
  const setKind = (k) => setForm(p => ({ ...p, kind: k, category: categories.some(c => c.name === p.category && c.kind === k) ? p.category : '' }));
  const onFiles = (e) => {
    const all = Array.from(e.target.files || []);
    const ok = all.filter(f => /^image\/(jpeg|png|webp)$/i.test(f.type));
    setFileMsg(ok.length < all.length ? `Se ignoraron ${all.length - ok.length} archivo(s): solo se aceptan fotos JPG, PNG o WebP.` : '');
    set('photoFiles', ok);
    if (ok.length < all.length && !ok.length) e.target.value = '';
  };
  return (
    <Modal title={`${editing ? 'Editar' : 'Nuevo'} material`} onClose={onClose} onSubmit={onSubmit} submitLabel="Guardar"
      extraActions={<button type="submit" className="secondary-btn" data-another="1" disabled={busy}>Guardar y crear otra marca</button>}>
      <div className="form-grid">
        <label>Nombre *<input required value={form.name} onChange={e => set('name', e.target.value)} placeholder="Tipo + detalle. Ej: Llavero metálico pintado" />
          <small className="field-help">La marca va en su propio campo, no en el nombre. Si el mismo material existe para varias marcas, cargá una vez cada marca con el mismo nombre.</small>
          {brandInName && <small className="warn">El nombre incluye «{brandInName}»: sacalo del nombre y elegí la marca abajo.</small>}</label>
        <label>Tipo<select value={form.kind} onChange={e => setKind(e.target.value)}><option value="consumible">Consumible (se entrega)</option><option value="equipamiento">Equipamiento (se presta y vuelve)</option></select></label>
        <label>Categoría *<select required value={form.category} onChange={e => set('category', e.target.value)}><option value="">Elegí la categoría…</option>{cats.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</select></label>
        <label>Marca<select value={form.brand} onChange={e => set('brand', e.target.value)}><option>Genérico</option>{BRANDS.map(b => <option key={b}>{b}</option>)}</select>
          <small className="field-help">Genérico y Neostar aparecen para todas las marcas.</small></label>
        {form.category === 'Regalos' && (
          <label>Ocasión<select value={form.occasion} onChange={e => set('occasion', e.target.value)}><option value="">—</option><option>Nuevo</option><option>Usado</option><option>Service</option><option>Postventa</option></select></label>
        )}
        {!editing && <label>Stock inicial en Depósito Rosario<input type="number" min="0" value={form.stock_nucleo} onChange={e => set('stock_nucleo', e.target.value)} /></label>}
        <label>Mínimo Depósito Rosario (recompra)<input type="number" min="0" value={form.reorder_nucleo} onChange={e => set('reorder_nucleo', e.target.value)} /></label>
        <label>Demora del proveedor (días)<input type="number" min="0" value={form.lead_time_days} onChange={e => set('lead_time_days', e.target.value)} />
          <small className="field-help">Se usa para avisarte cuándo recomprar.</small></label>
      </div>
      <div className="full-width photo-upload">
        <label>Fotos del material (JPG, PNG o WebP; se achican solas antes de subirse)
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={onFiles} />
        </label>
        {fileMsg && <small className="warn">{fileMsg}</small>}
        {form.photoFiles?.length > 0 && <small className="muted">{form.photoFiles.length} foto(s) para subir: {form.photoFiles.map(f => f.name).join(', ')}</small>}
        {editing && form.photo_urls?.length > 0 && (
          <div className="photo-edit">
            {form.photo_urls.map(u => (
              <span key={u} className="photo-edit-item">
                <Thumb url={u} alt="" w={120} />
                <button type="button" title="Quitar esta foto" aria-label="Quitar esta foto" onClick={() => set('photo_urls', form.photo_urls.filter(x => x !== u))}>×</button>
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
const itemLabel = (i) => `${i.name}${i.brand && i.brand !== 'Genérico' ? ` · ${i.brand}` : ''}`;
const itemSearch = (i) => `${i.name} ${i.brand || ''} ${i.sku || ''} ${i.category || ''}`;
const nameHasBrand = (name) => BRANDS.filter(b => b !== 'Neostar').find(b => new RegExp(`(^|[^a-záéíóúñ])${b}([^a-záéíóúñ]|$)`, 'i').test(String(name || '')));

/* Renglones «material + cantidad» con buscador. options: [{ id, label, search, avail?, note? }] */
function LinesEditor({ lines, onChange, options, rightLabel = 'Disponible', hideZero = true, addLabel = '+ Agregar otro material', withCost = false }) {
  const byId = useMemo(() => Object.fromEntries(options.map(o => [o.id, o])), [options]);
  const set = (i, patch) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const del = (i) => onChange(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines);
  return (
    <>
      <div className="send-lines">
        {lines.map((l, i) => {
          const o = byId[l.item_id];
          const excl = new Set(lines.filter((_, j) => j !== i).map(x => x.item_id).filter(Boolean));
          const max = o?.avail != null ? Math.max(o.avail, 0) : undefined;
          return (
            <div key={i} className={`send-line${withCost ? ' has-cost' : ''}`}>
              {l.locked
                ? <div className="locked-line"><strong>{o?.label || 'Material'}</strong><small>Ya entregado: no se puede cambiar</small></div>
                : <MaterialPicker options={options} value={l.item_id} onChange={v => set(i, { item_id: v, qty: 1 })} excludeIds={excl} rightLabel={rightLabel} hideZero={hideZero} required />}
              <input type="number" min="1" max={max || undefined} disabled={!l.item_id || l.locked} value={l.qty} onChange={e => set(i, { qty: e.target.value })} aria-label="Cantidad" required />
              {withCost && <input type="number" min="0" step="0.01" disabled={!l.item_id} value={l.cost ?? ''} onChange={e => set(i, { cost: e.target.value })} aria-label="Costo de esta línea en pesos (opcional)" placeholder="Costo $ (opcional)" />}
              <button type="button" className="link-btn danger" onClick={() => del(i)} disabled={lines.length === 1 || l.locked}>Quitar</button>
              {l.item_id && max != null && !l.locked && <small className="line-hint">Máximo {max}</small>}
            </div>
          );
        })}
      </div>
      <button type="button" className="secondary-btn add-line-btn" onClick={() => onChange([...lines, { item_id: '', qty: 1 }])}>{addLabel}</button>
    </>
  );
}

function RestockModal({ restock, setRestock, items, onClose, onSubmit }) {
  const set = (k, v) => setRestock(p => ({ ...p, [k]: v }));
  const options = useMemo(() => items.map(i => ({ id: i.id, label: itemLabel(i), search: itemSearch(i), avail: i.stock_nucleo || 0, note: i.category })), [items]);
  return (
    <Modal title="Registrar ingreso" onClose={onClose} onSubmit={onSubmit} submitLabel="Guardar ingreso">
      <div className="form-grid">
        <label>Origen<select value={restock.source} onChange={e => set('source', e.target.value)}><option value="proveedor">Proveedor</option><option value="otro">Otro (aclarar en notas)</option></select></label>
        <label>Notas<input value={restock.notes} onChange={e => set('notes', e.target.value)} placeholder="Remito, proveedor, etc." /></label>
      </div>
      <h3 className="sub">Materiales que entraron</h3>
      <LinesEditor lines={restock.lines} onChange={lines => set('lines', lines)} options={options} rightLabel="En Rosario" hideZero={false} withCost />
      <p className="muted small">Cargá todo lo que figura en el remito de una vez. El costo de cada línea es opcional (lo que costó esa línea completa).</p>
      <p className="muted small">¿Es una devolución de un depósito o concesionario? No la cargues acá: usá «Devolver a Rosario» en Depósitos y puntos, así también se descuenta de donde vuelve.</p>
    </Modal>
  );
}
function WithdrawalModal({ withdrawal, setWithdrawal, items, reserved, onClose, onSubmit }) {
  const set = (k, v) => setWithdrawal(p => ({ ...p, [k]: v }));
  const esIncidencia = withdrawal.reason_type === 'incidencia_cliente';
  const options = useMemo(() => items.map(i => ({ id: i.id, label: itemLabel(i), search: itemSearch(i), avail: Math.max(0, (i.stock_nucleo || 0) - (reserved?.[i.id] || 0)), note: reserved?.[i.id] > 0 ? `${i.stock_nucleo} en total, ${reserved[i.id]} reservados` : i.category })), [items, reserved]);
  return (
    <Modal title="Registrar retiro" onClose={onClose} onSubmit={onSubmit} submitLabel="Guardar retiro">
      <div className="form-grid">
        <label>Motivo *<select required value={withdrawal.reason_type} onChange={e => set('reason_type', e.target.value)}><option value="">Elegí el motivo…</option>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {esIncidencia && <>
          <label>Apellido cliente *<input required value={withdrawal.recipient_last_name} onChange={e => set('recipient_last_name', e.target.value)} /></label>
          <label>Patente *<input required value={withdrawal.vehicle_plate} onChange={e => set('vehicle_plate', e.target.value.toUpperCase())} /></label>
        </>}
        <label className="full-width">Descripción *<input required value={withdrawal.reason_detail} onChange={e => set('reason_detail', e.target.value)} placeholder={esIncidencia ? 'Motivo de la incidencia' : 'Descripción del retiro'} /></label>
      </div>
      <h3 className="sub">Materiales del retiro</h3>
      <LinesEditor lines={withdrawal.lines} onChange={lines => set('lines', lines)} options={options} />
      <p className="muted small">Podés retirar varios materiales juntos con el mismo motivo. Lo reservado para eventos no se puede retirar. Si falta stock en alguno, no se registra ninguno.</p>
    </Modal>
  );
}
function SendModal({ modal, setModal, items, destinations, destStock, reserved, isStaff, ownDestId, onClose, onSubmit }) {
  const set = (k, v) => setModal(p => ({ ...p, [k]: v }));
  const [allMats, setAllMats] = useState(false);
  const live = destinations.filter(d => d.active !== false);
  const origins = live.filter(d => d.supplies_dealers && (isStaff || d.id === ownDestId));
  const origin = origins.find(d => d.id === modal.origin_id);
  const originKey = modal.origin_id || '';
  const supplied = (d) => (d.supplied_by_id || '') === originKey;
  const pickable = live.filter(d => d.id !== modal.origin_id);
  const depots = !origin ? pickable.filter(d => d.is_depot && supplied(d)) : [];
  const dealers = pickable.filter(d => !d.is_depot && supplied(d));
  const regular = new Set([...depots, ...dealers].map(d => d.id));
  const others = modal.exceptional && isStaff ? pickable.filter(d => !regular.has(d.id) && (!origin || !d.is_depot)) : [];
  const chosenDest = destinations.find(d => d.id === modal.destination_id);
  const marcas = chosenDest?.marcas || [];
  const inScope = (it) => !marcas.length || it.brand === 'Genérico' || it.brand === 'Neostar' || marcas.includes(it.brand);
  const base = useMemo(() => (origin
    ? destStock.filter(r => r.destination_id === origin.id && r.qty > 0).map(r => ({ it: items.find(x => x.id === r.item_id), max: r.qty }))
    : items.map(it => ({ it, max: Math.max(0, (it.stock_nucleo || 0) - (reserved?.[it.id] || 0)) }))
  ).filter(x => x.it), [origin, destStock, items, reserved]);
  const chosen = new Set(modal.lines.map(l => l.item_id).filter(Boolean));
  const options = base
    .filter(x => allMats || inScope(x.it) || chosen.has(x.it.id))
    .map(({ it, max }) => ({ id: it.id, label: itemLabel(it), search: itemSearch(it), avail: max, note: !origin && reserved?.[it.id] > 0 ? `${it.stock_nucleo} en total, ${reserved[it.id]} reservados` : it.category }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const changeOrigin = (v) => { setAllMats(false); setModal(p => ({ ...p, origin_id: v, destination_id: '', exceptional: false, exception_reason: '', lines: [{ item_id: '', qty: 1 }] })); };
  const toggleExceptional = (c) => setModal(p => ({ ...p, exceptional: c, exception_reason: c ? p.exception_reason : '', destination_id: !c && !regular.has(p.destination_id) ? '' : p.destination_id }));
  const originName = origin ? origin.name : ROSARIO;
  return (
    <Modal title="Enviar materiales" onClose={onClose} onSubmit={onSubmit} submitLabel="Registrar envío">
      <div className="form-grid">
        {(origins.length > 0 || !isStaff) && (
          <label>Sale desde *
            <select value={modal.origin_id} disabled={!isStaff && origins.length <= 1} onChange={e => changeOrigin(e.target.value)}>
              {isStaff && <option value="">{ROSARIO}</option>}
              {origins.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        )}
        <label>Destino *
          <select required value={modal.destination_id} onChange={e => set('destination_id', e.target.value)}>
            <option value="">Seleccionar</option>
            {depots.length > 0 && <optgroup label="Depósitos">{depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>}
            {dealers.length > 0 && <optgroup label="Concesionarios">{dealers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>}
            {others.length > 0 && <optgroup label="Otros destinos (excepcional)">{others.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>}
          </select>
        </label>
        <label>Quién lo recibe<input value={modal.recipient_name} onChange={e => set('recipient_name', e.target.value)} placeholder="Nombre de quién recibe" /></label>
      </div>
      {isStaff && (
        <div className="exception-box">
          <label className="check-inline"><input type="checkbox" checked={Boolean(modal.exceptional)} onChange={e => toggleExceptional(e.target.checked)} /> Envío excepcional (a un destino que no abastece {originName})</label>
          {modal.exceptional && (
            <label className="full-width">Motivo del envío excepcional *
              <input required value={modal.exception_reason || ''} onChange={e => set('exception_reason', e.target.value)} placeholder="Ej: el concesionario se quedó sin stock y Santa Fe no llega a tiempo" />
            </label>
          )}
        </div>
      )}
      <h3 className="sub">Materiales del envío</h3>
      {marcas.length > 0 && !allMats && <p className="muted small">Mostrando materiales de {marcas.join(', ')}, genéricos y Neostar. <button type="button" className="link-btn" onClick={() => setAllMats(true)}>Mostrar todos los materiales</button></p>}
      {marcas.length > 0 && allMats && <p className="muted small">Mostrando todos los materiales. <button type="button" className="link-btn" onClick={() => setAllMats(false)}>Mostrar solo los de {marcas.join(', ')}</button></p>}
      <LinesEditor lines={modal.lines} onChange={lines => set('lines', lines)} options={options} />
      <label className="full-width notes-label">Notas<input value={modal.notes} onChange={e => set('notes', e.target.value)} placeholder="Opcional" /></label>
      {chosenDest?.is_depot === false
        ? <p className="muted small">Concesionario: se descuenta de {originName} y queda registrado con la fecha de hoy y las cantidades. Es solo un registro: no necesita recepción.</p>
        : <p className="muted small">Se descuenta de {originName} ahora y queda «en camino». Cuando llegue, quien recibe controla cada material (✓ o ✗) y las cantidades se suman a su stock.{!origin ? ' Lo reservado para eventos no se puede enviar.' : ''}</p>}
    </Modal>
  );
}
function EventModal({ modal, setModal, items, availableOf, onClose, onSubmit }) {
  const set = (k, v) => setModal(p => ({ ...p, [k]: v }));
  const editing = Boolean(modal.editing);
  const scoped = (it, brand) => it.brand === brand || it.brand === 'Genérico' || it.brand === 'Neostar';
  const setBrand = (brand) => setModal(p => ({
    ...p, brand,
    lines: p.lines.map(l => {
      const it = items.find(x => x.id === l.item_id);
      return l.locked || (it && scoped(it, brand)) ? l : { item_id: '', qty: 1 };
    })
  }));
  const lockedIds = new Set(modal.lines.filter(l => l.locked).map(l => l.item_id));
  const pool = items.filter(i => lockedIds.has(i.id) || (modal.brand && scoped(i, modal.brand)));
  const options = pool.map(i => ({ id: i.id, label: itemLabel(i), search: itemSearch(i), avail: availableOf(i.id, modal.start_date, modal.end_date, modal.editing), note: i.category }));
  return (
    <Modal title={editing ? 'Editar evento' : 'Nuevo evento'} onClose={onClose} onSubmit={onSubmit} submitLabel={editing ? 'Guardar cambios' : 'Guardar evento'}>
      <div className="form-grid">
        <label className="full-width">Nombre del evento *<input required value={modal.event_name} onChange={e => set('event_name', e.target.value)} placeholder="Ej: Activación BYD Rosario" /></label>
        <label>Fecha de inicio *<input type="date" required value={modal.start_date} onChange={e => setModal(p => ({ ...p, start_date: e.target.value, end_date: p.end_date && p.end_date >= e.target.value ? p.end_date : e.target.value }))} /></label>
        <label>Fecha de fin *<input type="date" required min={modal.start_date || undefined} value={modal.end_date} onChange={e => set('end_date', e.target.value)} /></label>
        <label>Marca *<select required disabled={modal.anyDelivered} value={modal.brand} onChange={e => setBrand(e.target.value)}><option value="">Seleccionar</option>{BRANDS.map(b => <option key={b}>{b}</option>)}</select>
          {modal.anyDelivered && <small className="field-help">Ya se entregaron materiales: la marca no se puede cambiar.</small>}</label>
        <label>Responsable (opcional)<input value={modal.carried_by} onChange={e => set('carried_by', e.target.value)} placeholder="Quién se lleva los elementos" /></label>
      </div>
      <h3 className="sub">Elementos a llevar</h3>
      {!modal.brand && <p className="muted small">Elegí la marca y te muestro los elementos de esa marca, los genéricos y los de Neostar.</p>}
      {modal.brand && (
        <>
          <LinesEditor lines={modal.lines} onChange={lines => set('lines', lines)} options={options} rightLabel="Disponibles" addLabel="+ Agregar otro elemento" />
          <p className="muted small">El máximo de cada elemento toma en cuenta lo reservado por otros eventos que se pisan en fechas{editing ? ' (este evento no se cuenta contra sí mismo)' : ''}.</p>
        </>
      )}
      <label className="full-width notes-label">Notas<input value={modal.notes} onChange={e => set('notes', e.target.value)} placeholder="Opcional" /></label>
      <p className="muted small">{editing ? 'Lo que ya se entregó queda bloqueado; podés cambiar fechas, responsable, notas y lo que todavía está solo reservado.' : 'Guardar reserva los elementos para esas fechas: nadie más puede usarlos en otro evento que se pise. El stock sale del Depósito Rosario recién cuando tocás «Entregar materiales».'}</p>
    </Modal>
  );
}
function WithdrawEventModal({ modal, setModal, onClose, onSubmit }) {
  return (
    <Modal title="Entregar materiales del evento" onClose={onClose} onSubmit={onSubmit} submitLabel="Entregar y descontar stock">
      <p><strong>{modal.event.event_name}</strong></p>
      <label className="full-width notes-label">Quién retira los materiales *<input required value={modal.by} onChange={e => setModal(p => ({ ...p, by: e.target.value }))} placeholder="Nombre y apellido" /></label>
      <p className="muted small">Los elementos reservados salen ahora del Depósito Rosario. Después podés imprimir el retiro para que lo firmen.</p>
    </Modal>
  );
}

function ReturnEventModal({ modal, setModal, onClose, onSubmit }) {
  const setLine = (i, v) => setModal(p => ({ ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, qty_returned: v } : l)) }));
  return (
    <Modal title="Registrar regreso del evento" onClose={onClose} onSubmit={onSubmit} submitLabel="Confirmar regreso">
      <p className="muted small">Indicá cuánto volvió de cada elemento. Lo que vuelve se suma al Depósito Rosario.</p>
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
<p class="sub">Depósito Rosario · Nº ${esc(String(event.id).slice(0, 8).toUpperCase())} · Emitido el ${today}</p>
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
  useScrollLock();
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
    <Modal title={modal.parcial ? 'Recibir lo que faltaba' : 'Controlar y recibir el envío'} onClose={onClose} onSubmit={onSubmit} submitLabel="Confirmar recepción">
      <p className="muted small">Envío a <strong>{sh.destination_name}</strong> · {fmtDate(sh.created_at)} · enviado por {sh.created_by_name}. Marcá ✓ si el material llegó bien o ✗ si hay una diferencia.</p>
      <div className="check-lines">
        {modal.lines.map((l, i) => (
          <div key={l.movement_id} className={`check-line ${l.ok === true ? 'is-ok' : l.ok === false ? 'is-bad' : ''}`}>
            <div className="check-name"><strong>{l.name}</strong><small>{modal.parcial ? 'Falta que llegue' : 'Enviado'}: {l.qty}</small></div>
            <div className="check-btns">
              <button type="button" className={`check-btn yes ${l.ok === true ? 'on' : ''}`} onClick={() => setLine(i, { ok: true })} aria-label="Correcto">✓</button>
              <button type="button" className={`check-btn no ${l.ok === false ? 'on' : ''}`} onClick={() => setLine(i, { ok: false })} aria-label="Hay una diferencia">✗</button>
            </div>
            {l.ok === false && (
              <div className="check-extra">
                <label>Motivo *
                  <select value={l.reason} onChange={e => setLine(i, { reason: e.target.value })}>
                    <option value="">Elegí el motivo…</option>
                    {DIFF_REASONS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                  </select>
                </label>
                <label>{l.reason === 'de_mas' ? `Cantidad total que llegó (más de ${l.qty})` : `Cantidad que llegó bien (menos de ${l.qty})`} *
                  <input type="number" min="0" value={l.qty_received} onChange={e => setLine(i, { qty_received: e.target.value })} /></label>
                <label>Nota (opcional)<input value={l.note} onChange={e => setLine(i, { note: e.target.value })} placeholder="Ej: caja golpeada" /></label>
              </div>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="secondary-btn add-line-btn" onClick={allOk}>Marcar todo ✓</button>
      <label className="full-width notes-label">Observaciones generales (opcional)<textarea value={modal.notes} onChange={e => setModal(p => ({ ...p, notes: e.target.value }))} placeholder="Algo más que Marketing tenga que saber" /></label>
      {bad && <p className="warn small">Hay materiales con ✗: lo que llegó bien se suma ahora a tu stock y el envío queda «con diferencia – pendiente» con alerta en rojo hasta que Marketing lo resuelva.</p>}
    </Modal>
  );
}

function ResolveModal({ modal, setModal, onClose, onSubmit }) {
  const sh = modal.shipment;
  const setRow = (i, k, patch) => setModal(p => ({ ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, rows: l.rows.map((r, n) => (n === k ? { ...r, ...patch } : r)) } : l)) }));
  const addRow = (i) => setModal(p => ({ ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, rows: [...l.rows, { action: '', qty: 1, note: '' }] } : l)) }));
  const delRow = (i, k) => setModal(p => ({ ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, rows: l.rows.filter((_, n) => n !== k) } : l)) }));
  return (
    <Modal title="Resolver diferencia del envío" onClose={onClose} onSubmit={onSubmit} submitLabel="Guardar resolución">
      <p className="muted small">Envío a <strong>{sh.destination_name}</strong> · {fmtDate(sh.created_at)}. Elegí qué pasó con cada unidad de diferencia. Si pasó más de una cosa, dividí la cantidad. Cada resolución queda registrada en el Historial.</p>
      <div className="check-lines">
        {modal.lines.map((l, i) => {
          const used = l.rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);
          const org = sh.origin_name || ROSARIO;
          const opts = l.diff_reason === 'de_mas' ? resSobrante(org) : resOptions(org);
          return (
            <div key={l.movement_id} className="check-line is-bad">
              <div className="check-name"><strong>{l.name}</strong><small>Enviado {l.qty} · {DIFF_LABEL[l.diff_reason]} · {l.pending} sin explicar{used !== l.pending ? ` (asignadas ${used})` : ''}</small></div>
              {l.rows.map((r, k) => (
                <div key={k} className="check-extra">
                  <label>Qué pasó *
                    <select value={r.action} onChange={e => setRow(i, k, { action: e.target.value })}>
                      <option value="">Elegí…</option>
                      {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                    </select>
                  </label>
                  <label>Unidades<input type="number" min="1" max={l.pending} value={r.qty} onChange={e => setRow(i, k, { qty: e.target.value })} /></label>
                  <label>{r.action === 'perdida' ? 'Motivo de la pérdida *' : 'Nota (opcional)'}<input value={r.note} onChange={e => setRow(i, k, { note: e.target.value })} /></label>
                  {l.rows.length > 1 && <button type="button" className="link-btn danger" onClick={() => delRow(i, k)}>Quitar</button>}
                </div>
              ))}
              {l.diff_reason !== 'de_mas' && l.pending > 1 && <button type="button" className="link-btn" onClick={() => addRow(i)}>+ Dividir en otra opción</button>}
            </div>
          );
        })}
      </div>
      <p className="warn small">Lo que no explíques ahora sigue como diferencia pendiente. Si {sh.origin_name || ROSARIO} no tiene stock suficiente para descontar un sobrante, ajustá ese stock primero.</p>
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
        <label>Motivo *<select required value={modal.reason_type} onChange={e => set('reason_type', e.target.value)}><option value="">Elegí el motivo…</option>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {esIncidencia && <>
          <label>Apellido cliente *<input required value={modal.recipient_last_name} onChange={e => set('recipient_last_name', e.target.value)} /></label>
          <label>Patente *<input required value={modal.vehicle_plate} onChange={e => set('vehicle_plate', e.target.value.toUpperCase())} /></label>
        </>}
        <label className="full-width">A quién / para qué *<input required value={modal.reason_detail} onChange={e => set('reason_detail', e.target.value)} placeholder="Ej: entrega 0km a cliente, evento en concesionaria" /></label>
      </div>
    </Modal>
  );
}

function PointStockInModal({ modal, setModal, items, qtyOf, onClose, onSubmit }) {
  const set = (k, v) => setModal(p => ({ ...p, [k]: v }));
  const options = useMemo(() => items.map(i => ({ id: i.id, label: itemLabel(i), search: itemSearch(i), avail: qtyOf ? qtyOf(i.id) : undefined, note: i.category })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [items, modal.destination_id]);
  return (
    <Modal title="Cargar stock en este depósito" onClose={onClose} onSubmit={onSubmit} submitLabel="Cargar">
      <div className="form-grid">
        <label className="full-width">Material *<MaterialPicker options={options} value={modal.item_id} onChange={v => set('item_id', v)} rightLabel="Hay ahora" hideZero={false} required /></label>
        <label>Cantidad *<input type="number" min="1" required value={modal.qty} onChange={e => set('qty', e.target.value)} /></label>
        <label className="full-width">Motivo *<input required value={modal.notes} onChange={e => set('notes', e.target.value)} placeholder="Ej: stock inicial contado, compra propia del depósito" /></label>
      </div>
      <p className="warn small">NO uses esto para mercadería que mandó Rosario: eso se recibe desde «En camino» y, si la cargás acá además, queda contada dos veces. Solo para stock que ya estaba o que llegó por otra vía.</p>
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

function AdjustModal({ modal, setModal, willReview, onClose, onSubmit }) {
  const set = (k, v) => setModal(p => ({ ...p, [k]: v, ...(k === 'new_qty' ? { confirmLow: false } : {}) }));
  return (
    <Modal title="Ajustar stock" onClose={onClose} onSubmit={onSubmit} submitLabel={modal.confirmLow ? 'Sí, confirmar el ajuste' : 'Registrar ajuste'}>
      <p><strong>{modal.name}</strong> · {modal.place}</p>
      <p className="adjust-facts">Stock actual: <strong>{modal.current}</strong>{modal.isRosario && <> · Reservado para eventos: <strong>{modal.reserved || 0}</strong></>}</p>
      <div className="form-grid">
        <label>Stock real contado *<input type="number" min="0" required value={modal.new_qty} onChange={e => set('new_qty', e.target.value)} /></label>
        <label>Motivo *<input required value={modal.reason} onChange={e => set('reason', e.target.value)} placeholder="Ej: conteo físico, rotura, error de carga" /></label>
      </div>
      {modal.confirmLow && <p className="warn small" role="alert">Estás dejando el stock en {modal.new_qty}, por debajo de lo reservado para eventos ({modal.reserved}). Los eventos abiertos no van a poder entregar todo lo reservado. Si es correcto, tocá «Sí, confirmar el ajuste».</p>}
      {willReview && !modal.isRosario && <p className="muted small">Marketing va a revisar este ajuste.</p>}
      <p className="muted small">Queda registrado quién lo hizo, cuándo y de cuánto a cuánto.</p>
    </Modal>
  );
}

/* ---------------- Ronda 3: conteo físico, importación, ficha, vista general ---------------- */

function SegControl({ value, onChange, options }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  );
}

/* Conteo físico: se carga lo contado y se guarda todo junto con un solo motivo; solo quedan registradas las diferencias */
function CountModal({ modal, setModal, items, destStock, destinations, reserved, canPick, onClose, onSubmit }) {
  const set = (patch) => setModal(p => ({ ...p, ...patch }));
  const dest = modal.destination_id || '';
  const counts = modal.counts || {};
  const rows = useMemo(() => {
    const byId = Object.fromEntries(items.map(i => [i.id, i]));
    const list = !dest
      ? items.map(i => ({ id: i.id, label: itemLabel(i), cat: i.category, sys: i.stock_nucleo || 0, res: reserved?.[i.id] || 0 }))
      : destStock.filter(r => r.destination_id === dest && byId[r.item_id]).map(r => ({ id: r.item_id, label: itemLabel(byId[r.item_id]), cat: byId[r.item_id].category, sys: r.qty, res: 0 }));
    return list.sort((a, b) => a.label.localeCompare(b.label));
  }, [dest, items, destStock, reserved]);
  const toks = norm((modal.q || '').trim()).split(/\s+/).filter(Boolean);
  const visible = rows.filter(r => !toks.length || toks.every(t => norm(`${r.label} ${r.cat}`).includes(t)));
  const has = (r) => counts[r.id] !== undefined && counts[r.id] !== '';
  const nCounted = rows.filter(has).length;
  const nDiff = rows.filter(r => has(r) && Number(counts[r.id]) !== r.sys).length;
  const setCount = (id, v) => set({ counts: { ...counts, [id]: v }, confirmLow: false });
  const fillBlank = () => {
    const next = { ...counts };
    visible.forEach(r => { if (!has(r)) next[r.id] = String(r.sys); });
    set({ counts: next });
  };
  const depots = destinations.filter(d => d.is_depot);
  const dealers = destinations.filter(d => !d.is_depot);
  return (
    <Modal title="Conteo físico" wide onClose={onClose} onSubmit={onSubmit} submitLabel={nDiff ? `Guardar conteo (${nDiff} diferencia${nDiff === 1 ? '' : 's'})` : 'Guardar conteo'}>
      <p className="muted small">Contá lo que hay en el estante y cargalo en «Contado». Dejá en blanco lo que no contaste. Al guardar, solo se registran los materiales cuya cantidad cambió, todos con el mismo motivo. También sirve para cargar el stock definitivo.</p>
      <div className="form-grid">
        {canPick
          ? <label>Qué depósito contás
              <select value={dest} onChange={e => set({ destination_id: e.target.value, counts: {}, q: '', confirmLow: false })}>
                <option value="">{ROSARIO}</option>
                {depots.length > 0 && <optgroup label="Depósitos">{depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>}
                {dealers.length > 0 && <optgroup label="Concesionarios">{dealers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>}
              </select></label>
          : <p className="full-width"><strong>{destinations.find(d => d.id === dest)?.name || 'Mi depósito'}</strong></p>}
        <label>Motivo del conteo *<input required value={modal.reason || ''} onChange={e => set({ reason: e.target.value })} placeholder="Ej: conteo mensual, carga del stock definitivo" /></label>
        <label className="full-width">Buscar material<input value={modal.q || ''} onChange={e => set({ q: e.target.value })} placeholder="Nombre, marca o categoría…" /></label>
      </div>
      <div className="count-tools">
        <button type="button" className="secondary-btn small-btn" onClick={fillBlank}>Completar lo que no toqué con lo que dice el sistema</button>
        <span className="muted small">{nCounted} de {rows.length} contados · {nDiff} con diferencia</span>
      </div>
      <div className="table-scroll">
        <table className="count-table">
          <thead><tr><th>Material</th><th>Sistema</th><th>Contado</th><th>Diferencia</th></tr></thead>
          <tbody>
            {visible.slice(0, 400).map(r => {
              const d = has(r) ? Number(counts[r.id]) - r.sys : null;
              const low = !dest && has(r) && r.res > 0 && Number(counts[r.id]) < r.res;
              return (
                <tr key={r.id}>
                  <td><strong>{r.label}</strong><small>{r.cat}{r.res > 0 ? ` · reservado para eventos: ${r.res}` : ''}</small></td>
                  <td>{r.sys}</td>
                  <td><input type="number" min="0" step="1" aria-label={`Contado de ${r.label}`} value={counts[r.id] ?? ''} onChange={e => setCount(r.id, e.target.value)} /></td>
                  <td className={d == null || d === 0 ? '' : d > 0 ? 'ok' : 'warn'}>{d == null ? '—' : d === 0 ? '=' : (d > 0 ? `+${d}` : `−${Math.abs(d)}`)}{low && <small className="warn">menos que lo reservado</small>}</td>
                </tr>
              );
            })}
            {!visible.length && <tr><td colSpan="4" className="muted">{rows.length ? 'Ningún material coincide con la búsqueda.' : (dest ? 'Este depósito todavía no tiene stock registrado. Cargalo con «+ Cargar stock» en Depósitos y puntos o con «Importar planilla».' : 'No hay materiales.')}</td></tr>}
          </tbody>
        </table>
      </div>
      {visible.length > 400 && <p className="muted small">Se muestran 400 de {visible.length}: buscá para ver el resto.</p>}
      {modal.confirmLow && <p className="warn small">Algunas cantidades quedan por debajo de lo reservado para eventos. Si es correcto, tocá «Guardar conteo» otra vez para confirmar.</p>}
    </Modal>
  );
}

/* Importar materiales desde una planilla guardada como CSV */
const IMPORT_HEADERS = ['Material', 'Categoría', 'Marca', 'Depósito', 'Cantidad', 'Mínimo'];
const IMPORT_COLS = { name: ['material', 'nombre', 'producto'], category: ['categoria'], brand: ['marca'], destination: ['deposito', 'ubicacion', 'destino'], qty: ['cantidad', 'stock', 'unidades'], min: ['minimo', 'min', 'stock minimo'] };
function ImportModal({ categories, destinations, items, onClose, onSubmit }) {
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [fileErr, setFileErr] = useState('');
  const catByNorm = useMemo(() => Object.fromEntries(categories.map(c => [norm(c.name), c.name])), [categories]);
  const brandByNorm = useMemo(() => Object.fromEntries(['Genérico', ...BRANDS].map(b => [norm(b), b])), []);
  const depots = destinations.filter(d => d.is_depot);
  const existing = useMemo(() => new Set(items.map(i => `${norm(i.name.trim())}|${i.brand || 'Genérico'}`)), [items]);
  const isRosario = (t) => ['', 'rosario', 'deposito rosario', 'deposito marketing rosario'].includes(norm(t.trim()));

  const template = () => downloadCsv('plantilla-materiales.csv', IMPORT_HEADERS, [['BORRAR ESTA FILA (ejemplo)', '(una categoría de la lista)', 'Kia', 'Rosario', '100', '20']]);
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    setRows([]); setFileErr(''); setFileName(f ? f.name : '');
    if (!f) return;
    if (!/\.csv$|\.txt$/i.test(f.name)) { setFileErr('Guardá la planilla desde Excel como «CSV (delimitado por comas)» y subí ese archivo.'); return; }
    if (f.size > 1024 * 1024) { setFileErr('El archivo es muy grande (máximo 1 MB).'); return; }
    const table = parseCsv(await f.text());
    if (table.length < 2) { setFileErr('La planilla no tiene filas de datos.'); return; }
    const head = table[0].map(h => norm(h.trim()));
    const col = {};
    Object.entries(IMPORT_COLS).forEach(([k, names]) => { col[k] = head.findIndex(h => names.includes(h)); });
    if (col.name < 0 || col.category < 0) { setFileErr('Faltan las columnas «Material» y «Categoría». Bajá la plantilla para ver el formato.'); return; }
    const data = table.slice(1);
    if (data.length > 500) { setFileErr('Importá de a 500 filas como máximo (el archivo tiene ' + data.length + ').'); return; }
    const seen = new Set();
    setRows(data.map((r, i) => {
      const get = (k) => (col[k] >= 0 ? (r[col[k]] || '').trim() : '');
      const o = { line: i + 2, name: get('name'), catRaw: get('category'), brandRaw: get('brand'), destRaw: get('destination'), qtyRaw: get('qty'), minRaw: get('min'), errors: [], notes: [] };
      if (!o.name) o.errors.push('falta el material');
      o.category = catByNorm[norm(o.catRaw)];
      if (!o.category) o.errors.push(`categoría «${o.catRaw || 'vacía'}» no existe`);
      o.brand = o.brandRaw ? brandByNorm[norm(o.brandRaw)] : 'Genérico';
      if (!o.brand) o.errors.push(`marca «${o.brandRaw}» no válida`);
      const num = (t) => (t === '' ? 0 : /^\d+$/.test(t) ? Number(t) : NaN);
      o.qty = num(o.qtyRaw); o.min = num(o.minRaw);
      if (Number.isNaN(o.qty)) o.errors.push('cantidad inválida');
      if (Number.isNaN(o.min)) o.errors.push('mínimo inválido');
      if (isRosario(o.destRaw)) o.dest = '';
      else {
        const hit = depots.filter(d => norm(d.name).includes(norm(o.destRaw.trim())));
        if (hit.length === 1) o.dest = hit[0].id; else o.errors.push(`depósito «${o.destRaw}» no se reconoce`);
        o.destName = hit.length === 1 ? hit[0].name : '';
      }
      const key = `${norm(o.name)}|${o.brand}|${o.dest ?? '?'}`;
      if (seen.has(key)) o.notes.push('repetida en la planilla: se omite'); seen.add(key);
      if (o.dest === '' && o.brand && existing.has(`${norm(o.name)}|${o.brand}`)) o.notes.push('ya existe: no se cambia su stock');
      return o;
    }));
  };
  const nErr = rows.filter(r => r.errors.length).length;
  const submit = (e) => {
    e.preventDefault();
    if (!rows.length || nErr) return;
    onSubmit(rows.map(r => ({ name: r.name, category: r.category, brand: r.brand, destination: r.dest === '' ? 'Rosario' : r.destName, destination_id: r.dest || null, qty: r.qty, min: r.min })));
  };
  return (
    <Modal title="Importar materiales desde planilla" wide onClose={onClose} onSubmit={submit} submitLabel={rows.length && !nErr ? `Importar ${rows.length} fila(s)` : 'Importar'}>
      <ol className="import-steps">
        <li><button type="button" className="secondary-btn small-btn" onClick={template}>Bajar plantilla</button> y completala en Excel: Material, Categoría, Marca, Depósito (Rosario, Santa Fe o Cañada), Cantidad y Mínimo. Borrá la fila de ejemplo.</li>
        <li>Guardala como <strong>CSV (delimitado por comas)</strong> y subila acá: <input type="file" accept=".csv,.txt,text/csv" onChange={onFile} /></li>
        <li>Revisá la vista previa. Si todo está bien, tocá «Importar».</li>
      </ol>
      <p className="muted small">Categorías válidas: {categories.map(c => c.name).join(', ')}. Marcas: Genérico, {BRANDS.join(', ')}. Importar solo <strong>crea</strong> materiales y carga stock inicial: lo que ya existe no se pisa, así que importar dos veces no duplica stock.</p>
      {fileErr && <p className="warn">{fileErr}</p>}
      {rows.length > 0 && (
        <>
          <p><strong>{fileName}</strong>: {rows.length} fila(s){nErr ? ` · ${nErr} con errores (corregilas en la planilla y volvé a subirla)` : ' · sin errores'}</p>
          <div className="table-scroll">
            <table className="count-table">
              <thead><tr><th>Fila</th><th>Material</th><th>Categoría</th><th>Marca</th><th>Depósito</th><th>Cant.</th><th>Mín.</th><th>Estado</th></tr></thead>
              <tbody>
                {rows.slice(0, 200).map(r => (
                  <tr key={r.line} className={r.errors.length ? 'row-bad' : ''}>
                    <td>{r.line}</td><td>{r.name}</td><td>{r.category || r.catRaw}</td><td>{r.brand || r.brandRaw}</td>
                    <td>{r.dest === '' ? ROSARIO : (r.destName || r.destRaw)}</td><td>{Number.isNaN(r.qty) ? r.qtyRaw : r.qty}</td><td>{Number.isNaN(r.min) ? r.minRaw : r.min}</td>
                    <td>{r.errors.length ? <span className="warn">{r.errors.join('; ')}</span> : r.notes.length ? <span className="muted">{r.notes.join('; ')}</span> : <span className="ok">OK</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 200 && <p className="muted small">Se muestran 200 de {rows.length} filas (se importan todas).</p>}
        </>
      )}
    </Modal>
  );
}

/* Ficha del material: stock en cada lugar, lo reservado para eventos, últimos movimientos y fotos */
function ItemSheet({ item, reserved, destStock, destinations, openEvents, history, isStaff, onEdit, onAdjust, onDelete, onPhotos, onClose }) {
  const res = reserved?.[item.id] || 0;
  const where = destStock.filter(r => r.item_id === item.id && r.qty > 0).map(r => ({ ...r, dest: destinations.find(d => d.id === r.destination_id) })).filter(r => r.dest)
    .sort((a, b) => (b.dest.is_depot ? 1 : 0) - (a.dest.is_depot ? 1 : 0) || a.dest.name.localeCompare(b.dest.name));
  const total = (item.stock_nucleo || 0) + where.reduce((a, r) => a + r.qty, 0);
  const act = (fn) => () => fn(item);
  return (
    <Modal title={item.name} wide onClose={onClose} onSubmit={(e) => e.preventDefault()} hideSubmit cancelLabel="Cerrar"
      extraActions={isStaff ? <>
        <button type="button" className="secondary-btn" onClick={act(onEdit)}>Editar</button>
        <button type="button" className="secondary-btn" onClick={act(onAdjust)}>Ajustar stock</button>
        <button type="button" className="secondary-btn danger-btn" onClick={act(onDelete)}>Eliminar o archivar</button>
      </> : null}>
      <p className="muted">{item.brand || 'Genérico'} · {item.category} · {item.kind === 'equipamiento' ? 'Equipamiento (se presta y vuelve)' : 'Consumible'}</p>
      {item.photo_urls?.length > 0 && (
        <div className="sheet-photos">
          {item.photo_urls.slice(0, 4).map(u => <button type="button" key={u} className="thumb-btn" onClick={() => onPhotos(item)} title="Ver fotos"><Thumb url={u} alt={item.name} /></button>)}
        </div>
      )}
      <div className="sheet-tiles">
        <div><strong>{item.stock_nucleo || 0}</strong><span>En {ROSARIO}</span></div>
        <div><strong>{res}</strong><span>Reservado para eventos</span></div>
        <div><strong>{Math.max(0, (item.stock_nucleo || 0) - res)}</strong><span>Disponible hoy</span></div>
        <div><strong>{total}</strong><span>Total en todos lados</span></div>
      </div>
      <h3 className="sub">Stock en depósitos y concesionarios</h3>
      {where.length ? (
        <table><thead><tr><th>Lugar</th><th>Cantidad</th></tr></thead>
          <tbody>{where.map(r => <tr key={r.destination_id}><td>{r.dest.name}</td><td>{r.qty}</td></tr>)}</tbody></table>
      ) : <p className="muted small">No hay unidades en depósitos ni concesionarios.</p>}
      {openEvents.length > 0 && (
        <>
          <h3 className="sub">Reservado para eventos</h3>
          <table><thead><tr><th>Evento</th><th>Fechas</th><th>Cantidad</th></tr></thead>
            <tbody>{openEvents.map(x => <tr key={x.id}><td>{x.ev.event_name}</td><td>{fmtRange(x.ev)}</td><td>{x.qty_allocated}</td></tr>)}</tbody></table>
        </>
      )}
      <h3 className="sub">Últimos movimientos</h3>
      {history.length ? (
        <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Cant.</th><th>Detalle</th></tr></thead>
          <tbody>{history.map(h => <tr key={h.id}><td>{fmtDate(h.at)}</td><td>{h.tipo}</td><td>{h.qty}</td><td>{h.detalle || '—'}</td></tr>)}</tbody></table>
      ) : <p className="muted small">Todavía no tiene movimientos.</p>}
    </Modal>
  );
}

/* Vista general: una tarjeta por lugar y una tabla de materiales × depósitos */
function OverviewView({ destinations, destStock, items, pointStatus, shipments, onOpen, toggle }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('Todas');
  const [onlyStock, setOnlyStock] = useState(true);
  const depots = destinations.filter(d => d.is_depot && d.active !== false);
  const dealers = destinations.filter(d => !d.is_depot && d.active !== false);
  const cards = [...depots, ...dealers].map(d => {
    const rs = destStock.filter(r => r.destination_id === d.id && r.qty > 0);
    const last = shipments.filter(x => x.destination_id === d.id).map(x => x.created_at).sort().pop();
    const alerts = d.is_depot ? pointStatus.filter(p => p.destination_id === d.id && p.status !== 'ok').length : 0;
    return { d, mats: rs.length, units: rs.reduce((a, r) => a + r.qty, 0), alerts, last };
  });
  const dealerIds = new Set(dealers.map(d => d.id));
  const cats = [...new Set(items.map(i => i.category))].sort();
  const toks = norm(q.trim()).split(/\s+/).filter(Boolean);
  const rows = items.map(i => {
    const by = Object.fromEntries(depots.map(d => [d.id, 0]));
    let dl = 0;
    destStock.filter(r => r.item_id === i.id).forEach(r => { if (r.destination_id in by) by[r.destination_id] += r.qty; else if (dealerIds.has(r.destination_id)) dl += r.qty; });
    const total = (i.stock_nucleo || 0) + Object.values(by).reduce((a, b) => a + b, 0) + dl;
    return { i, by, dl, total };
  }).filter(r => (!onlyStock || r.total > 0) && (cat === 'Todas' || r.i.category === cat) && (!toks.length || toks.every(t => norm(`${r.i.name} ${r.i.brand || ''}`).includes(t))))
    .sort((a, b) => norm(a.i.name).localeCompare(norm(b.i.name)) || String(a.i.brand).localeCompare(String(b.i.brand)));
  return (
    <>
      <section className="card" style={{ marginBottom: 18 }}>{toggle}</section>
      <section className="card" style={{ marginBottom: 18 }}>
        <h2>Resumen por lugar</h2>
        <div className="overview-cards">
          {cards.map(({ d, mats, units, alerts, last }) => (
            <button type="button" key={d.id} className="overview-card" onClick={() => onOpen(d.id)}>
              <strong>{d.name}</strong>
              <span>{mats} material(es) · {units} unidades</span>
              <span className={alerts ? 'warn' : 'muted'}>{d.is_depot ? (alerts ? `${alerts} para reponer` : 'Sin alertas') : 'Concesionario'}</span>
              <small>{last ? `Último envío: ${fmtDate(last)}` : 'Sin envíos'}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>Materiales × depósitos</h2>
        <div className="filters-row">
          <label className="filter-label">Buscar<input value={q} onChange={e => setQ(e.target.value)} placeholder="Nombre o marca…" /></label>
          <label className="filter-label">Categoría<select value={cat} onChange={e => setCat(e.target.value)}><option>Todas</option>{cats.map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="check-filter"><input type="checkbox" checked={onlyStock} onChange={e => setOnlyStock(e.target.checked)} /> Solo con stock</label>
        </div>
        <div className="table-scroll">
          <table className="matrix">
            <thead><tr><th>Material</th><th>{ROSARIO}</th>{depots.map(d => <th key={d.id}>{d.name}</th>)}<th>Concesionarios</th><th>Total</th></tr></thead>
            <tbody>
              {rows.slice(0, 300).map(({ i, by, dl, total }) => (
                <tr key={i.id}>
                  <td><strong>{i.name}</strong><small>{i.brand && i.brand !== 'Genérico' ? i.brand : ''}</small></td>
                  <td>{i.stock_nucleo || 0}</td>
                  {depots.map(d => <td key={d.id}>{by[d.id] || 0}</td>)}
                  <td>{dl}</td><td><strong>{total}</strong></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={depots.length + 4} className="muted">Ningún material coincide.</td></tr>}
            </tbody>
          </table>
        </div>
        {rows.length > 300 && <p className="muted small">Se muestran 300 de {rows.length}: buscá para ver el resto.</p>}
      </section>
    </>
  );
}
