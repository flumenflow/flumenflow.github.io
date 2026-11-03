# Flumen website

Static site (index.html, style.css, app.js, img/). Preview with `python3 -m http.server` in this folder.

- Hero: a live 2D shallow-water model in JavaScript (HLL + Audusse hydrostatic reconstruction, 180 x 110 cells of 4 m, Manning n 0.03) with three scenarios: dam break, cloudburst, storm surge. The HUD shows its mass error.
- River, estuary and wave panels are schematics; the numbers beside them come from the Flumen verification tests and the paper.
- Paper: https://zenodo.org/records/23918670 (doi:10.5281/zenodo.23918670).
- Icon: ../brand (gpt-image-2 via Codex, gen.sh + p_*.txt, concept A chosen).
