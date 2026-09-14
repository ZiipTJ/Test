"""Enchainement COLMAP -> OpenMVS -> modele metrique.

La chaine est decoupee en etapes explicites : chacune journalise, peut etre
interrompue, et laisse ses fichiers intermediaires sur le disque pour qu'un
echec reste diagnosticable.
"""

from __future__ import annotations

import shutil
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from . import colmap_io, images as image_tools, mesh as mesh_tools
from .config import QualityPreset, Settings, Toolchain, resolve_toolchain
from .markers import BoardSpec
from .scale import ScaleEstimationError, ScaleResult, detect_in_reconstruction, estimate_scale

# Au-dela, l'appariement exhaustif devient deraisonnable sur un processeur.
EXHAUSTIVE_MATCHING_LIMIT = 160


class PipelineError(RuntimeError):
    """Echec d'une etape, avec un message destine a l'utilisateur."""


class Cancelled(RuntimeError):
    """L'utilisateur a demande l'arret."""


@dataclass
class Step:
    key: str
    label: str
    weight: float


STEPS = [
    Step("preparation", "Analyse et conversion des photos", 1.0),
    Step("features", "Detection des points caracteristiques", 3.0),
    Step("matching", "Appariement des images", 6.0),
    Step("mapper", "Calcul des poses de camera", 5.0),
    Step("undistort", "Redressement des images", 1.0),
    Step("scale", "Mesure de l'echelle sur les marqueurs", 1.5),
    Step("densify", "Densification du nuage de points", 20.0),
    Step("mesh", "Reconstruction du maillage", 4.0),
    Step("refine", "Affinage du maillage", 6.0),
    Step("texture", "Plaquage de la texture couleur", 3.0),
    Step("export", "Export metrique et rapport", 1.0),
]


@dataclass
class PipelineResult:
    output_dir: Path
    obj_path: Path | None = None
    stl_path: Path | None = None
    scale: ScaleResult | None = None
    quality: image_tools.QualityReport | None = None
    stats: mesh_tools.MeshStats | None = None
    registered_images: int = 0
    total_images: int = 0
    reprojection_error_px: float = float("nan")
    duration_s: float = 0.0
    warnings: list[str] = field(default_factory=list)

    @property
    def is_metric(self) -> bool:
        return self.scale is not None


class Pipeline:
    """Execute la chaine complete pour un dossier de photos."""

    def __init__(self, input_dir: str | Path, output_dir: str | Path,
                 settings: Settings, *, on_log=None, on_progress=None,
                 cancel_event: threading.Event | None = None):
        self.input_dir = Path(input_dir)
        self.output_dir = Path(output_dir)
        self.settings = settings
        self.toolchain: Toolchain = resolve_toolchain(settings)
        self._on_log = on_log or (lambda message: None)
        self._on_progress = on_progress or (lambda fraction, label: None)
        self._cancel = cancel_event or threading.Event()
        self._done_weight = 0.0
        self._total_weight = sum(step.weight for step in STEPS)

    # ---------------------------------------------------------------- outils

    def log(self, message: str) -> None:
        self._on_log(message)

    def _check_cancelled(self) -> None:
        if self._cancel.is_set():
            raise Cancelled("calcul interrompu")

    def _begin(self, step: Step) -> None:
        self._check_cancelled()
        self.log(f"\n=== {step.label} ===")
        self._on_progress(self._done_weight / self._total_weight, step.label)

    def _complete(self, step: Step) -> None:
        self._done_weight += step.weight
        self._on_progress(self._done_weight / self._total_weight, step.label)

    def _skip(self, step: Step, reason: str) -> None:
        self.log(f"--- {step.label} : ignore ({reason})")
        self._complete(step)

    def _run(self, command: list[str], label: str) -> None:
        """Lance un binaire externe en relayant sa sortie ligne par ligne."""
        self._check_cancelled()
        printable = " ".join(f'"{c}"' if " " in str(c) else str(c) for c in command)
        self.log(f"$ {printable}")
        try:
            process = subprocess.Popen(
                [str(c) for c in command], stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                errors="replace", bufsize=1)
        except OSError as error:
            raise PipelineError(f"{label} : impossible de lancer le programme "
                                f"({error})") from error

        assert process.stdout is not None
        try:
            for line in process.stdout:
                line = line.rstrip()
                if line:
                    self.log(line)
                if self._cancel.is_set():
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                    raise Cancelled("calcul interrompu")
        finally:
            process.stdout.close()
        code = process.wait()
        if code != 0:
            raise PipelineError(
                f"{label} : le programme s'est arrete avec le code {code}. "
                "Les dernieres lignes du journal indiquent la cause.")

    def _threads(self) -> int:
        return self.settings.threads if self.settings.threads > 0 else -1

    def _openmvs(self, name: str) -> Path:
        path = self.toolchain.openmvs.get(name)
        if path is None:
            raise PipelineError(f"{name} est introuvable : verifiez le dossier OpenMVS "
                                "dans les reglages.")
        return path

    # ---------------------------------------------------------------- chaine

    def run(self) -> PipelineResult:
        started = time.time()
        if not self.toolchain.is_complete:
            raise PipelineError(
                "Outils manquants : " + ", ".join(self.toolchain.missing)
                + ". Ouvrez les reglages pour indiquer ou ils sont installes.")

        self.output_dir.mkdir(parents=True, exist_ok=True)
        work = self.output_dir / "travail"
        work.mkdir(exist_ok=True)
        result = PipelineResult(output_dir=self.output_dir)

        preset = self.settings.preset
        self.log(f"Qualite : {preset.label} - {preset.note}")

        prepared_dir = self._step_preparation(work, preset, result)
        database = work / "colmap.db"
        self._step_features(database, prepared_dir, preset, result)
        self._step_matching(database, result)
        sparse_dir = self._step_mapper(database, prepared_dir, work, result)
        dense_dir = self._step_undistort(prepared_dir, sparse_dir, work, preset)
        self._step_scale(dense_dir, result)
        textured_obj = self._step_openmvs(work, dense_dir, preset)
        self._step_export(textured_obj, result)

        result.duration_s = time.time() - started
        self._on_progress(1.0, "Termine")
        return result

    def _step_preparation(self, work: Path, preset: QualityPreset,
                          result: PipelineResult) -> Path:
        step = STEPS[0]
        self._begin(step)
        sources = image_tools.list_source_images(self.input_dir)
        if not sources:
            raise PipelineError(f"Aucune photo trouvee dans {self.input_dir}")
        result.total_images = len(sources)
        self.log(f"{len(sources)} fichiers trouves, analyse en cours...")

        report = image_tools.inspect_images(sources, progress=self._counter("Analyse"))
        result.quality = report
        for diagnostic in report.diagnostics:
            self.log(str(diagnostic))
        if report.has_blocking_issue:
            raise PipelineError(
                "Le lot de photos ne permet pas une reconstruction fiable :\n"
                + "\n".join(str(d) for d in report.diagnostics
                            if d.severity == "erreur"))

        prepared = work / "images"
        self.log(f"Conversion vers {prepared}...")
        written = image_tools.prepare_images(
            [info.path for info in report.images if info.width > 0], prepared,
            max_size=preset.max_image_size, progress=self._counter("Conversion"))
        self.log(f"{len(written)} images pretes.")
        self._complete(step)
        return prepared

    def _counter(self, label: str):
        """Journalise une progression toutes les dix unites pour rester lisible."""
        def report(done: int, total: int) -> None:
            self._check_cancelled()
            if done % 10 == 0 or done == total:
                self.log(f"{label} : {done}/{total}")
        return report

    def _step_features(self, database: Path, image_dir: Path,
                       preset: QualityPreset, result: PipelineResult) -> None:
        step = STEPS[1]
        self._begin(step)
        uniform = result.quality is not None and result.quality.uniform_optics
        if not uniform:
            self.log("Optique non uniforme : un jeu d'intrinseques par image sera "
                     "estime, ce qui degrade la precision.")
        command = [
            self.toolchain.colmap, "feature_extractor",
            "--database_path", database,
            "--image_path", image_dir,
            "--ImageReader.camera_model", "SIMPLE_RADIAL",
            "--ImageReader.single_camera", "1" if uniform else "0",
            "--SiftExtraction.use_gpu", "0",
            "--SiftExtraction.num_threads", str(self._threads()),
        ]
        if preset.max_image_size:
            command += ["--SiftExtraction.max_image_size", str(preset.max_image_size)]
        if preset.key in ("precis", "maximum"):
            # Descripteurs plus robustes, uniquement disponibles en CPU.
            command += ["--SiftExtraction.estimate_affine_shape", "1",
                        "--SiftExtraction.domain_size_pooling", "1"]
        self._run(command, "Detection des points caracteristiques")
        self._complete(step)

    def _step_matching(self, database: Path, result: PipelineResult) -> None:
        step = STEPS[2]
        self._begin(step)
        count = result.total_images
        if count <= EXHAUSTIVE_MATCHING_LIMIT:
            command = [self.toolchain.colmap, "exhaustive_matcher",
                       "--database_path", database,
                       "--SiftMatching.use_gpu", "0",
                       "--SiftMatching.guided_matching", "1",
                       "--SiftMatching.num_threads", str(self._threads())]
        else:
            self.log(f"{count} images : appariement sequentiel avec bouclage, "
                     "l'appariement exhaustif serait trop long en CPU.")
            command = [self.toolchain.colmap, "sequential_matcher",
                       "--database_path", database,
                       "--SiftMatching.use_gpu", "0",
                       "--SequentialMatching.overlap", "15",
                       "--SequentialMatching.quadratic_overlap", "1",
                       "--SiftMatching.num_threads", str(self._threads())]
        self._run(command, "Appariement des images")
        self._complete(step)

    def _step_mapper(self, database: Path, image_dir: Path, work: Path,
                     result: PipelineResult) -> Path:
        step = STEPS[3]
        self._begin(step)
        sparse = work / "sparse"
        sparse.mkdir(exist_ok=True)
        self._run([
            self.toolchain.colmap, "mapper",
            "--database_path", database,
            "--image_path", image_dir,
            "--output_path", sparse,
            # Affiner le point principal est utile quand la focale EXIF sert
            # d'amorce, ce qui est le cas des photos de telephone.
            "--Mapper.ba_refine_principal_point", "1",
            "--Mapper.num_threads", str(self._threads()),
        ], "Calcul des poses de camera")

        model_dir = colmap_io.find_largest_model(sparse)
        reconstruction = colmap_io.read_model(model_dir)
        result.registered_images = len(reconstruction.images)
        result.reprojection_error_px = reconstruction.mean_reprojection_error
        self.log(f"{result.registered_images}/{result.total_images} images alignees, "
                 f"erreur de reprojection moyenne {result.reprojection_error_px:.3f} px")

        if result.registered_images < 0.6 * result.total_images:
            result.warnings.append(
                f"Seules {result.registered_images} images sur {result.total_images} "
                "ont pu etre alignees : recouvrement insuffisant ou photos floues.")
        if result.registered_images < 10:
            raise PipelineError(
                "Trop peu d'images alignees pour reconstruire l'objet. Reprenez la "
                "serie avec davantage de recouvrement entre vues successives.")
        self._complete(step)
        return model_dir

    def _step_undistort(self, image_dir: Path, sparse_dir: Path, work: Path,
                        preset: QualityPreset) -> Path:
        step = STEPS[4]
        self._begin(step)
        dense = work / "dense"
        command = [self.toolchain.colmap, "image_undistorter",
                   "--image_path", image_dir,
                   "--input_path", sparse_dir,
                   "--output_path", dense,
                   "--output_type", "COLMAP"]
        if preset.max_image_size:
            command += ["--max_image_size", str(preset.max_image_size)]
        self._run(command, "Redressement des images")
        self._complete(step)
        return dense

    def _step_scale(self, dense_dir: Path, result: PipelineResult) -> None:
        step = STEPS[5]
        if not self.settings.use_markers:
            result.warnings.append(
                "Scan sans marqueurs : le modele est sans echelle, aucune cote "
                "ne peut en etre tiree.")
            self._skip(step, "marqueurs desactives")
            return

        self._begin(step)
        spec: BoardSpec = self.settings.board_spec()
        self.log(f"Recherche des marqueurs {spec.dictionary} "
                 f"({spec.marker_mm:g} mm) dans les images redressees...")
        reconstruction = colmap_io.read_model(dense_dir / "sparse")
        observations = detect_in_reconstruction(
            reconstruction, dense_dir / "images", spec,
            progress=self._counter("Detection"))
        self.log(f"{len(observations)} marqueurs detectes.")
        try:
            scale_result = estimate_scale(reconstruction, observations, spec)
        except ScaleEstimationError as error:
            result.warnings.append(
                f"Echelle non determinee ({error}). Le modele est exporte sans "
                "unite : aucune cote ne peut en etre tiree.")
            self.log(f"ECHEC de la mise a l'echelle : {error}")
            self._complete(step)
            return

        result.scale = scale_result
        result.warnings.extend(scale_result.warnings)
        self.log(scale_result.summary())
        self._complete(step)

    def _step_openmvs(self, work: Path, dense_dir: Path,
                      preset: QualityPreset) -> Path:
        scene = work / "scene.mvs"
        step = STEPS[6]
        self._begin(step)
        self._run([self._openmvs("InterfaceCOLMAP"),
                   "-i", dense_dir, "-o", scene,
                   "--image-folder", dense_dir / "images"], "Import OpenMVS")

        dense_scene = work / "scene_dense.mvs"
        self._run([self._openmvs("DensifyPointCloud"), scene,
                   "-o", dense_scene,
                   "-w", work,
                   "--resolution-level", str(preset.densify_resolution_level),
                   "--min-resolution", str(preset.densify_min_resolution),
                   "--number-views", "5",
                   "--max-threads", str(max(self.settings.threads, 0))],
                  "Densification du nuage")
        self._complete(step)

        step = STEPS[7]
        self._begin(step)
        mesh_scene = work / "scene_mesh.mvs"
        self._run([self._openmvs("ReconstructMesh"), dense_scene,
                   "-o", mesh_scene, "-w", work,
                   "--max-threads", str(max(self.settings.threads, 0))],
                  "Reconstruction du maillage")
        self._complete(step)

        step = STEPS[8]
        if preset.refine_mesh:
            self._begin(step)
            refined = work / "scene_refine.mvs"
            self._run([self._openmvs("RefineMesh"), mesh_scene,
                       "-o", refined, "-w", work,
                       "--resolution-level", "1",
                       "--max-threads", str(max(self.settings.threads, 0))],
                      "Affinage du maillage")
            mesh_scene = refined
            self._complete(step)
        else:
            self._skip(step, "desactive par le niveau de qualite")

        step = STEPS[9]
        self._begin(step)
        marker = time.time()
        self._run([self._openmvs("TextureMesh"), mesh_scene,
                   "-o", work / "scene_texture.mvs", "-w", work,
                   "--export-type", "obj",
                   "--resolution-level", str(preset.texture_resolution_level),
                   "--max-threads", str(max(self.settings.threads, 0))],
                  "Plaquage de la texture")
        textured = self._newest_obj(work, marker)
        self._complete(step)
        return textured

    def _newest_obj(self, work: Path, since: float) -> Path:
        """Retrouve l'OBJ produit par TextureMesh, dont le nom varie selon la version."""
        candidates = [p for p in work.glob("*.obj") if p.stat().st_mtime >= since - 1]
        if not candidates:
            candidates = list(work.glob("*.obj"))
        if not candidates:
            raise PipelineError(
                "TextureMesh n'a produit aucun fichier OBJ. Consultez le journal.")
        return max(candidates, key=lambda p: p.stat().st_mtime)

    def _step_export(self, textured_obj: Path, result: PipelineResult) -> None:
        step = STEPS[10]
        self._begin(step)
        factor = result.scale.scale_mm_per_unit if result.scale else 1.0
        suffix = "mm" if result.scale else "sans_echelle"
        obj_path = self.output_dir / f"modele_{suffix}.obj"

        stats = mesh_tools.scale_obj(textured_obj, obj_path, factor)
        stl_stats = mesh_tools.export_stl_from_obj(
            obj_path, self.output_dir / f"modele_{suffix}.stl")
        result.obj_path = obj_path
        result.stl_path = self.output_dir / f"modele_{suffix}.stl"
        result.stats = stl_stats
        unit = "mm" if result.scale else "unites arbitraires"
        self.log(stats.summary(unit))

        from .report import write_report
        report_path = write_report(result, self.settings, self.output_dir)
        self.log(f"Rapport ecrit : {report_path}")
        self._complete(step)


def estimate_runtime_hint(image_count: int, preset: QualityPreset) -> str:
    """Ordre de grandeur du temps de calcul sur un processeur recent sans GPU."""
    base = {"brouillon": 0.35, "standard": 1.2, "precis": 4.0, "maximum": 12.0}
    hours = base.get(preset.key, 1.2) * max(image_count, 1) / 100.0
    if hours < 1:
        return f"environ {round(hours * 60)} minutes pour {image_count} photos"
    return f"environ {hours:.1f} heures pour {image_count} photos"
