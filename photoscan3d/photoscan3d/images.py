"""Preparation des photos iPhone et controle qualite avant reconstruction.

Un scan rate se decide a la prise de vue, pas au calcul : ce module convertit
les HEIC, verifie la nettete, l'exposition et la coherence optique du lot, et
dit a l'utilisateur ce qui ne va pas avant de lancer plusieurs heures de
calcul.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

SUPPORTED_SUFFIXES = {".heic", ".heif", ".jpg", ".jpeg", ".png", ".tif", ".tiff"}

# En dessous de ce nombre de vues, le recouvrement est rarement suffisant
# pour une reconstruction complete, encore moins pour une mesure.
RECOMMENDED_MIN_IMAGES = 60
MINIMUM_IMAGES = 20
# Une image dont la nettete tombe sous cette fraction de la mediane du lot
# est presque toujours une photo bougee.
SHARPNESS_RATIO_FLOOR = 0.35
CLIPPED_HIGHLIGHT_LIMIT = 0.05


@dataclass
class ImageInfo:
    path: Path
    width: int
    height: int
    sharpness: float
    brightness: float
    clipped_fraction: float
    focal_35mm: float | None
    camera_model: str | None
    issues: list[str] = field(default_factory=list)

    @property
    def megapixels(self) -> float:
        return self.width * self.height / 1e6


@dataclass
class Diagnostic:
    severity: str  # "erreur" | "avertissement" | "info"
    message: str

    def __str__(self) -> str:
        return f"[{self.severity}] {self.message}"


@dataclass
class QualityReport:
    images: list[ImageInfo]
    diagnostics: list[Diagnostic]

    @property
    def has_blocking_issue(self) -> bool:
        return any(d.severity == "erreur" for d in self.diagnostics)

    @property
    def flagged(self) -> list[ImageInfo]:
        return [image for image in self.images if image.issues]

    @property
    def uniform_optics(self) -> bool:
        """Vrai si toutes les photos partagent capteur, cadrage et focale.

        C'est la condition pour n'estimer qu'un seul jeu d'intrinseques, ce
        qui est nettement plus precis que d'en estimer un par image.
        """
        if not self.images:
            return False
        first = self.images[0]
        return all(
            image.width == first.width and image.height == first.height
            and image.focal_35mm == first.focal_35mm
            and image.camera_model == first.camera_model
            for image in self.images)

    def summary(self) -> str:
        if not self.images:
            return "Aucune photo exploitable."
        lines = [f"{len(self.images)} photos, {self.images[0].megapixels:.1f} Mpx",
                 f"Optique uniforme : {'oui' if self.uniform_optics else 'non'}"]
        lines += [str(d) for d in self.diagnostics]
        return "\n".join(lines)


def list_source_images(directory: str | Path) -> list[Path]:
    directory = Path(directory)
    return sorted(p for p in directory.iterdir()
                  if p.is_file() and p.suffix.lower() in SUPPORTED_SUFFIXES)


def _register_heif() -> None:
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:  # les HEIC seront simplement illisibles
        pass


def _exif_optics(image) -> tuple[float | None, str | None]:
    """Focale equivalente 35 mm et modele d'appareil, si l'EXIF les porte."""
    try:
        exif = image.getexif()
    except (AttributeError, OSError):
        return None, None
    if not exif:
        return None, None
    model = exif.get(272)  # Model
    focal_35 = exif.get(41989)  # FocalLengthIn35mmFilm
    if focal_35 is None:
        ifd = exif.get_ifd(0x8769)  # Exif IFD
        focal_35 = ifd.get(41989)
        focal = ifd.get(37386)
        if focal_35 is None and focal is not None:
            focal_35 = float(focal)  # a defaut, la focale physique
    return (float(focal_35) if focal_35 else None,
            str(model).strip() if model else None)


def _measure(image) -> tuple[float, float, float]:
    """Nettete (variance du laplacien), luminance moyenne et part de blancs brules."""
    import cv2

    gray = np.asarray(image.convert("L"), dtype=np.uint8)
    # Analyse a taille fixe : la nettete mesuree devient comparable d'une
    # photo a l'autre meme si les definitions different.
    target_width = 1024
    if gray.shape[1] != target_width:
        ratio = target_width / gray.shape[1]
        gray = cv2.resize(gray, None, fx=ratio, fy=ratio, interpolation=cv2.INTER_AREA)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(gray.mean())
    clipped = float((gray >= 250).mean())
    return sharpness, brightness, clipped


def inspect_images(paths: list[Path], progress=None) -> QualityReport:
    """Analyse le lot de photos et produit un diagnostic lisible."""
    from PIL import Image, ImageOps

    _register_heif()
    infos: list[ImageInfo] = []
    for index, path in enumerate(paths):
        try:
            with Image.open(path) as raw:
                image = ImageOps.exif_transpose(raw)
                focal, model = _exif_optics(raw)
                sharpness, brightness, clipped = _measure(image)
                infos.append(ImageInfo(path, image.width, image.height, sharpness,
                                       brightness, clipped, focal, model))
        except (OSError, ValueError):
            infos.append(ImageInfo(path, 0, 0, 0.0, 0.0, 0.0, None, None,
                                   ["illisible"]))
        if progress is not None:
            progress(index + 1, len(paths))

    return QualityReport(infos, _diagnose(infos))


def _diagnose(infos: list[ImageInfo]) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    readable = [info for info in infos if info.width > 0]

    if len(readable) < MINIMUM_IMAGES:
        diagnostics.append(Diagnostic(
            "erreur", f"{len(readable)} photos exploitables : il en faut au moins "
                      f"{MINIMUM_IMAGES}, et {RECOMMENDED_MIN_IMAGES} pour mesurer."))
    elif len(readable) < RECOMMENDED_MIN_IMAGES:
        diagnostics.append(Diagnostic(
            "avertissement",
            f"{len(readable)} photos : suffisant pour une forme, insuffisant pour "
            f"une cote fiable. Visez {RECOMMENDED_MIN_IMAGES} a 150 vues avec "
            "70 a 80 % de recouvrement."))

    unreadable = [info for info in infos if info.width == 0]
    if unreadable:
        diagnostics.append(Diagnostic(
            "avertissement", f"{len(unreadable)} fichiers illisibles et ignores "
                             f"(HEIC sans pillow-heif installe ?)"))

    if readable:
        sharpness = np.array([info.sharpness for info in readable])
        median = float(np.median(sharpness))
        for info in readable:
            if median > 0 and info.sharpness < SHARPNESS_RATIO_FLOOR * median:
                info.issues.append("floue")
            if info.clipped_fraction > CLIPPED_HIGHLIGHT_LIMIT:
                info.issues.append("hautes lumieres brulees")
        blurry = [info for info in readable if "floue" in info.issues]
        if blurry:
            diagnostics.append(Diagnostic(
                "avertissement",
                f"{len(blurry)} photos nettement moins nettes que les autres : "
                "les retirer ameliore souvent le resultat."))
        burnt = [info for info in readable if "hautes lumieres brulees" in info.issues]
        if burnt:
            diagnostics.append(Diagnostic(
                "avertissement",
                f"{len(burnt)} photos avec des reflets brules : sans texture, ces "
                "zones ne seront pas reconstruites. Diffusez l'eclairage."))

        brightness = np.array([info.brightness for info in readable])
        if brightness.std() > 25:
            diagnostics.append(Diagnostic(
                "avertissement",
                "Exposition tres variable d'une photo a l'autre : verrouillez "
                "l'exposition (appui long sur l'ecran) et desactivez le HDR."))

        focals = {info.focal_35mm for info in readable if info.focal_35mm}
        if len(focals) > 1:
            diagnostics.append(Diagnostic(
                "erreur",
                f"Plusieurs focales dans le lot ({sorted(focals)} mm) : vous avez "
                "change d'objectif ou zoome. Refaites la serie avec un seul "
                "objectif, sans zoomer."))
        elif not focals:
            diagnostics.append(Diagnostic(
                "avertissement",
                "Aucune focale dans l'EXIF : COLMAP devra la deviner, ce qui "
                "degrade la precision. Evitez de reexporter les photos."))

        sizes = {(info.width, info.height) for info in readable}
        if len(sizes) > 1:
            diagnostics.append(Diagnostic(
                "avertissement",
                "Definitions ou orientations melangees : gardez le telephone "
                "toujours dans le meme sens."))
    return diagnostics


def prepare_images(paths: list[Path], destination: str | Path, max_size: int = 0,
                   progress=None) -> list[Path]:
    """Convertit le lot en JPEG exploitable par COLMAP.

    Les HEIC sont decodes, l'orientation EXIF est appliquee aux pixels, et
    l'EXIF est conserve afin que COLMAP dispose de la focale. Renvoie la
    liste des fichiers ecrits.
    """
    from PIL import Image, ImageOps

    _register_heif()
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []
    for index, path in enumerate(paths):
        target = destination / f"{path.stem}.jpg"
        try:
            with Image.open(path) as raw:
                image = ImageOps.exif_transpose(raw).convert("RGB")
                exif = raw.info.get("exif")
                if max_size and max(image.size) > max_size:
                    ratio = max_size / max(image.size)
                    image = image.resize(
                        (round(image.width * ratio), round(image.height * ratio)),
                        Image.LANCZOS)
                    # L'EXIF reste valide : COLMAP deduit la focale en pixels
                    # de la focale en mm et de la largeur de l'image ecrite.
                image.save(target, "JPEG", quality=95, subsampling=0,
                           **({"exif": exif} if exif else {}))
            written.append(target)
        except (OSError, ValueError):
            continue
        if progress is not None:
            progress(index + 1, len(paths))
    return written
