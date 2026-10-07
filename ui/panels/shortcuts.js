// Keyboard: the canvas keys, active whenever the person is not typing in a field.

const typing = (el) => el && (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable);

export function installShortcuts({ canvas, toggleSidebar, clearSelection, enabled, find }) {
  addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      return find();
    }
    if (event.metaKey || event.ctrlKey || event.altKey || typing(document.activeElement)) return;
    if (event.key === '[') {
      event.preventDefault();
      return toggleSidebar();
    }
    if (!enabled()) return;
    const step = event.shiftKey ? 160 : 60;
    const run = {
      0: () => canvas.fitAll(),
      1: () => canvas.zoomTo(1),
      '=': () => canvas.zoomBy(1.25),
      '+': () => canvas.zoomBy(1.25),
      '-': () => canvas.zoomBy(1 / 1.25),
      Escape: clearSelection,
      '/': find, // find on any page
      ArrowLeft: () => canvas.pan(step, 0),
      ArrowRight: () => canvas.pan(-step, 0),
      ArrowUp: () => canvas.pan(0, step),
      ArrowDown: () => canvas.pan(0, -step),
    }[event.key];
    if (!run) return;
    event.preventDefault();
    run();
  });
}
