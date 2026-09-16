/** Panneau « Réglages » : hypothèses de calcul du faisceau. */
import { useProject } from '../../state/project';

export function SettingsPanel() {
  const settings = useProject((state) => state.project.settings);
  const update = useProject((state) => state.updateSettings);

  return (
    <div className="panel">
      <h2>Hypothèses de calcul</h2>

      <div className="field">
        <label>Foisonnement</label>
        <input
          type="number" min={1} max={1.6} step={0.01} value={settings.packingFactor}
          onChange={(event) => update({ packingFactor: Number(event.target.value) })}
        />
      </div>
      <p className="hint">
        Coefficient appliqué au diamètre issu du rangement réel des fils. 1,00 correspond à un toron parfaitement
        serré ; 1,15 est une valeur courante pour un faisceau rubané ou spiralé.
      </p>

      <div className="field">
        <label>Remplissage max.</label>
        <input
          type="number" min={0.3} max={1} step={0.05} value={settings.maxFillRatio}
          onChange={(event) => update({ maxFillRatio: Number(event.target.value) })}
        />
      </div>
      <p className="hint">Au-delà, la gaine devient difficile à enfiler et le rayon de courbure se dégrade.</p>

      <div className="field">
        <label>Rayon de coude</label>
        <input
          type="number" min={1} step={1} value={settings.defaultBendRadius}
          onChange={(event) => update({ defaultBendRadius: Number(event.target.value) })}
        />
      </div>
      <div className="field">
        <label>Mou par défaut (%)</label>
        <input
          type="number" min={0} max={30} step={0.5} value={Number((settings.defaultSlack * 100).toFixed(1))}
          onChange={(event) => update({ defaultSlack: Number(event.target.value) / 100 })}
        />
      </div>
      <div className="field">
        <label>Rayon mini toron</label>
        <input
          type="number" min={1} max={20} step={0.5} value={settings.bundleMinBendFactor}
          onChange={(event) => update({ bundleMinBendFactor: Number(event.target.value) })}
        />
      </div>
      <p className="hint">Exprimé en multiples du diamètre du toron : 4 signifie 4 × Ø.</p>

      <label className="checkline">
        <input
          type="checkbox" checked={settings.correctLengthByPosition}
          onChange={(event) => update({ correctLengthByPosition: event.target.checked })}
        />
        Corriger la longueur selon la position du fil dans le toron
      </label>
      <p className="hint">
        Un fil placé à l’extérieur d’un coude parcourt (R + e)·φ au lieu de R·φ. Sur un faisceau de forte section
        avec des coudes serrés, l’écart entre fils devient mesurable.
      </p>
    </div>
  );
}
