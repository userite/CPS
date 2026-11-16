import { formatNumber } from "../../domain/format";
import { oeeTone } from "../../domain/machinePresentation";
import type { OeeColorThresholds } from "../../types/machine";

const RADIUS = 30;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function OeeGauge({
  value,
  thresholds,
}: {
  value: number | null;
  thresholds: OeeColorThresholds;
}) {
  const tone = value == null ? "neutral" : oeeTone(value, thresholds);
  const label = value == null ? "—" : `${formatNumber(value)}%`;
  const offset = value == null ? CIRCUMFERENCE : CIRCUMFERENCE * (1 - value / 100);

  return (
    <div className={`oee oee-${tone}`} role="img" aria-label={value == null ? "OEE: няма данни" : `OEE ${label}`}>
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <circle cx="40" cy="40" r={RADIUS} className="oee-track" />
        {value != null && value > 0 && (
          <circle
            cx="40"
            cy="40"
            r={RADIUS}
            className={`oee-arc oee-arc-${tone}`}
            strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            strokeDashoffset={offset}
            transform="rotate(-90 40 40)"
          />
        )}
      </svg>
      <span className="oee-label" aria-hidden="true">
        {label}
      </span>
    </div>
  );
}
