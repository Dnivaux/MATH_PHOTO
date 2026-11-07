"""Post-traitement du LaTeX produit par les modèles OCR (sans dépendance lourde : partagé avec eval/)."""

from __future__ import annotations

import re

DELIMITERS = re.compile(r"^\s*(?:\\\[|\\\(|\$\$?)(.*?)(?:\\\]|\\\)|\$\$?)\s*$", re.S)


def strip_delimiters(latex: str) -> str:
    """Retire les délimiteurs d'affichage autour de la formule : TexTeller renvoie \\[ ... \\]."""
    m = DELIMITERS.match(latex)
    return (m.group(1) if m else latex).strip()

FUNCTIONS = ("sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|log|ln|exp|lim|max|min|det|gcd")
_NAMED = re.compile(r"\\(operatorname\*?|mathrm|mathsf|text|mathit)\s*\{\s*([a-zA-Z ]+?)\s*\}")
_UNWRAP = re.compile(r"\\(boldsymbol|mathbf|bm|pmb|mathit)\s*\{([^{}]*)\}")
_UPRIGHT = re.compile(r"\\(mathrm|mathsf)\s*\{([^{}]*)\}")
_ARRAY = re.compile(r"^\\begin\{array\}\s*\{\s*\|?\s*c\s*\|?\s*\}(.*)\\end\{array\}$", re.S)


def _closing(s: str, i: int) -> int:
    """Indice de l'accolade fermante qui correspond à l'accolade ouvrante s[i] (-1 si absente)."""
    depth = 0
    for j in range(i, len(s)):
        depth += {"{": 1, "}": -1}.get(s[j], 0)
        if depth == 0:
            return j
    return -1


def _unwrap_outer(s: str) -> str:
    """TexTeller encadre parfois toute la formule : \\boxed{...}, tableau d'une seule case, \\hline en tête."""
    while True:
        t = re.sub(r"^(\\hline\s*)+", "", s).strip()
        if t.startswith("\\boxed") and (i := t.find("{")) != -1 and _closing(t, i) == len(t) - 1:
            t = t[i + 1:-1].strip()
        elif (m := _ARRAY.match(t)) and "&" not in m.group(1) and "\\\\" not in m.group(1).strip().removesuffix("\\\\"):
            t = m.group(1).strip().removesuffix("\\\\").strip()
        if t == s:
            return s
        s = t


def canonicalize(latex: str) -> str:
    """Ramène les variantes d'écriture des modèles OCR à la forme standard, sans changer la formule :
    délimiteurs et cadres d'affichage, `\\operatorname*{l i m}` / `\\mathrm{s i n}` -> `\\lim` / `\\sin`,
    `\\underset{x\\to 0}{\\lim}` -> `\\lim_{x\\to 0}`, gras, styles, tailles et espacements. Même rendu à l'écran."""
    s = _unwrap_outer(strip_delimiters(latex))

    def named(m: re.Match) -> str:
        name = re.sub(r"\s+", "", m.group(2))
        return f"\\{name} " if re.fullmatch(FUNCTIONS, name) else m.group(0)

    s = _NAMED.sub(named, s)
    # \mathrm{d}, \mathrm{x \to 0} : droit ou italique, c'est la même variable (≥ 2 lettres : une unité, on garde)
    s = _UPRIGHT.sub(lambda m: m.group(2) if len(re.findall(r"[a-zA-Z]", re.sub(r"\\[a-zA-Z]+", "", m.group(2)))) <= 1 else m.group(0), s)
    s = re.sub(r"\\underset\s*\{([^{}]*)\}\s*\{\s*\\lim\s*\}", r"\\lim_{\1}", s)
    for _ in range(3):  # imbrications : \boldsymbol{\boldsymbol{x}}
        s = _UNWRAP.sub(r"\2", s)
    s = re.sub(r"\\(displaystyle|textstyle|scriptstyle|limits|mathstrut|tiny|small|large|Large|LARGE|huge)(?![a-zA-Z])", "", s)
    s = re.sub(r"\\[bB]igg?[lrm]?(?![a-zA-Z])", "", s)            # \bigl( -> (
    s = re.sub(r"\\[dt]frac(?![a-zA-Z])", r"\\frac", s)
    s = re.sub(r"\\rightarrow(?![a-zA-Z])", r"\\to", s)
    s = re.sub(r"\\int\s*_\s*\{\s*\}(\s*\^\s*\{\s*\})?", r"\\int", s)  # bornes vides
    s = re.sub(r"\\[,:;! ](?![a-zA-Z])|\\q?quad(?![a-zA-Z])", " ", s)
    s = re.sub(r"\{\s*\\(sf|rm|it|bf|tt)(?![a-zA-Z])\s*([^{}]*)\}", r"\2", s)  # {\sf x} -> x (anciens styles)
    s = re.sub(r"\\(sf|rm|it|bf|tt)(?![a-zA-Z])", "", s)
    s = re.sub(r"^\s*=\s*", "", s)                                     # une formule ne commence pas par =
    s = re.sub(r"^\s*(\.\s*|\\cdot\s*|\\bullet\s*)+(?=\S)", "", s)     # point de numérotation en tête
    s = re.sub(r"(\s*[;,]|\s*\.(?!\d))+\s*$", "", s)                   # ponctuation finale
    return re.sub(r"\s+", " ", s).strip()
