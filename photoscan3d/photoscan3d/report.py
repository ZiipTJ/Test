"""Rapport de controle du scan, au format HTML autonome.

Le rapport existe pour repondre a une seule question : peut-on faire
confiance aux cotes de ce modele ? Il affiche donc les chiffres qui
permettent de trancher, avertissements compris.
"""

from __future__ import annotations

import html
from datetime import datetime
from pathlib import Path

STYLE = """
:root { color-scheme: light dark; --bg:#fbfbfa; --fg:#1c1c1a; --muted:#65655f;
        --line:#e2e2dd; --card:#ffffff; --ok:#1a7f4b; --warn:#9a6209; --bad:#a32020; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#16161a; --fg:#ececeb; --muted:#a0a09a; --line:#2e2e34;
          --card:#1e1e23; --ok:#4ec27f; --warn:#e0a33c; --bad:#f0776c; } }
body { margin:0; padding:32px 20px; background:var(--bg); color:var(--fg);
       font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif; }
main { max-width:860px; margin:0 auto; }
h1 { font-size:26px; margin:0 0 4px; }
h2 { font-size:18px; margin:32px 0 12px; padding-bottom:6px;
     border-bottom:1px solid var(--line); }
.sub { color:var(--muted); margin:0 0 24px; }
.verdict { padding:16px 18px; border-radius:10px; border:1px solid var(--line);
           background:var(--card); margin-bottom:8px; }
.verdict strong { font-size:19px; }
.ok { color:var(--ok); } .warn { color:var(--warn); } .bad { color:var(--bad); }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
        gap:12px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px;
        padding:14px 16px; }
.card .label { color:var(--muted); font-size:13px; }
.card .value { font-size:20px; font-variant-numeric:tabular-nums; margin-top:2px; }
table { width:100%; border-collapse:collapse; font-size:14px; }
th,td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); }
th { color:var(--muted); font-weight:600; }
td.num { text-align:right; font-variant-numeric:tabular-nums; }
ul { padding-left:20px; } li { margin:4px 0; }
footer { margin-top:40px; color:var(--muted); font-size:13px; }
"""


def _card(label: str, value: str) -> str:
    return (f'<div class="card"><div class="label">{html.escape(label)}</div>'
            f'<div class="value">{html.escape(value)}</div></div>')


def _verdict(result) -> str:
    if result.scale is None:
        return ('<div class="verdict"><strong class="bad">Modele sans echelle</strong>'
                "<p>Aucune mesure ne peut etre tiree de ce modele : les marqueurs "
                "n'ont pas ete exploites ou n'ont pas ete reconnus. La forme reste "
                "correcte, les dimensions sont arbitraires.</p></div>")
    accuracy = result.scale.expected_accuracy_mm
    if accuracy <= 0.5:
        level, text = "ok", "Echelle metrique fiable"
    elif accuracy <= 2.0:
        level, text = "warn", "Echelle metrique exploitable avec reserve"
    else:
        level, text = "bad", "Echelle metrique peu fiable"
    return (f'<div class="verdict"><strong class="{level}">{text}</strong>'
            f"<p>Incertitude indicative de <b>&plusmn; {accuracy:.2f} mm</b> sur une "
            f"cote de l'ordre de {result.scale.baseline_mm:.0f} mm, estimee a partir "
            "du recalage sur la planche et d'un plancher systematique de 0,1 %. "
            "Elle porte sur le transfert d'echelle&nbsp;: elle ne dit rien du bruit "
            "local de la surface reconstruite, ni d'une erreur sur la taille de "
            "marqueur saisie, qui se reporterait telle quelle sur toutes les "
            "cotes.</p></div>")


def _quality_table(report) -> str:
    if report is None or not report.flagged:
        return "<p>Aucune photo problematique detectee.</p>"
    rows = "".join(
        f"<tr><td>{html.escape(info.path.name)}</td>"
        f'<td class="num">{info.sharpness:.0f}</td>'
        f'<td class="num">{info.clipped_fraction * 100:.1f} %</td>'
        f"<td>{html.escape(', '.join(info.issues))}</td></tr>"
        for info in report.flagged[:40])
    more = ("" if len(report.flagged) <= 40
            else f"<p>... et {len(report.flagged) - 40} autres.</p>")
    return ("<table><tr><th>Photo</th><th>Nettete</th><th>Blancs brules</th>"
            f"<th>Signale</th></tr>{rows}</table>{more}")


def build_html(result, settings) -> str:
    scale = result.scale
    cards = [
        _card("Images alignees", f"{result.registered_images} / {result.total_images}"),
        _card("Erreur de reprojection", f"{result.reprojection_error_px:.3f} px"),
        _card("Duree du calcul", f"{result.duration_s / 60:.0f} min"),
    ]
    if scale is not None:
        cards += [
            _card("Echelle", f"{scale.scale_mm_per_unit:.6g} mm/unite"),
            _card("Residu de recalage", f"{scale.fit_rms_mm:.3f} mm RMS"),
            _card("Dispersion", f"{scale.relative_std * 100:.3f} %"),
            _card("Planeite de la planche", f"{scale.planarity_mm:.3f} mm"),
            _card("Marqueurs exploites", f"{scale.n_markers} ({scale.n_corners} coins)"),
        ]
    if result.stats is not None:
        unit = "mm" if scale else "u."
        dx, dy, dz = result.stats.dimensions
        cards += [
            _card("Encombrement", f"{dx:.1f} x {dy:.1f} x {dz:.1f} {unit}"),
            _card("Triangles", f"{result.stats.triangles}"),
        ]

    warnings = ("<ul>" + "".join(f"<li>{html.escape(w)}</li>"
                                 for w in result.warnings) + "</ul>"
                if result.warnings else "<p>Aucun avertissement.</p>")

    files = "".join(
        f"<li><code>{html.escape(str(path.name))}</code></li>"
        for path in (result.obj_path, result.stl_path) if path is not None)

    return f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rapport de scan</title><style>{STYLE}</style></head>
<body><main>
<h1>Rapport de scan photogrammetrique</h1>
<p class="sub">{html.escape(result.output_dir.name)} &mdash;
{datetime.now():%d/%m/%Y %H:%M} &mdash; qualite {html.escape(settings.preset.label)}</p>

{_verdict(result)}

<h2>Chiffres cles</h2>
<div class="grid">{''.join(cards)}</div>

<h2>Avertissements</h2>
{warnings}

<h2>Photos signalees</h2>
{_quality_table(result.quality)}

<h2>Fichiers produits</h2>
<ul>{files}</ul>

<h2>Comment ameliorer la precision</h2>
<ul>
<li>Augmenter le nombre de vues (80 a 150) et le recouvrement entre vues
    successives, sur au moins trois hauteurs differentes.</li>
<li>Verrouiller la mise au point et l'exposition, desactiver le HDR et le
    mode Live, et eviter tout zoom : une seule focale pour toute la serie.</li>
<li>Eclairage diffus, sans ombre dure ni reflet ; matifier les surfaces
    brillantes ou transparentes.</li>
<li>Coller la planche de marqueurs sur un support parfaitement plan et
    saisir la taille de marqueur <em>mesuree au pied a coulisse</em>.</li>
<li>Rapprocher l'appareil : la precision est proportionnelle a la distance
    de prise de vue.</li>
</ul>

<footer>Genere par PhotoScan3D &mdash; chaine COLMAP + OpenMVS.
Les incertitudes affichees sont des indicateurs de controle, elles ne
constituent pas un certificat d'etalonnage.</footer>
</main></body></html>
"""


def write_report(result, settings, directory: str | Path) -> Path:
    path = Path(directory) / "rapport.html"
    path.write_text(build_html(result, settings), encoding="utf-8")
    return path
