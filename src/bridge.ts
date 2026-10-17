/**
 * The host side of the MCP Apps protocol (spec 2026-01-26), written as one self-contained function so it
 * can be serialised into the host page (`hostBridge.toString()`) and also unit-tested in Node with fakes.
 *
 * Message paths:
 *   app (sandboxed iframe) ⇄ host page   : JSON-RPC 2.0 over window.postMessage
 *   host page ⇄ native TV app            : `post(msg)` (e.g. window.ReactNativeWebView.postMessage) and
 *                                          `window.__tvHost.receive(msg)` (called via injectJavaScript)
 */

export interface BridgeConfig {
  protocolVersion: string;
  hostInfo: { name: string; version: string };
  hostContext: Record<string, unknown>;
  toolInput: Record<string, unknown>;
  toolResult?: unknown;
}

/** Messages the host page sends to the native app. */
export type ToNative =
  | { t: "ready" }
  | { t: "call"; id: string | number; params: { name: string; arguments?: Record<string, unknown> } }
  | { t: "message"; text: string }
  | { t: "log"; level: string; data: unknown };

/** Messages the native app sends to the host page. */
export type FromNative =
  | { t: "result"; id: string | number; result?: unknown; error?: string }
  | { t: "tool-result"; result: unknown };

interface WinLike {
  addEventListener(type: "message", fn: (e: { source: unknown; data: unknown }) => void): void;
  [k: string]: unknown;
}

export function hostBridge(cfg: BridgeConfig, win: WinLike, frameWin: () => { postMessage(m: unknown, o: string): void } | null, post: (m: ToNative) => void): void {
  const toApp = (msg: unknown) => frameWin()?.postMessage(msg, "*");
  const reply = (id: unknown, result: unknown) => toApp({ jsonrpc: "2.0", id, result });
  const fail = (id: unknown, code: number, message: string) => toApp({ jsonrpc: "2.0", id, error: { code, message } });
  let initialized = false;

  const sendTool = () => {
    toApp({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: cfg.toolInput } });
    if (cfg.toolResult !== undefined) toApp({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: cfg.toolResult });
  };

  win.addEventListener("message", (e) => {
    if (e.source !== frameWin()) return;
    const m = e.data as { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown> } | null;
    if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") return;
    switch (m.method) {
      case "ui/initialize":
        return reply(m.id, {
          protocolVersion: cfg.protocolVersion,
          hostInfo: cfg.hostInfo,
          hostCapabilities: { serverTools: {}, logging: {} },
          hostContext: cfg.hostContext,
        });
      case "ui/notifications/initialized":
        if (!initialized) {
          initialized = true;
          sendTool();
          post({ t: "ready" });
        }
        return;
      case "tools/call": {
        const p = (m.params ?? {}) as { name?: unknown; arguments?: Record<string, unknown> };
        if (typeof p.name !== "string") return fail(m.id, -32602, "tools/call needs a tool name");
        return post({ t: "call", id: m.id as string | number, params: { name: p.name, arguments: p.arguments ?? {} } });
      }
      case "ui/message": {
        // The app asks to say something in the conversation: on a shared TV it becomes a turn.
        const content = (m.params?.content ?? []) as { type?: string; text?: string }[];
        const text = Array.isArray(content) ? content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(" ").trim() : "";
        if (text) post({ t: "message", text });
        return m.id !== undefined ? reply(m.id, {}) : undefined;
      }
      case "ui/open-link":
        // There is no browser to hand a link to on a TV.
        return fail(m.id, -32000, "Links cannot be opened on this TV. Show a QR code instead.");
      case "ui/request-display-mode":
        return reply(m.id, { mode: "inline" });
      case "ui/update-model-context":
        return reply(m.id, {});
      case "notifications/message":
        return post({ t: "log", level: String(m.params?.level ?? "info"), data: m.params?.data });
      default:
        if (m.method.startsWith("ui/notifications/")) return; // size-changed and friends need no answer
        if (m.id !== undefined) fail(m.id, -32601, `Method not supported by this TV host: ${m.method}`);
    }
  });

  (win as Record<string, unknown>).__tvHost = {
    receive(msg: FromNative) {
      if (msg.t === "result") {
        if (msg.error) fail(msg.id, -32000, msg.error);
        else reply(msg.id, msg.result);
      } else if (msg.t === "tool-result") {
        cfg.toolResult = msg.result;
        toApp({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: msg.result });
      }
    },
  };
}
