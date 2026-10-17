import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TVFocusGuideView } from '@amazon-devices/react-native-kepler';
import { WebView } from '@amazon-devices/webview';
import { utf8ToBase64 } from './base64';

const color = { bg: '#0B0F18', ink: '#EEF1F6', dim: '#8D97A8', accent: '#F0A742' };
const type = { tiny: 10, small: 12, title: 20 };

/** What the host needs to show an app: the host page from buildHostPage(), plus labels. */
export interface TvApp {
  appId: string;
  title: string;
  /** Label for the source, e.g. the MCP server name. */
  server: string;
  /** Full host page HTML from `buildHostPage()` (built where Function#toString works, e.g. your server). */
  html: string;
}

export interface AppHostHandle {
  /** Delivers an app_tool_result from the server into the page. */
  deliver(callId: string, result: unknown, error?: string): void;
}

interface Props {
  card: TvApp;
  onToolCall(callId: string, name: string, args: Record<string, unknown>): void;
  onMessage(text: string): void;
  onLog?(level: string, data: unknown): void;
}

/**
 * Shows an MCP App (ui:// resource) full-screen. The server sends a ready host page (mcp-apps-tv-host);
 * the Vega WebView only accepts a URI, so it loads as a data: URI (ledger VDR-024). Focus is trapped so
 * the D-pad stays inside the app (VDR-026); Back closes it.
 */
export const AppHost = forwardRef<AppHostHandle, Props>(function AppHost({ card, onToolCall, onMessage, onLog }, ref) {
  const web = useRef<{ injectJavaScript(js: string): void } | null>(null);
  const ids = useRef(new Map<string, string | number>());
  const uri = useMemo(() => `data:text/html;charset=utf-8;base64,${utf8ToBase64(card.html)}`, [card.html]);

  useImperativeHandle(ref, () => ({
    deliver(callId, result, error) {
      const id = ids.current.get(callId);
      if (id === undefined) return;
      ids.current.delete(callId);
      const msg = JSON.stringify({ t: 'result', id, result, error });
      web.current?.injectJavaScript(`window.__tvHost && window.__tvHost.receive(${msg}); true;`);
    },
  }));

  const onWebMessage = (e: { nativeEvent?: { data?: string } }) => {
    let m: { t?: string; id?: string | number; params?: { name: string; arguments?: Record<string, unknown> }; text?: string; level?: string; data?: unknown };
    try {
      m = JSON.parse(e.nativeEvent?.data ?? '');
    } catch {
      return;
    }
    if (m.t === 'call' && m.params && m.id !== undefined) {
      const callId = `${card.appId}:${String(m.id)}`;
      ids.current.set(callId, m.id);
      onToolCall(callId, m.params.name, m.params.arguments ?? {});
    } else if (m.t === 'message' && m.text) onMessage(m.text);
    else if (m.t === 'log') onLog?.(m.level ?? 'info', m.data);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.kind}>APP · {card.server}</Text>
        <Text style={styles.title}>{card.title}</Text>
        <Text style={styles.hint}>Back to close</Text>
      </View>
      <TVFocusGuideView style={styles.frame} trapFocusUp trapFocusDown trapFocusLeft trapFocusRight autoFocus>
        <WebView
          ref={web as never}
          source={{ uri }}
          javaScriptEnabled
          domStorageEnabled
          hasTVPreferredFocus
          focusable
          onMessage={onWebMessage as never}
          style={styles.web}
        />
      </TVFocusGuideView>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  kind: { color: color.dim, fontSize: type.tiny + 1, letterSpacing: 1.2, fontWeight: '700' },
  title: { color: color.ink, fontSize: type.title, fontWeight: '800' },
  hint: { color: color.dim, fontSize: type.small, marginLeft: 'auto' },
  frame: { flex: 1, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: color.accent },
  web: { flex: 1, backgroundColor: color.bg },
});
