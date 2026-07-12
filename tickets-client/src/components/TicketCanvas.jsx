import { useMemo, useRef } from 'react';
import { encodeCode39, sanitizeCode39 } from '../lib/code39.js';
import { fillText, allPlaceholdersEmpty } from '../lib/template.js';

/**
 * Renders a ticket template. With `editable`, elements can be selected,
 * dragged, rotated (handle above the selection), and resized (handle at the
 * bottom-right corner); changes flow back through onChange(updaterFn).
 */
export default function TicketCanvas({ template, data, editable = false, selectedId, onSelect, onChange, snap = false, className = '' }) {
  const nodeRefs = useRef({});

  function patchElement(id, patch) {
    onChange(t => ({
      ...t,
      elements: t.elements.map(el => (el.id === id ? { ...el, ...patch } : el)),
    }));
  }

  const snapTo = v => (snap ? Math.round(v / 4) * 4 : Math.round(v));

  function startDrag(e, el) {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(el.id);
    const sx = e.clientX, sy = e.clientY, ox = el.x, oy = el.y;
    const move = ev => patchElement(el.id, {
      x: snapTo(ox + ev.clientX - sx),
      y: snapTo(oy + ev.clientY - sy),
    });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Corner handle: pointer deltas are inverse-rotated into the element's own
  // axes so resizing behaves naturally even when the element is rotated.
  function startResize(e, el) {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const rad = ((el.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const orig = { w: el.w, h: el.h, fontSize: el.fontSize };
    const move = ev => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      const ldx = dx * cos + dy * sin;
      const ldy = -dx * sin + dy * cos;
      if (el.type === 'text') {
        const fontSize = Math.min(120, Math.max(5, Math.round(orig.fontSize + (ldx + ldy) / 4)));
        patchElement(el.id, { fontSize });
      } else if (el.type === 'line') {
        patchElement(el.id, {
          w: Math.max(8, snapTo(orig.w + ldx)),
          h: Math.min(24, Math.max(1, Math.round(orig.h + ldy))),
        });
      } else {
        patchElement(el.id, {
          w: Math.max(16, snapTo(orig.w + ldx)),
          h: Math.max(12, snapTo(orig.h + ldy)),
        });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startRotate(e, el) {
    e.preventDefault();
    e.stopPropagation();
    const node = nodeRefs.current[el.id];
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const move = ev => {
      let deg = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90;
      deg = ((Math.round(deg) % 360) + 360) % 360;
      // Snap to the compass points when close — that's what people want 95% of the time
      for (const snap of [0, 90, 180, 270, 360]) {
        if (Math.abs(deg - snap) <= 5) { deg = snap % 360; break; }
      }
      patchElement(el.id, { rotation: deg });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div
      className={`relative bg-white border border-gray-300 rounded-xl overflow-hidden ${className}`}
      style={{
        width: template.width,
        height: template.height,
        background: template.bg || '#fff',
        // Faint dot grid in the designer only — never printed
        backgroundImage: editable
          ? 'radial-gradient(circle, rgba(148,163,184,0.35) 1px, transparent 1px)'
          : undefined,
        backgroundSize: editable ? '16px 16px' : undefined,
      }}
      onPointerDown={() => editable && onSelect(null)}
    >
      {template.elements.map(el => {
        const content = renderContent(el, data, editable);
        if (content === null) return null;
        const selected = editable && selectedId === el.id;
        return (
          <div
            key={el.id}
            ref={n => { nodeRefs.current[el.id] = n; }}
            onPointerDown={e => startDrag(e, el)}
            className="absolute"
            style={{
              left: el.x,
              top: el.y,
              transform: `rotate(${el.rotation || 0}deg)`,
              transformOrigin: 'center center',
              cursor: editable ? 'move' : undefined,
              outline: selected ? '1.5px solid #e11d48' : (editable ? '1px dashed transparent' : undefined),
              outlineOffset: 3,
              userSelect: 'none',
              touchAction: 'none',
            }}
          >
            {content}
            {selected && (
              <>
                <div
                  className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center"
                  style={{ top: -26, transformOrigin: 'bottom center' }}
                >
                  <div
                    onPointerDown={e => startRotate(e, el)}
                    title="Drag to rotate"
                    className="w-4 h-4 rounded-full bg-white border-2 border-tix shadow cursor-grab active:cursor-grabbing"
                  />
                  <div className="w-px h-2 bg-tix" />
                </div>
                <div
                  onPointerDown={e => startResize(e, el)}
                  title={el.type === 'text' ? 'Drag to scale text' : 'Drag to resize'}
                  className="absolute w-3.5 h-3.5 bg-white border-2 border-tix rounded-[3px] shadow cursor-nwse-resize"
                  style={{ right: -8, bottom: -8 }}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function renderContent(el, data, editable) {
  switch (el.type) {
    case 'text': {
      const filled = fillText(el.text, data);
      if (!editable && (!filled.trim() || allPlaceholdersEmpty(el.text, data))) return null;
      return (
        <span
          style={{
            display: 'block',
            fontSize: el.fontSize,
            fontWeight: el.bold ? 700 : 400,
            color: el.color,
            letterSpacing: `${el.tracking || 0}px`,
            fontFamily: el.mono ? 'ui-monospace, monospace' : undefined,
            whiteSpace: 'pre',
            lineHeight: 1.25,
            // In the designer an empty binding still needs something to grab
            opacity: editable && !filled.trim() ? 0.35 : 1,
          }}
        >
          {filled.trim() ? filled : (editable ? el.text || '(empty)' : '')}
        </span>
      );
    }
    case 'barcode':
      return <BarcodeBlock el={el} data={data} editable={editable} />;
    case 'line':
      return (
        <div
          style={{
            width: el.w,
            height: el.h,
            background: el.dashed ? undefined : el.color,
            backgroundImage: el.dashed
              ? `repeating-linear-gradient(90deg, ${el.color} 0 6px, transparent 6px 12px)`
              : undefined,
          }}
        />
      );
    case 'box':
      return (
        <div
          style={{
            width: el.w,
            height: el.h,
            border: `${el.border}px ${el.dashed ? 'dashed' : 'solid'} ${el.color}`,
            borderRadius: el.radius,
            background: el.fill || 'transparent',
          }}
        />
      );
    case 'image':
      if (!el.src) {
        if (!editable) return null;
        return (
          <div
            className="flex items-center justify-center border-2 border-dashed border-gray-300 rounded text-[9px] text-gray-400 uppercase tracking-widest text-center px-1"
            style={{ width: el.w, height: el.h }}
          >
            Image — upload below
          </div>
        );
      }
      return (
        <img
          src={el.src}
          alt=""
          draggable={false}
          style={{ width: el.w, height: el.h, objectFit: 'contain', pointerEvents: 'none' }}
        />
      );
    default:
      return null;
  }
}

function BarcodeBlock({ el, data, editable }) {
  const value = sanitizeCode39(fillText(el.value, data));
  const textH = el.showText ? 16 : 0;
  const { bars, totalWidth } = useMemo(
    () => (value ? encodeCode39(value) : { bars: [], totalWidth: 1 }),
    [value]
  );

  if (!value) {
    if (!editable) return null;
    return (
      <div
        className="flex items-center justify-center border-2 border-dashed border-gray-300 rounded text-[10px] text-gray-400 uppercase tracking-widest"
        style={{ width: el.w, height: el.h }}
      >
        Barcode · {el.value || '{barcode}'}
      </div>
    );
  }

  return (
    <div style={{ width: el.w, height: el.h }}>
      {/* Horizontal stretch keeps wide/narrow ratios intact — all a scanner reads */}
      <svg
        viewBox={`0 0 ${totalWidth} 100`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: el.h - textH, display: 'block' }}
        role="img"
        aria-label={`Code 39 barcode: ${value}`}
      >
        {bars.map((b, i) => (
          <rect key={i} x={b.x} y="0" width={b.width} height="100" fill="#000" shapeRendering="crispEdges" />
        ))}
      </svg>
      {el.showText && (
        <p
          className="font-mono text-center text-gray-800"
          style={{ fontSize: 10, letterSpacing: 3, lineHeight: `${textH}px`, margin: 0 }}
        >
          {value}
        </p>
      )}
    </div>
  );
}
