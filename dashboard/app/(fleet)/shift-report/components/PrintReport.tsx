// ---------------------------------------------------------------------------
// Single-page print report (hidden on screen, shown only when printing)
// ---------------------------------------------------------------------------

import { ShiftReport } from "../types";
import { fmtTime, fmtDateLong, fmtDateTime, fmtHM } from "../utils/timezone";

export function PrintReport({
  report,
  startH,
  startM,
  endH,
  endM,
}: {
  report: ShiftReport;
  startH: number;
  startM: number;
  endH: number;
  endM: number;
}) {
  return (
    <div className="print-report">
      {/* Header */}
      <div className="pr-header">
        <h1>IRONSIGHT SHIFT REPORT</h1>
        <div className="pr-header-right">
          {fmtDateLong(report.periodStart)} &middot; {fmtHM(startH, startM)}–{fmtHM(endH, endM)} ET &middot; {report.truckId}
        </div>
      </div>
      <hr className="pr-rule" />

      {/* KPI Row */}
      <div className="pr-kpi-row">
        <div className="pr-kpi"><div className="pr-kpi-val">{report.engineHours.toFixed(1)}<span>hrs</span></div><div className="pr-kpi-label">Engine Hours</div></div>
        <div className="pr-kpi"><div className="pr-kpi-val">{report.idlePercent.toFixed(0)}<span>%</span></div><div className="pr-kpi-label">Idle Time</div></div>
        <div className="pr-kpi"><div className="pr-kpi-val">{report.totalPlates}<span>plates</span></div><div className="pr-kpi-label">Plates Placed</div></div>
        <div className="pr-kpi"><div className="pr-kpi-val">{report.platesPerHour.toFixed(0)}<span>/hr</span></div><div className="pr-kpi-label">Plates / Hour</div></div>
      </div>

      {/* Location */}
      <p className="pr-location">
        <strong>Location:</strong> Louisville, KY
        {report.route.distanceMiles > 0 && ` \u2014 ${report.route.distanceMiles} mi${report.route.distanceSource === "speed_estimate" ? " (est.)" : ""}`}
        {report.route.movingMinutes > 0 && ` \u2014 ${report.route.movingMinutes} min moving, ${report.route.stoppedMinutes} min stopped`}
      </p>

      {/* Alerts */}
      {report.alerts.length > 0 && (
        <div className="pr-section">
          <div className="pr-section-head">Alerts</div>
          {report.alerts.slice(0, 5).map((alert, i) => (
            <div key={i} className={`pr-alert ${alert.level === "critical" ? "pr-critical" : "pr-warning"}`}>
              {alert.level === "critical" ? "[!] CRITICAL" : "[*] WARNING"}: {alert.message} \u2014 {fmtTime(alert.timestamp)}
            </div>
          ))}
          {report.alerts.length > 5 && (
            <div className="pr-more">and {report.alerts.length - 5} more alert{report.alerts.length - 5 > 1 ? "s" : ""}</div>
          )}
        </div>
      )}

      {/* Trips */}
      {report.trips.length > 0 && (
        <div className="pr-section">
          <div className="pr-section-head">Engine Activity ({report.trips.length} trip{report.trips.length > 1 ? "s" : ""})</div>
          <table className="pr-table">
            <thead><tr><th>Trip</th><th>Start</th><th>End</th><th>Duration</th></tr></thead>
            <tbody>
              {report.trips.slice(0, 8).map((trip, i) => (
                <tr key={i}><td>{i + 1}</td><td>{fmtTime(trip.startTime)}</td><td>{fmtTime(trip.endTime)}</td><td>{trip.durationMin} min</td></tr>
              ))}
            </tbody>
          </table>
          {report.trips.length > 8 && (
            <div className="pr-more">{report.trips.length - 8} additional short trips</div>
          )}
        </div>
      )}

      {/* Peak Readings */}
      <div className="pr-section">
        <div className="pr-section-head">Peak Readings</div>
        <div className="pr-inline-data">
          Peak Coolant: {report.peakCoolantTemp ? `${report.peakCoolantTemp.value}\u00B0F at ${fmtTime(report.peakCoolantTemp.timestamp)}` : "\u2014"}
          {" \u00A0|\u00A0 "}
          Peak Oil: {report.peakOilTemp ? `${report.peakOilTemp.value}\u00B0F at ${fmtTime(report.peakOilTemp.timestamp)}` : "\u2014"}
          {" \u00A0|\u00A0 "}
          Min Battery: {report.minBatteryVoltage ? `${report.minBatteryVoltage.value}V at ${fmtTime(report.minBatteryVoltage.timestamp)}` : "\u2014"}
        </div>
      </div>

      {/* DTCs */}
      {report.dtcEvents.length > 0 && (
        <div className="pr-section">
          <div className="pr-section-head">Diagnostic Trouble Codes</div>
          <div className="pr-inline-data">
            {report.dtcEvents.map((dtc, i) => (
              <span key={i}>{i > 0 && " \u00A0|\u00A0 "}{dtc.code} (first seen {fmtTime(dtc.firstSeen)})</span>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="pr-footer">
        IronSight Fleet Monitoring \u2014 Generated {fmtDateTime(new Date().toISOString())} \u2014 {report.dataPointCount.tps + report.dataPointCount.truck} readings \u2014 All times Eastern (Louisville, KY)
      </div>
    </div>
  );
}
