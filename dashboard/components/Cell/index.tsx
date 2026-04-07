// Cell/index.tsx — Barrel export for robot cell monitoring components.
// These components display real-time data from the Staubli TX2-140 robot
// controller and Apera Vue AI vision system at B&B Metals.
//
// Usage in Dashboard.tsx:
//   import { CellSection } from "./Cell";
//   <CellSection simMode={simMode} />
//
// CellSection is the self-contained orchestrator (polls /api/cell-readings,
// renders Watchdog + StaubliPanel + AperaPanel + Network strip).
// Individual panels are also exported for custom layouts.

export { default as CellSection } from "./CellSection";
export { default as StaubliPanel } from "./StaubliPanel";
export { default as AperaPanel } from "./AperaPanel";
export { default as CellWatchdog } from "./CellWatchdog";
export type {
  StaubliReadings,
  AperaReadings,
  NetworkDevice,
  CellAlert,
  CellState,
} from "./CellTypes";
