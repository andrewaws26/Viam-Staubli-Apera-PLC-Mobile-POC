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
  "/api/snapshots": ["developer", "manager", "mechanic", "operator"],

  // Push notifications
  "/api/user/push-token": ["developer", "manager", "mechanic", "operator"],
  "/api/push/send": ["developer", "manager"],

  // Team
  "/api/team-members": ["developer", "manager", "mechanic"],

  // Timesheets (all roles can submit their own; manager+ can review)
  "/api/timesheets": ["developer", "manager", "mechanic", "operator"],
  "/api/timesheets/admin": ["developer", "manager"],
  "/api/timesheets/vehicles": ["developer", "manager", "mechanic", "operator"],

  // Profiles (all roles can view/edit own; manager+ can view all)
  "/api/profiles": ["developer", "manager", "mechanic", "operator"],
  "/api/profiles/upload": ["developer", "manager", "mechanic", "operator"],

  // PTO (all roles can submit own; manager+ can approve/view all)
  "/api/pto": ["developer", "manager", "mechanic", "operator"],
  "/api/pto/admin": ["developer", "manager"],
  "/api/pto/balance": ["developer", "manager", "mechanic", "operator"],

  // Per Diem (all roles can view own; manager+ can manage rates)
  "/api/per-diem": ["developer", "manager", "mechanic", "operator"],
  "/api/per-diem/rates": ["developer", "manager"],

  // Training (all roles can view own status; manager+ can manage records)
  "/api/training": ["developer", "manager", "mechanic", "operator"],
  "/api/training/requirements": ["developer", "manager", "mechanic", "operator"],
  "/api/training/admin": ["developer", "manager"],

  // Reports (manager+)
  "/api/reports": ["developer", "manager"],
  "/api/reports/generate": ["developer", "manager"],

  // Admin
  "/api/audit-log": ["developer", "manager"],

  // Web pages
  "/fleet": ["developer", "manager", "mechanic"],
  "/work": ["developer", "manager", "mechanic", "operator"],
  "/timesheets": ["developer", "manager", "mechanic", "operator"],
  "/timesheets/admin": ["developer", "manager"],
  "/profile": ["developer", "manager", "mechanic", "operator"],
  "/pto": ["developer", "manager", "mechanic", "operator"],
  "/pto/admin": ["developer", "manager"],
  "/training": ["developer", "manager", "mechanic", "operator"],
  "/training/admin": ["developer", "manager"],
  "/snapshots": ["developer", "manager", "mechanic", "operator"],
  "/dev": ["developer"],
  "/dev-portal": ["developer"],
  "/api/dev-portal": ["developer"],
  "/vision": ["developer"],
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
