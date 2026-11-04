import React, { useEffect, useMemo, useRef } from 'react';
import { PixelRatio, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { ASSET_BASE, FILE_ACCESS_PROPS } from '../../engine/assets';
import { useTheme, webColors } from '../../theme';
import { buildSolutionHtml } from './solutionHtml';

export interface DocState {
  phase: 'loading' | 'error' | 'done';
  latex: string;
  kindLabel?: string;
  progress?: string;
  error?: { title: string; message: string; canRetry: boolean; canEdit: boolean; queued?: boolean };
  solution?: unknown;
  explain?: {
    status: 'unavailable' | 'idle' | 'loading' | 'streaming' | 'done' | 'error';
    via?: 'device' | 'server';
    level: string;
    text?: string;
    report?: unknown;
    message?: string;
    action?: { id: string; label: string; icon: string };
  };
  canVerifyServer?: boolean;
  levels: { id: string; label: string }[];
}

interface Props {
  state: DocState;
  onAction: (action: string, value?: string | null) => void;
}

/** La page de solution (une seule WebView) ; l'état est poussé à chaque changement */
export const SolutionDocument: React.FC<Props> = ({ state, onAction }) => {
  const { c, scheme } = useTheme();
  const ref = useRef<React.ElementRef<typeof WebView>>(null);
  const ready = useRef(false);
  const fontScale = PixelRatio.getFontScale();
  const html = useMemo(() => buildSolutionHtml(webColors(c), fontScale, scheme === 'dark'), [c, fontScale, scheme]);
  const latest = useRef(state);
  latest.current = state;

  const push = () => {
    if (!ready.current) {
      return;
    }
    ref.current?.injectJavaScript(`window.__doc && window.__doc.set(${JSON.stringify(latest.current)}); true;`);
  };

  useEffect(push, [state]);
  useEffect(() => {
    ready.current = false;
  }, [html]);

  return (
    <WebView
      ref={ref}
      {...FILE_ACCESS_PROPS}
      source={{ html, baseUrl: ASSET_BASE }}
      style={[styles.web, { backgroundColor: c.bg }]}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
      overScrollMode="never"
      onShouldStartLoadWithRequest={req => req.url.startsWith('file:') || req.url.startsWith('about:')}
      onRenderProcessGone={() => ref.current?.reload()}
      onMessage={e => {
        let m: any;
        try {
          m = JSON.parse(e.nativeEvent.data);
        } catch {
          return;
        }
        if (m.type === 'ready') {
          ready.current = true;
          push();
        } else if (m.type === 'action') {
          onAction(m.action, m.value);
        }
      }}
    />
  );
};

const styles = StyleSheet.create({ web: { flex: 1 } });
