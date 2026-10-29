import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

/* Estado de interfaz compartido: mientras corre una operación (busy) los botones se bloquean,
   y los errores se muestran DENTRO de la ventana abierta (antes quedaban detrás de la ventana). */
export const UiCtx = createContext({ busy: false, error: '' });

export const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* Bloquea el scroll de la página mientras hay una ventana abierta */
export function useScrollLock() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
}

export function Modal({ title, onClose, onSubmit, submitLabel, children, wide = false, extraActions = null, hideSubmit = false, cancelLabel = 'Cancelar' }) {
  const { busy, error } = useContext(UiCtx);
  const formRef = useRef(null);
  const errRef = useRef(null);
  useScrollLock();
  useEffect(() => {
    const el = formRef.current?.querySelector('input:not([type=hidden]):not([disabled]):not(.picker-req), select:not([disabled]), textarea:not([disabled])');
    if (el) el.focus({ preventScroll: true });
  }, []);
  useEffect(() => { if (error && errRef.current) errRef.current.scrollIntoView({ block: 'nearest' }); }, [error]);
  const submit = (e) => { if (busy) { e.preventDefault(); return; } onSubmit(e); };
  return (
    <div className="modal-overlay">
      <form className={`modal${wide ? ' modal-wide' : ''}`} onSubmit={submit} ref={formRef}>
        <div className="card-head"><h2>{title}</h2><button type="button" className="close-btn" onClick={onClose} aria-label="Cerrar">×</button></div>
        {error && <div className="error-banner modal-error" role="alert" ref={errRef}>{error}</div>}
        {children}
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onClose}>{cancelLabel}</button>
          {extraActions}
          {!hideSubmit && <button type="submit" className="primary-btn" disabled={busy}>{busy ? 'Guardando…' : submitLabel}</button>}
        </div>
      </form>
    </div>
  );
}

/* Selector único de material: un solo campo con búsqueda (nombre, SKU o marca, sin importar acentos ni mayúsculas),
   manejable con teclado (↑ ↓ Enter Esc). options: [{ id, label, search, avail?, note? }] */
export function MaterialPicker({ options, value, onChange, excludeIds, rightLabel = 'Disponible', hideZero = true, required = false, placeholder = 'Buscar por nombre o marca…', ariaLabel = 'Material' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [showZero, setShowZero] = useState(false);
  const wrap = useRef(null);
  const listRef = useRef(null);
  const selected = options.find(o => o.id === value);
  const tokens = norm(q.trim()).split(/\s+/).filter(Boolean);
  const isZero = (o) => hideZero && o.avail != null && o.avail <= 0;
  const visible = useMemo(() => options.filter(o => {
    if (o.id === value) return true;
    if (excludeIds && excludeIds.has(o.id)) return false;
    if (tokens.length) { const hay = norm(o.search || o.label); if (!tokens.every(t => hay.includes(t))) return false; }
    if (isZero(o) && !showZero) return false;
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [options, value, excludeIds, q, showZero, hideZero]);
  const hiddenZero = useMemo(() => (hideZero && !showZero ? options.filter(o => isZero(o) && o.id !== value && !(excludeIds && excludeIds.has(o.id)) && (!tokens.length || tokens.every(t => norm(o.search || o.label).includes(t)))).length : 0),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [options, value, excludeIds, q, showZero, hideZero]);
  const shown = visible.slice(0, 60);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useEffect(() => { setHi(0); }, [q, showZero]);
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[hi];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const choose = (o) => {
    if (!o || (isZero(o) && o.id !== value)) return;
    onChange(o.id); setOpen(false); setQ('');
  };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setHi(h => Math.min(h + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (open) setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { if (open) { e.preventDefault(); choose(shown[hi]); } }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setQ(''); } }
    else if (e.key === 'Tab') { setOpen(false); setQ(''); }
  };
  const listId = useRef(`pk-${Math.random().toString(36).slice(2, 8)}`).current;
  return (
    <div className="picker" ref={wrap}>
      <div className="picker-box">
        <input
          type="text" role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && shown[hi] ? `${listId}-${hi}` : undefined}
          autoComplete="off" value={open ? q : (selected ? selected.label : '')}
          placeholder={selected ? selected.label : placeholder}
          onClick={() => setOpen(true)}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
        />
        {value && !open && <button type="button" className="picker-clear" aria-label="Quitar selección" onClick={() => onChange('')}>×</button>}
      </div>
      {required && <input className="picker-req" tabIndex={-1} aria-hidden="true" required value={value || ''} onChange={() => {}} />}
      {open && (
        <ul className="picker-list" id={listId} role="listbox" ref={listRef}>
          {shown.map((o, i) => (
            <li key={o.id} id={`${listId}-${i}`} role="option" aria-selected={o.id === value}
              className={`${i === hi ? 'hi' : ''}${isZero(o) ? ' zero' : ''}${o.id === value ? ' sel' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }} onMouseEnter={() => setHi(i)}>
              <span className="opt-name">{o.label}{o.note ? <small>{o.note}</small> : null}</span>
              {o.avail != null && <span className="opt-qty">{isZero(o) ? 'Sin stock' : `${rightLabel}: ${o.avail}`}</span>}
            </li>
          ))}
          {!shown.length && <li className="empty" role="option" aria-selected="false">{hiddenZero ? 'Solo hay materiales sin stock con esa búsqueda' : 'Sin resultados'}</li>}
          {visible.length > shown.length && <li className="empty" aria-hidden="true">Seguí escribiendo para ver más ({visible.length - shown.length} más)</li>}
          {hiddenZero > 0 && (
            <li className="foot" role="presentation" onMouseDown={(e) => { e.preventDefault(); setShowZero(true); }}>
              <button type="button" className="link-btn" tabIndex={-1}>Mostrar sin stock ({hiddenZero})</button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/* Achica la foto antes de subirla: lado mayor 1600 px, JPEG calidad 0,8, máximo 5 MB */
export async function compressImage(file, max = 1600, quality = 0.8) {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type || '')) throw new Error(`«${file.name}»: formato no soportado, subí JPG, PNG o WebP`);
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error(`«${file.name}»: no se pudo leer la imagen`); }
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error(`«${file.name}»: no se pudo procesar la imagen`);
  if (blob.size > 5 * 1024 * 1024) throw new Error(`«${file.name}» sigue pesando más de 5 MB; probá con una foto más chica`);
  return blob;
}

/* Exporta a CSV para Excel en español: separador «;», UTF-8 con BOM */
export function downloadCsv(filename, header, rows) {
  const cell = (v) => {
    let s = String(v ?? '').replace(/\r?\n/g, ' ');
    if (/^[=+\-@\t]/.test(s) && Number.isNaN(Number(s.replace(',', '.')))) s = `'${s}`;
    return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = `﻿${[header, ...rows].map(r => r.map(cell).join(';')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* Lee un CSV exportado desde Excel (separador «;» o «,», comillas, UTF-8 con o sin BOM). Devuelve filas de celdas. */
export function parseCsv(text) {
  const t = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = t.split(/\r?\n/).find(l => l.trim() !== '') || '';
  const delim = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows.map(r => r.map(x => x.trim()));
}
