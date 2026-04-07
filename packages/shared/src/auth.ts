/** Role definitions and permission helpers for IronSight fleet monitoring. */

export type UserRole = "developer" | "manager" | "mechanic" | "operator";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  assignedTruckIds: string[];
}

export const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  // Commands (mechanic+)
  "/api/plc-command": ["developer", "manager", "mechanic"],
  "/api/truck-command": ["developer", "manager", "mechanic"],

  // AI (mechanic+)
  "/api/ai-chat": ["developer", "manager", "mechanic"],
  "/api/ai-diagnose": ["developer", "manager", "mechanic"],
  "/api/ai-report-summary": ["developer", "manager", "mechanic"],
  "/api/ai-suggest-steps": ["developer", "manager", "mechanic"],

  // Telemetry (all roles)
  "/api/sensor-readings": ["developer", "manager", "mechanic", "operator"],
  "/api/truck-readings": ["developer", "manager", "mechanic", "operator"],
  "/api/sensor-history": ["developer", "manager", "mechanic", "operator"],
  "/api/shift-report": ["developer", "manager", "mechanic", "operator"],
  "/api/pi-health": ["developer", "manager", "mechanic", "operator"],
  "/api/truck-history": ["developer", "manager", "mechanic", "operator"],
  "/api/truck-notes": ["developer", "manager", "mechanic", "operator"],
  "/api/truck-assignments": ["developer", "manager", "mechanic", "operator"],
  "/api/fleet/status": ["developer", "manager", "mechanic", "operator"],
  "/api/fleet/trucks": ["developer", "manager", "mechanic", "operator"],
  "/api/dtc-history": ["developer", "manager", "mechanic", "operator"],
  "/api/maintenance": ["developer", "manager", "mechanic", "operator"],
  "/api/work-orders": ["developer", "manager", "mechanic", "operator"],

  // Push notifications
  "/api/user/push-token": ["developer", "manager", "mechanic", "operator"],
  "/api/push/send": ["developer", "manager"],

  // Team
  "/api/team-members": ["developer", "manager", "mechanic"],

  // Admin
  "/api/audit-log": ["developer", "manager"],

  // Web pages
  "/fleet": ["developer", "manager", "mechanic"],
  "/work": ["developer", "manager", "mechanic", "operator"],
  "/dev": ["developer"],
  "/admin": ["developer", "manager"],
};

export function hasRole(userRole: string | undefined, requiredRoles: UserRole[]): boolean {
  if (!userRole) return false;
  const clean = userRole.replace("org:", "") as UserRole;
  return requiredRoles.includes(clean);
}

export function cleanRole(role: string): UserRole {
  return role.replace("org:", "") as UserRole;
}

export function canSeeAllTrucks(role: UserRole | string): boolean {
  const clean = (typeof role === "string" ? role.replace("org:", "") : role) as UserRole;
  return clean !== "operator";
}

export function canUseAI(role: UserRole | string): boolean {
  const clean = (typeof role === "string" ? role.replace("org:", "") : role) as UserRole;
  return ["developer", "manager", "mechanic"].includes(clean);
}

export function canIssueCommands(role: UserRole | string): boolean {
  const clean = (typeof role === "string" ? role.replace("org:", "") : role) as UserRole;
  return ["developer", "manager", "mechanic"].includes(clean);
}

export function canManageFleet(role: UserRole | string): boolean {
  const clean = (typeof role === "string" ? role.replace("org:", "") : role) as UserRole;
  return clean === "developer" || clean === "manager";
}
