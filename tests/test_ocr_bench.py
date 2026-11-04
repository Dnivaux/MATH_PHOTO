"""Normalisation du banc OCR : les délimiteurs d'affichage ne doivent pas compter comme une erreur."""

from eval.ocr_bench import equivalent, normalize, strip_delimiters
from serving.ocr.text import canonicalize


def test_texteller_delimiters():
    assert strip_delimiters(r"\[-3x^{2}+23x-30=0\]") == "-3x^{2}+23x-30=0"
    assert strip_delimiters("$x+1$") == "x+1" and strip_delimiters("$$x+1$$") == "x+1"
    assert normalize(r"\[5-6x=6-9x\]") == normalize("5 - 6 x = 6 - 9 x")
    assert equivalent(r"\[x^{2}+4x-5=0\]", "x^{2} + 4 x - 5 = 0")
    assert not equivalent(r"\[x^{2}+4x-6=0\]", "x^{2} + 4 x - 5 = 0")


def test_canonical_writing_of_ocr_models():
    """Sorties réelles de pix2text-mfr 1.5 : même formule, autre écriture."""
    p = canonicalize(r"\underset { x \to 0 } { \operatorname* { l i m } } \, \frac { x ^ { 2 } - x } { x ^ { 2 } \, + \, 6 x }")
    assert equivalent(p, r"\lim_{x \to 0} \frac{x^{2} - x}{x^{2} + 6 x}")
    d = canonicalize(r"\frac { d } { d x } ( - x ^ { 5 } + 2 \mathrm { s i n } \, ( 2 x ) )")
    assert equivalent(d, r"\frac{d}{dx}(- x^{5} + 2 \sin{(2 x )})")
    assert canonicalize(r"\boldsymbol { x } \boldsymbol { e } ^ { \boldsymbol { x } }") == "x e ^ { x }"
    assert canonicalize(r"\[x+1\]") == "x+1"
    assert canonicalize(r"\mathrm { k g }") == r"\mathrm { k g }"  # pas une fonction : inchangé


def test_canonical_frames_and_limits():
    """Sorties réelles (banc du 4 novembre) : la bonne formule, mal habillée."""
    ref = r"\lim_{x \to 5} \frac{x^{2} - 4 x - 5}{x^{2} - 7 x + 10}"
    tex = "\\[\\boxed{\n\\begin{array}\n{c}\\lim\\limits_{x\\to 5}\\frac{x^{2}\\,-\\,4x\\,-\\,5}{x^{2}\\,-\\,7x \\,+\\,10}\n\\end{array}\n}\\]"
    assert equivalent(canonicalize(tex), ref)
    assert equivalent(canonicalize(r"\underset { \mathrm { x \to 0 } } { \operatorname* { l i m } } \, \frac { \operatorname { s i n } { \left( 7 x \right) } } { x }"),
                      r"\lim_{x \to 0} \frac{\sin{(7 x )}}{x}")
    assert canonicalize(r"= \lim _ { x \to 1 } x") == r"\lim _ { x \to 1 } x"
    assert canonicalize(r"\frac { \mathrm { d } } { \mathrm { d } x } ( x )") == r"\frac { d } { d x } ( x )"
    assert canonicalize(r"\int _ { } ^ { } x d x") == r"\int x d x"
    # un tableau à plusieurs cases n'est pas déballé
    assert canonicalize(r"\begin{array}{c}x\\y\end{array}") == r"\begin{array}{c}x\\y\end{array}"


def test_trocr_detokenize():
    """Détokenisation ByteLevel de pix2text-mfr (référence du JavaScript de l'app) : Ġ est l'espace."""
    from serving.ocr.trocr_onnx import detokenize

    assert detokenize(["<s>", "\\frac", "Ġ{", "Ġd", "Ġ}", "</s>"]) == r"\frac { d }"
    assert detokenize(["x", "Ġ^", "Ġ{", "Ġ2", "Ġ}", "<pad>"]) == "x ^ { 2 }"
    assert detokenize(["Ã©"]) == "é"  # octets UTF-8 sur deux caractères
