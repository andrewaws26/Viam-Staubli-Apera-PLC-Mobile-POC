"use client";

import { DocsLayout } from "@/components/docs/DocsLayout";
import {
  DocSection, H3, P, BulletList, NumberedList, Table,
  Steps, InfoBox, Warning, Badge,
} from "@/components/docs/DocComponents";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "roles", label: "Roles & Permissions" },
  { id: "route-permissions", label: "Route Permissions" },
  { id: "fleet-admin", label: "Fleet Administration" },
  { id: "user-management", label: "User Management" },
  { id: "audit-trail", label: "Audit Trail" },
  { id: "inventory", label: "Inventory Management" },
  { id: "architecture", label: "System Architecture" },
  { id: "mobile-app", label: "Mobile App" },
  { id: "troubleshooting", label: "Troubleshooting" },
] as const;

export default function AdminDocsPage() {
  return (
    <DocsLayout
      title="System & Admin — User Guide"
      subtitle="Roles, permissions, fleet administration, inventory, system architecture, and troubleshooting."
      sections={sections}
    >
      <DocSection id="overview" title="Overview">
        <P>
          IronSight uses a role-based access control system with four roles. Each role grants
          progressively more access to platform features. This guide covers the permissions
          model, administration features, and troubleshooting.
        </P>
      </DocSection>

      <DocSection id="roles" title="Roles & Permissions">
        <P>
          IronSight has four user roles, from most restricted to most powerful:
        </P>
        <Table
          headers={["Role", "Access Level", "Intended For"]}
          rows={[
            ["Operator", "Basic view + own timesheets/PTO/training/profile", "Field operators, drivers"],
            ["Mechanic", "Operator + AI diagnostics + truck commands + work orders + team members", "Fleet mechanics, technicians"],
            ["Manager", "Mechanic + all finance + approvals + admin dashboards + push notifications", "Supervisors, foremen, office staff"],
            ["Developer", "Everything including dev tools, vision, all admin", "System administrators, IT"],
          ]}
        />
        <H3>What each role can do</H3>
        <H3>Operator</H3>
        <BulletList
          items={[
            "View fleet overview and truck dashboards (but not the fleet page itself)",
            "View sensor readings, shift reports, truck history",
            "Create/edit/submit own timesheets",
            "Request PTO, view own balance",
            "View own training status",
            "Edit own profile",
            "View work orders (cannot create)",
            "Participate in team chat",
          ]}
        />
        <H3>Mechanic (all Operator permissions plus)</H3>
        <BulletList
          items={[
            "Access fleet page (/fleet)",
            "Use AI chat and full diagnosis",
            "Issue truck commands (clear DTCs, request PGNs, etc.)",
            "Create and manage work orders",
            "View team members list",
          ]}
        />
        <H3>Manager (all Mechanic permissions plus)</H3>
        <BulletList
          items={[
            "Access all Finance/Accounting pages",
            "Approve/reject timesheets and PTO requests",
            "Manage training records (admin)",
            "View audit trail",
            "Manage fleet (add/edit trucks, assign personnel)",
            "Access admin page (/admin)",
            "Send push notifications",
            "Manage per diem rates",
            "Run AI reports",
          ]}
        />
        <H3>Developer (all Manager permissions plus)</H3>
        <BulletList
          items={[
            "Access dev tools (/dev) with raw sensor data",
            "Access vision page (/vision)",
            "Toggle DEV mode on truck dashboard",
          ]}
        />
      </DocSection>

      <DocSection id="route-permissions" title="Route Permissions">
        <P>
          Every API route and page is protected by the route permissions map. If you get an
          &quot;Access Denied&quot; error, your role doesn&apos;t have permission for that route.
        </P>
        <H3>API routes by access level</H3>
        <Table
          headers={["Access Level", "Routes"]}
          rows={[
            ["All roles", "sensor-readings, truck-readings, shift-report, fleet/status, fleet/trucks, work-orders, timesheets, profiles, pto, training, maintenance, dtc-history"],
            ["Mechanic+", "ai-chat, ai-diagnose, ai-suggest-steps, plc-command, truck-command, team-members"],
            ["Manager+", "timesheets/admin, pto/admin, training/admin, per-diem/rates, audit-log, reports, reports/generate, push/send"],
            ["Developer only", "/dev, /vision"],
          ]}
        />
        <H3>Page routes by access level</H3>
        <Table
          headers={["Access Level", "Pages"]}
          rows={[
            ["All roles", "/work, /timesheets, /profile, /pto, /training"],
            ["Mechanic+", "/fleet"],
            ["Manager+", "/admin, /timesheets/admin, /pto/admin, /training/admin, /accounting/*, /reports"],
            ["Developer only", "/dev, /vision"],
          ]}
        />
      </DocSection>

      <DocSection id="fleet-admin" title="Fleet Administration">
        <P>
          Manage the fleet registry at <strong>/admin</strong>. This is where you configure
          trucks, their Viam connections, and personnel assignments.
        </P>
        <H3>Adding a truck</H3>
        <NumberedList
          items={[
            "Go to /admin",
            "Click \"Add Truck\" in the Fleet Manager section",
            "Enter: name, VIN, year, make, model, license plate",
            "Enter Viam credentials: Part ID, Machine Address, API Key, API Key ID",
            "Set home base location",
            "Enable capabilities: TPS monitoring, J1939 diagnostics, Cell monitoring",
            "Save",
          ]}
        />
        <H3>Assigning personnel</H3>
        <P>
          In the Assignments section, link employees to trucks by role. A truck can have
          multiple assigned operators, mechanics, and a manager. Assignments show on fleet
          overview cards and inform the work order system about who works on which truck.
        </P>
        <H3>Truck lifecycle</H3>
        <Steps
          items={[
            { label: "Active", desc: "In service, reporting data, visible in fleet" },
            { label: "Inactive", desc: "Temporarily parked — hidden from fleet overview" },
            { label: "Maintenance", desc: "In the shop — flagged for repair" },
            { label: "Decommissioned", desc: "Permanently retired — cannot be reactivated" },
          ]}
        />
        <Warning>
          Decommissioning is permanent. Use &quot;Inactive&quot; for temporary removal from service.
        </Warning>
      </DocSection>

      <DocSection id="user-management" title="User Management">
        <P>
          IronSight uses Clerk for authentication. Users sign in with email/password or
          social login. Roles are stored in Clerk&apos;s publicMetadata field.
        </P>
        <H3>How roles are assigned</H3>
        <BulletList
          items={[
            "New users default to the \"operator\" role",
            "Managers or developers can change roles via the Clerk dashboard",
            "Role changes take effect on the user's next page load",
            "Roles are stored in Clerk publicMetadata as { role: \"mechanic\" }",
          ]}
        />
        <H3>Inviting new users</H3>
        <NumberedList
          items={[
            "The new user signs up at the IronSight login page",
            "They are automatically assigned the \"operator\" role",
            "A manager or developer goes to the Clerk dashboard to update their role if needed",
            "The user's employee profile is auto-created on their first visit to /profile",
          ]}
        />
      </DocSection>

      <DocSection id="audit-trail" title="Audit Trail">
        <P>
          Every significant action in IronSight is logged to the audit_log table. The audit
          trail at <strong>/accounting/audit-trail</strong> provides a searchable, filterable view
          of all activity.
        </P>
        <H3>What gets logged</H3>
        <BulletList
          items={[
            "DTC clears and truck commands",
            "AI diagnosis and chat sessions",
            "Note creation/deletion on trucks",
            "Work order lifecycle (create, update, delete)",
            "Timesheet lifecycle (create, submit, approve, reject)",
            "PTO requests and approvals",
            "Training record creation/deletion",
            "Profile updates and picture uploads",
            "All accounting actions (journal entries, invoices, bills, payroll, etc.)",
            "Fleet management (truck create, update, decommission)",
            "Report generation and management",
          ]}
        />
        <H3>Each log entry contains</H3>
        <BulletList
          items={[
            "Timestamp — when the action occurred",
            "User — who performed the action (name, ID, role)",
            "Action — what was done (e.g., timesheet_approved, invoice_sent)",
            "Truck ID — which truck was involved (if applicable)",
            "Details — JSON with additional context (amounts, status changes, etc.)",
          ]}
        />
      </DocSection>

      <DocSection id="inventory" title="Inventory Management">
        <P>
          Track parts and supplies at <strong>/inventory</strong>. The inventory system manages
          stock levels, reorder points, and usage logging for fleet maintenance parts.
        </P>
        <H3>Features</H3>
        <BulletList
          items={[
            "Parts catalog with name, SKU, description, category",
            "Stock levels with current quantity tracking",
            "Reorder points — alerts when stock falls below threshold",
            "Location tracking — which warehouse/truck/bin holds the part",
            "Usage logging — record when parts are used on work orders",
            "Category organization — Filters, Fluids, Brakes, Electrical, etc.",
          ]}
        />
        <H3>Stock alerts</H3>
        <Table
          headers={["Alert", "Trigger", "Color"]}
          rows={[
            ["Low Stock", "Quantity at or below reorder point", "Yellow"],
            ["Out of Stock", "Quantity is zero", "Red"],
          ]}
        />
      </DocSection>

      <DocSection id="architecture" title="System Architecture">
        <P>
          IronSight is a cloud-connected fleet monitoring system. Here&apos;s how it works
          at a high level — no technical knowledge required.
        </P>
        <H3>How data flows</H3>
        <NumberedList
          items={[
            "Each truck has a Raspberry Pi 5 computer mounted in the cab",
            "The Pi reads sensors: engine data (CAN bus), TPS production data (PLC), and robot cell data",
            "Sensor data is captured at 1 reading per second",
            "Data syncs to Viam Cloud every 6 seconds over WiFi or cellular",
            "The IronSight dashboard (web app) reads from Viam Cloud every 3–10 seconds",
            "Everything is stored in a PostgreSQL database (Supabase) for history and reporting",
            "AI analysis runs on-demand via Anthropic's Claude API",
          ]}
        />
        <H3>Key systems</H3>
        <Table
          headers={["System", "Purpose"]}
          rows={[
            ["Viam Cloud", "Collects and stores real-time sensor data from trucks"],
            ["Supabase", "Database for timesheets, work orders, chat, accounting, etc."],
            ["Clerk", "User authentication and role management"],
            ["Vercel", "Hosts the dashboard web application"],
            ["Anthropic Claude", "Powers AI diagnostics, chat, reports, and receipt scanning"],
          ]}
        />
      </DocSection>

      <DocSection id="mobile-app" title="Mobile App">
        <P>
          IronSight has an iOS app (React Native / Expo) for field use. The mobile app
          provides a subset of dashboard features optimized for phone screens.
        </P>
        <H3>Mobile features</H3>
        <BulletList
          items={[
            "Fleet overview — see which trucks are online",
            "Truck dashboard — view live sensor data and DTCs",
            "Work orders — view and update work order status",
            "Team chat — send and receive messages with push notifications",
            "Timesheets — view timesheet list",
          ]}
        />
        <H3>Push notifications</H3>
        <P>
          The mobile app receives push notifications for new chat messages, work order
          assignments, and timesheet status changes. Notifications are delivered via Expo
          Push Notification service.
        </P>
      </DocSection>

      <DocSection id="troubleshooting" title="Troubleshooting">
        <H3>Common issues</H3>
        <Table
          headers={["Problem", "Likely Cause", "Solution"]}
          rows={[
            ["Truck shows offline", "WiFi/cellular connection lost, or Pi powered off", "Check truck's WiFi/cellular connection. Verify Raspberry Pi has power. Check Tailscale status."],
            ["Data not updating", "Viam server stopped on the Pi", "SSH into the Pi and run: sudo systemctl restart viam-server"],
            ["Can't approve timesheets", "Your role is not Manager or Developer", "Ask a manager to update your role in the Clerk dashboard"],
            ["Can't see Finance pages", "Your role is Operator or Mechanic", "Finance requires Manager or Developer role"],
            ["AI not responding", "Anthropic API key expired or rate limited", "Check ANTHROPIC_API_KEY in Vercel environment variables"],
            ["Shift report empty", "No data for the selected time range", "Verify the truck was online during that period. Try a broader time range."],
            ["Fleet page empty", "No trucks configured in the fleet registry", "Go to /admin and add trucks with Viam credentials"],
            ["Login not working", "Clerk authentication issue", "Clear browser cookies, try incognito mode, or contact admin"],
          ]}
        />
        <H3>Getting help</H3>
        <P>
          Use the help button (bottom-right corner of any page) to ask the AI assistant
          about any IronSight feature. For technical issues, contact your system administrator.
        </P>
      </DocSection>
    </DocsLayout>
  );
}
