/** Coupe du toron : le rangement réel des fils dans la section, à l'échelle.
 *  C'est la vue qui explique le diamètre annoncé et le taux de remplissage. */
import { deriveAll } from '../state/derived';
import { useProject } from '../state/project';
import { useSession } from '../state/session';
import { fillRatio } from '../core/harness/bundle';
import { SLEEVE_KIND_LABEL } from '../core/harness/library';

export function SectionView({ segmentId, size = 250 }: { segmentId: string; size?: number }) {
  const project = useProject((state) => state.project);
  const select = useSession((state) => state.select);
  const derived = deriveAll(project);

  const load = derived.computation.loads.get(segmentId);
  const segment = project.segments[segmentId];
  if (!load || !segment) return null;

  const sleeve = segment.sleeveId ? project.sleeves[segment.sleeveId] : undefined;
  const outerRadius = Math.max(
    load.bundleDiameter / 2,
    sleeve ? sleeve.innerDiameter / 2 + sleeve.wallThickness : 0,
    1,
  );
  const scale = (size / 2 - 14) / outerRadius;
  const center = size / 2;
  const diameters = load.wireIds.map((id) => project.wires[id]?.outerDiameter ?? 0);
  const ratio = sleeve && sleeve.innerDiameter > 0 ? fillRatio(diameters, sleeve.innerDiameter) : null;

  return (
    <div>
      <svg className="section-view" width={size} height={size} role="img" aria-label="Coupe du toron">
        <circle cx={center} cy={center} r={(load.bundleDiameter / 2) * scale} fill="#2b3038" />
        {sleeve && sleeve.innerDiameter > 0 && (
          <>
            <circle
              cx={center} cy={center} r={(sleeve.innerDiameter / 2) * scale}
              fill="none" stroke={sleeve.color} strokeWidth={Math.max(1.5, sleeve.wallThickness * scale)} strokeDasharray={sleeve.kind === 'spiralee' ? '6 4' : undefined}
            />
          </>
        )}
        <circle cx={center} cy={center} r={(load.bundleDiameter / 2) * scale} fill="none" stroke="#6b7382" strokeDasharray="3 3" />
        {load.wireIds.map((wireId) => {
          const circle = load.positions.get(wireId);
          const wire = project.wires[wireId];
          if (!circle || !wire) return null;
          return (
            <g key={wireId} onClick={() => select({ kind: 'wire', id: wireId })} style={{ cursor: 'pointer' }}>
              <circle
                cx={center + circle.x * scale}
                cy={center - circle.y * scale}
                r={Math.max(1.5, circle.r * scale)}
                fill={wire.color}
                stroke="rgba(0,0,0,0.55)"
                strokeWidth={0.8}
              >
                <title>{`${wire.name} — ${wire.sectionMm2} mm² — Ø${wire.outerDiameter} mm`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span>Toron Ø{load.bundleDiameter.toFixed(1)} mm</span>
        <span>{load.wireIds.length} fils</span>
        <span>{load.copperSection.toFixed(2)} mm² cuivre</span>
        {sleeve && <span>{SLEEVE_KIND_LABEL[sleeve.kind]} Ø{sleeve.innerDiameter}</span>}
        {ratio != null && (
          <span style={{ color: ratio > project.settings.maxFillRatio ? 'var(--warn)' : 'var(--ok)' }}>
            remplissage {(ratio * 100).toFixed(0)} %
          </span>
        )}
      </div>
    </div>
  );
}
