/**
 * nav-config.ts — Single source of truth for IronSight navigation.
 *
 * Top nav: 6 section items (Fleet, Operations, People, Finance, Reports, avatar).
 * Each section defines sidebar groups with items and role requirements.
 */

export interface NavItem {
  href: string;
  label: string;
  shortLabel?: string;
  roles?: string[];
  adminOnly?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export interface NavSection {
  id: string;
  label: string;
  href: string;
  roles?: string[];
  sidebar: NavGroup[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "manager",
    label: "Command Center",
    href: "/manager",
    roles: ["developer", "manager"],
    sidebar: [
      {
        title: "Overview",
        items: [
          { href: "/manager", label: "Dashboard" },
        ],
      },
      {
        title: "Quick Actions",
        items: [
          { href: "/timesheets/admin", label: "Review Timesheets" },
          { href: "/pto/admin", label: "PTO Approvals" },
          { href: "/training/admin", label: "Compliance" },
        ],
      },
      {
        title: "System",
        items: [
          { href: "/setup", label: "Setup Wizard" },
        ],
      },
    ],
  },
  {
    id: "fleet",
    label: "Fleet",
    href: "/fleet",
    sidebar: [
      {
        title: "Fleet",
        items: [
          { href: "/fleet", label: "All Trucks" },
          { href: "/shift-report", label: "Shift Report" },
          { href: "/snapshots", label: "Snapshots" },
        ],
      },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    href: "/work",
    sidebar: [
      {
        title: "Operations",
        items: [
          { href: "/work", label: "Work Orders" },
          { href: "/chat", label: "Team Chat" },
        ],
      },
    ],
  },
  {
    id: "people",
    label: "People",
    href: "/timesheets",
    sidebar: [
      {
        title: "Time",
        items: [
          { href: "/timesheets", label: "My Timesheets" },
          { href: "/timesheets/new", label: "New Timesheet" },
          { href: "/pto", label: "Time Off" },
        ],
      },
      {
        title: "Compliance",
        items: [{ href: "/training", label: "Training" }],
      },
      {
        title: "Profile",
        items: [{ href: "/profile", label: "My Profile" }],
      },
      {
        title: "Admin",
        items: [
          { href: "/team", label: "Team Roster", adminOnly: true },
          { href: "/timesheets/admin", label: "Timesheet Review", adminOnly: true },
          { href: "/pto/admin", label: "PTO Approvals", adminOnly: true },
          { href: "/training/admin", label: "Training Admin", adminOnly: true },
          { href: "/admin/vehicles", label: "Vehicle Admin", adminOnly: true },
        ],
      },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    href: "/accounting",
    roles: ["developer", "manager"],
    sidebar: [
      {
        title: "Dashboard",
        items: [{ href: "/accounting", label: "Finance Home" }],
      },
      {
        title: "Job Costing",
        items: [{ href: "/jobs", label: "All Jobs" }],
      },
      {
        title: "Sales",
        items: [
          { href: "/accounting/invoices", label: "Invoices" },
          { href: "/accounting/estimates", label: "Estimates / Quotes" },
          { href: "/accounting/customers", label: "Customers" },
          { href: "/accounting/payment-reminders", label: "Payment Reminders" },
        ],
      },
      {
        title: "Expenses",
        items: [
          { href: "/accounting/bills", label: "Bills" },
          { href: "/accounting/vendor-1099", label: "1099 Tracking" },
          { href: "/accounting/receipt-ocr", label: "Receipt Scanner" },
        ],
      },
      {
        title: "Banking",
        items: [
          { href: "/accounting/bank", label: "Bank Reconciliation" },
          { href: "/accounting/expense-rules", label: "CC Rules & Import" },
          { href: "/accounting/recurring", label: "Recurring Entries" },
        ],
      },
      {
        title: "Payroll",
        items: [
          { href: "/accounting/payroll-run", label: "Run Payroll" },
          { href: "/accounting/employee-tax", label: "Employee Tax Setup" },
        ],
      },
      {
        title: "Taxes",
        items: [
          { href: "/accounting/sales-tax", label: "Sales Tax" },
          { href: "/accounting/tax-reports", label: "Tax Reports (941)" },
        ],
      },
      {
        title: "Reports",
        items: [
          { href: "/accounting/reports", label: "Financial Reports" },
          { href: "/accounting/budget", label: "Budget vs. Actual" },
        ],
      },
      {
        title: "Accounting",
        items: [
          { href: "/accounting", label: "Chart of Accounts" },
          { href: "/accounting/new", label: "Journal Entries" },
          { href: "/accounting/periods", label: "Accounting Periods" },
          { href: "/accounting/fixed-assets", label: "Fixed Assets" },
          { href: "/accounting/docs", label: "User Guide" },
        ],
      },
      {
        title: "",
        items: [
          { href: "/accounting/import", label: "QB Data Import" },
          { href: "/accounting/audit-trail", label: "Audit Trail" },
        ],
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    roles: ["developer", "manager"],
    sidebar: [],
  },
  {
    id: "devportal",
    label: "Dev Portal",
    href: "/dev-portal",
    roles: ["developer"],
    sidebar: [
      {
        title: "Overview",
        items: [
          { href: "/dev-portal", label: "Control Plane" },
        ],
      },
      {
        title: "Infrastructure",
        items: [
          { href: "/dev-portal/health", label: "System Health" },
          { href: "/dev-portal/deployments", label: "Deployments" },
          { href: "/dev-portal/tests", label: "Test Runs" },
        ],
      },
      {
        title: "Development",
        items: [
          { href: "/dev-portal/prompts", label: "Prompt Library" },
          { href: "/dev-portal/sessions", label: "AI Sessions" },
          { href: "/dev-portal/workflows", label: "Workflows" },
        ],
      },
      {
        title: "Knowledge",
        items: [
          { href: "/dev-portal/architecture", label: "Architecture Map" },
          { href: "/dev-portal/knowledge", label: "Knowledge Base" },
        ],
      },
    ],
  },
];

/**
 * Resolve which section owns a given pathname.
 * Returns the section id or null for pages with no section (home, auth, system).
 */
export function resolveSection(pathname: string): NavSection | null {
  if (pathname.startsWith("/manager")) {
    return NAV_SECTIONS.find((s) => s.id === "manager") ?? null;
  }
  if (pathname.startsWith("/accounting") || pathname.startsWith("/jobs")) {
    return NAV_SECTIONS.find((s) => s.id === "finance") ?? null;
  }
  if (pathname.startsWith("/reports")) {
    return NAV_SECTIONS.find((s) => s.id === "reports") ?? null;
  }
  if (pathname.startsWith("/dev-portal")) {
    return NAV_SECTIONS.find((s) => s.id === "devportal") ?? null;
  }
  for (const section of NAV_SECTIONS) {
    for (const group of section.sidebar) {
      for (const item of group.items) {
        if (pathname === item.href || pathname.startsWith(item.href + "/")) {
          return section;
        }
      }
    }
  }
  return null;
}

/**
 * Build breadcrumb segments for a pathname within a section.
 */
export function buildBreadcrumbs(
  pathname: string,
  section: NavSection | null,
): { label: string; href: string }[] {
  const crumbs: { label: string; href: string }[] = [];
  if (!section) return crumbs;

  crumbs.push({ label: section.label, href: section.href });

  // Find matching sidebar group + item
  for (const group of section.sidebar) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(item.href + "/")) {
        if (group.title && group.title !== section.label && group.title !== "Dashboard") {
          crumbs.push({ label: group.title, href: item.href });
        }
        if (item.label !== section.label && item.label !== "Finance Home") {
          crumbs.push({ label: item.label, href: item.href });
        }
        return crumbs;
      }
    }
  }

  return crumbs;
}

/**
 * Check if user role has access to a section.
 */
export function canAccessSection(role: string, section: NavSection): boolean {
  if (!section.roles) return true;
  return section.roles.includes(role);
}

/**
 * Check if user role can see an item (handles adminOnly).
 */
export function canAccessItem(role: string, item: NavItem): boolean {
  if (item.adminOnly) return role === "developer" || role === "manager";
  if (item.roles) return item.roles.includes(role);
  return true;
}
