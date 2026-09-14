"""Interface en ligne de commande, utile pour les lots et le diagnostic."""

from __future__ import annotations

import argparse
import sys
import threading
from pathlib import Path

from .config import QUALITY_PRESETS, Settings, resolve_toolchain
from .images import inspect_images, list_source_images
from .markers import BoardSpec, board_instructions, write_printable_board
from .pipeline import Cancelled, Pipeline, PipelineError, estimate_runtime_hint


def _settings_from_args(args) -> Settings:
    settings = Settings.load()
    if getattr(args, "quality", None):
        settings.quality = args.quality
    if getattr(args, "threads", None) is not None:
        settings.threads = args.threads
    if getattr(args, "marker_mm", None) is not None:
        settings.marker_mm = args.marker_mm
    if getattr(args, "gap_mm", None) is not None:
        settings.gap_mm = args.gap_mm
    if getattr(args, "rows", None) is not None:
        settings.board_rows = args.rows
    if getattr(args, "cols", None) is not None:
        settings.board_cols = args.cols
    if getattr(args, "no_markers", False):
        settings.use_markers = False
    if getattr(args, "colmap", None):
        settings.colmap_path = args.colmap
    if getattr(args, "openmvs", None):
        settings.openmvs_dir = args.openmvs
    return settings


def _add_board_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--marker-mm", type=float,
                        help="cote mesure d'un marqueur imprime, en mm")
    parser.add_argument("--gap-mm", type=float, help="espacement entre marqueurs, en mm")
    parser.add_argument("--rows", type=int, help="nombre de lignes de la planche")
    parser.add_argument("--cols", type=int, help="nombre de colonnes de la planche")


def command_scan(args) -> int:
    settings = _settings_from_args(args)
    input_dir, output_dir = Path(args.photos), Path(args.output)
    count = len(list_source_images(input_dir)) if input_dir.is_dir() else 0
    print(f"{count} photos - {estimate_runtime_hint(count, settings.preset)}")

    pipeline = Pipeline(input_dir, output_dir, settings,
                        on_log=print,
                        on_progress=lambda fraction, label:
                            print(f"[{fraction * 100:5.1f} %] {label}"),
                        cancel_event=threading.Event())
    try:
        result = pipeline.run()
    except (PipelineError, Cancelled) as error:
        print(f"\nEchec : {error}", file=sys.stderr)
        return 1

    print("\n=== Resultat ===")
    if result.scale is not None:
        print(result.scale.summary())
    else:
        print("Modele SANS echelle : aucune cote ne peut en etre tiree.")
    if result.stats is not None:
        print(result.stats.summary("mm" if result.scale else "unites"))
    for warning in result.warnings:
        print(f"Attention : {warning}")
    print(f"Modele : {result.obj_path}")
    print(f"Rapport : {result.output_dir / 'rapport.html'}")
    return 0


def command_check(args) -> int:
    sources = list_source_images(Path(args.photos))
    if not sources:
        print("Aucune photo reconnue dans ce dossier.", file=sys.stderr)
        return 1
    report = inspect_images(sources, progress=lambda done, total:
                            print(f"\rAnalyse {done}/{total}", end="", flush=True))
    print("\n" + report.summary())
    for info in report.flagged:
        print(f"  {info.path.name} : {', '.join(info.issues)}")
    return 1 if report.has_blocking_issue else 0


def command_board(args) -> int:
    settings = _settings_from_args(args)
    spec: BoardSpec = settings.board_spec()
    path = write_printable_board(spec, args.output, dpi=args.dpi)
    print(f"Planche ecrite : {path}\n")
    print(board_instructions(spec))
    return 0


def command_tools(args) -> int:
    settings = _settings_from_args(args)
    toolchain = resolve_toolchain(settings)
    print(toolchain.describe())
    if toolchain.is_complete:
        print("\nLa chaine est complete.")
        return 0
    print("\nManquants : " + ", ".join(toolchain.missing))
    print("Installez COLMAP et OpenMVS, puis relancez avec --colmap et --openmvs "
          "pour enregistrer leur emplacement.")
    if args.colmap or args.openmvs:
        settings.save()
    return 1


def command_gui(args) -> int:
    try:
        from .gui import main as gui_main
    except ImportError as error:
        print(f"Interface graphique indisponible ({error}).\n"
              "Installez PySide6 : pip install PySide6", file=sys.stderr)
        return 1
    return gui_main()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="photoscan3d",
        description="Scan 3D metrique a partir de photographies (COLMAP + OpenMVS).")
    parser.add_argument("--colmap", help="chemin de l'executable COLMAP")
    parser.add_argument("--openmvs", help="dossier des executables OpenMVS")
    subparsers = parser.add_subparsers(dest="command")

    gui = subparsers.add_parser("gui", help="ouvrir l'interface graphique")
    gui.set_defaults(func=command_gui)

    scan = subparsers.add_parser("scan", help="reconstruire un objet")
    scan.add_argument("photos", help="dossier contenant les photos")
    scan.add_argument("-o", "--output", required=True, help="dossier resultat")
    scan.add_argument("--quality", choices=sorted(QUALITY_PRESETS),
                      help="niveau de qualite du calcul")
    scan.add_argument("--threads", type=int, help="0 pour utiliser tous les coeurs")
    scan.add_argument("--no-markers", action="store_true",
                      help="ne pas mettre le modele a l'echelle")
    _add_board_arguments(scan)
    scan.set_defaults(func=command_scan)

    check = subparsers.add_parser("check", help="controler un lot de photos")
    check.add_argument("photos")
    check.set_defaults(func=command_check)

    board = subparsers.add_parser("board", help="generer la planche a imprimer")
    board.add_argument("-o", "--output", default="planche_aruco.pdf")
    board.add_argument("--dpi", type=int, default=600)
    _add_board_arguments(board)
    board.set_defaults(func=command_board)

    tools = subparsers.add_parser("tools", help="verifier l'installation")
    tools.set_defaults(func=command_tools)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not hasattr(args, "func"):
        return command_gui(args)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
