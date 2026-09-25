// A spotlight on a live control: the window dims except for a cutout around
// the anchor, and a small card sits beside it. Adapted from OpenMausBot's
// Spotlight (Apache-2.0, github.com/milind-soni/OpenMausBot,
// src/components/onboarding/Spotlight.tsx), rewritten with plain CSS.
//
// The anchor is found by its `data-tour` id, never a class name, so a
// refactor cannot silently break the tour. The dim layer takes no pointer
// events: the user can still press the lit control. When the anchor changes,
// the component stays mounted and the cutout and card slide to the new one.
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Placement } from '../onboarding';

const PAD = 8;
const CARD_W = 320;
const GAP = 12;
/** The ring's 2px outline plus its 6px halo (.spot-ring box-shadow). */
const EDGE = 8;

type Rect = { x: number; y: number; w: number; h: number };

function measure(anchor: string): Rect | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`)).filter((el) => el.getClientRects().length > 0);
  const el = all[all.length - 1];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0 || r.right <= 0 || r.left >= window.innerWidth || r.bottom <= 0 || r.top >= window.innerHeight) return null;
  // Keep the ring and its halo inside the window: a control in a corner would otherwise lose part of its outline.
  const x = Math.max(EDGE, r.left - PAD);
  const y = Math.max(EDGE, r.top - PAD);
  return { x, y, w: Math.min(window.innerWidth - EDGE, r.right + PAD) - x, h: Math.min(window.innerHeight - EDGE, r.bottom + PAD) - y };
}

/** The whole viewport minus the anchor's rectangle, as an even-odd polygon. */
function cutout(r: Rect | null): string {
  if (!r) return 'polygon(0 0, 100% 0, 100% 100%, 0 100%)';
  const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x1}px ${y1}px, ${x1}px ${y2}px, ${x2}px ${y2}px, ${x2}px ${y1}px, ${x1}px ${y1}px)`;
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

interface Action { label: string; onClick: () => void; }

export default function Spotlight({ anchor, placement, children, progress, primary, secondary, onDone }: {
  anchor: string | null;
  placement: Placement;
  children: ReactNode;
  progress?: string;
  primary: Action;
  secondary?: Action;
  /** Escape. */
  onDone: () => void;
}) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [settled, setSettled] = useState(false);

  // Follow the anchor through layout, scroll, resize and DOM changes. A new
  // anchor not on screen yet keeps the previous rectangle, so the cutout waits and then slides.
  useLayoutEffect(() => {
    if (!anchor) { setRect(null); return; }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setRect((prev) => measure(anchor) ?? prev));
    };
    update();
    const el = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
    const ro = el ? new ResizeObserver(update) : null;
    if (el) ro?.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchor]);

  // First paint dims the full window, the next frame narrows to the anchor.
  useEffect(() => {
    if (reducedMotion()) { setSettled(true); return; }
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onDone(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  if (anchor && !rect) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardWidth = Math.min(CARD_W, vw - 24);
  // Positioned by transform only, so a change of anchor slides on the compositor.
  let transform: string;
  if (rect && placement === 'right' && rect.x + rect.w + GAP + cardWidth <= vw - 12) {
    transform = `translate3d(${rect.x + rect.w + GAP}px, ${Math.max(12, Math.min(rect.y, vh - 180))}px, 0)`;
  } else if (rect) {
    const left = Math.max(12, Math.min(rect.x, vw - cardWidth - 12));
    const roomBelow = vh - (rect.y + rect.h) - GAP;
    const roomAbove = rect.y - GAP;
    const below = placement === 'above' ? roomAbove < 140 && roomBelow > roomAbove : roomBelow >= 140 || roomAbove < roomBelow;
    transform = below ? `translate3d(${left}px, ${rect.y + rect.h + GAP}px, 0)` : `translate3d(${left}px, calc(${rect.y - GAP}px - 100%), 0)`;
  } else {
    transform = 'translate3d(calc(50vw - 50%), calc(50vh - 50%), 0)';
  }

  return createPortal(
    <div className="spot-layer" aria-live="polite">
      <div className="spot-dim" style={{ clipPath: cutout(settled ? rect : null) }} aria-hidden="true" />
      {rect && <div className="spot-ring" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, opacity: settled ? 1 : 0 }} aria-hidden="true" />}
      <div className="spot-card-pos" style={{ transform, width: cardWidth }}>
        <div role="dialog" aria-label="使用引导" className={`spot-card${settled ? ' in' : ''}`}>
          <p key={anchor ?? 'centre'} className="spot-text">{children}</p>
          <div className="spot-actions">
            <button type="button" className="button primary" autoFocus onClick={primary.onClick}>{primary.label}</button>
            {progress && <span className="spot-progress">{progress}</span>}
            {secondary && <button type="button" className="spot-skip" onClick={secondary.onClick}>{secondary.label}</button>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
