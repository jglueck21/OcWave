// Drag-to-reorder for a list, with mouse and touch: drag a row by its grip handle. Rows slide out of the way
// while dragging and the list scrolls when the pointer nears the top or bottom edge of the screen.
export function makeReorderable(container, { itemSelector, handleSelector, onMove }) {
  let drag = null;
  let scroller = null;
  let raf = 0;

  const scrollParent = (node) => {
    for (let el = node.parentElement; el; el = el.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) return el;
    }
    return document.scrollingElement;
  };

  function update() {
    if (!drag) return;
    const top = container.getBoundingClientRect().top;
    const y = drag.clientY - top; // pointer position inside the list, so scrolling is accounted for
    drag.row.style.transform = `translateY(${y - drag.startY}px)`;
    const { tops, heights } = drag; // row positions inside the list, measured before anything moved
    let to = drag.from;
    tops.forEach((top, i) => {
      if (y >= top && y < top + heights[i]) to = i;
    });
    if (y < tops[0]) to = 0;
    if (y > tops.at(-1) + heights.at(-1)) to = tops.length - 1;
    drag.to = to;
    const shift = heights[drag.from];
    drag.rows.forEach((row, i) => {
      if (row === drag.row) return;
      row.style.transform = drag.from < to && i > drag.from && i <= to ? `translateY(${-shift}px)` : drag.from > to && i >= to && i < drag.from ? `translateY(${shift}px)` : "";
    });
  }

  function autoScroll() {
    if (!drag) return;
    const area = scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
    const edge = 70;
    const speed = drag.clientY < area.top + edge ? -(1 - (drag.clientY - area.top) / edge) * 16 : drag.clientY > area.bottom - edge ? (1 - (area.bottom - drag.clientY) / edge) * 16 : 0;
    if (speed) {
      scroller.scrollTop += speed;
      update();
    }
    raf = requestAnimationFrame(autoScroll);
  }

  container.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest(handleSelector);
    if (!handle || event.button > 0) return;
    const row = handle.closest(itemSelector);
    const rows = [...container.querySelectorAll(itemSelector)];
    const from = rows.indexOf(row);
    const listTop = container.getBoundingClientRect().top;
    const rects = rows.map((r) => r.getBoundingClientRect());
    drag = {
      row,
      rows,
      from,
      to: from,
      clientY: event.clientY,
      startY: event.clientY - listTop,
      tops: rects.map((r) => r.top - listTop),
      heights: rects.map((r) => r.height),
    };
    scroller = scrollParent(container);
    row.classList.add("dragging");
    container.classList.add("reordering");
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
    raf = requestAnimationFrame(autoScroll);
  });
  container.addEventListener("pointermove", (event) => {
    if (!drag) return;
    drag.clientY = event.clientY;
    update();
  });
  const end = (commit) => {
    if (!drag) return;
    cancelAnimationFrame(raf);
    const { rows, row, from, to } = drag;
    rows.forEach((r) => (r.style.transform = ""));
    row.classList.remove("dragging");
    container.classList.remove("reordering");
    drag = null;
    if (commit && from !== to) onMove(from, to);
  };
  container.addEventListener("pointerup", (event) => {
    if (drag) (drag.clientY = event.clientY, update()); // use the final position even if no move event came before
    end(true);
  });
  container.addEventListener("pointercancel", () => end(false));
}
