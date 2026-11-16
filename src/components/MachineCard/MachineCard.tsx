import { oeeColorThresholds, staleAfterMs as defaultStaleAfterMs } from "../../config/dashboard";
import { formatNumber } from "../../domain/format";
import { alertText, freshness, presentMachine, statusLabel } from "../../domain/machinePresentation";
import type { MachineCardProps } from "../../types/machine";
import { MachineIcon } from "./MachineIcon";
import { OeeGauge } from "./OeeGauge";
import { Sparkline } from "./Sparkline";
import "./MachineCard.css";

export function MachineCard({
  machine,
  selected = false,
  loading = false,
  now,
  staleAfterMs = defaultStaleAfterMs,
  oeeThresholds = oeeColorThresholds,
  trendThresholds,
  onSelect,
}: MachineCardProps) {
  if (loading) {
    return (
      <article className="mc-card is-loading" aria-busy="true">
        <p className="mc-loading-label">Зареждане</p>
        <div className="mc-skel" />
        <div className="mc-skel mc-skel-short" />
        <div className="mc-skel mc-skel-chart" />
      </article>
    );
  }

  if (!machine) {
    return (
      <article className="mc-card">
        <p>Липсват данни за машината.</p>
      </article>
    );
  }

  const presented = presentMachine(machine);
  const interactive = Boolean(onSelect);
  const clock = now ?? new Date();
  const age = freshness(presented.lastUpdatedAt, clock, staleAfterMs);
  const alert = alertText(presented.status, presented.activeAlertCount ?? 0);
  const label = statusLabel(presented.status);
  const oeeText = presented.oee == null ? "няма OEE" : `OEE ${formatNumber(presented.oee)}%`;

  return (
    <article
      className={`mc-card${interactive ? " is-interactive" : ""}${selected ? " is-selected" : ""}`}
      data-status={presented.status}
      data-machine-id={presented.id}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
      aria-label={interactive ? `${presented.name}, ${label}, ${oeeText}${selected ? ", избрана" : ""}` : undefined}
      onClick={() => onSelect?.(presented.id)}
      onKeyDown={(event) => {
        if (!onSelect) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(presented.id);
        }
      }}
    >
      <header className="mc-head">
        <MachineIcon kind={presented.kind} />
        <div className="mc-id">
          <h3 className="mc-name">{presented.name}</h3>
          <p className="mc-model">{presented.model ?? "\u00a0"}</p>
          <p className="mc-code">{presented.id}</p>
          <p className="mc-status">
            <span className="mc-dot" aria-hidden="true" />
            <span>{label}</span>
          </p>
        </div>
      </header>
      {alert && (
        <p className="mc-alert">
          <svg className="mc-alert-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 1.5 15 14H1L8 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 6.2v3.6" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="8" cy="12.1" r="0.7" fill="currentColor" />
          </svg>
          {alert}
        </p>
      )}
      <div className="mc-body">
        <OeeGauge value={presented.oee} thresholds={oeeThresholds} />
        <Sparkline
          points={presented.trend}
          label={presented.primaryMetric.label}
          unit={presented.primaryMetric.unit}
          thresholds={trendThresholds}
        />
      </div>
      <footer className="mc-foot">
        <span>{age.label}</span>
        {age.stale && <span className="mc-stale">Остарели данни</span>}
      </footer>
    </article>
  );
}
