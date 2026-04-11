"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  RAILROAD_OPTIONS,
  WEEKDAY_LABELS,
  LUNCH_OPTIONS,
  type Timesheet,
  type CreateTimesheetPayload,
  type UpdateTimesheetPayload,
} from "@ironsight/shared";
import TimesheetSections from "./TimesheetSections";
import { useToast } from "@/components/Toast";
import PromptModal from "@/components/ui/PromptModal";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Props {
  existingTimesheet?: Timesheet | null;
  currentUserId: string;
  currentUserRole: string;
}

function getWeekDates(weekEnding: string): string[] {
  const end = new Date(weekEnding + "T12:00:00");
  const dates: string[] = [];
  // Week is Mon-Sun, ending Saturday = 6 days back from Saturday
  for (let i = 6; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

function getNextSaturday(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = (6 - day + 7) % 7 || 7;
  const sat = new Date(now);
  sat.setDate(now.getDate() + diff);
  return sat.toISOString().split("T")[0];
}

export default function TimesheetForm({ existingTimesheet, currentUserId, currentUserRole }: Props) {
  const router = useRouter();
  const isEdit = !!existingTimesheet;
  const isManager = currentUserRole === "developer" || currentUserRole === "manager";
  const isDraft = !existingTimesheet || existingTimesheet.status === "draft";
  const canEdit = isDraft || isManager;

  // Form state
  const [weekEnding, setWeekEnding] = useState(existingTimesheet?.week_ending || getNextSaturday());
  const [railroad, setRailroad] = useState(existingTimesheet?.railroad_working_on || "");
  const [chaseVehicles, setChaseVehicles] = useState<string[]>(existingTimesheet?.chase_vehicles || []);
  const [semiTrucks, setSemiTrucks] = useState<string[]>(existingTimesheet?.semi_trucks || []);
  const [workLocation, setWorkLocation] = useState(existingTimesheet?.work_location || "");
  const [nightsOut, setNightsOut] = useState(existingTimesheet?.nights_out || 0);
  const [layovers, setLayovers] = useState(existingTimesheet?.layovers || 0);
  const [coworkers, setCoworkers] = useState<{ id: string; name: string }[]>(existingTimesheet?.coworkers || []);
  const [nsJobCode, setNsJobCode] = useState(existingTimesheet?.norfolk_southern_job_code || "");
  const [jobId, setJobId] = useState(existingTimesheet?.job_id || "");
  const [jobOptions, setJobOptions] = useState<{ id: string; name: string; job_number: string }[]>([]);
  const [iftaOdometerStart, setIftaOdometerStart] = useState<number | null>(existingTimesheet?.ifta_odometer_start ?? null);
  const [iftaOdometerEnd, setIftaOdometerEnd] = useState<number | null>(existingTimesheet?.ifta_odometer_end ?? null);
  const [notes, setNotes] = useState(existingTimesheet?.notes || "");
  const [dailyLogs, setDailyLogs] = useState<{
    log_date: string;
    start_time: string;
    end_time: string;
    hours_worked: number;
    travel_hours: number;
    description: string;
    lunch_minutes: number;
    semi_truck_travel: boolean;
    traveling_from: string;
    destination: string;
    travel_miles: number | null;
  }[]>([]);

  // Reference data
  const [vehicleOptions, setVehicleOptions] = useState<{ chase: string[]; semi: string[] }>({ chase: [], semi: [] });
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [showCoworkerPicker, setShowCoworkerPicker] = useState(false);

  // UI state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [success, setSuccess] = useState("");
  const { toast } = useToast();

  // Load reference data
  useEffect(() => {
    fetch("/api/timesheets/vehicles")
      .then((r) => r.json())
      .then((d) => setVehicleOptions({ chase: d.chase || [], semi: d.semi || [] }))
      .catch(() => toast("Failed to load vehicles"));
    fetch("/api/team-members")
      .then((r) => r.json())
      .then((d) => setTeamMembers(Array.isArray(d) ? d.filter((m: TeamMember) => m.id !== currentUserId) : []))
      .catch(() => toast("Failed to load team members"));
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((d) => setJobOptions(Array.isArray(d) ? d.filter((j: { status: string }) => j.status === "active" || j.status === "bidding").map((j: { id: string; name: string; job_number: string }) => ({ id: j.id, name: j.name, job_number: j.job_number })) : []))
      .catch(() => {});
  }, [currentUserId]);

  // Initialize daily logs when week ending changes
  const initDailyLogs = useCallback((we: string) => {
    if (!we) return;
    const dates = getWeekDates(we);
    if (existingTimesheet?.daily_logs?.length) {
      // Merge existing logs with dates
      const logMap = new Map(existingTimesheet.daily_logs.map((l) => [l.log_date, l]));
      setDailyLogs(
        dates.map((d) => {
          const existing = logMap.get(d);
          return {
            log_date: d,
            start_time: existing?.start_time || "",
            end_time: existing?.end_time || "",
            hours_worked: existing?.hours_worked || 0,
            travel_hours: existing?.travel_hours || 0,
            description: existing?.description || "",
            lunch_minutes: existing?.lunch_minutes ?? 0,
            semi_truck_travel: existing?.semi_truck_travel ?? false,
            traveling_from: existing?.traveling_from || "",
            destination: existing?.destination || "",
            travel_miles: existing?.travel_miles ?? null,
          };
        }),
      );
    } else {
      setDailyLogs(
        dates.map((d) => ({
          log_date: d,
          start_time: "",
          end_time: "",
          hours_worked: 0,
          travel_hours: 0,
          description: "",
          lunch_minutes: 0,
          semi_truck_travel: false,
          traveling_from: "",
          destination: "",
          travel_miles: null,
        })),
      );
    }
  }, [existingTimesheet]);

  useEffect(() => {
    initDailyLogs(weekEnding);
  }, [weekEnding, initDailyLogs]);

  function updateDailyLog(idx: number, field: string, value: string | number | boolean | null) {
    setDailyLogs((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };

      // Auto-calculate hours from start/end times minus lunch
      if ((field === "start_time" || field === "end_time" || field === "lunch_minutes") && next[idx].start_time && next[idx].end_time) {
        const [sh, sm] = next[idx].start_time.split(":").map(Number);
        const [eh, em] = next[idx].end_time.split(":").map(Number);
        let hours = eh + em / 60 - (sh + sm / 60);
        if (hours < 0) hours += 24;
        hours -= (next[idx].lunch_minutes || 0) / 60;
        if (hours < 0) hours = 0;
        next[idx].hours_worked = Math.round(hours * 100) / 100;
      }
      return next;
    });
  }

  function toggleVehicle(list: string[], setList: (v: string[]) => void, value: string) {
    if (list.includes(value)) {
      setList(list.filter((v) => v !== value));
    } else {
      setList([...list, value]);
    }
  }

  function toggleCoworker(member: TeamMember) {
    if (coworkers.find((c) => c.id === member.id)) {
      setCoworkers(coworkers.filter((c) => c.id !== member.id));
    } else {
      setCoworkers([...coworkers, { id: member.id, name: member.name }]);
    }
  }

  const totalHours = dailyLogs.reduce((s, l) => s + (l.hours_worked || 0), 0);
  const totalTravel = dailyLogs.reduce((s, l) => s + (l.travel_hours || 0), 0);

  // ── Daily log entry-based form state ──────────────────────────────
  const [dailyLogFormIdx, setDailyLogFormIdx] = useState<number | null>(null);
  const [dlForm, setDlForm] = useState({
    start_time: "", end_time: "", hours_worked: 0, travel_hours: 0,
    description: "", lunch_minutes: 0, semi_truck_travel: false,
    traveling_from: "", destination: "", travel_miles: null as number | null,
  });

  function updateDlForm(field: string, value: string | number | boolean | null) {
    setDlForm(prev => {
      const next = { ...prev, [field]: value };
      if ((field === "start_time" || field === "end_time" || field === "lunch_minutes") && next.start_time && next.end_time) {
        const [sh, sm] = next.start_time.split(":").map(Number);
        const [eh, em] = next.end_time.split(":").map(Number);
        let hours = eh + em / 60 - (sh + sm / 60);
        if (hours < 0) hours += 24;
        hours -= (next.lunch_minutes || 0) / 60;
        if (hours < 0) hours = 0;
        next.hours_worked = Math.round(hours * 100) / 100;
      }
      return next;
    });
  }

  function openDailyLogAdd() {
    const availIdx = dailyLogs.findIndex(l => !l.start_time && !(l.hours_worked > 0));
    if (availIdx >= 0) {
      setDailyLogFormIdx(availIdx);
      setDlForm({ start_time: "", end_time: "", hours_worked: 0, travel_hours: 0, description: "", lunch_minutes: 0, semi_truck_travel: false, traveling_from: "", destination: "", travel_miles: null });
    }
  }

  function editDailyLog(idx: number) {
    setDailyLogFormIdx(idx);
    const log = dailyLogs[idx];
    setDlForm({
      start_time: log.start_time, end_time: log.end_time, hours_worked: log.hours_worked,
      travel_hours: log.travel_hours, description: log.description, lunch_minutes: log.lunch_minutes,
      semi_truck_travel: log.semi_truck_travel, traveling_from: log.traveling_from,
      destination: log.destination, travel_miles: log.travel_miles,
    });
  }

  function saveDailyLogForm() {
    if (dailyLogFormIdx === null) return;
    setDailyLogs(prev => {
      const next = [...prev];
      next[dailyLogFormIdx] = { ...next[dailyLogFormIdx], ...dlForm };
      return next;
    });
    setDailyLogFormIdx(null);
  }

  function clearDailyLog(idx: number) {
    setDailyLogs(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], start_time: "", end_time: "", hours_worked: 0, travel_hours: 0, description: "", lunch_minutes: 0, semi_truck_travel: false, traveling_from: "", destination: "", travel_miles: null };
      return next;
    });
  }

  async function handleSave(andSubmit = false) {
    setError("");
    setSuccess("");
    setSaving(true);

    try {
      const payload = {
        week_ending: weekEnding,
        railroad_working_on: railroad || null,
        norfolk_southern_job_code: nsJobCode || null,
        job_id: jobId || null,
        chase_vehicles: chaseVehicles,
        semi_trucks: semiTrucks,
        work_location: workLocation || null,
        nights_out: nightsOut,
        layovers,
        coworkers,
        ifta_odometer_start: iftaOdometerStart,
        ifta_odometer_end: iftaOdometerEnd,
        notes: notes || null,
        daily_logs: dailyLogs.filter((l) => l.hours_worked > 0 || l.description || l.start_time),
        ...(andSubmit ? { status: "submitted" } : {}),
      };

      let res: Response;
      if (isEdit) {
        res = await fetch(`/api/timesheets/${existingTimesheet!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload as UpdateTimesheetPayload),
        });
      } else {
        res = await fetch("/api/timesheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload as CreateTimesheetPayload),
        });
      }

      const data = await res.json();

      if (!res.ok) {
        // If duplicate, redirect to the existing timesheet
        if (res.status === 409 && data.existing_id) {
          router.push(`/timesheets/${data.existing_id}`);
          return;
        }
        throw new Error(data.error || "Failed to save");
      }

      // If we just created it, submit it as a follow-up
      if (!isEdit && andSubmit) {
        await fetch(`/api/timesheets/${data.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "submitted" }),
        });
      }

      setSuccess(andSubmit ? "Timesheet submitted!" : "Timesheet saved!");
      setTimeout(() => router.push("/timesheets"), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Status banner */}
      {existingTimesheet && existingTimesheet.status !== "draft" && (
        <div
          className={`mb-6 px-4 py-3 rounded-lg text-sm font-medium ${
            existingTimesheet.status === "submitted"
              ? "bg-blue-900/50 border border-blue-700 text-blue-200"
              : existingTimesheet.status === "approved"
                ? "bg-green-900/50 border border-green-700 text-green-200"
                : "bg-red-900/50 border border-red-700 text-red-200"
          }`}
        >
          {existingTimesheet.status === "submitted" && "This timesheet has been submitted and is pending approval."}
          {existingTimesheet.status === "approved" &&
            `Approved by ${existingTimesheet.approved_by_name} on ${new Date(existingTimesheet.approved_at!).toLocaleDateString()}`}
          {existingTimesheet.status === "rejected" && (
            <>
              Rejected{existingTimesheet.rejection_reason && `: ${existingTimesheet.rejection_reason}`}
            </>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-900/50 border border-red-700 text-red-200 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-green-900/50 border border-green-700 text-green-200 text-sm">
          {success}
        </div>
      )}

      {/* Week Ending Date */}
      <section className="mb-8">
        <label className="block text-sm font-semibold text-gray-300 mb-2 uppercase tracking-wider">
          Week Ending Date
        </label>
        <input
          type="date"
          value={weekEnding}
          onChange={(e) => setWeekEnding(e.target.value)}
          disabled={!canEdit}
          className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500 disabled:opacity-50"
        />
      </section>

      {/* Railroad Time Section */}
      <section className="mb-6">
        <h2 className="text-lg font-bold text-gray-100 mb-4">Railroad Time</h2>

        {/* Co-workers */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-400 mb-2">Co-workers with you</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {coworkers.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-900/50 border border-purple-700 text-purple-200 text-sm"
              >
                {c.name}
                {canEdit && (
                  <button
                    onClick={() => setCoworkers(coworkers.filter((x) => x.id !== c.id))}
                    className="text-purple-400 hover:text-white"
                  >
                    x
                  </button>
                )}
              </span>
            ))}
          </div>
          {canEdit && (
            <div className="relative">
              <button
                onClick={() => setShowCoworkerPicker(!showCoworkerPicker)}
                className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors"
              >
                Add/Remove Co-Workers
              </button>
              {showCoworkerPicker && (
                <div className="absolute z-20 top-full mt-2 left-0 w-72 max-h-64 overflow-y-auto rounded-lg bg-gray-800 border border-gray-700 shadow-xl">
                  {teamMembers.map((m) => {
                    const selected = coworkers.some((c) => c.id === m.id);
                    return (
                      <button
                        key={m.id}
                        onClick={() => toggleCoworker(m)}
                        className={`w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-gray-800/50 transition-colors ${
                          selected ? "bg-purple-900/30" : ""
                        }`}
                      >
                        <span className="text-sm text-gray-200">{m.name}</span>
                        {selected && (
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-purple-400" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                  {teamMembers.length === 0 && (
                    <p className="px-4 py-3 text-sm text-gray-500">No team members found</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chase Vehicles */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-400 mb-2">Chase Vehicle #</label>
          <div className="flex flex-wrap gap-2">
            {vehicleOptions.chase.map((v) => (
              <button
                key={v}
                onClick={() => canEdit && toggleVehicle(chaseVehicles, setChaseVehicles, v)}
                disabled={!canEdit}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  chaseVehicles.includes(v)
                    ? "bg-purple-600 text-white border border-purple-500"
                    : "bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-500"
                } disabled:opacity-50`}
              >
                {v}
              </button>
            ))}
            {vehicleOptions.chase.length === 0 && (
              <p className="text-sm text-gray-500">No vehicles configured</p>
            )}
          </div>
        </div>

        {/* Railroad Working On */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-400 mb-2">Railroad Working On</label>
          <select
            value={railroad}
            onChange={(e) => setRailroad(e.target.value)}
            disabled={!canEdit}
            className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500 disabled:opacity-50"
          >
            <option value="">Select railroad...</option>
            {RAILROAD_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        {/* Norfolk Southern Job Code (conditional) */}
        {railroad === "Norfolk Southern" && (
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-400 mb-2">Norfolk Southern Job Code</label>
            <input
              type="text"
              value={nsJobCode}
              onChange={(e) => setNsJobCode(e.target.value)}
              disabled={!canEdit}
              placeholder="e.g. NS-2026-0412"
              className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 disabled:opacity-50"
            />
          </div>
        )}

        {/* Job Assignment */}
        {jobOptions.length > 0 && (
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-400 mb-2">Job (Optional)</label>
            <select
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              disabled={!canEdit}
              className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500 disabled:opacity-50"
            >
              <option value="">No job assigned</option>
              {jobOptions.map((j) => (
                <option key={j.id} value={j.id}>{j.job_number} — {j.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Semi Trucks */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-400 mb-2">Semi Truck #</label>
          <div className="flex flex-wrap gap-2">
            {vehicleOptions.semi.map((v) => (
              <button
                key={v}
                onClick={() => canEdit && toggleVehicle(semiTrucks, setSemiTrucks, v)}
                disabled={!canEdit}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  semiTrucks.includes(v)
                    ? "bg-purple-600 text-white border border-purple-500"
                    : "bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-500"
                } disabled:opacity-50`}
              >
                {v}
              </button>
            ))}
            {vehicleOptions.semi.length === 0 && (
              <p className="text-sm text-gray-500">No semi trucks configured</p>
            )}
          </div>
        </div>

        {/* Work Location */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-400 mb-2">Work Location (City/State)</label>
          <input
            type="text"
            value={workLocation}
            onChange={(e) => setWorkLocation(e.target.value)}
            disabled={!canEdit}
            placeholder="e.g. Louisville, KY"
            className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 disabled:opacity-50"
          />
        </div>

        {/* Nights Out + Layovers */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-semibold text-gray-400 mb-2">Nights Out</label>
            <input
              type="number"
              min={0}
              value={nightsOut}
              onChange={(e) => setNightsOut(parseInt(e.target.value) || 0)}
              disabled={!canEdit}
              className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-400 mb-2">Layovers</label>
            <input
              type="number"
              min={0}
              value={layovers}
              onChange={(e) => setLayovers(parseInt(e.target.value) || 0)}
              disabled={!canEdit}
              className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500 disabled:opacity-50"
            />
          </div>
        </div>

      </section>

      {/* Railroad Daily Logs */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-100 mb-3">Railroad Daily Logs</h2>

        {dailyLogs.filter(l => l.start_time || l.hours_worked > 0).length === 0 && dailyLogFormIdx === null && (
          <p className="text-gray-400 text-sm italic mb-3">No railroad time entered for this week</p>
        )}

        <div className="space-y-2 mb-3">
          {dailyLogs.map((log, idx) => {
            if (!log.start_time && !(log.hours_worked > 0)) return null;
            const dayLabel = WEEKDAY_LABELS[idx] || "";
            const dateLabel = log.log_date
              ? new Date(log.log_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
              : "";
            return (
              <div key={log.log_date} className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 border border-gray-800/60">
                <div className="text-sm text-gray-300">
                  <span className="font-medium text-gray-200">{dayLabel} {dateLabel}</span>
                  <span className="text-gray-500 mx-2">|</span>
                  <span>{log.start_time} - {log.end_time}</span>
                  <span className="text-gray-500 mx-2">|</span>
                  <span className="text-green-400 font-bold">{log.hours_worked}h</span>
                  {log.lunch_minutes > 0 && <span className="text-gray-500 ml-2">({log.lunch_minutes}min lunch)</span>}
                  {log.semi_truck_travel && <span className="text-gray-500 ml-2">| Semi travel</span>}
                </div>
                {canEdit && (
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => editDailyLog(idx)} className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-800/50 transition-colors">Edit</button>
                    <button onClick={() => clearDailyLog(idx)} className="px-2 py-1 rounded text-xs text-gray-400 hover:text-red-300 hover:bg-red-900/30 transition-colors">Del</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add/Edit daily log form */}
        {dailyLogFormIdx !== null && (
          <div className="p-4 rounded-lg bg-gray-800 border border-gray-700 space-y-3 mb-3">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
              {dailyLogs[dailyLogFormIdx]?.start_time ? "Edit" : "Add"} Log Entry
            </h4>
            <div>
              <label className="block text-sm font-semibold text-gray-400 mb-1">Date</label>
              <select
                value={dailyLogFormIdx}
                onChange={(e) => {
                  const newIdx = Number(e.target.value);
                  setDailyLogFormIdx(newIdx);
                  const log = dailyLogs[newIdx];
                  if (log.start_time || log.hours_worked > 0) {
                    setDlForm({ start_time: log.start_time, end_time: log.end_time, hours_worked: log.hours_worked, travel_hours: log.travel_hours, description: log.description, lunch_minutes: log.lunch_minutes, semi_truck_travel: log.semi_truck_travel, traveling_from: log.traveling_from, destination: log.destination, travel_miles: log.travel_miles });
                  }
                }}
                className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500"
              >
                {dailyLogs.map((log, idx) => (
                  <option key={idx} value={idx}>
                    {new Date(log.log_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-semibold text-gray-400 mb-1">Start Time</label>
                <input type="time" value={dlForm.start_time} onChange={(e) => updateDlForm("start_time", e.target.value)} className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-400 mb-1">Stop Time</label>
                <input type="time" value={dlForm.end_time} onChange={(e) => updateDlForm("end_time", e.target.value)} className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-400 mb-1">Lunch</label>
                <select value={dlForm.lunch_minutes} onChange={(e) => updateDlForm("lunch_minutes", Number(e.target.value))} className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500">
                  {LUNCH_OPTIONS.map((m) => <option key={m} value={m}>{m} minutes</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-400 mb-1">Did Semi Truck Travel?</label>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input type="radio" checked={dlForm.semi_truck_travel} onChange={() => updateDlForm("semi_truck_travel", true)} className="w-5 h-5" /> Yes
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input type="radio" checked={!dlForm.semi_truck_travel} onChange={() => updateDlForm("semi_truck_travel", false)} className="w-5 h-5" /> No
                </label>
              </div>
            </div>
            {dlForm.semi_truck_travel && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-400 mb-1">Traveling From</label>
                  <input type="text" value={dlForm.traveling_from} onChange={(e) => updateDlForm("traveling_from", e.target.value)} className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-400 mb-1">Destination</label>
                  <input type="text" value={dlForm.destination} onChange={(e) => updateDlForm("destination", e.target.value)} className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-400 mb-1">Miles</label>
                  <input type="number" min={0} value={dlForm.travel_miles ?? ""} onChange={(e) => updateDlForm("travel_miles", e.target.value ? parseFloat(e.target.value) : null)} className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500" />
                </div>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button onClick={saveDailyLogForm} className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-bold transition-colors">Add Entry</button>
              <button onClick={() => setDailyLogFormIdx(null)} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-bold transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {/* Add button */}
        {canEdit && dailyLogFormIdx === null && (
          <button onClick={openDailyLogAdd} className="w-full py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold transition-colors">
            Add Railroad Daily Log
          </button>
        )}

        {/* Totals bar */}
        {totalHours > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-300">Week Totals</span>
            <div className="flex gap-6">
              <span className="text-sm">
                <span className="text-gray-500">Work:</span>{" "}
                <span className="font-bold text-green-400">{totalHours.toFixed(2)}h</span>
              </span>
              <span className="text-sm">
                <span className="text-gray-500">Travel:</span>{" "}
                <span className="font-bold text-blue-400">{totalTravel.toFixed(2)}h</span>
              </span>
              <span className="text-sm">
                <span className="text-gray-500">Total:</span>{" "}
                <span className="font-bold text-white">{(totalHours + totalTravel).toFixed(2)}h</span>
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Sub-Sections (only for existing timesheets) */}
      {existingTimesheet && (
        <section className="mb-8">
          <TimesheetSections
            timesheetId={existingTimesheet.id}
            canEdit={canEdit}
            iftaOdometerStart={iftaOdometerStart}
            iftaOdometerEnd={iftaOdometerEnd}
            onIftaOdometerStartChange={setIftaOdometerStart}
            onIftaOdometerEndChange={setIftaOdometerEnd}
          />
        </section>
      )}

      {/* Notes */}
      <section className="mb-8">
        <label className="block text-sm font-semibold text-gray-300 mb-2 uppercase tracking-wider">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={!canEdit}
          rows={3}
          placeholder="Additional notes..."
          className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 disabled:opacity-50 resize-none"
        />
      </section>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 pb-8">
        {canEdit && (
          <>
            <button
              onClick={() => handleSave(false)}
              disabled={saving}
              className="px-6 py-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-semibold transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Draft"}
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              className="px-6 py-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors disabled:opacity-50"
            >
              {saving ? "Submitting..." : "Submit Timesheet"}
            </button>
          </>
        )}

        {/* Manager actions */}
        {isManager && existingTimesheet?.status === "submitted" && (
          <>
            <button
              onClick={async () => {
                setSaving(true);
                await fetch(`/api/timesheets/${existingTimesheet.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ status: "approved" }),
                });
                router.push("/timesheets/admin");
              }}
              className="px-6 py-3 rounded-lg bg-green-600 hover:bg-green-500 text-white font-semibold transition-colors"
            >
              Approve
            </button>
            <button
              onClick={() => setShowRejectModal(true)}
              className="px-6 py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition-colors"
            >
              Reject
            </button>
          </>
        )}

        {/* Withdraw */}
        {existingTimesheet?.status === "submitted" && existingTimesheet.user_id === currentUserId && (
          <button
            onClick={async () => {
              setSaving(true);
              await fetch(`/api/timesheets/${existingTimesheet.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "draft" }),
              });
              router.refresh();
              setSaving(false);
            }}
            className="px-6 py-3 rounded-lg border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white font-semibold transition-colors"
          >
            Withdraw
          </button>
        )}

        {/* Resubmit after rejection */}
        {existingTimesheet?.status === "rejected" && existingTimesheet.user_id === currentUserId && (
          <button
            onClick={async () => {
              setSaving(true);
              // Move back to draft first, then user can edit and resubmit
              await fetch(`/api/timesheets/${existingTimesheet.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "draft" }),
              });
              router.refresh();
              setSaving(false);
            }}
            className="px-6 py-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold transition-colors"
          >
            Edit & Resubmit
          </button>
        )}

        {/* Print / Export PDF */}
        {existingTimesheet && (
          <button
            onClick={() => window.open(`/api/timesheets/${existingTimesheet.id}/pdf`, '_blank')}
            className="px-6 py-3 rounded-lg border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white font-semibold transition-colors"
          >
            Print / Export PDF
          </button>
        )}

        <a
          href="/timesheets"
          className="px-6 py-3 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white font-semibold transition-colors"
        >
          Cancel
        </a>
      </div>

      {existingTimesheet && (
        <PromptModal
          open={showRejectModal}
          title="Rejection reason (optional)"
          placeholder="Why is this timesheet being rejected?"
          onConfirm={async (reason) => {
            setShowRejectModal(false);
            setSaving(true);
            await fetch(`/api/timesheets/${existingTimesheet.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "rejected", rejection_reason: reason }),
            });
            router.push("/timesheets/admin");
          }}
          onCancel={() => setShowRejectModal(false)}
        />
      )}
    </div>
  );
}
