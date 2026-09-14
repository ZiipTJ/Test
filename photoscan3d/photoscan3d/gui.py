"""Interface graphique PhotoScan3D.

Fenetre unique : on designe un dossier de photos, on controle le lot, on
lance le calcul, et on suit le journal des outils externes en direct. Le
calcul tourne dans un fil separe pour que la fenetre reste vivante pendant
les heures de densification.
"""

from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

from PySide6.QtCore import QObject, QThread, Qt, QUrl, Signal
from PySide6.QtGui import QDesktopServices, QFont
from PySide6.QtWidgets import (QApplication, QCheckBox, QComboBox, QDialog,
                               QDialogButtonBox, QDoubleSpinBox, QFileDialog,
                               QFormLayout, QGroupBox, QHBoxLayout, QLabel,
                               QLineEdit, QMessageBox, QPlainTextEdit,
                               QProgressBar, QPushButton, QSpinBox,
                               QVBoxLayout, QWidget)

from .config import QUALITY_PRESETS, Settings, resolve_toolchain
from .images import inspect_images, list_source_images
from .markers import DICTIONARIES, board_instructions, write_printable_board
from .pipeline import Cancelled, Pipeline, PipelineError, estimate_runtime_hint


class Worker(QObject):
    """Execute la chaine de reconstruction hors du fil graphique."""

    log = Signal(str)
    progress = Signal(float, str)
    finished = Signal(object)
    failed = Signal(str)

    def __init__(self, input_dir: Path, output_dir: Path, settings: Settings,
                 cancel_event: threading.Event):
        super().__init__()
        self._input_dir = input_dir
        self._output_dir = output_dir
        self._settings = settings
        self._cancel = cancel_event

    def run(self) -> None:
        pipeline = Pipeline(self._input_dir, self._output_dir, self._settings,
                            on_log=self.log.emit,
                            on_progress=lambda f, label: self.progress.emit(f, label),
                            cancel_event=self._cancel)
        try:
            self.finished.emit(pipeline.run())
        except Cancelled:
            self.failed.emit("Calcul interrompu.")
        except PipelineError as error:
            self.failed.emit(str(error))
        except Exception as error:  # remonter plutot que mourir en silence
            self.failed.emit(f"Erreur inattendue : {error!r}")


class ToolchainDialog(QDialog):
    """Emplacement des binaires COLMAP et OpenMVS."""

    def __init__(self, settings: Settings, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Reglages des outils")
        self.settings = settings

        self.colmap_edit = QLineEdit(settings.colmap_path)
        self.openmvs_edit = QLineEdit(settings.openmvs_dir)
        self.status = QLabel()
        self.status.setWordWrap(True)

        form = QFormLayout()
        form.addRow("Executable COLMAP", self._with_browse(self.colmap_edit, False))
        form.addRow("Dossier OpenMVS", self._with_browse(self.openmvs_edit, True))

        detect = QPushButton("Detecter automatiquement")
        detect.clicked.connect(self._detect)

        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)

        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(detect)
        layout.addWidget(self.status)
        layout.addWidget(buttons)
        self._detect()

    def _with_browse(self, edit: QLineEdit, is_directory: bool) -> QWidget:
        container = QWidget()
        row = QHBoxLayout(container)
        row.setContentsMargins(0, 0, 0, 0)
        row.addWidget(edit)
        button = QPushButton("Parcourir...")

        def browse() -> None:
            if is_directory:
                path = QFileDialog.getExistingDirectory(self, "Dossier OpenMVS")
            else:
                path, _ = QFileDialog.getOpenFileName(self, "Executable COLMAP")
            if path:
                edit.setText(path)
                self._detect()

        button.clicked.connect(browse)
        row.addWidget(button)
        return container

    def _detect(self) -> None:
        probe = Settings(colmap_path=self.colmap_edit.text().strip(),
                         openmvs_dir=self.openmvs_edit.text().strip())
        toolchain = resolve_toolchain(probe)
        self.status.setText(toolchain.describe())

    def apply_to(self, settings: Settings) -> None:
        settings.colmap_path = self.colmap_edit.text().strip()
        settings.openmvs_dir = self.openmvs_edit.text().strip()


class MainWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("PhotoScan3D - scan 3D metrique par photographies")
        self.setMinimumSize(880, 720)
        self.setAcceptDrops(True)

        self.settings = Settings.load()
        self.thread: QThread | None = None
        self.cancel_event = threading.Event()
        self.result = None

        self._build_ui()
        self._refresh_toolchain_status()

    # ------------------------------------------------------------- interface

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)

        self.input_edit = QLineEdit(self.settings.last_input_dir)
        self.input_edit.setPlaceholderText(
            "Glissez ici le dossier contenant vos photos, ou cliquez sur Parcourir")
        self.input_edit.textChanged.connect(self._on_input_changed)
        self.output_edit = QLineEdit(self.settings.last_output_dir)
        self.output_edit.setPlaceholderText("Dossier ou ecrire le modele et le rapport")

        folders = QFormLayout()
        folders.addRow("Photos", self._browse_row(self.input_edit, "Dossier des photos"))
        folders.addRow("Resultat", self._browse_row(self.output_edit, "Dossier resultat"))
        layout.addLayout(folders)

        layout.addWidget(self._quality_group())
        layout.addWidget(self._marker_group())

        self.toolchain_label = QLabel()
        self.toolchain_label.setWordWrap(True)
        settings_button = QPushButton("Reglages des outils...")
        settings_button.clicked.connect(self._open_settings)
        tools_row = QHBoxLayout()
        tools_row.addWidget(self.toolchain_label, 1)
        tools_row.addWidget(settings_button)
        layout.addLayout(tools_row)

        self.check_button = QPushButton("Verifier les photos")
        self.check_button.clicked.connect(self._check_photos)
        self.start_button = QPushButton("Lancer le scan")
        self.start_button.setDefault(True)
        self.start_button.clicked.connect(self._start)
        self.stop_button = QPushButton("Arreter")
        self.stop_button.setEnabled(False)
        self.stop_button.clicked.connect(self._stop)
        actions = QHBoxLayout()
        for button in (self.check_button, self.start_button, self.stop_button):
            actions.addWidget(button)
        layout.addLayout(actions)

        self.progress = QProgressBar()
        self.progress.setRange(0, 1000)
        self.step_label = QLabel("Pret.")
        layout.addWidget(self.progress)
        layout.addWidget(self.step_label)

        self.log_view = QPlainTextEdit(readOnly=True)
        self.log_view.setFont(QFont("Consolas" if os.name == "nt" else "Monospace", 9))
        self.log_view.setMaximumBlockCount(6000)
        layout.addWidget(self.log_view, 1)

        self.open_folder_button = QPushButton("Ouvrir le dossier resultat")
        self.open_folder_button.clicked.connect(self._open_output)
        self.open_report_button = QPushButton("Voir le rapport")
        self.open_report_button.clicked.connect(self._open_report)
        self.open_report_button.setEnabled(False)
        results = QHBoxLayout()
        results.addWidget(self.open_folder_button)
        results.addWidget(self.open_report_button)
        layout.addLayout(results)

    def _browse_row(self, edit: QLineEdit, title: str) -> QWidget:
        container = QWidget()
        row = QHBoxLayout(container)
        row.setContentsMargins(0, 0, 0, 0)
        row.addWidget(edit)
        button = QPushButton("Parcourir...")

        def browse() -> None:
            path = QFileDialog.getExistingDirectory(self, title, edit.text())
            if path:
                edit.setText(path)

        button.clicked.connect(browse)
        row.addWidget(button)
        return container

    def _quality_group(self) -> QGroupBox:
        group = QGroupBox("Qualite du calcul")
        self.quality_combo = QComboBox()
        for key, preset in QUALITY_PRESETS.items():
            self.quality_combo.addItem(preset.label, key)
        index = self.quality_combo.findData(self.settings.quality)
        self.quality_combo.setCurrentIndex(max(index, 0))
        self.quality_combo.currentIndexChanged.connect(self._on_quality_changed)

        self.threads_spin = QSpinBox()
        self.threads_spin.setRange(0, 128)
        self.threads_spin.setValue(self.settings.threads)
        self.threads_spin.setSpecialValueText("tous les coeurs")

        self.quality_note = QLabel()
        self.quality_note.setWordWrap(True)

        form = QFormLayout(group)
        form.addRow("Niveau", self.quality_combo)
        form.addRow("Coeurs utilises", self.threads_spin)
        form.addRow(self.quality_note)
        self._on_quality_changed()
        return group

    def _marker_group(self) -> QGroupBox:
        group = QGroupBox("Reference metrique (planche ArUco)")
        self.use_markers = QCheckBox(
            "Mettre le modele a l'echelle avec une planche de marqueurs")
        self.use_markers.setChecked(self.settings.use_markers)

        self.rows_spin = QSpinBox()
        self.rows_spin.setRange(1, 10)
        self.rows_spin.setValue(self.settings.board_rows)
        self.cols_spin = QSpinBox()
        self.cols_spin.setRange(1, 10)
        self.cols_spin.setValue(self.settings.board_cols)

        self.marker_spin = QDoubleSpinBox()
        self.marker_spin.setRange(5.0, 500.0)
        self.marker_spin.setDecimals(2)
        self.marker_spin.setSuffix(" mm")
        self.marker_spin.setValue(self.settings.marker_mm)
        self.marker_spin.setToolTip(
            "Cote noir d'un marqueur, MESURE au pied a coulisse sur la planche "
            "imprimee. C'est cette valeur qui fixe l'echelle du modele.")

        self.gap_spin = QDoubleSpinBox()
        self.gap_spin.setRange(0.0, 200.0)
        self.gap_spin.setDecimals(2)
        self.gap_spin.setSuffix(" mm")
        self.gap_spin.setValue(self.settings.gap_mm)

        self.dictionary_combo = QComboBox()
        self.dictionary_combo.addItems(sorted(DICTIONARIES))
        index = self.dictionary_combo.findText(self.settings.dictionary)
        self.dictionary_combo.setCurrentIndex(max(index, 0))

        generate = QPushButton("Generer la planche a imprimer...")
        generate.clicked.connect(self._generate_board)

        form = QFormLayout(group)
        form.addRow(self.use_markers)
        grid = QHBoxLayout()
        grid.addWidget(QLabel("lignes"))
        grid.addWidget(self.rows_spin)
        grid.addWidget(QLabel("colonnes"))
        grid.addWidget(self.cols_spin)
        form.addRow("Grille", grid)
        form.addRow("Cote d'un marqueur mesure", self.marker_spin)
        form.addRow("Espacement", self.gap_spin)
        form.addRow("Dictionnaire", self.dictionary_combo)
        form.addRow(generate)
        return group

    # --------------------------------------------------------------- actions

    def _collect_settings(self) -> Settings:
        self.settings.quality = self.quality_combo.currentData()
        self.settings.threads = self.threads_spin.value()
        self.settings.use_markers = self.use_markers.isChecked()
        self.settings.board_rows = self.rows_spin.value()
        self.settings.board_cols = self.cols_spin.value()
        self.settings.marker_mm = self.marker_spin.value()
        self.settings.gap_mm = self.gap_spin.value()
        self.settings.dictionary = self.dictionary_combo.currentText()
        self.settings.last_input_dir = self.input_edit.text().strip()
        self.settings.last_output_dir = self.output_edit.text().strip()
        self.settings.save()
        return self.settings

    def _on_quality_changed(self) -> None:
        preset = QUALITY_PRESETS[self.quality_combo.currentData()]
        directory = self.input_edit.text().strip()
        count = len(list_source_images(directory)) if directory and Path(directory).is_dir() else 0
        hint = estimate_runtime_hint(count or 100, preset)
        self.quality_note.setText(f"{preset.note}\nTemps indicatif sans GPU : {hint}.")

    def _on_input_changed(self, text: str) -> None:
        if not self.output_edit.text().strip() and Path(text).is_dir():
            self.output_edit.setText(str(Path(text).parent / f"{Path(text).name}_scan"))
        self._on_quality_changed()

    def _refresh_toolchain_status(self) -> None:
        toolchain = resolve_toolchain(self.settings)
        if toolchain.is_complete:
            self.toolchain_label.setText("Outils detectes : COLMAP et OpenMVS sont prets.")
        else:
            self.toolchain_label.setText(
                "Outils manquants : " + ", ".join(toolchain.missing)
                + ". Utilisez « Reglages des outils » ou le script d'installation.")

    def _open_settings(self) -> None:
        dialog = ToolchainDialog(self.settings, self)
        if dialog.exec() == QDialog.Accepted:
            dialog.apply_to(self.settings)
            self.settings.save()
            self._refresh_toolchain_status()

    def _generate_board(self) -> None:
        settings = self._collect_settings()
        spec = settings.board_spec()
        path, _ = QFileDialog.getSaveFileName(
            self, "Enregistrer la planche", "planche_aruco.pdf",
            "PDF (*.pdf);;Image PNG (*.png)")
        if not path:
            return
        try:
            written = write_printable_board(spec, path)
        except (OSError, ValueError) as error:
            QMessageBox.critical(self, "Echec", str(error))
            return
        QMessageBox.information(
            self, "Planche generee",
            f"{written}\n\n{board_instructions(spec)}")

    def _check_photos(self) -> None:
        directory = Path(self.input_edit.text().strip())
        if not directory.is_dir():
            QMessageBox.warning(self, "Dossier introuvable",
                                "Indiquez d'abord le dossier contenant les photos.")
            return
        sources = list_source_images(directory)
        if not sources:
            QMessageBox.warning(self, "Aucune photo",
                                "Aucun fichier image reconnu dans ce dossier.")
            return
        self._append_log(f"Analyse de {len(sources)} photos...")
        QApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            report = inspect_images(sources)
        finally:
            QApplication.restoreOverrideCursor()
        self._append_log(report.summary())
        self._on_quality_changed()

    def _start(self) -> None:
        settings = self._collect_settings()
        input_dir = Path(settings.last_input_dir)
        output_dir = Path(settings.last_output_dir or "")
        if not input_dir.is_dir():
            QMessageBox.warning(self, "Dossier introuvable",
                                "Indiquez le dossier contenant les photos.")
            return
        if not output_dir.name:
            QMessageBox.warning(self, "Dossier resultat",
                                "Indiquez ou ecrire le modele.")
            return
        toolchain = resolve_toolchain(settings)
        if not toolchain.is_complete:
            QMessageBox.critical(
                self, "Outils manquants",
                "Les programmes suivants sont introuvables :\n"
                + "\n".join(toolchain.missing)
                + "\n\nInstallez-les puis indiquez leur emplacement dans les reglages.")
            return

        self.log_view.clear()
        self.cancel_event = threading.Event()
        self.result = None
        self.open_report_button.setEnabled(False)
        self._set_running(True)

        self.thread = QThread(self)
        self.worker = Worker(input_dir, output_dir, settings, self.cancel_event)
        self.worker.moveToThread(self.thread)
        self.thread.started.connect(self.worker.run)
        self.worker.log.connect(self._append_log)
        self.worker.progress.connect(self._update_progress)
        self.worker.finished.connect(self._on_finished)
        self.worker.failed.connect(self._on_failed)
        self.thread.start()

    def _stop(self) -> None:
        self.cancel_event.set()
        self.step_label.setText("Arret demande, fin de l'etape en cours...")

    def _set_running(self, running: bool) -> None:
        self.start_button.setEnabled(not running)
        self.check_button.setEnabled(not running)
        self.stop_button.setEnabled(running)

    def _append_log(self, message: str) -> None:
        self.log_view.appendPlainText(message)

    def _update_progress(self, fraction: float, label: str) -> None:
        self.progress.setValue(int(max(0.0, min(1.0, fraction)) * 1000))
        self.step_label.setText(label)

    def _finish_thread(self) -> None:
        if self.thread is not None:
            self.thread.quit()
            self.thread.wait()
            self.thread = None
        self._set_running(False)

    def _on_finished(self, result) -> None:
        self._finish_thread()
        self.result = result
        self.settings.remember_project(str(result.output_dir))
        self.settings.save()
        self.open_report_button.setEnabled(True)
        self.progress.setValue(1000)

        if result.scale is not None:
            headline = (f"Modele metrique termine.\n\n{result.scale.summary()}")
        else:
            headline = ("Modele termine, mais SANS echelle : aucune cote ne peut en "
                        "etre tiree.")
        if result.stats is not None:
            headline += "\n\n" + result.stats.summary(
                "mm" if result.scale else "unites")
        if result.warnings:
            headline += "\n\nAvertissements :\n- " + "\n- ".join(result.warnings)
        self.step_label.setText("Termine.")
        QMessageBox.information(self, "Scan termine", headline)

    def _on_failed(self, message: str) -> None:
        self._finish_thread()
        self.step_label.setText("Echec.")
        self._append_log(f"\n!!! {message}")
        QMessageBox.critical(self, "Echec du scan", message)

    def _open_output(self) -> None:
        directory = self.output_edit.text().strip()
        if directory:
            QDesktopServices.openUrl(QUrl.fromLocalFile(directory))

    def _open_report(self) -> None:
        if self.result is not None:
            report = Path(self.result.output_dir) / "rapport.html"
            if report.exists():
                QDesktopServices.openUrl(QUrl.fromLocalFile(str(report)))

    # ------------------------------------------------------- glisser-deposer

    def dragEnterEvent(self, event) -> None:
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event) -> None:
        for url in event.mimeData().urls():
            path = Path(url.toLocalFile())
            if path.is_dir():
                self.input_edit.setText(str(path))
                break
            if path.is_file():
                self.input_edit.setText(str(path.parent))
                break
        event.acceptProposedAction()

    def closeEvent(self, event) -> None:
        if self.thread is not None and self.thread.isRunning():
            answer = QMessageBox.question(
                self, "Calcul en cours",
                "Un calcul est en cours. Voulez-vous l'interrompre et quitter ?")
            if answer != QMessageBox.Yes:
                event.ignore()
                return
            self.cancel_event.set()
            self.thread.quit()
            self.thread.wait(15000)
        self._collect_settings()
        event.accept()


def main() -> int:
    application = QApplication(sys.argv)
    application.setApplicationName("PhotoScan3D")
    window = MainWindow()
    window.show()
    return application.exec()


if __name__ == "__main__":
    raise SystemExit(main())
