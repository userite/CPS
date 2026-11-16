export type MachineStatus =
  | "running"
  | "idle"
  | "setup"
  | "warning"
  | "alarm"
  | "offline"
  | "unknown";

export type MachineKind = "lathe" | "other";

export type MetricPoint = {
  timestamp: string;
  value: number | null;
};

export type MachineCardData = {
  id: string;
  name: string;
  model?: string;
  kind?: MachineKind;
  status: MachineStatus;
  oee: number | null;
  primaryMetric: {
    key: string;
    label: string;
    unit: string;
  };
  trend: MetricPoint[];
  lastUpdatedAt?: string;
  activeAlertCount?: number;
};

export type TrendThresholds = {
  upper?: number | null;
  lower?: number | null;
};

/** null bounds mean the gauge stays neutral. Production has not set these. */
export type OeeColorThresholds = {
  goodMin: number | null;
  warnMin: number | null;
};

export type MachineCardSource = {
  machine: MachineCardData;
  trendThresholds?: TrendThresholds;
};

export type MachineCardProps = {
  machine?: MachineCardData;
  selected?: boolean;
  loading?: boolean;
  now?: Date;
  staleAfterMs?: number;
  oeeThresholds?: OeeColorThresholds;
  trendThresholds?: TrendThresholds;
  onSelect?: (machineId: string) => void;
};
