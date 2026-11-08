#!/usr/bin/env bash
# Icônes Android de PhotoMathon depuis assets/icon/photomathon-foreground.svg (rsvg-convert + ImageMagick).
#
# - mipmap-*/ic_launcher_foreground.png : avant-plan de l'icône adaptative (Android 8+, 108 dp)
# - mipmap-*/ic_launcher.png, ic_launcher_round.png : icônes classiques (48 dp), carré arrondi et rond
#
#     clients/mobile/scripts/make-icons.sh
set -euo pipefail

cd "$(dirname "$0")/.."
SVG=assets/icon/photomathon-foreground.svg
RES=android/app/src/main/res
BG="#1A73C8"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

for pair in mdpi:1 hdpi:1.5 xhdpi:2 xxhdpi:3 xxxhdpi:4; do
  dpi=${pair%%:*}; k=${pair##*:}
  fg=$(awk "BEGIN{print int(108*$k)}"); icon=$(awk "BEGIN{print int(48*$k)}")
  out=$RES/mipmap-$dpi
  mkdir -p "$out"
  rsvg-convert -w "$fg" -h "$fg" "$SVG" -o "$out/ic_launcher_foreground.png"
  # icône classique : les 72 dp du centre (zone visible d'une icône adaptative), sur le fond bleu
  rsvg-convert -w $((fg * 3)) -h $((fg * 3)) -b "$BG" "$SVG" -o "$TMP/full.png"
  magick "$TMP/full.png" -gravity center -crop "$((fg * 2))x$((fg * 2))+0+0" +repage -resize "${icon}x${icon}" "$TMP/sq.png"
  r=$(awk "BEGIN{print int($icon*0.22)}")
  magick "$TMP/sq.png" \( -size "${icon}x${icon}" xc:black -fill white -draw "roundrectangle 0,0 $((icon - 1)),$((icon - 1)) $r,$r" \) \
    -alpha off -compose copy_opacity -composite "$out/ic_launcher.png"
  magick "$TMP/sq.png" \( -size "${icon}x${icon}" xc:black -fill white -draw "circle $((icon / 2)),$((icon / 2)) $((icon / 2)),0" \) \
    -alpha off -compose copy_opacity -composite "$out/ic_launcher_round.png"
  echo "$dpi : avant-plan ${fg}px, icône ${icon}px"
done
