import { type BridgeConfig, hostBridge } from "./bridge.ts";
import { focusShim } from "./focus-shim.ts";

export interface ShellOptions {
  /** The MCP App's HTML (the `ui://` resource text). */
  appHtml: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  /** The CallToolResult the app should render. */
  toolResult?: unknown;
  /** CSS scale for the app. Vega WebViews render at devicePixelRatio 1 while native UI is at 2 (ledger VDR-025). */
  scale?: number;
  /** Extra host context for the app (merged over the TV defaults). */
  hostContext?: Record<string, unknown>;
  hostInfo?: { name: string; version: string };
  /** Expression the page uses to reach the native app. Default: React Native WebView bridge. */
  nativePost?: string;
  theme?: "dark" | "light";
}

/**
 * Some TypeScript runners (tsx/esbuild with keepNames) wrap functions in `__name(fn, "name")` calls, which then
 * appear in Function#toString output. This no-op makes serialised code run anywhere.
 */
const PRELUDE = "var __name = function (f) { return f; };";

const esc = (s: string) => s.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/**
 * Builds a complete host page: the MCP App runs in a sandboxed iframe (srcdoc), the page answers the
 * MCP Apps handshake, proxies tools/call to the native TV app, and injects the D-pad focus shim.
 * Must run where Function#toString returns source (Node, browsers), not inside Hermes release builds.
 */
export function buildHostPage(o: ShellOptions): string {
  const scale = o.scale ?? 1;
  const cfg: BridgeConfig = {
    protocolVersion: "2026-01-26",
    hostInfo: o.hostInfo ?? { name: "mcp-apps-tv-host", version: "0.1.0" },
    hostContext: {
      theme: o.theme ?? "dark",
      displayMode: "inline",
      availableDisplayModes: ["inline"],
      platform: "tv",
      deviceCapabilities: { touch: false, hover: false, dpad: true },
      locale: "en-IN",
      ...o.hostContext,
      toolInfo: { tool: { name: o.toolName } },
    },
    toolInput: o.toolInput ?? {},
    toolResult: o.toolResult,
  };
  const appDoc = `<script>${PRELUDE}(${focusShim.toString()})();</script>${o.appHtml}`;
  const post = o.nativePost ?? "function (m) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); }";
  const pct = 100 / scale;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:${o.theme === "light" ? "#fff" : "#0f1420"};overflow:hidden}
#app{border:0;width:${pct}%;height:${pct}%;transform:scale(${scale});transform-origin:0 0;display:block;background:transparent}</style></head>
<body><iframe id="app" sandbox="allow-scripts allow-forms" title="${o.toolName.replace(/"/g, "")}"></iframe>
<script>
${PRELUDE}
(function () {
  var frame = document.getElementById("app");
  var cfg = ${esc(JSON.stringify(cfg))};
  var post = ${post};
  (${hostBridge.toString()})(cfg, window, function () { return frame.contentWindow; }, post);
  frame.srcdoc = ${esc(JSON.stringify(appDoc))};
  frame.addEventListener("load", function () { try { frame.focus(); } catch (e) {} });
  // TV WebViews do not reliably move keyboard focus into a sandboxed iframe, so keys that land on the
  // host document are forwarded; the focus shim inside the app replays them (D-pad still works).
  var KEYS = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Enter: 1, " ": 1 };
  document.addEventListener("keydown", function (e) {
    post({ t: "log", level: "key", data: { key: e.key, target: document.activeElement === frame ? "frame" : "host" } });
    if (!KEYS[e.key] || document.activeElement === frame) return;
    e.preventDefault();
    if (frame.contentWindow) frame.contentWindow.postMessage({ __tvKey: e.key }, "*");
  });
})();
</script></body></html>`;
}

/** data: URI for WebViews that only take a URI (Vega WebView: ledger VDR-024). */
export function toDataUri(html: string): string {
  return `data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`;
}
