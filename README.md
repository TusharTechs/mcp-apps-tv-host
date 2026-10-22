# mcp-apps-tv-host

Render [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) (interactive `ui://` resources from MCP
servers) on a **TV**, driven by a **remote control**. Built for Fire TV on Vega OS, usable on any WebView-based TV.

MCP Apps today run in chat hosts on desktops and phones, where a mouse or a finger is assumed. A TV has neither: it has
a D-pad, a 10-foot viewing distance and, on Vega, a WebView with its own quirks. This package is the missing host:

- **Host page builder** (`buildHostPage`): puts the app in a sandboxed `srcdoc` iframe and implements the host side of
  the MCP Apps protocol (2026-01-26): `ui/initialize` with a TV host context (`platform: "tv"`,
  `deviceCapabilities: { touch: false, hover: false, dpad: true }`), `tool-input` / `tool-result` notifications,
  `tools/call` proxying, `ui/message` turned into a conversation turn, and a polite refusal of `ui/open-link`.
- **D-pad focus shim**, injected into every app: arrow keys move focus to the nearest focusable element in that
  direction, OK activates it, focus rings are large and visible, and apps that handle keys themselves are left alone.
  Keys that land on the host document are forwarded into the app frame.
- **Vega React Native component** (`mcp-apps-tv-host/vega`): loads the page as a `data:` URI (the Vega WebView accepts
  only URIs), bridges `tools/call` to your app, and keeps D-pad focus inside the app.

## Why the details matter on Vega (measured on the Vega Virtual Device, SDK 0.24)

| Platform behaviour | What the package does |
|---|---|
| `@amazon-devices/webview` accepts `{ uri }` only, no `{ html }` | ships the page as `data:text/html;base64,…` (300 KB tested) |
| WebView renders at `devicePixelRatio` 1 while React Native lays out at 2 → web UI looks half size | scales the app iframe 2× |
| D-pad focus escapes the WebView to any focusable native view on screen | the component is meant to be the only focusable view; Back closes |
| Hermes release builds cannot serialise function source (`Function#toString` → bytecode) | the page is built on your server, not on the TV |
| Some bundlers (tsx/esbuild `keepNames`) inject `__name()` into serialised functions | the page defines a no-op `__name` first |

## Use

On your server (Node), after an MCP tool with `_meta.ui.resourceUri` returns:

```ts
import { buildHostPage } from "mcp-apps-tv-host";

const resource = await client.readResource({ uri });            // the ui:// HTML
const html = buildHostPage({
  appHtml: resource.contents[0].text,
  toolName: "show_week",
  toolInput: args,
  toolResult: callToolResult,                                    // the app renders structuredContent from this
  scale: 2,                                                      // Vega WebView density fix
});
// send { appId, title, server, html } to the TV
```

On the TV (React Native for Vega):

```tsx
import { AppHost, type AppHostHandle } from "mcp-apps-tv-host/vega";

<AppHost
  ref={hostRef}
  card={app}                                                     // { appId, title, server, html }
  onToolCall={(callId, name, args) => sendToServer({ callId, name, args })}
  onMessage={(text) => askAgent(text)}
/>
// when the server answers: hostRef.current.deliver(callId, callToolResult, error)
```

Your server proxies `tools/call` to the MCP server that served the app and returns the raw `CallToolResult`.

## Tests

`vitest` covers the handshake, tool proxying, origin checks, link refusal, `ui/message`, HTML escaping (an app's
`</script>` cannot break out of the host script) and the `data:` URI round trip.

## In use

Verified end to end on the Vega Virtual Device in [Couchside](https://github.com/TusharTechs/couchside), a
bring-your-own-AI voice harness for Fire TV: a family week view navigated with the D-pad, and a live sports scoreboard
that keeps calling its own MCP server through the bridge (`tools/call` → React Native → WebSocket → the MCP server).
See both in the [Couchside demo](https://youtu.be/7ffUjDRi-4Q) at 1:25 (scoreboard) and 2:27 (week view).

## Licence

MIT
