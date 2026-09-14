"""Reglages persistants et localisation des binaires externes."""

from __future__ import annotations

import json
import os
import shutil
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .markers import DEFAULT_DICTIONARY

APP_NAME = "PhotoScan3D"

# Executables OpenMVS necessaires a la chaine, dans l'ordre d'utilisation.
OPENMVS_BINARIES = ("InterfaceCOLMAP", "DensifyPointCloud", "ReconstructMesh",
                    "RefineMesh", "TextureMesh")


@dataclass(frozen=True)
class QualityPreset:
    """Compromis vitesse / finesse, calibre pour un calcul sans carte graphique.

    ``densify_resolution_level`` divise la resolution par 2^level pendant la
    densification : c'est le parametre qui pilote reellement le temps de
    calcul en CPU.
    """

    key: str
    label: str
    max_image_size: int          # 0 = pleine resolution
    densify_resolution_level: int
    densify_min_resolution: int
    refine_mesh: bool
    texture_resolution_level: int
    note: str


QUALITY_PRESETS: dict[str, QualityPreset] = {
    "brouillon": QualityPreset(
        key="brouillon", label="Brouillon (controle rapide)",
        max_image_size=1600, densify_resolution_level=3, densify_min_resolution=480,
        refine_mesh=False, texture_resolution_level=2,
        note="Pour verifier que la prise de vue tient la route avant de lancer un "
             "calcul long. Ne pas utiliser pour mesurer."),
    "standard": QualityPreset(
        key="standard", label="Standard",
        max_image_size=2400, densify_resolution_level=2, densify_min_resolution=640,
        refine_mesh=False, texture_resolution_level=1,
        note="Bon compromis. Precision typique de l'ordre du dixieme de pour cent "
             "si la planche est bien vue."),
    "precis": QualityPreset(
        key="precis", label="Precis (mesure)",
        max_image_size=3200, densify_resolution_level=1, densify_min_resolution=640,
        refine_mesh=True, texture_resolution_level=1,
        note="Reglage vise pour la metrologie. Comptez plusieurs heures en CPU."),
    "maximum": QualityPreset(
        key="maximum", label="Maximum (tres long)",
        max_image_size=0, densify_resolution_level=1, densify_min_resolution=640,
        refine_mesh=True, texture_resolution_level=0,
        note="Pleine resolution. A reserver aux petits lots de photos ou aux "
             "machines puissantes : facilement une nuit de calcul."),
}
DEFAULT_QUALITY = "standard"


def config_directory() -> Path:
    """Dossier de configuration, conforme aux usages de chaque systeme."""
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        return base / APP_NAME
    return Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "photoscan3d"


def _windows_candidates(name: str) -> list[Path]:
    roots = [Path(os.environ.get("ProgramFiles", r"C:\Program Files")),
             Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")),
             Path(r"C:\\"), Path.home() / "Documents", Path.home() / "Downloads"]
    candidates: list[Path] = []
    for root in roots:
        for pattern in (f"{name}*/bin/{name}*", f"{name}*/{name}*", f"{name}*"):
            try:
                candidates.extend(root.glob(pattern))
            except OSError:
                continue
    return candidates


def find_executable(name: str, extra_dirs: list[Path] | None = None) -> Path | None:
    """Cherche un executable dans les dossiers indiques, puis dans le PATH."""
    suffixes = [".exe", ".bat", ""] if os.name == "nt" else [""]
    for directory in extra_dirs or []:
        for suffix in suffixes:
            candidate = Path(directory) / f"{name}{suffix}"
            if candidate.is_file():
                return candidate
    found = shutil.which(name)
    if found:
        return Path(found)
    if os.name == "nt":
        for candidate in _windows_candidates(name):
            if candidate.is_file() and candidate.suffix.lower() in (".exe", ".bat"):
                return candidate
    return None


@dataclass
class Settings:
    """Reglages de l'application, serialises en JSON."""

    colmap_path: str = ""
    openmvs_dir: str = ""
    quality: str = DEFAULT_QUALITY
    threads: int = 0                       # 0 = tous les coeurs disponibles
    board_rows: int = 3
    board_cols: int = 4
    marker_mm: float = 40.0
    gap_mm: float = 12.0
    dictionary: str = DEFAULT_DICTIONARY
    use_markers: bool = True
    last_input_dir: str = ""
    last_output_dir: str = ""
    recent_projects: list[str] = field(default_factory=list)

    @classmethod
    def path(cls) -> Path:
        return config_directory() / "settings.json"

    @classmethod
    def load(cls) -> "Settings":
        path = cls.path()
        if not path.exists():
            return cls()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return cls()
        known = {f for f in cls().__dict__}
        return cls(**{k: v for k, v in data.items() if k in known})

    def save(self) -> Path:
        path = self.path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(self), indent=2, ensure_ascii=False),
                        encoding="utf-8")
        return path

    @property
    def preset(self) -> QualityPreset:
        return QUALITY_PRESETS.get(self.quality, QUALITY_PRESETS[DEFAULT_QUALITY])

    def board_spec(self):
        from .markers import BoardSpec
        return BoardSpec(rows=self.board_rows, cols=self.board_cols,
                         marker_mm=self.marker_mm, gap_mm=self.gap_mm,
                         dictionary=self.dictionary)

    def remember_project(self, directory: str | Path) -> None:
        directory = str(directory)
        self.recent_projects = [directory] + [
            p for p in self.recent_projects if p != directory][:9]


@dataclass
class Toolchain:
    """Binaires externes resolus, avec leur diagnostic."""

    colmap: Path | None
    openmvs: dict[str, Path | None]

    @property
    def missing(self) -> list[str]:
        names = [] if self.colmap else ["colmap"]
        names += [name for name, path in self.openmvs.items() if path is None]
        return names

    @property
    def is_complete(self) -> bool:
        return not self.missing

    def describe(self) -> str:
        lines = [f"COLMAP : {self.colmap or 'INTROUVABLE'}"]
        for name, path in self.openmvs.items():
            lines.append(f"{name} : {path or 'INTROUVABLE'}")
        return "\n".join(lines)


def resolve_toolchain(settings: Settings) -> Toolchain:
    """Localise COLMAP et OpenMVS a partir des reglages puis du systeme."""
    colmap = Path(settings.colmap_path) if settings.colmap_path else None
    if colmap is not None and not colmap.is_file():
        colmap = None
    if colmap is None:
        colmap = find_executable("colmap")

    extra = [Path(settings.openmvs_dir)] if settings.openmvs_dir else []
    openmvs = {name: find_executable(name, extra) for name in OPENMVS_BINARIES}
    return Toolchain(colmap=colmap, openmvs=openmvs)
