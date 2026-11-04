/**
 * Calcul embarqué (CortexJS Compute Engine), exécuté dans la WebView du moteur.
 * Le même code tourne dans Jest (voir __tests__/math.test.ts) : il est écrit comme une fabrique
 * `makeMath(ce)` sans dépendance au DOM.
 *
 *  - analyze(latex) : classe le problème selon le périmètre du dossier. Local : arithmétique (fractions,
 *    puissances, racines, fonctions usuelles) et équation du premier degré, avec des étapes au format du
 *    générateur du serveur (datagen/problems.py) : c'est sur ce format que l'explainer a été distillé.
 *    Le reste (équation de degré >= 2, système, dérivée, intégrale, limite) part au serveur.
 *  - checkExplanation(...) : portage numérique de eval/faithfulness.py. Chaque égalité écrite par le LLM
 *    entre $...$ est revérifiée ; les nombres absents des étapes sont signalés (hallucination).
 */
export const MATH_SOURCE = String.raw`
function makeMath(newCE) {
  // Un moteur partagé pour l'analyse (renouvelé régulièrement : CortexJS déclare au passage les symboles
  // qu'il rencontre, par ex. f comme fonction après « f(x) = … ») et un moteur neuf pour chaque
  // vérification d'explication, pour qu'une saisie précédente ne change pas le sens d'un symbole.
  var shared = newCE(), uses = 0, active = null;
  function E() { return active || shared; }

  // ------------------------------------------------------------ outils

  /** Fonctions du clavier que CortexJS ne connaît pas sous ce nom */
  function fixHeads(j) {
    if (!Array.isArray(j)) return j;
    var h = j[0], a = j.slice(1).map(fixHeads);
    if (h === 'nCr' && a.length === 2) return ['Binomial', a[0], a[1]];
    if (h === 'nPr' && a.length === 2) return ['Divide', ['Factorial', a[0]], ['Factorial', ['Subtract', a[0], a[1]]]];
    if (h === 'Re') return ['Real', a[0]];
    if (h === 'Im') return ['Imaginary', a[0]];
    if (h === 'OverBar') return ['Conjugate', a[0]];
    if (h === 'Argument') return ['Arctan2', ['Imaginary', a[0]], ['Real', a[0]]];
    return [h].concat(a);
  }

  var RENAMED = /"(nCr|nPr|Re|Im|OverBar|Argument)"/;

  function parse(latex) {
    var e = E().parse(latex);
    // reconstruire l'expression seulement si une fonction du clavier doit être renommée (ce.box échoue sur
    // les notations à variable liée comme la somme)
    if (!e.isValid || !RENAMED.test(JSON.stringify(e.json))) return e;
    return E().box(fixHeads(e.json));
  }

  function heads(j, acc) {
    acc = acc || {};
    if (Array.isArray(j)) { if (typeof j[0] === 'string') acc[j[0]] = true; j.forEach(function (x) { heads(x, acc); }); }
    return acc;
  }

  /** Valeur numérique réelle d'une expression sans variable, sinon null */
  function real(e) {
    try {
      var v = e.N();
      if (typeof v.re === 'number' && isFinite(v.re) && Math.abs(v.im || 0) < 1e-12) return v.re;
    } catch (err) {}
    return null;
  }

  /** Nombre décimal pour l'affichage, à la française (virgule) */
  function decimalLatex(x) {
    if (!isFinite(x)) return null;
    var s = String(parseFloat(x.toPrecision(10)));
    if (/e/.test(s)) {
      var p = x.toExponential(6).split('e');
      return p[0].replace(/\.?0+$/, '').replace('.', '{,}') + ' \\times 10^{' + Number(p[1]) + '}';
    }
    return s.replace('-', '-').replace('.', '{,}');
  }

  function clean(latex) {
    return String(latex || '')
      .replace(/\\exponentialE/g, 'e').replace(/\\imaginaryI/g, 'i')
      .replace(/\\mathrm\{([A-Za-z]+)\}/g, '\\operatorname{$1}');
  }

  function texOf(e) { return clean(e.latex).replace(/\\frac\{-([^{}]+)\}\{/g, '-\\frac{$1}{'); }

  var SERVER_TYPE_LABELS = {
    equation: 'Équation', system: 'Système d\'équations', derivative: 'Dérivée', integral: 'Primitive', limit: 'Limite',
  };

  /** Même règle que datagen/from_latex.py:detect_type */
  function detectType(latex) {
    if (/\\lim/.test(latex)) return 'limit';
    if (/\\int/.test(latex)) return 'integral';
    if (/\\frac\{\s*(?:\\mathrm\{d\}|d)\s*\}\{\s*(?:\\mathrm\{d\}|d)\s*x\s*\}|f'\(x\)|\\prime/.test(latex)) return 'derivative';
    if (/\\begin\{cases\}/.test(latex) || /\\\\/.test(latex) || (latex.match(/=/g) || []).length >= 2) return 'system';
    if (/=/.test(latex)) return 'equation';
    return null;
  }

  var RELATIONS = { Less: 1, Greater: 1, LessEqual: 1, GreaterEqual: 1, NotEqual: 1 };

  // ------------------------------------------------------------ analyse

  function analyze(latex) {
    if (++uses > 60) { shared = newCE(); uses = 0; }
    var src = String(latex || '').trim();
    if (!src) return { valid: false, kind: 'empty' };
    var serverType = detectType(src);
    if (serverType && serverType !== 'equation') {
      return { valid: true, kind: serverType, route: 'server', apiType: serverType, label: SERVER_TYPE_LABELS[serverType] };
    }
    var e = parse(src);
    if (!e.isValid) {
      return { valid: false, kind: 'invalid', route: 'server', apiType: serverType || undefined, reason: 'invalid_latex' };
    }
    var j = e.json;
    var op = Array.isArray(j) ? j[0] : null;
    if (op && RELATIONS[op]) return { valid: true, kind: 'inequality', route: 'none', label: 'Inéquation' };
    if (op === 'List' || op === 'Tuple') return { valid: true, kind: 'system', route: 'server', apiType: 'system', label: SERVER_TYPE_LABELS.system };
    // les indices de somme et de produit (Σ, Π) sont des variables liées, pas des inconnues
    var bound = {};
    (function walk(n) {
      if (!Array.isArray(n)) return;
      if (n[0] === 'Limits' && typeof n[1] === 'string') bound[n[1]] = true;
      n.forEach(walk);
    })(j);
    var unknowns = (e.unknowns || []).filter(function (s) { return s !== 'Nothing' && !bound[s]; });

    if (op === 'Equal') {
      var lhs = E().box(j[1]), rhs = E().box(j[2]);
      // f(x) = ... : fonction à tracer
      if (Array.isArray(j[1]) && j[1].length === 2 && /^[a-z]$/.test(j[1][0]) && typeof j[1][1] === 'string') {
        return functionPlot(rhs, j[1][1], src, j[1][0] + '(' + j[1][1] + ')');
      }
      if (unknowns.length === 0) return equalityCheck(lhs, rhs, src);
      if (unknowns.length === 1) {
        var lin = linear(lhs, rhs, unknowns[0], src);
        if (lin) return lin;
        return { valid: true, kind: 'equation', route: 'server', apiType: 'equation', label: 'Équation', variable: unknowns[0],
                 plot: plotOf([{ label: 'membre de gauche', e: lhs }, { label: 'membre de droite', e: rhs }], unknowns[0]) };
      }
      return { valid: true, kind: 'equation', route: 'server', apiType: 'equation', label: 'Équation' };
    }
    if (unknowns.length === 0) return arithmetic(e, src);
    if (unknowns.length === 1) return functionPlot(e, unknowns[0], src, null);
    return { valid: true, kind: 'expression', route: 'none', label: 'Expression à plusieurs variables' };
  }

  function arithmetic(e, src) {
    var exact = e.evaluate();
    var exactTex = texOf(exact);
    var x = real(e);
    // forme exacte aboutie : un nombre, ou une forme close (racines, π, fractions) sans fonction non évaluée
    var closed = !(exact.unknowns || []).length && !/\\(error|operatorname|mathrm)|\\bot|\\imaginaryI/.test(exact.latex);
    if (!closed && x === null) {
      return { valid: true, kind: 'arithmetic', route: 'none', label: 'Calcul', reason: 'Calcul non abouti : ' + exactTex };
    }
    var approx = x !== null ? decimalLatex(x) : null;
    var isDecimal = /\d\.\d/.test(exactTex);
    var result = closed && !isDecimal && exactTex.length <= 60 ? exactTex : approx || exactTex;
    var steps = [{ text_fr: 'On calcule l\'expression.', latex: src + ' = ' + result }];
    var isInteger = /^-?\d+(\\,\d{3})*$/.test(result);
    var numeric = approx && !isInteger && approx !== result ? approx : null;
    if (numeric) steps.push({ text_fr: 'Valeur approchée.', latex: result + ' \\approx ' + numeric });
    return {
      valid: true, kind: 'arithmetic', route: 'local', label: 'Calcul', statement: 'Calculer $' + src + '$.',
      result: { latex: result, numeric: numeric }, steps: steps, answers: x !== null ? [x] : [],
    };
  }

  function equalityCheck(lhs, rhs, src) {
    var a = real(lhs), b = real(rhs);
    if (a === null || b === null) return { valid: true, kind: 'arithmetic', route: 'none', label: 'Égalité', reason: 'Égalité non évaluable' };
    var ok = Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
    return {
      valid: true, kind: 'check', route: 'local', label: 'Égalité à vérifier', statement: 'Vérifier l\'égalité $' + src + '$.',
      result: { latex: ok ? '\\text{Vrai}' : '\\text{Faux}', numeric: null },
      steps: [
        { text_fr: 'Valeur du membre de gauche.', latex: side(lhs) },
        { text_fr: 'Valeur du membre de droite.', latex: side(rhs) },
      ],
    };
  }

  function side(e) { var a = texOf(e), b = texOf(e.evaluate()); return a === b ? a : a + ' = ' + b; }

  /**
   * Équation du premier degré : f(v) = lhs - rhs est affine si f(t) = k t + f(0) aux points de contrôle
   * (calcul exact). Étapes identiques à datagen/problems.py:linear_problem.
   */
  function linear(lhs, rhs, v, src) {
    var f = E().box(['Subtract', lhs.json, rhs.json]);
    function at(t) { var sub = {}; sub[v] = E().box(t); return f.subs(sub).evaluate(); }
    var f0 = at(0), f1 = at(1);
    if (!f0.isNumberLiteral || !f1.isNumberLiteral) return null;
    var k = E().box(['Subtract', f1.json, f0.json]).evaluate();
    if (real(k) === null || Math.abs(real(k)) < 1e-15) return null;
    var probes = [2, 3, -1, ['Rational', 1, 2], ['Rational', 7, 3]];
    for (var i = 0; i < probes.length; i++) {
      var expect = E().box(['Add', ['Multiply', k.json, probes[i]], f0.json]).evaluate();
      var got = at(probes[i]);
      var d = real(E().box(['Subtract', got.json, expect.json]));
      if (d === null || Math.abs(d) > 1e-12) return null;
    }
    var r = E().box(['Negate', f0.json]).evaluate();
    var sol = E().box(['Divide', r.json, k.json]).evaluate();
    var kx = texOf(E().box(['Multiply', k.json, v]).evaluate());
    var solTex = texOf(sol), kTex = texOf(k), rTex = texOf(r);
    var steps = [
      { text_fr: 'On regroupe les termes en ' + v + ' à gauche et les constantes à droite.', latex: kx + ' = ' + rTex },
      { text_fr: 'On divise les deux membres par ' + kTex + '.', latex: v + ' = ' + solTex },
      { text_fr: 'L\'équation admet une unique solution : $' + v + ' = ' + solTex + '$.', latex: null },
    ];
    var s = real(sol);
    var numeric = /\\frac/.test(solTex) && s !== null ? decimalLatex(s) : null;
    var resultTex = v + ' \\in \\left\\{' + solTex + '\\right\\}';
    return {
      valid: true, kind: 'linear', route: 'local', apiType: 'equation', label: 'Équation du premier degré', variable: v,
      statement: 'Résoudre dans $\\mathbb{R}$ l\'équation $' + src + '$.',
      result: { latex: resultTex, numeric: numeric ? v + ' \\approx ' + numeric : null },
      steps: steps, solutions: [s], answers: [s],
      plot: plotOf([{ label: 'membre de gauche', e: lhs }, { label: 'membre de droite', e: rhs }], v, s !== null ? [{ label: v + ' = ' + solTex, x: s, y: real(lhs.subs((function () { var o = {}; o[v] = sol; return o; })())) }] : []),
    };
  }

  function functionPlot(e, v, src, name) {
    var simplified = texOf(e.simplify());
    return {
      valid: true, kind: 'function', route: 'local', label: 'Fonction', variable: v,
      result: simplified !== texOf(e) ? { latex: (name ? name + ' = ' : '') + simplified, numeric: null } : null,
      steps: [], plot: plotOf([{ label: name || src, e: e }], v),
    };
  }

  /** Courbes du graphe : LaTeX recompilé par la page du graphe (CortexJS) */
  function plotOf(list, v, points) {
    var curves = [];
    list.forEach(function (it) {
      var u = (it.e.unknowns || []).filter(function (s) { return s !== v; });
      if (u.length === 0 && it.e.unknowns && it.e.unknowns.indexOf(v) >= 0) curves.push({ label: it.label, latex: texOf(it.e) });
    });
    if (!curves.length) return null;
    return { var: v, curves: curves, points: (points || []).filter(function (p) { return isFinite(p.x) && isFinite(p.y); }) };
  }

  // ------------------------------------------------------------ fidélité de l'explication

  var MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([\s\S]+?)\$|\\\(([\s\S]+?)\\\)/g;
  var SEP_RE = /\\quad|\\qquad|\\text\{[^}]*\}|\\textrm\{[^}]*\}|\\mathrm\{\s*(?:ou|et|donc)\s*\}|;|\\\\|\\iff|\\Leftrightarrow|\\Rightarrow|\\implies|\\Longleftrightarrow/;
  var SKIP_RE = /\\neq|\\ne\b|<|>|\\leq?|\\geq?|\\in\b|\\notin|\\approx|\\simeq|\\sim\b|\\to\b|\\\{|\\emptyset|\\varnothing|\\mathbb|\\forall|\\exists|\\pm|\\mp/;
  var NUM_RE = /(?<![a-zA-Z_^\\])\d+(?:\.\d+)?/g;
  var BLOCKED = { Integrate: 1, Limit: 1, D: 1, Derivative: 1, Apply: 1, Equal: 1, Less: 1, Greater: 1, LessEqual: 1, GreaterEqual: 1, Element: 1, Tuple: 1, List: 1, Sequence: 1, Pair: 1, Nothing: 1, Error: 1 };

  function normalize(s, vars) {
    s = String(s)
      .replace(/\\left\s*([(\[|.])/g, '$1').replace(/\\right\s*([)\]|.])/g, '$1').replace(/\\left\.|\\right\./g, '')
      .replace(/\\(?:mathrm|operatorname|text)\{\s*e\s*\}/g, 'e')
      .replace(/\\cdot/g, '\\times').replace(/\\[dt]frac/g, '\\frac')
      .replace(/\\[,;:!]|\\ |~/g, ' ')
      .replace(/(\d),(\d)/g, '$1.$2')
      .replace(/\\(?:begin|end)\{[a-z*]+\}/g, '').replace(/&/g, '').replace(/\\displaystyle/g, '');
    (vars || ['x', 'y']).forEach(function (v) {
      s = s.replace(new RegExp('(^|[^a-zA-Z\\\\])' + v + '_\\{?\\w+\\}?', 'g'), '$1' + v);
    });
    return s.trim().replace(/\.$/, '').trim();
  }

  function splitRelations(seg) {
    var pairs = [];
    seg.split(SEP_RE).forEach(function (part) {
      if (!part || part.indexOf('=') < 0 || SKIP_RE.test(part)) return;
      var sides = part.split('=').map(function (p) { return p.trim(); }).filter(Boolean);
      for (var i = 0; i + 1 < sides.length; i++) pairs.push([sides[i], sides[i + 1]]);
    });
    return pairs;
  }

  function numbersIn(latex) {
    var out = {};
    (normalize(latex).match(NUM_RE) || []).forEach(function (n) {
      if (n.indexOf('.') >= 0) n = n.replace(/0+$/, '').replace(/\.$/, '');
      out[n] = true;
    });
    return out;
  }

  /** Générateur pseudo-aléatoire reproductible (mêmes points à chaque vérification) */
  function rng(seed) { return function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }

  function compiled(latex, allowedVars) {
    var e = parse(latex);
    if (!e.isValid) return null;
    var hs = heads(e.json);
    for (var h in hs) if (BLOCKED[h]) return null;
    var u = (e.unknowns || []);
    for (var i = 0; i < u.length; i++) if (allowedVars.indexOf(u[i]) < 0) return null;
    var fn;
    try { fn = e.compile(); } catch (err) { return null; }
    if (typeof fn !== 'function') return null;
    return { e: e, fn: fn, vars: u };
  }

  function call(c, pt) {
    try { var v = c.fn(pt); return typeof v === 'number' && isFinite(v) ? v : null; } catch (err) { return null; }
  }

  function close(a, b) { return Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(b)); }

  function relationHolds(A, B, ctx) {
    var allowed = ctx.vars.concat(['C'], Object.keys(ctx.symbols));
    var a = compiled(A, allowed), b = compiled(B, allowed);
    if (!a || !b) return 'unparsed';
    var vars = {}; a.vars.concat(b.vars).forEach(function (v) { vars[v] = true; });
    var names = Object.keys(vars);
    var r = rng(7), identity = true, diffs = [], bad = false;
    for (var k = 0; k < 6; k++) {
      var pt = {};
      names.forEach(function (n) { pt[n] = n in ctx.symbols ? ctx.symbols[n] : n === 'C' ? 0 : 0.3 + 2.4 * r(); });
      var va = call(a, pt), vb = call(b, pt);
      if (va === null || vb === null) { bad = true; break; }
      if (!close(va, vb)) identity = false;
      diffs.push(va - vb);
    }
    if (!bad && identity) return 'ok';
    if (!bad && (ctx.ptype === 'integral' || vars.C)) {
      var mn = Math.min.apply(null, diffs), mx = Math.max.apply(null, diffs);
      if (mx - mn <= 1e-7 * Math.max(1, Math.abs(mx))) return 'ok';
    }
    if (ctx.solutions && ctx.solutions.length) {
      var hit = ctx.solutions.map(function (sol) {
        var pt = Object.assign({ C: 0 }, ctx.symbols, sol);
        var va = call(a, pt), vb = call(b, pt);
        return va !== null && vb !== null && close(va, vb);
      });
      var good = ctx.ptype === 'system' ? hit.every(Boolean) : hit.some(Boolean);
      if (good) return 'ok';
    }
    return bad ? 'unparsed' : 'fail';
  }

  function isFinalAnswer(B, ctx) {
    var allowed = ctx.vars.concat(['C'], Object.keys(ctx.symbols));
    var b = compiled(B, allowed);
    if (!b) return false;
    if (ctx.ptype === 'derivative' && ctx.answerFn) {
      var f = compiled(ctx.answerFn, allowed);
      if (!f) return false;
      var r = rng(3);
      for (var i = 0; i < 5; i++) {
        var pt = { x: 0.3 + 2.4 * r(), C: 0 };
        var u = call(b, pt), w = call(f, pt);
        if (u === null || w === null || !close(u, w)) return false;
      }
      return true;
    }
    if (ctx.ptype === 'integral' && ctx.integrand) {
      var g = compiled(ctx.integrand, allowed);
      if (!g) return false;
      var r2 = rng(5), h = 1e-4;
      for (var j = 0; j < 5; j++) {
        var x0 = 0.4 + 2.2 * r2();
        var p1 = call(b, { x: x0 + h, C: 0 }), p0 = call(b, { x: x0 - h, C: 0 }), gv = call(g, { x: x0 });
        if (p1 === null || p0 === null || gv === null || Math.abs((p1 - p0) / (2 * h) - gv) > 1e-4 * Math.max(1, Math.abs(gv))) return false;
      }
      return true;
    }
    if (b.vars.length) return false;
    var v = call(b, {});
    return v !== null && (ctx.answers || []).some(function (ans) { return typeof ans === 'number' && close(v, ans); });
  }

  /**
   * ctx = { text, ptype, vars, solutions: [{x: 2}], answers: [nombres], answerFn, integrand,
   *         sources: [LaTeX et textes de l'énoncé, du résultat et des étapes], noRealSolution }
   */
  function checkExplanation(ctx) {
    active = newCE();
    try { return check(ctx); } finally { active = null; }
  }

  function check(ctx) {
    ctx.vars = ctx.vars && ctx.vars.length ? ctx.vars : ['x'];
    // valeurs nommées dans les étapes (a, b, c, Delta...) : comme problem["symbols"] côté serveur
    ctx.symbols = ctx.symbols || {};
    var rep = { ok: 0, fail: 0, unparsed: 0, failures: [], finalStated: false, numbers: 0, hallucinated: [] };
    if (ctx.noRealSolution) rep.finalStated = /aucune solution|pas de solution|\\emptyset|\\varnothing/i.test(ctx.text);
    var allowed = { '0': true, '1': true, '2': true };
    (ctx.sources || []).forEach(function (s) { Object.assign(allowed, numbersIn(s || '')); });
    var segments = [], m;
    MATH_RE.lastIndex = 0;
    while ((m = MATH_RE.exec(ctx.text))) {
      var raw = m[1] || m[2] || m[3] || m[4];
      var nums = numbersIn(raw);
      rep.numbers += Object.keys(nums).length;
      var seg = normalize(raw, ctx.vars), segOk = 0, segBad = 0;
      splitRelations(seg).forEach(function (p) {
        var res = relationHolds(p[0], p[1], ctx);
        if (res === 'ok') {
          rep.ok++; segOk++;
          if (!rep.finalStated && isFinalAnswer(p[1], ctx)) rep.finalStated = true;
        } else if (res === 'fail') {
          rep.fail++; segBad++; rep.failures.push(p[0] + ' = ' + p[1]);
        } else {
          rep.unparsed++; segBad++;
        }
      });
      segments.push({ nums: nums, ok: segOk > 0 && segBad === 0 });
    }
    var derived = {};
    segments.forEach(function (s) { if (s.ok) Object.assign(derived, s.nums); });
    segments.forEach(function (s) {
      Object.keys(s.nums).forEach(function (n) {
        if (!allowed[n] && !derived[n] && rep.hallucinated.indexOf(n) < 0) rep.hallucinated.push(n);
      });
    });
    var total = rep.ok + rep.fail + rep.unparsed;
    rep.score = rep.ok + rep.fail ? rep.ok / (rep.ok + rep.fail) : 0;
    rep.accept = rep.fail === 0 && rep.hallucinated.length === 0 && rep.ok >= 1 && rep.finalStated &&
      (total ? rep.unparsed / total : 1) <= 0.34;
    return rep;
  }

  /** Valeurs numériques d'une liste de LaTeX (solutions renvoyées par le serveur) */
  function values(list) {
    return (list || []).map(function (l) { var e = parse(l); return e.isValid ? real(e) : null; });
  }

  /**
   * Le serveur a-t-il répondu pour le problème envoyé ? Comparaison numérique en quelques points :
   * équation = même lhs - rhs à un facteur près ; dérivée, primitive, limite = même fonction.
   * true si on ne sait pas comparer (on ne bloque pas une réponse sur un doute de lecture).
   */
  function sameProblem(sent, received, type) {
    function body(l) {
      l = String(l).trim();
      var m;
      if (type === 'derivative' && (m = l.match(/^\\frac\{d\}\{d\s*x\}\s*(.*)$/))) return m[1];
      if (type === 'integral' && (m = l.match(/^\\int\s*(.*?)\s*\\?,?\s*d\s*x\s*$/))) return m[1];
      if (type === 'limit' && (m = l.match(/^\\lim_\{[^}]*\}\s*(.*)$/))) return m[1];
      if (type === 'equation' && l.indexOf('=') > 0) { var s = l.split('='); return '(' + s[0] + ')-(' + s[1] + ')'; }
      return null;
    }
    var a = body(sent), b = body(received);
    if (a === null || b === null) return true;
    var ca = compiled(a, ['x']), cb = compiled(b, ['x']);
    if (!ca || !cb) return true;
    var r = rng(11), ratio = null;
    for (var i = 0; i < 6; i++) {
      var x = 0.3 + 2.4 * r(), va = call(ca, { x: x }), vb = call(cb, { x: x });
      if (va === null || vb === null) return true;
      if (type === 'equation') {
        if (Math.abs(va) < 1e-9 && Math.abs(vb) < 1e-9) continue;
        if (Math.abs(va) < 1e-9 || Math.abs(vb) < 1e-9) return false;
        var q = vb / va;
        if (ratio === null) ratio = q; else if (!close(q, ratio)) return false;
      } else if (!close(va, vb)) return false;
    }
    return true;
  }

  function evaluate(latex) {
    var e = parse(latex);
    if (!e.isValid) throw new Error('LaTeX invalide');
    var exact = e.evaluate();
    var x = real(e);
    return { exactLatex: texOf(exact), numericLatex: x !== null ? decimalLatex(x) : null, value: x, isNumber: !!exact.isNumberLiteral };
  }

  return {
    analyze: analyze, evaluate: evaluate, checkExplanation: checkExplanation, values: values,
    detectType: detectType, decimalLatex: decimalLatex,
    isValid: function (latex) { return parse(latex).isValid; },
    sameProblem: function (a, b, type) { active = newCE(); try { return sameProblem(a, b, type); } finally { active = null; } },
  };
}
`;
