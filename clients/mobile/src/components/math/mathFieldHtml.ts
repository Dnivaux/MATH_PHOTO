/**
 * Page de l'éditeur de la calculatrice : un <math-field> MathLive (édition en 2D : fractions, puissances,
 * racines…). Le clavier est celui de l'app : le clavier virtuel de MathLive et celui du téléphone sont
 * désactivés.
 *
 * RN -> page : window.__calc.run({ action, latex })
 *   action = insert | set | left | right | backspace | clear | home | end
 * page -> RN : { type: 'ready' } | { type: 'change', latex } | { type: 'height', value }
 */
import { ASSET_BASE, LOAD_SCRIPT_HELPER, LOCAL } from '../../engine/assets';

export interface MathFieldColors {
  text: string;
  caret: string;
  selection: string;
  placeholder: string;
}

export function buildMathFieldHtml(initialLatex: string, colors: MathFieldColors, fontSize = 30, assetBase: string = ASSET_BASE): string {
  const local = assetBase + LOCAL.mathlive;
  const payload = JSON.stringify({ initial: initialLatex || '', local }).replace(/<\//g, '<\\/');
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<script>${LOAD_SCRIPT_HELPER}</script>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  math-field {
    display: block; width: 100%; box-sizing: border-box;
    font-size: ${fontSize}px; padding: 10px 6px; min-height: 64px;
    background: transparent; color: ${colors.text}; border: none; outline: none;
    --caret-color: ${colors.caret}; --selection-background-color: ${colors.selection};
    --placeholder-color: ${colors.placeholder}; --contains-highlight-background-color: transparent;
    --smart-fence-color: ${colors.placeholder}; --primary-color: ${colors.caret};
  }
  math-field::part(virtual-keyboard-toggle), math-field::part(menu-toggle) { display: none; }
  math-field::part(content) { justify-content: flex-start; }
  #fallback { color: ${colors.placeholder}; font: 14px sans-serif; padding: 8px; display: none; }
</style></head><body>
<math-field id="mf"></math-field>
<div id="fallback">Éditeur indisponible : fichiers de l’app incomplets.</div>
<script>
  var P = ${payload};
  function post(m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function clean(latex) {
    return String(latex || '').replace(/\\\\placeholder(\\[[^\\]]*\\])?\\{\\}/g, '').trim();
  }
  __loadScript(P.local + 'mathlive.min.js').then(function () {
    MathfieldElement.fontsDirectory = P.local + 'fonts/';
    MathfieldElement.soundsDirectory = null;
    var mf = document.getElementById('mf');
    mf.mathVirtualKeyboardPolicy = 'manual';
    mf.menuItems = [];
    mf.smartFence = true;
    mf.smartSuperscript = true;
    mf.defaultMode = 'math';
    mf.value = P.initial;
    function noSystemKeyboard() {
      var root = mf.shadowRoot;
      var ta = root && root.querySelector('textarea, [contenteditable], .ML__keyboard-sink');
      if (ta) { ta.setAttribute('inputmode', 'none'); ta.setAttribute('virtualkeyboardpolicy', 'manual'); }
    }
    noSystemKeyboard();
    setTimeout(noSystemKeyboard, 200);
    mf.addEventListener('focusin', noSystemKeyboard);
    mf.addEventListener('input', function () { post({ type: 'change', latex: clean(mf.value) }); report(); });
    window.__calc = {
      run: function (c) {
        mf.focus();
        noSystemKeyboard();
        switch (c.action) {
          case 'insert': mf.executeCommand(['insert', c.latex, { format: 'latex', selectionMode: 'placeholder', focus: true }]); break;
          case 'set': mf.value = c.latex || ''; mf.executeCommand('moveToMathfieldEnd'); break;
          case 'left': mf.executeCommand('moveToPreviousChar'); break;
          case 'right':
            if (/\\\\placeholder/.test(mf.value)) mf.executeCommand('moveToNextPlaceholder');
            else mf.executeCommand('moveToNextChar');
            break;
          case 'home': mf.executeCommand('moveToMathfieldStart'); break;
          case 'end': mf.executeCommand('moveToMathfieldEnd'); break;
          case 'backspace': mf.executeCommand('deleteBackward'); break;
          case 'clear': mf.value = ''; break;
        }
        post({ type: 'change', latex: clean(mf.value) });
        report();
      },
    };
    function report() { post({ type: 'height', value: Math.ceil(mf.getBoundingClientRect().height) }); }
    setTimeout(function () { mf.focus(); mf.executeCommand('moveToMathfieldEnd'); noSystemKeyboard(); report(); }, 50);
    post({ type: 'ready' });
    post({ type: 'change', latex: clean(mf.value) });
  }).catch(function (e) {
    document.getElementById('fallback').style.display = 'block';
    post({ type: 'error', error: String(e) });
  });
</script></body></html>`;
}
