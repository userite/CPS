import type { MachineCardSource } from "../types/machine";

export type MachineLoadResult = {
  mode: "demo" | "unconfigured";
  cards: MachineCardSource[];
};

/**
 * Only door from the screen to machine data.
 * Cards never talk to a PLC, OPC UA, or MQTT.
 * A refresh interval belongs here once blondina is connected.
 * Sample cards load only in development or when VITE_CPS_DATA=demo.
 */
export function isDemoMode(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_CPS_DATA === "demo";
}

export async function loadMachines(): Promise<MachineLoadResult> {
  if (!isDemoMode()) return { mode: "unconfigured", cards: [] };
  const { getDemoCards } = await import("./demoMachines");
  return { mode: "demo", cards: getDemoCards() };
}
