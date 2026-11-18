/**
 * Enter moves to the next field, in every form of the app (forms, popups and page forms alike).
 *
 * - Works on text / number / date inputs and dropdowns; a textarea keeps Enter for new lines.
 * - On the last field of a real <form>, Enter still saves the form (the browser's normal submit).
 * - Boxes that use Enter themselves (scan box, search lists, discount boxes, …) call preventDefault,
 *   so they are left alone; a field can also opt out with data-enter="self".
 */
const FIELDS = 'input, select, textarea';
const SKIP_TYPES = new Set(['hidden', 'file', 'button', 'submit', 'reset', 'image', 'range', 'color']);

const usable = (el) => !el.disabled && !el.readOnly && el.tabIndex >= 0 && !SKIP_TYPES.has(el.type)
  && el.offsetParent !== null && el.getAttribute('data-enter') !== 'self';

function onKeyDown(e) {
  if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
  const el = e.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return;
  if (SKIP_TYPES.has(el.type) || el.getAttribute('data-enter') === 'self') return;
  // the form / popup / page the field belongs to
  const box = el.closest('form') || el.closest('[role="dialog"]') || el.closest('main');
  if (!box) return;
  const fields = [...box.querySelectorAll(FIELDS)].filter((f) => f === el || usable(f));
  const next = fields[fields.indexOf(el) + 1];
  if (!next) return; // last field: a <form> submits as usual, anything else does nothing
  e.preventDefault();
  next.focus();
  if (next instanceof HTMLInputElement && typeof next.select === 'function' && !['checkbox', 'radio', 'date', 'month', 'time', 'datetime-local'].includes(next.type)) {
    try { next.select(); } catch { /* some input types cannot be selected */ }
  }
}

// bubble phase on document: React's own Enter handlers (which preventDefault) run first
document.addEventListener('keydown', onKeyDown);
