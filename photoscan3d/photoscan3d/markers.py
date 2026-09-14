"""Planche de marqueurs ArUco : definition geometrique et generation imprimable.

La planche est la reference metrique du scan. Sa geometrie est definie une
seule fois ici et reutilisee par l'estimation d'echelle, afin que les
coordonnees attendues correspondent exactement a ce qui a ete imprime.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

# Dictionnaires pertinents : peu de bits = detection plus robuste a distance.
DICTIONARIES = {
    "DICT_4X4_50": 50,
    "DICT_5X5_50": 50,
    "DICT_6X6_50": 50,
    "DICT_APRILTAG_36H11": 587,
}
DEFAULT_DICTIONARY = "DICT_4X4_50"

MM_PER_INCH = 25.4


@dataclass(frozen=True)
class BoardSpec:
    """Grille de marqueurs coplanaires, cotes en millimetres.

    ``marker_mm`` doit etre la taille *mesuree au pied a coulisse* sur la
    planche imprimee, pas la taille nominale : les imprimantes appliquent
    couramment 0,3 a 1 % d'erreur d'echelle, ce qui se reporterait
    integralement sur le modele.
    """

    rows: int = 3
    cols: int = 4
    marker_mm: float = 40.0
    gap_mm: float = 12.0
    dictionary: str = DEFAULT_DICTIONARY
    first_id: int = 0

    def __post_init__(self) -> None:
        if self.rows < 1 or self.cols < 1:
            raise ValueError("la planche doit compter au moins un marqueur")
        if self.marker_mm <= 0:
            raise ValueError("marker_mm doit etre strictement positif")
        if self.gap_mm < 0:
            raise ValueError("gap_mm ne peut pas etre negatif")
        if self.dictionary not in DICTIONARIES:
            raise ValueError(f"dictionnaire inconnu : {self.dictionary}")
        if self.rows * self.cols > DICTIONARIES[self.dictionary]:
            raise ValueError(
                f"{self.dictionary} ne contient que {DICTIONARIES[self.dictionary]} marqueurs"
            )

    @property
    def marker_ids(self) -> list[int]:
        return [self.first_id + i for i in range(self.rows * self.cols)]

    @property
    def width_mm(self) -> float:
        return self.cols * self.marker_mm + (self.cols - 1) * self.gap_mm

    @property
    def height_mm(self) -> float:
        return self.rows * self.marker_mm + (self.rows - 1) * self.gap_mm

    @property
    def diagonal_mm(self) -> float:
        """Plus grande distance entre deux coins : la base de mesure utile."""
        return float(np.hypot(self.width_mm, self.height_mm))

    def corner_positions(self) -> dict[int, np.ndarray]:
        """Coins de chaque marqueur dans le repere planche (mm, z = 0).

        L'ordre des quatre coins suit celui de ``cv2.aruco.detectMarkers`` :
        haut-gauche, haut-droit, bas-droit, bas-gauche.
        """
        pitch = self.marker_mm + self.gap_mm
        positions: dict[int, np.ndarray] = {}
        for index, marker_id in enumerate(self.marker_ids):
            row, col = divmod(index, self.cols)
            x0, y0 = col * pitch, row * pitch
            x1, y1 = x0 + self.marker_mm, y0 + self.marker_mm
            positions[marker_id] = np.array([
                [x0, y0, 0.0],
                [x1, y0, 0.0],
                [x1, y1, 0.0],
                [x0, y1, 0.0],
            ])
        return positions


def render_board(spec: BoardSpec, dpi: int = 600, margin_mm: float = 10.0) -> np.ndarray:
    """Rend la planche en image binaire a l'echelle exacte demandee."""
    import cv2

    px_per_mm = dpi / MM_PER_INCH
    marker_px = int(round(spec.marker_mm * px_per_mm))
    pitch_px = int(round((spec.marker_mm + spec.gap_mm) * px_per_mm))
    margin_px = int(round(margin_mm * px_per_mm))

    height = 2 * margin_px + (spec.rows - 1) * pitch_px + marker_px
    width = 2 * margin_px + (spec.cols - 1) * pitch_px + marker_px
    canvas = np.full((height, width), 255, dtype=np.uint8)

    dictionary = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, spec.dictionary))
    for index, marker_id in enumerate(spec.marker_ids):
        row, col = divmod(index, spec.cols)
        image = cv2.aruco.generateImageMarker(dictionary, marker_id, marker_px)
        top, left = margin_px + row * pitch_px, margin_px + col * pitch_px
        canvas[top:top + marker_px, left:left + marker_px] = image
    return canvas


def write_printable_board(spec: BoardSpec, path: str | Path, dpi: int = 600) -> Path:
    """Ecrit la planche en PNG ou PDF a l'echelle 1:1.

    Le fichier porte la resolution voulue dans ses metadonnees : imprime a
    100 % (sans « ajuster a la page »), un marqueur mesure ``marker_mm``.
    """
    from PIL import Image

    path = Path(path)
    canvas = render_board(spec, dpi=dpi)
    image = Image.fromarray(canvas).convert("L")
    if path.suffix.lower() == ".pdf":
        image.save(path, "PDF", resolution=float(dpi))
    else:
        image.save(path, dpi=(dpi, dpi))
    return path


def board_instructions(spec: BoardSpec) -> str:
    """Consignes d'impression et de controle, a afficher a cote du fichier."""
    return (
        f"Planche {spec.rows}x{spec.cols} marqueurs {spec.dictionary}\n"
        f"  Taille nominale d'un marqueur : {spec.marker_mm:g} mm\n"
        f"  Encombrement : {spec.width_mm:g} x {spec.height_mm:g} mm\n"
        f"  Base de mesure (diagonale)   : {spec.diagonal_mm:.1f} mm\n\n"
        "1. Imprimer a 100 % (decocher « ajuster a la page ») sur papier epais\n"
        "   ou coller la feuille sur un support rigide et parfaitement plan.\n"
        "2. Mesurer au pied a coulisse le cote noir d'un marqueur imprime,\n"
        "   puis saisir cette valeur mesuree dans le logiciel. Une erreur de\n"
        "   0,5 % ici devient 0,5 % d'erreur sur toutes les cotes du modele.\n"
        "3. Poser l'objet au centre de la planche sans masquer plus de la\n"
        "   moitie des marqueurs, et ne plus deplacer l'objet ni la planche\n"
        "   pendant toute la prise de vue.\n"
    )
