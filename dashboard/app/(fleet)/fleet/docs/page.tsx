"use client";

import { DocsLayout } from "@/components/docs/DocsLayout";
import {
  DocSection, H3, P, BulletList, NumberedList, Table,
  Steps, InfoBox, Warning, Badge,
} from "@/components/docs/DocComponents";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "fleet-dashboard", label: "Fleet Dashboard" },
  { id: "truck-dashboard", label: "Truck Dashboard" },
  { id: "sensor-data", label: "Sensor Data" },
  { id: "dtc-codes", label: "DTC Codes" },
  { id: "shift-reports", label: "Shift Reports" },
  { id: "fleet-management", label: "Fleet Management" },
  { id: "roles", label: "Roles & Access" },
  { id: "glossary", label: "Glossary" },
] as const;

export default function FleetDocsPage() {
  return (
    <DocsLayout
      title="Fleet & Monitoring — User Guide"
      subtitle="Real-time truck monitoring, sensor data, diagnostics, shift reports, and fleet administration."
      sections={sections}
    >
      <DocSection id="overview" title="Overview">
        <P>
          IronSight Fleet Monitoring provides real-time visibility into every truck in your fleet.
          Each truck has a Raspberry Pi 5 that reads engine data (J1939 CAN bus), TPS production
          data (PLC via Modbus TCP), and robot cell data (Staubli/Apera). Data syncs to the cloud
          at 1 Hz and is displayed on the dashboard with 10-second polling.
        </P>
        <H3>What you can see</H3>
        <BulletList
          items={[
            "Live fleet status — which trucks are online, engines running, TPS active",
            "Individual truck dashboards with gauge grids, DTC panels, and AI chat",
            "14 categories of sensor data with threshold-based color coding",
            "Active trouble codes with plain-English descriptions and AI diagnosis",
            "Shift reports with KPIs, alerts, route maps, and trend charts",
            "Fleet administration — add trucks, assign personnel, view audit logs",
          ]}
        />
        <H3>How data flows</H3>
        <InfoBox title="Data Pipeline">
          Truck sensors (CAN bus + PLC + Cell) → Raspberry Pi 5 (1 Hz capture) → Viam Cloud
          (6-second sync) → Dashboard API → Your browser (10-second polling). Total latency
          from truck to screen: typically 10–20 seconds.
        </InfoBox>
      </DocSection>

      <DocSection id="fleet-dashboard" title="Fleet Dashboard">
        <P>
          The fleet dashboard at <strong>/fleet</strong> shows all trucks at a glance. Each truck
          appears as a card with live status indicators.
        </P>
        <H3>Summary bar</H3>
        <P>Seven metric cards across the top:</P>
        <Table
          headers={["Metric", "What It Shows"]}
          rows={[
            ["Total Trucks", "Number of trucks in the fleet registry"],
            ["Online", "Trucks with data received in the last 5 minutes (green)"],
            ["Offline", "Trucks with no recent data (red)"],
            ["Engines Running", "Trucks with RPM > 0 (blue)"],
            ["TPS Active", "Trucks with TPS power on and plate dropping (purple)"],
            ["Active DTCs", "Total active trouble codes across all trucks (amber)"],
            ["Maintenance Overdue", "Trucks with overdue maintenance items (red)"],
          ]}
        />
        <H3>Truck cards</H3>
        <BulletList
          items={[
            "Status dot: green = connected, red = offline, gray = no data ever",
            "TPS status: online/offline, plate count, plates per minute, speed (ft/min)",
            "Engine status: running/off, RPM, coolant temperature",
            "Location and weather from the truck's last reading",
            "Assigned personnel with role-colored badges",
            "Maintenance badges: overdue (red), due soon (yellow), DTC count",
            "Last seen timestamp with relative time (e.g., \"3 minutes ago\")",
          ]}
        />
        <P>
          Click any truck card to open its individual dashboard.
        </P>
        <H3>Auto-refresh</H3>
        <P>
          The fleet dashboard polls every 10 seconds. A &quot;Last refresh: Xs ago&quot; indicator
          shows data freshness. You can also click the refresh button for an immediate update.
        </P>
      </DocSection>

      <DocSection id="truck-dashboard" title="Truck Dashboard">
        <P>
          The individual truck dashboard shows when you navigate to <strong>/?truck_id=XX</strong> or click
          a truck card from the fleet overview. It displays comprehensive real-time data for a
          single vehicle.
        </P>
        <H3>Dashboard sections</H3>
        <NumberedList
          items={[
            "Header — Truck name, VIN, vehicle mode toggle (truck/car), connection status dot",
            "Alert banner — Red bar when active DTCs are present, shows fault names",
            "Gauge grid — 14 categories of sensor data with threshold-based color coding",
            "DTC panel — Active trouble codes with severity badges, clear button, AI diagnosis",
            "AI Chat panel — Conversational AI mechanic with full diagnosis mode",
            "Trend charts — Historical sparklines for key metrics (coolant, RPM, speed, battery)",
            "Truck notes — Free-form notes field for mechanic observations",
            "Truck chat — Team chat thread anchored to this truck",
            "Maintenance tracker — Scheduled maintenance items with overdue alerts",
            "Work orders — Active work orders assigned to this truck",
          ]}
        />
        <H3>Connection status</H3>
        <P>
          The status dot in the header shows data freshness. Green means data is flowing normally.
          When the truck is off or disconnected, a gray banner appears: &quot;Truck is off — waiting
          for data...&quot; Historical data remains accessible.
        </P>
        <H3>Demo mode</H3>
        <P>
          Truck ID &quot;00&quot; is a demo truck with simulated data. Use it to explore the dashboard
          without a live truck connection. Simulated data includes RPM cycles, speed variations,
          temperature fluctuations, and intermittent faults.
        </P>
        <H3>Polling</H3>
        <BulletList
          items={[
            "Live readings: every 3 seconds",
            "Historical data: background fetch every 5 minutes",
            "DTC tracking: real-time on each reading update",
          ]}
        />
      </DocSection>

      <DocSection id="sensor-data" title="Sensor Data">
        <P>
          The gauge grid displays sensor data organized into 14 categories. Each reading has
          threshold-based color coding: white/gray = normal, yellow = warning, red = critical.
        </P>
        <H3>Truck mode categories (J1939)</H3>
        <Table
          headers={["Category", "Key Readings", "Critical Thresholds"]}
          rows={[
            ["Engine", "RPM, engine load, accelerator position, torque", "—"],
            ["Temperatures", "Coolant, oil, fuel, intake, trans oil, ambient", "Coolant > 221°F, Oil > 240°F"],
            ["Pressures", "Oil, fuel, boost, barometric", "Oil < 14.5 PSI"],
            ["Vehicle", "Speed, gear, fuel rate, fuel economy, battery", "Battery < 11.5V"],
            ["Aftertreatment", "SCR efficiency, DEF level, DPF soot, NOx sensors", "SCR < 50%, DEF < 10%"],
            ["Brakes & Safety", "Brake pedal, ABS active, air pressure", "—"],
            ["PTO / Hydraulics", "PTO status, speed, hydraulic temps/pressure", "—"],
            ["Idle / Trip", "Idle fuel, idle hours, trip fuel, service interval", "—"],
            ["Air / Wheel Speed", "Air supply, circuit pressures, axle speed", "—"],
            ["Navigation", "GPS coordinates, heading, altitude, speed", "—"],
            ["Extended Engine", "Exhaust pressure, odometer, cruise, clutch slip", "—"],
            ["Fuel Cost", "Burn rate $/hr, cost/mile, current MPG", "—"],
            ["System Health", "DPF filter, SCR system, battery, DEF indicator", "—"],
            ["Lifetime", "VIN, engine hours, total fuel, idle stats, odometer", "—"],
          ]}
        />
        <H3>TPS (Tie Plate System) data</H3>
        <BulletList
          items={[
            "Plate count (DS7) — Total plates placed this session",
            "Plates per minute (DS8) — Current production rate",
            "Encoder distance (DS10) — Distance traveled, counted in 0.1-inch increments",
            "Detector offset (DS6) — Distance from detector to drop point",
            "Tie spacing (DS3) — Configured spacing between plates (typically 19.5 inches)",
            "Operating mode — TPS-1, TPS-2, Tie Team, etc.",
          ]}
        />
        <H3>Color coding</H3>
        <Table
          headers={["Color", "Meaning"]}
          rows={[
            ["White/Gray", "Normal — within operating range"],
            ["Yellow", "Warning — approaching threshold limits"],
            ["Red", "Critical — outside safe operating range, action needed"],
          ]}
        />
        <Warning>
          Some thresholds are inverted: for pressures, battery voltage, and fluid levels, LOWER
          values are worse. Oil pressure below 14.5 PSI is critical even though the number is
          small.
        </Warning>
      </DocSection>

      <DocSection id="dtc-codes" title="DTC Codes">
        <P>
          Diagnostic Trouble Codes (DTCs) are error codes set by the truck&apos;s electronic control
          units (ECUs). IronSight reads and displays them in real-time with plain-English descriptions.
        </P>
        <H3>J1939 format (trucks)</H3>
        <P>
          Heavy-duty trucks use the J1939 protocol. Each DTC has three components:
        </P>
        <Table
          headers={["Component", "What It Is", "Example"]}
          rows={[
            ["SPN", "Suspect Parameter Number — identifies the system or component", "SPN 110 = Engine Coolant Temperature"],
            ["FMI", "Failure Mode Indicator — describes the type of failure", "FMI 0 = High, FMI 3 = Voltage High"],
            ["ECU", "Electronic Control Unit — which module reported it", "ENG = Engine, TRANS = Transmission, ABS, ACM"],
          ]}
        />
        <H3>Severity levels</H3>
        <Table
          headers={["Severity", "Color", "Meaning"]}
          rows={[
            ["Critical", "Red", "Immediate attention required — may cause damage or derate"],
            ["Warning", "Yellow", "Needs attention soon — performance may degrade"],
            ["Info", "Blue", "Informational — monitor but not urgent"],
          ]}
        />
        <H3>Warning lamps</H3>
        <P>
          The DTC panel shows lamp indicators when active: MIL (Malfunction Indicator), STOP (Red Stop),
          WARN (Amber Warning), and PROT (Protect Lamp). Both the Engine ECM and Aftertreatment ACM
          can command lamps independently.
        </P>
        <H3>Clearing DTCs</H3>
        <NumberedList
          items={[
            "Open the truck dashboard for the affected vehicle",
            "In the DTC panel, click the red \"CLEAR DTCs\" button",
            "The system sends a clear command to the truck via CAN bus",
            "If codes return immediately, the underlying condition persists — clearing alone won't fix it",
          ]}
        />
        <Warning>
          If the Protect Lamp comes back on with zero DTCs after clearing, the ECU is reasserting
          the lamp because the root cause hasn&apos;t been resolved. See the AI Diagnostics docs for
          aftertreatment cascade failure patterns.
        </Warning>
        <H3>DTC history</H3>
        <P>
          The DTC history timeline shows all codes that appeared and cleared over time. Intermittent
          codes (appearing and clearing repeatedly) suggest electrical issues, loose connections, or
          borderline sensor values.
        </P>
        <H3>AI diagnosis</H3>
        <P>
          Each active DTC has a &quot;Diagnose with AI&quot; button. Clicking it opens the AI chat with
          a pre-populated question about that specific code. The AI receives the full DTC context
          plus live readings and historical trends.
        </P>
      </DocSection>

      <DocSection id="shift-reports" title="Shift Reports">
        <P>
          Generate detailed reports for any time range at <strong>/shift-report</strong>. Shift reports
          aggregate all sensor data into KPIs, alerts, trend charts, and route maps.
        </P>
        <H3>Generating a report</H3>
        <NumberedList
          items={[
            "Go to /shift-report",
            "Select a date using the date picker",
            "Choose a preset (Day 6am–6pm, Night 6pm–6am, Full 6am–6am) or set custom times",
            "Click \"Generate\" — the system queries Viam Cloud for all data in that range",
            "Review the report, then click \"Print\" for a paper copy",
          ]}
        />
        <H3>Report sections</H3>
        <Table
          headers={["Section", "What It Shows"]}
          rows={[
            ["Summary KPIs", "Engine hours, idle %, plates placed, plates per hour — color-coded by performance"],
            ["Alerts", "Critical and warning events with timestamps (e.g., coolant over 225°F)"],
            ["DTC Events", "All trouble codes captured during the shift"],
            ["Trip Timeline", "Engine on/off cycles with start/end times and duration"],
            ["Route", "GPS track map (if available) or estimated distance from speed data"],
            ["Peak Readings", "Highest coolant/oil temps and lowest battery voltage with timestamps"],
            ["Engine Vitals", "Sparkline charts for coolant, RPM, speed, and battery over the shift"],
          ]}
        />
        <H3>KPI thresholds</H3>
        <BulletList
          items={[
            "Idle time: green < 25%, yellow 25–40%, red > 40%",
            "Plates per hour: green > 500/hr, yellow < 500/hr",
            "Engine hours and plates placed: green when > 0",
          ]}
        />
        <InfoBox title="Printing">
          The report has print-optimized CSS. Click &quot;Print&quot; or use Ctrl+P / Cmd+P.
          Navigation and interactive elements are hidden in print mode, and the layout
          is formatted for standard 8.5x11&quot; paper.
        </InfoBox>
      </DocSection>

      <DocSection id="fleet-management" title="Fleet Management">
        <P>
          Manage your fleet registry at <strong>/admin</strong>. This is where you add trucks,
          assign personnel, and configure Viam connections.
        </P>
        <H3>Adding a truck</H3>
        <NumberedList
          items={[
            "Go to /admin (requires Manager or Developer role)",
            "Click \"Add Truck\"",
            "Enter: truck name, VIN, year, make, model, license plate",
            "Enter Viam Part ID and Machine Address (for data connectivity)",
            "Set capabilities: TPS monitoring, J1939 diagnostics, Cell monitoring",
            "Set home base location",
            "Save — the truck appears in the fleet overview immediately",
          ]}
        />
        <H3>Assigning personnel</H3>
        <P>
          In the Assignments section of the admin page, assign operators, mechanics, and managers
          to specific trucks. Assignments appear on fleet overview truck cards and inform the
          work order system.
        </P>
        <H3>Truck statuses</H3>
        <Table
          headers={["Status", "Meaning"]}
          rows={[
            ["Active", "Truck is in service and reporting data"],
            ["Inactive", "Temporarily out of service (parked, seasonal)"],
            ["Maintenance", "In the shop for scheduled or unscheduled work"],
            ["Decommissioned", "Permanently retired from the fleet"],
          ]}
        />
        <Warning>
          Decommissioning a truck is permanent. The truck will be hidden from fleet overview
          and cannot be reactivated. Use &quot;Inactive&quot; for temporary removal.
        </Warning>
      </DocSection>

      <DocSection id="roles" title="Roles & Access">
        <Table
          headers={["Role", "Fleet Access"]}
          rows={[
            ["Operator", "Can view fleet overview and truck dashboards, generate shift reports"],
            ["Mechanic", "Same as operator, plus AI diagnostics and DTC clearing"],
            ["Manager", "Same as mechanic, plus fleet admin (add/edit trucks, assign personnel)"],
            ["Developer", "Full access including DEV mode for raw sensor data"],
          ]}
        />
        <P>
          The fleet overview at /fleet is accessible to all roles. The admin page at /admin
          requires <Badge>Manager</Badge> or <Badge>Developer</Badge> role.
        </P>
      </DocSection>

      <DocSection id="glossary" title="Glossary">
        <Table
          headers={["Term", "Definition"]}
          rows={[
            ["TPS", "Tie Plate System — the automated tie plate placement system on railroad trucks"],
            ["PLC", "Programmable Logic Controller — the Click C0-10DD2E-D that controls TPS operations"],
            ["J1939", "SAE standard communication protocol for heavy-duty vehicle diagnostics"],
            ["DTC", "Diagnostic Trouble Code — an error code set by a vehicle ECU"],
            ["SPN", "Suspect Parameter Number — identifies which system/component has a fault (J1939)"],
            ["FMI", "Failure Mode Indicator — describes the type of failure (0=high, 1=low, 3=voltage high, etc.)"],
            ["ECU", "Electronic Control Unit — a computer module in the vehicle (engine, transmission, ABS, etc.)"],
            ["CAN bus", "Controller Area Network — the physical communication bus connecting ECUs"],
            ["Modbus TCP", "Communication protocol used to read PLC registers over Ethernet"],
            ["SCR", "Selective Catalytic Reduction — converts NOx emissions using DEF fluid"],
            ["DPF", "Diesel Particulate Filter — captures soot from exhaust, needs periodic regeneration"],
            ["DEF", "Diesel Exhaust Fluid — urea solution injected into SCR system for NOx reduction"],
            ["Protect Lamp", "EPA inducement indicator — signals aftertreatment system needs repair"],
            ["Regen", "Regeneration — burning accumulated soot from the DPF (passive or forced)"],
            ["Viam", "Cloud robotics platform used for remote data collection from Raspberry Pis"],
          ]}
        />
      </DocSection>
    </DocsLayout>
  );
}
