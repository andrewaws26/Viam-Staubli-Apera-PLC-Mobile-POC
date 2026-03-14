// PRIVACY CONSTRAINT: This dashboard displays machine and component state only.
// Fields that could identify operators, shift times, or personnel must never
// be added here. See docs/architecture.md section 6 for the full policy.

export type ComponentStatus = "healthy" | "fault" | "error" | "loading" | "pending";

export type SensorReadings = Record<string, unknown>;

export interface ComponentState {
  id: string;
  label: string;
  icon: string;
  status: ComponentStatus;
  readings: SensorReadings | null;
  lastUpdated: Date | null;
  faultMessage: string | null;
}

export interface FaultEvent {
  id: string;
  componentId: string;
  componentLabel: string;
  message: string;
  timestamp: Date;
}
