/** Role definitions for IronSight fleet monitoring. Copied from web dashboard. */
export type UserRole = "developer" | "manager" | "mechanic" | "operator";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  assignedTruckIds: string[];
}

export const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  "/api/plc-command": ["developer", "manager", "mechanic"],
  "/api/truck-command": ["developer", "manager", "mechanic"],
  "/api/ai-chat": ["developer", "manager", "mechanic"],
  "/api/ai-diagnose": ["developer", "manager", "mechanic"],
  "/api/ai-report-summary": ["developer", "manager", "mechanic"],
  "/api/sensor-readings": ["developer", "manager", "mechanic", "operator"],
  "/api/truck-readings": ["developer", "manager", "mechanic", "operator"],
  "/api/shift-report": ["developer", "manager", "mechanic", "operator"],
  "/api/fleet/status": ["developer", "manager", "mechanic", "operator"],
  "/api/fleet/trucks": ["developer", "manager", "mechanic", "operator"],
  "/api/truck-notes": ["developer", "manager", "mechanic", "operator"],
  "/api/dtc-history": ["developer", "manager", "mechanic", "operator"],
  "/api/maintenance": ["developer", "manager", "mechanic", "operator"],
  "/api/work-orders": ["developer", "manager", "mechanic", "operator"],
  "/api/audit-log": ["developer", "manager"],
};

export function hasRole(userRole: string | undefined, requiredRoles: UserRole[]): boolean {
  if (!userRole) return false;
  const cleanRole = userRole.replace("org:", "") as UserRole;
  return requiredRoles.includes(cleanRole);
}

export function cleanRole(role: string): UserRole {
  return role.replace("org:", "") as UserRole;
}

export function canSeeAllTrucks(role: UserRole | string): boolean {
  const clean = role.replace("org:", "") as UserRole;
  return clean !== "operator";
}

export function canUseAI(role: UserRole | string): boolean {
  const clean = role.replace("org:", "") as UserRole;
  return ["developer", "manager", "mechanic"].includes(clean);
}

export function canIssueCommands(role: UserRole | string): boolean {
  const clean = role.replace("org:", "") as UserRole;
  return ["developer", "manager", "mechanic"].includes(clean);
}

export function canManageFleet(role: UserRole | string): boolean {
  const clean = role.replace("org:", "") as UserRole;
  return clean === "developer" || clean === "manager";
}
