import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { ASSET_BASE, FILE_ACCESS_PROPS } from '../../engine/assets';
import { buildMathFieldHtml } from './mathFieldHtml';

export type MathFieldAction = 'left' | 'right' | 'backspace' | 'clear' | 'home' | 'end';

export interface MathFieldHandle {
  insert(latex: string): void;
  set(latex: string): void;
  run(action: MathFieldAction): void;
}

interface Props {
  initialLatex?: string;
  onChange?: (latex: string) => void;
  minHeight?: number;
}

/** Éditeur mathématique en 2D (MathLive) piloté par le clavier de l'app */
export const MathFieldView = forwardRef<MathFieldHandle, Props>(({ initialLatex = '', onChange, minHeight = 72 }, ref) => {
  const web = useRef<React.ElementRef<typeof WebView>>(null);
  const [height, setHeight] = useState(minHeight);
  // la page n'est construite qu'une fois : les changements passent par __calc.run
  const html = useMemo(() => buildMathFieldHtml(initialLatex), []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = (cmd: object) =>
    web.current?.injectJavaScript(`window.__calc && window.__calc.run(${JSON.stringify(cmd)}); true;`);

  useImperativeHandle(ref, () => ({
    insert: latex => send({ action: 'insert', latex }),
    set: latex => send({ action: 'set', latex }),
    run: action => send({ action }),
  }));

  return (
    <View style={[styles.box, { height: Math.max(minHeight, height) }]}>
      <WebView
        ref={web}
        {...FILE_ACCESS_PROPS}
        source={{ html, baseUrl: ASSET_BASE }}
        style={styles.web}
        scrollEnabled={false}
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        onMessage={e => {
          let m: any;
          try {
            m = JSON.parse(e.nativeEvent.data);
          } catch {
            return;
          }
          if (m.type === 'change') onChange?.(m.latex);
          if (m.type === 'height' && m.value > 0) setHeight(m.value + 8);
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  box: { width: '100%', backgroundColor: 'transparent' },
  web: { backgroundColor: 'transparent' },
});
