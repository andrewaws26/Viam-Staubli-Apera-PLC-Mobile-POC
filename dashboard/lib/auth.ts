// Role definitions for IronSight fleet monitoring
export type UserRole = "admin" | "mechanic" | "driver" | "viewer";

// Route permission matrix
export const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  "/api/plc-command": ["admin", "mechanic"],
  "/api/truck-command": ["admin", "mechanic"],
  "/api/ai-chat": ["admin", "mechanic"],
  "/api/ai-diagnose": ["admin", "mechanic"],
  "/api/ai-report-summary": ["admin", "mechanic"],
  "/api/sensor-readings": ["admin", "mechanic", "driver", "viewer"],
  "/api/truck-readings": ["admin", "mechanic", "driver", "viewer"],
  "/api/sensor-history": ["admin", "mechanic", "driver", "viewer"],
  "/api/shift-report": ["admin", "mechanic", "driver", "viewer"],
  "/api/pi-health": ["admin", "mechanic", "driver", "viewer"],
  "/api/truck-history": ["admin", "mechanic", "driver", "viewer"],
  "/dev": ["admin"],
};

export function hasRole(userRole: string | undefined, requiredRoles: UserRole[]): boolean {
  if (!userRole) return false;
  // Clerk org roles are prefixed like "org:admin"
  const cleanRole = userRole.replace("org:", "") as UserRole;
  return requiredRoles.includes(cleanRole);
}
