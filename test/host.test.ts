import { describe, expect, it } from "vitest";
import { hostBridge, type ToNative } from "../src/bridge.ts";
import { buildHostPage, toDataUri } from "../src/shell.ts";

function harness(toolResult?: unknown) {
  const listeners: ((e: { source: unknown; data: unknown }) => void)[] = [];
  const toApp: unknown[] = [];
  const frame = { postMessage: (m: unknown) => toApp.push(m) };
  const win: Record<string, unknown> & { addEventListener: (t: "message", f: (e: { source: unknown; data: unknown }) => void) => void } = {
    addEventListener: (_t, f) => listeners.push(f),
  };
  const native: ToNative[] = [];
  hostBridge(
    { protocolVersion: "2026-01-26", hostInfo: { name: "t", version: "1" }, hostContext: { platform: "tv" }, toolInput: { from: "today" }, toolResult },
    win,
    () => frame,
    (m) => native.push(m),
  );
  const fromApp = (data: unknown, source: unknown = frame) => listeners.forEach((f) => f({ source, data }));
  return { toApp, native, fromApp, host: win.__tvHost as { receive: (m: unknown) => void } };
}

describe("MCP Apps TV host bridge", () => {
  it("answers ui/initialize with TV host context, then sends tool input and result once", () => {
    const h = harness({ structuredContent: { week: [] } });
    h.fromApp({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} });
    expect(h.toApp[0]).toMatchObject({ id: 1, result: { protocolVersion: "2026-01-26", hostContext: { platform: "tv" } } });
    h.fromApp({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    h.fromApp({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    expect(h.toApp.slice(1)).toEqual([
      { jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { from: "today" } } },
      { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { week: [] } } },
    ]);
    expect(h.native).toEqual([{ t: "ready" }]);
  });

  it("proxies tools/call to the native side and routes the answer back", () => {
    const h = harness();
    h.fromApp({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_calendar", arguments: { date: "2026-10-24" } } });
    expect(h.native).toEqual([{ t: "call", id: 7, params: { name: "get_calendar", arguments: { date: "2026-10-24" } } }]);
    h.host.receive({ t: "result", id: 7, result: { content: [] } });
    h.host.receive({ t: "result", id: 8, error: "boom" });
    expect(h.toApp).toEqual([
      { jsonrpc: "2.0", id: 7, result: { content: [] } },
      { jsonrpc: "2.0", id: 8, error: { code: -32000, message: "boom" } },
    ]);
  });

  it("ignores messages from anything but the app frame and refuses links", () => {
    const h = harness();
    h.fromApp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x" } }, { other: true });
    expect(h.native).toEqual([]);
    h.fromApp({ jsonrpc: "2.0", id: 2, method: "ui/open-link", params: { url: "https://x" } });
    h.fromApp({ jsonrpc: "2.0", id: 3, method: "made/up" });
    expect(h.toApp).toEqual([
      { jsonrpc: "2.0", id: 2, error: { code: -32000, message: expect.stringContaining("QR") } },
      { jsonrpc: "2.0", id: 3, error: { code: -32601, message: expect.stringContaining("made/up") } },
    ]);
  });

  it("turns ui/message into a conversation turn", () => {
    const h = harness();
    h.fromApp({ jsonrpc: "2.0", id: 4, method: "ui/message", params: { role: "user", content: [{ type: "text", text: "Tell me about Sunday" }] } });
    expect(h.native).toEqual([{ t: "message", text: "Tell me about Sunday" }]);
  });
});

describe("host page", () => {
  const page = buildHostPage({ appHtml: "<h1>Week</h1><script>var x = '</script>';</script>", toolName: "show_week", toolInput: {}, scale: 2 });

  it("is self-contained: no bundler helpers leaked into the serialised functions", () => {
    expect(page).not.toMatch(/__defProp|__export|require\(/);
    // A leaked esbuild `__name(...)` helper must be harmless: the page defines a no-op first.
    expect(page.indexOf("var __name = function")).toBeGreaterThan(-1);
    expect(page).toContain("sandbox=\"allow-scripts allow-forms\"");
    expect(page).toContain("transform:scale(2)");
    expect(page).toContain("width:50%");
  });

  it("escapes the app HTML so it cannot break out of the host script", () => {
    const scripts = page.split("<script>").length - 1;
    expect(scripts).toBe(1); // only the host's own script tag; the app's are escaped inside srcdoc
    expect(page).toContain("\\u003c/script>");
  });

  it("produces a data: URI the Vega WebView accepts", () => {
    const uri = toDataUri(page);
    expect(uri.startsWith("data:text/html;charset=utf-8;base64,")).toBe(true);
    expect(Buffer.from(uri.split(",")[1] as string, "base64").toString("utf8")).toBe(page);
  });
});
