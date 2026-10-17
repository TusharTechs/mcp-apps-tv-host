/**
 * D-pad focus shim, injected at the top of every MCP App rendered on a TV.
 * Most MCP Apps are built for a mouse or touch screen. The shim makes them usable with a remote:
 * arrow keys move focus to the nearest focusable element in that direction, Enter activates it,
 * and focused elements get a large, visible ring. Apps that handle arrow keys themselves
 * (preventDefault) are left alone.
 *
 * Plain ES5-ish source on purpose: it runs inside arbitrary app documents.
 */
export function focusShim(): void {
  var SEL = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"]),[role="button"],[role="link"],[role="tab"],[role="option"]';
  var DIRS: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

  function visible(el: Element): boolean {
    var r = el.getBoundingClientRect();
    var s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !(el as HTMLButtonElement).disabled;
  }
  function candidates(): HTMLElement[] {
    return Array.prototype.slice.call(document.querySelectorAll(SEL)).filter(visible);
  }
  function center(el: Element) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function move(dx: number, dy: number): boolean {
    var cur = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    var list = candidates();
    if (!cur) {
      if (list[0]) list[0].focus();
      return !!list[0];
    }
    var c = center(cur);
    var best: HTMLElement | null = null;
    var bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      var el = list[i] as HTMLElement;
      if (el === cur) continue;
      var p = center(el);
      var along = (p.x - c.x) * dx + (p.y - c.y) * dy; // distance in the pressed direction
      if (along <= 1) continue;
      var across = Math.abs((p.x - c.x) * dy) + Math.abs((p.y - c.y) * dx); // sideways drift
      var score = along + across * 2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) {
      best.focus();
      best.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    return !!best;
  }

  document.addEventListener("keydown", function (e) {
    var d = DIRS[e.key];
    if (!d) return;
    // Let the app's own handlers run first; act only if nobody handled the key.
    setTimeout(function () {
      if (e.defaultPrevented) return;
      move((d as [number, number])[0], (d as [number, number])[1]);
    }, 0);
  });
  // Keys forwarded by the host page (when the host document, not this frame, has focus).
  window.addEventListener("message", function (ev) {
    var k = ev.data && (ev.data as { __tvKey?: string }).__tvKey;
    if (!k) return;
    var target = (document.activeElement || document.body) as HTMLElement;
    var synthetic = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
    target.dispatchEvent(synthetic);
    if (synthetic.defaultPrevented) return;
    var dd = DIRS[k];
    if (dd) move(dd[0], dd[1]);
    else if ((k === "Enter" || k === " ") && target !== document.body) target.click();
  });

  var style = document.createElement("style");
  style.textContent =
    ":focus{outline:4px solid #F0A742 !important;outline-offset:3px !important;border-radius:6px}" +
    "button:focus,[role=button]:focus,a:focus{transform:scale(1.04);transition:transform .08s}";
  (document.head || document.documentElement).appendChild(style);

  function first() {
    if (!document.activeElement || document.activeElement === document.body) {
      var list = candidates();
      if (list[0]) list[0].focus();
    }
  }
  if (document.readyState === "complete") setTimeout(first, 50);
  else window.addEventListener("load", function () { setTimeout(first, 50); });
  // Content often renders after the tool result arrives; try again then.
  new MutationObserver(function () { first(); }).observe(document.documentElement, { childList: true, subtree: true });
}
