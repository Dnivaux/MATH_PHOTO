/**
 * Page de l'éditeur de la calculatrice : un <math-field> MathLive (édition
 * en 2D comme une calculatrice graphique : fractions, puissances, racines…).
 * Le clavier est celui de l'app (React Native) : on désactive le clavier
 * virtuel de MathLive et celui du téléphone.
 *
 * RN -> page : window.__calc.run({ action, latex })
 *   action = insert | set | left | right | backspace | clear | home | end
 * page -> RN : { type: 'ready' } | { type: 'change', latex } | { type: 'height', value }
 */
import { ASSET_BASE, CDN, LOAD_SCRIPT_HELPER, LOCAL } from '../../engine/assets';

export function buildMathFieldHtml(initialLatex: string, assetBase: string = ASSET_BASE): string {
  const local = assetBase + LOCAL.mathlive;
  const payload = JSON.stringify({ initial: initialLatex || '', local, cdn: CDN.mathlive }).replace(/<\//g, '<\\/');
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<script>${LOAD_SCRIPT_HELPER}</script>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  math-field {
    display: block; width: 100%; box-sizing: border-box;
    font-size: 30px; padding: 10px 6px; min-height: 64px;
    background: transparent; color: #FFFFFF; border: none; outline: none;
    --caret-color: #FF3B30; --selection-background-color: rgba(255,59,48,0.35);
    --placeholder-color: #8E8E93; --contains-highlight-background-color: rgba(255,255,255,0.06);
    --smart-fence-color: #8E8E93; --primary-color: #FF3B30;
  }
  math-field::part(virtual-keyboard-toggle), math-field::part(menu-toggle) { display: none; }
  math-field::part(content) { justify-content: flex-start; }
  #fallback { color: #8E8E93; font: 14px sans-serif; padding: 8px; display: none; }
</style></head><body>
<math-field id="mf"></math-field>
<div id="fallback">Éditeur indisponible (MathLive non chargé)</div>
<script>
  var P = ${payload};
  function post(m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); if (window.__calcListener) window.__calcListener(m); }
  function clean(latex) {
    return String(latex || '').replace(/\\\\placeholder(\\[[^\\]]*\\])?\\{\\}/g, '').trim();
  }
  __loadFirst([P.local + 'mathlive.min.js', P.cdn + 'mathlive.min.js']).then(function (src) {
    var base = src.replace(/mathlive\\.min\\.js$/, '');
    MathfieldElement.fontsDirectory = base + 'fonts/';
    MathfieldElement.soundsDirectory = null;
    var mf = document.getElementById('mf');
    mf.mathVirtualKeyboardPolicy = 'manual';
    mf.menuItems = [];
    mf.smartFence = true;
    mf.smartSuperscript = true;
    mf.defaultMode = 'math';
    mf.value = P.initial;
    // pas de clavier du téléphone : la saisie passe par les touches de l'app
    function noSystemKeyboard() {
      var root = mf.shadowRoot;
      var ta = root && root.querySelector('textarea, [contenteditable], .ML__keyboard-sink');
      if (ta) { ta.setAttribute('inputmode', 'none'); ta.setAttribute('virtualkeyboardpolicy', 'manual'); }
    }
    noSystemKeyboard();
    setTimeout(noSystemKeyboard, 200);
    mf.addEventListener('focusin', noSystemKeyboard);
    mf.addEventListener('input', function () { post({ type: 'change', latex: clean(mf.value), raw: mf.value }); report(); });

    window.__calc = {
      run: function (c) {
        mf.focus();
        noSystemKeyboard();
        switch (c.action) {
          case 'insert': mf.executeCommand(['insert', c.latex, { format: 'latex', selectionMode: 'placeholder', focus: true }]); break;
          case 'set': mf.value = c.latex || ''; mf.executeCommand('moveToMathfieldEnd'); break;
          case 'left': mf.executeCommand('moveToPreviousChar'); break;
          case 'right':
            // s'il reste des cases vides, → va à la suivante (comme une calculatrice graphique)
            if (/\\placeholder/.test(mf.value)) mf.executeCommand('moveToNextPlaceholder');
            else mf.executeCommand('moveToNextChar');
            break;
          case 'home': mf.executeCommand('moveToMathfieldStart'); break;
          case 'end': mf.executeCommand('moveToMathfieldEnd'); break;
          case 'backspace': mf.executeCommand('deleteBackward'); break;
          case 'clear': mf.value = ''; break;
        }
        post({ type: 'change', latex: clean(mf.value), raw: mf.value });
        report();
      },
    };
    function report() { post({ type: 'height', value: Math.ceil(mf.getBoundingClientRect().height) }); }
    setTimeout(function () { mf.focus(); mf.executeCommand('moveToMathfieldEnd'); noSystemKeyboard(); report(); }, 50);
    post({ type: 'ready', source: src.indexOf('file:') === 0 ? 'apk' : 'cdn' });
    post({ type: 'change', latex: clean(mf.value), raw: mf.value });
  }).catch(function (e) {
    document.getElementById('fallback').style.display = 'block';
    post({ type: 'error', error: String(e) });
  });
</script></body></html>`;
}
