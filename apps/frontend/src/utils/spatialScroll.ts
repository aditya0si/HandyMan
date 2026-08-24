/**
 * Two-finger spatial scroll (user-approved gesture upgrade): while the
 * primary hand holds the TWO_FINGER pose (index + middle extended), its
 * vertical cursor movement scrolls whatever card content sits under the
 * cursor. DOM-dependent by nature (scrollHeight/clientTop are live
 * layout) — browser-verified, not unit-tested (FloatingWindow precedent).
 *
 * Direction is "content follows the hand" (touch metaphor): hand moves
 * down -> content drags down -> earlier content is revealed, i.e.
 * scrollTop decreases. Same bodily logic as grabbing and dragging a card.
 */

/** Minimum |delta| px per frame before a scroll write (jitter gate). */
export const SCROLL_MIN_DELTA_PX = 0.5;

/** True when the element actually scrolls (overflow + clipped content). */
function isScrollable(el: Element, style: CSSStyleDeclaration): boolean {
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  const overflow = style.overflowY;
  return overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';
}

/**
 * Finds the scrollable element to drive: the element at (x, y) itself, or
 * its nearest scrollable ancestor (scrolling a card's inner list while the
 * pointer rests on a child row). Falls back to the nearest floating-window
 * root's first scrollable descendant (pointer over a non-scrolling child,
 * e.g. a label above the list).
 */
export function findScrollableAt(x: number, y: number): Element | null {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  let node: Element | null = hit;
  while (node) {
    if (isScrollable(node, window.getComputedStyle(node))) return node;
    node = node.parentElement;
  }
  // No scrollable ancestor: try the enclosing floating window's first
  // scrollable descendant (content sections own their overflow).
  const winRoot = hit.closest('[data-window-id]');
  if (winRoot) {
    for (const el of Array.from(winRoot.querySelectorAll('*'))) {
      if (isScrollable(el, window.getComputedStyle(el))) return el;
    }
  }
  return null;
}

/** Applies one scroll step; returns true when a scrollable moved. */
export function scrollAtPoint(x: number, y: number, deltaPx: number): boolean {
  if (Math.abs(deltaPx) < SCROLL_MIN_DELTA_PX) return false;
  const target = findScrollableAt(x, y);
  if (!target) return false;
  const before = target.scrollTop;
  target.scrollTop = before + deltaPx;
  return target.scrollTop !== before;
}
