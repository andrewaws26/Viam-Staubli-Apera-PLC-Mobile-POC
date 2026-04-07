// Role definitions for IronSight fleet monitoring
export type UserRole = "developer" | "manager" | "mechanic" | "operator";

// Route permission matrix
export const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  "/api/plc-command": ["developer", "manager", "mechanic"],
  "/api/truck-command": ["developer", "manager", "mechanic"],
  "/api/ai-chat": ["developer", "manager", "mechanic"],
  "/api/ai-diagnose": ["developer", "manager", "mechanic"],
  "/api/ai-report-summary": ["developer", "manager", "mechanic"],
  "/api/sensor-readings": ["developer", "manager", "mechanic", "operator"],
  "/api/truck-readings": ["developer", "manager", "mechanic", "operator"],
  "/api/sensor-history": ["developer", "manager", "mechanic", "operator"],
  "/api/shift-report": ["developer", "manager", "mechanic", "operator"],
  "/api/pi-health": ["developer", "manager", "mechanic", "operator"],
  "/api/truck-history": ["developer", "manager", "mechanic", "operator"],
  "/api/truck-notes": ["developer", "manager", "mechanic", "operator"],
  "/api/truck-assignments": ["developer", "manager", "mechanic", "operator"],
  "/api/audit-log": ["developer", "manager"],
  "/api/user/push-token": ["developer", "manager", "mechanic", "operator"],
  "/api/push/send": ["developer", "manager"],
  "/api/dtc-history": ["developer", "manager", "mechanic", "operator"],
  "/api/maintenance": ["developer", "manager", "mechanic", "operator"],
  "/api/work-orders": ["developer", "manager", "mechanic", "operator"],
  "/fleet": ["developer", "manager", "mechanic"],
  "/work": ["developer", "manager", "mechanic", "operator"],
  "/dev": ["developer"],
  "/admin": ["developer", "manager"],
};

export function hasRole(userRole: string | undefined, requiredRoles: UserRole[]): boolean {
  if (!userRole) return false;
  // Clerk org roles are prefixed like "org:admin"
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

export function canManageFleet(role: UserRole | string): boolean {
  const clean = role.replace("org:", "") as UserRole;
  return clean === "developer" || clean === "manager";
}
