"use client";

/**
 * TimesheetSections — Collapsible accordion UI for all 10 timesheet sub-sections.
 *
 * Each section is a card that expands to show existing entries and an inline
 * add/edit form. Data is fetched from /api/timesheets/[id]/sections.
 *
 * Sections: Railroad Timecards, Inspections, IFTA Entries, Expenses,
 * Maintenance Time, Shop Time, Mileage Pay, Flight Pay, Holiday Pay, Vacation Pay.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  EXPENSE_CATEGORIES,
  LUNCH_OPTIONS,
  US_STATE_CODES,
  RAILROAD_OPTIONS,
  type ExpenseCategory,
} from "@ironsight/shared";

// ── Section configuration ──────────────────────────────────────────────

interface SectionConfig {
  key: string;
  label: string;
  icon: string;
  color: string;
}

const SECTIONS: SectionConfig[] = [
  { key: "railroad_timecards", label: "Railroad Timecards", icon: "📋", color: "blue" },
  { key: "inspections", label: "Inspections", icon: "🔍", color: "amber" },
  { key: "ifta_entries", label: "IFTA Entries", icon: "⛽", color: "green" },
  { key: "expenses", label: "Expenses", icon: "💰", color: "rose" },
  { key: "maintenance_time", label: "Maintenance Time", icon: "🔧", color: "purple" },
  { key: "shop_time", label: "Shop Time", icon: "🏭", color: "cyan" },
  { key: "mileage_pay", label: "Mileage Pay", icon: "🚗", color: "orange" },
  { key: "flight_pay", label: "Flight Pay", icon: "✈️", color: "sky" },
  { key: "holiday_pay", label: "Holiday Pay", icon: "🎄", color: "red" },
  { key: "vacation_pay", label: "Vacation Pay", icon: "🏖️", color: "teal" },
];

const COLOR_MAP: Record<string, { border: string; bg: string; text: string; badge: string }> = {
  blue:   { border: "border-blue-800",   bg: "bg-blue-900/20",   text: "text-blue-300",   badge: "bg-blue-900/50 text-blue-300" },
  amber:  { border: "border-amber-800",  bg: "bg-amber-900/20",  text: "text-amber-300",  badge: "bg-amber-900/50 text-amber-300" },
  green:  { border: "border-green-800",  bg: "bg-green-900/20",  text: "text-green-300",  badge: "bg-green-900/50 text-green-300" },
  rose:   { border: "border-rose-800",   bg: "bg-rose-900/20",   text: "text-rose-300",   badge: "bg-rose-900/50 text-rose-300" },
  purple: { border: "border-purple-800", bg: "bg-purple-900/20", text: "text-purple-300", badge: "bg-purple-900/50 text-purple-300" },
  cyan:   { border: "border-cyan-800",   bg: "bg-cyan-900/20",   text: "text-cyan-300",   badge: "bg-cyan-900/50 text-cyan-300" },
  orange: { border: "border-orange-800", bg: "bg-orange-900/20", text: "text-orange-300", badge: "bg-orange-900/50 text-orange-300" },
  sky:    { border: "border-sky-800",    bg: "bg-sky-900/20",    text: "text-sky-300",    badge: "bg-sky-900/50 text-sky-300" },
  red:    { border: "border-red-800",    bg: "bg-red-900/20",    text: "text-red-300",    badge: "bg-red-900/50 text-red-300" },
  teal:   { border: "border-teal-800",   bg: "bg-teal-900/20",   text: "text-teal-300",   badge: "bg-teal-900/50 text-teal-300" },
};

// ── Types ──────────────────────────────────────────────────────────────

type EntryRecord = Record<string, unknown>;

interface Props {
  timesheetId: string;
  canEdit: boolean;
}

// ── Component ──────────────────────────────────────────────────────────

export default function TimesheetSections({ timesheetId, canEdit }: Props) {
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, EntryRecord[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [showForm, setShowForm] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<EntryRecord | null>(null);
  const [formData, setFormData] = useState<EntryRecord>({});
  const [saving, setSaving] = useState(false);

  // ── Receipt upload state ────────────────────────────────────────────
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const odometerInputRef = useRef<HTMLInputElement>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [odometerPreview, setOdometerPreview] = useState<string | null>(null);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [odometerUploading, setOdometerUploading] = useState(false);

  function handleFileSelect(
    file: File,
    field: "receipt_image_url" | "odometer_image_url",
  ) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (field === "receipt_image_url") {
        setReceiptPreview(dataUrl);
      } else {
        setOdometerPreview(dataUrl);
      }
    };
    reader.readAsDataURL(file);
  }

  async function uploadReceiptImage(
    entryId: string,
    field: "receipt_image_url" | "odometer_image_url",
    preview: string,
  ) {
    const setUploading = field === "receipt_image_url" ? setReceiptUploading : setOdometerUploading;
    setUploading(true);
    try {
      // Extract base64 and content type from data URL
      const match = preview.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) return;
      const [, content_type, image] = match;

      const res = await fetch("/api/timesheets/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image,
          content_type,
          timesheet_id: timesheetId,
          entry_id: entryId,
          field,
        }),
      });

      if (res.ok) {
        const { url } = await res.json();
        setField(field, url);
        if (field === "receipt_image_url") setReceiptPreview(null);
        else setOdometerPreview(null);
        // Refresh entries to show the new thumbnail
        await fetchSection("expenses");
      }
    } catch {
      // Silently fail
    }
    setUploading(false);
  }

  // ── Fetch entries for a section ────────────────────────────────────

  const fetchSection = useCallback(
    async (section: string) => {
      setLoading((prev) => ({ ...prev, [section]: true }));
      try {
        const res = await fetch(
          `/api/timesheets/${timesheetId}/sections?section=${section}`,
        );
        if (res.ok) {
          const data = await res.json();
          setEntries((prev) => ({ ...prev, [section]: data }));
        }
      } catch {
        // Silently fail — user can retry by toggling section
      }
      setLoading((prev) => ({ ...prev, [section]: false }));
    },
    [timesheetId],
  );

  // Load entries when a section is opened
  useEffect(() => {
    if (openSection && !entries[openSection]) {
      fetchSection(openSection);
    }
  }, [openSection, entries, fetchSection]);

  // ── Toggle section ─────────────────────────────────────────────────

  function toggleSection(key: string) {
    setOpenSection((prev) => (prev === key ? null : key));
    setShowForm(null);
    setEditingEntry(null);
    setFormData({});
  }

  // ── Save entry (create or update) ──────────────────────────────────

  async function saveEntry(section: string) {
    setSaving(true);
    try {
      const isEdit = !!editingEntry;
      const url = isEdit
        ? `/api/timesheets/${timesheetId}/sections?section=${section}&entry_id=${editingEntry?.id}`
        : `/api/timesheets/${timesheetId}/sections?section=${section}`;

      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        await fetchSection(section);
        setShowForm(null);
        setEditingEntry(null);
        setFormData({});
      }
    } catch {
      // Silently fail
    }
    setSaving(false);
  }

  // ── Delete entry ───────────────────────────────────────────────────

  async function deleteEntry(section: string, entryId: string) {
    try {
      const res = await fetch(
        `/api/timesheets/${timesheetId}/sections?section=${section}&entry_id=${entryId}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setEntries((prev) => ({
          ...prev,
          [section]: (prev[section] ?? []).filter(
            (e) => e.id !== entryId,
          ),
        }));
      }
    } catch {
      // Silently fail
    }
  }

  // ── Start editing an entry ─────────────────────────────────────────

  function startEdit(section: string, entry: EntryRecord) {
    setShowForm(section);
    setEditingEntry(entry);
    // Copy entry data into form (excluding id, timesheet_id, created_at)
    const { id: _, timesheet_id: __, created_at: ___, ...rest } = entry;
    setFormData(rest);
  }

  // ── Start adding new entry ─────────────────────────────────────────

  function startAdd(section: string) {
    setShowForm(section);
    setEditingEntry(null);
    setFormData(getDefaultFormData(section));
    setReceiptPreview(null);
    setOdometerPreview(null);
  }

  // ── Cancel form ────────────────────────────────────────────────────

  function cancelForm() {
    setShowForm(null);
    setEditingEntry(null);
    setFormData({});
    setReceiptPreview(null);
    setOdometerPreview(null);
  }

  // ── Update a form field ────────────────────────────────────────────

  function setField(key: string, value: unknown) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4">
        Sub-Sections
      </h3>

      {SECTIONS.map((section) => {
        const colors = COLOR_MAP[section.color];
        const isOpen = openSection === section.key;
        const sectionEntries = entries[section.key] ?? [];
        const isLoading = loading[section.key];
        const isFormOpen = showForm === section.key;

        return (
          <div
            key={section.key}
            className={`rounded-xl border transition-colors ${
              isOpen ? colors.border + " " + colors.bg : "border-gray-800 bg-gray-900/30"
            }`}
          >
            {/* Section header */}
            <button
              onClick={() => toggleSection(section.key)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">{section.icon}</span>
                <span className={`text-sm font-bold ${isOpen ? colors.text : "text-gray-300"}`}>
                  {section.label}
                </span>
                {sectionEntries.length > 0 && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${colors.badge}`}>
                    {sectionEntries.length}
                  </span>
                )}
              </div>
              <svg
                className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {/* Expanded content */}
            {isOpen && (
              <div className="px-4 pb-4 space-y-3">
                {isLoading && (
                  <div className="flex justify-center py-4">
                    <div className="w-5 h-5 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
                  </div>
                )}

                {!isLoading && sectionEntries.length === 0 && !isFormOpen && (
                  <p className="text-gray-500 text-sm py-2">No entries yet</p>
                )}

                {/* Existing entries */}
                {!isLoading &&
                  sectionEntries.map((entry) => (
                    <div
                      key={entry.id as string}
                      className="flex items-start justify-between gap-3 p-3 rounded-lg bg-gray-800/50 border border-gray-800/60"
                    >
                      <div className="min-w-0 flex-1 text-sm text-gray-300">
                        {renderEntrySummary(section.key, entry)}
                      </div>
                      {canEdit && (
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={() => startEdit(section.key, entry)}
                            className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-800/50 transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteEntry(section.key, entry.id as string)}
                            className="px-2 py-1 rounded text-xs text-gray-400 hover:text-red-300 hover:bg-red-900/30 transition-colors"
                          >
                            Del
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                {/* Add/Edit form */}
                {isFormOpen && (
                  <div className="p-4 rounded-lg bg-gray-800 border border-gray-700 space-y-3">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                      {editingEntry ? "Edit" : "New"} {section.label.replace(/s$/, "")}
                    </h4>
                    {renderSectionForm(section.key, formData, setField)}

                    {/* Receipt & Odometer upload — expenses only */}
                    {section.key === "expenses" && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        {/* Receipt image */}
                        <div>
                          <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
                            Receipt Photo
                          </label>
                          <input
                            ref={receiptInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleFileSelect(file, "receipt_image_url");
                              e.target.value = "";
                            }}
                          />
                          <div className="flex items-center gap-3">
                            {receiptPreview ? (
                              <>

                                <img
                                  src={receiptPreview}
                                  alt="Receipt preview"
                                  className="w-10 h-10 rounded object-cover border border-gray-600"
                                />
                                {editingEntry ? (
                                  <button
                                    type="button"
                                    onClick={() => uploadReceiptImage(editingEntry.id as string, "receipt_image_url", receiptPreview)}
                                    disabled={receiptUploading}
                                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
                                  >
                                    {receiptUploading ? "Uploading..." : "Upload Receipt"}
                                  </button>
                                ) : (
                                  <span className="text-xs text-gray-500">Save entry first, then upload</span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setReceiptPreview(null)}
                                  className="text-xs text-gray-500 hover:text-red-400"
                                >
                                  Remove
                                </button>
                              </>
                            ) : formData.receipt_image_url ? (
                              <>

                                <img
                                  src={formData.receipt_image_url as string}
                                  alt="Receipt"
                                  className="w-10 h-10 rounded object-cover border border-gray-600"
                                />
                                <button
                                  type="button"
                                  onClick={() => receiptInputRef.current?.click()}
                                  className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-bold transition-colors"
                                >
                                  Replace
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => receiptInputRef.current?.click()}
                                className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-bold transition-colors"
                              >
                                Upload Receipt
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Odometer image */}
                        <div>
                          <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
                            Odometer Photo
                          </label>
                          <input
                            ref={odometerInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleFileSelect(file, "odometer_image_url");
                              e.target.value = "";
                            }}
                          />
                          <div className="flex items-center gap-3">
                            {odometerPreview ? (
                              <>

                                <img
                                  src={odometerPreview}
                                  alt="Odometer preview"
                                  className="w-10 h-10 rounded object-cover border border-gray-600"
                                />
                                {editingEntry ? (
                                  <button
                                    type="button"
                                    onClick={() => uploadReceiptImage(editingEntry.id as string, "odometer_image_url", odometerPreview)}
                                    disabled={odometerUploading}
                                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
                                  >
                                    {odometerUploading ? "Uploading..." : "Upload Odometer"}
                                  </button>
                                ) : (
                                  <span className="text-xs text-gray-500">Save entry first, then upload</span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setOdometerPreview(null)}
                                  className="text-xs text-gray-500 hover:text-red-400"
                                >
                                  Remove
                                </button>
                              </>
                            ) : formData.odometer_image_url ? (
                              <>

                                <img
                                  src={formData.odometer_image_url as string}
                                  alt="Odometer"
                                  className="w-10 h-10 rounded object-cover border border-gray-600"
                                />
                                <button
                                  type="button"
                                  onClick={() => odometerInputRef.current?.click()}
                                  className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-bold transition-colors"
                                >
                                  Replace
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => odometerInputRef.current?.click()}
                                className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-bold transition-colors"
                              >
                                Upload Odometer
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => saveEntry(section.key)}
                        disabled={saving}
                        className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold transition-colors disabled:opacity-50"
                      >
                        {saving ? "Saving..." : editingEntry ? "Update" : "Add"}
                      </button>
                      <button
                        onClick={cancelForm}
                        className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-bold transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Add button */}
                {canEdit && !isFormOpen && (
                  <button
                    onClick={() => startAdd(section.key)}
                    className={`w-full py-2 rounded-lg border border-dashed border-gray-700 text-gray-500 hover:text-white hover:border-gray-500 text-sm font-medium transition-colors`}
                  >
                    + Add {section.label.replace(/s$/, "").replace(/ies$/, "y")}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Default form data per section ────────────────────────────────────

function getDefaultFormData(section: string): EntryRecord {
  const today = new Date().toISOString().split("T")[0];
  switch (section) {
    case "railroad_timecards":
      return { railroad: "Norfolk Southern", track_supervisor: "", division_engineer: "", images: [] };
    case "inspections":
      return { inspection_time: today + "T08:00", images: [], notes: "" };
    case "ifta_entries":
      return { state_code: "", reportable_miles: 0, gallons_purchased: 0 };
    case "expenses":
      return {
        expense_date: today, amount: 0, category: "Other" as ExpenseCategory,
        description: "", needs_reimbursement: true, payment_type: "credit",
        receipt_image_url: null, is_fuel: false, fuel_vehicle_type: null,
        fuel_vehicle_number: null, odometer_image_url: null,
      };
    case "maintenance_time":
      return { log_date: today, start_time: "08:00", stop_time: "17:00", hours_worked: 8, description: "", parts_used: "" };
    case "shop_time":
      return { log_date: today, start_time: "08:00", stop_time: "17:00", lunch_minutes: 30, hours_worked: 8 };
    case "mileage_pay":
      return { log_date: today, traveling_from: "", destination: "", miles: 0, chase_vehicle: "", description: "" };
    case "flight_pay":
      return { log_date: today, traveling_from: "", destination: "" };
    case "holiday_pay":
      return { holiday_date: today };
    case "vacation_pay":
      return { start_date: today, end_date: today, hours_per_day: 8, total_hours: 8 };
    default:
      return {};
  }
}

// ── Render compact entry summary per section ─────────────────────────

function renderEntrySummary(section: string, entry: EntryRecord): React.ReactNode {
  switch (section) {
    case "railroad_timecards":
      return (
        <div>
          <span className="font-medium text-gray-200">{entry.railroad as string}</span>
          {entry.track_supervisor ? (
            <span className="text-gray-500 ml-2">Sup: {String(entry.track_supervisor)}</span>
          ) : null}
        </div>
      );
    case "inspections":
      return (
        <div>
          <span className="font-medium text-gray-200">
            {new Date(entry.inspection_time as string).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </span>
          {entry.notes ? <span className="text-gray-500 ml-2 truncate">{String(entry.notes)}</span> : null}
        </div>
      );
    case "ifta_entries":
      return (
        <div className="flex gap-4">
          <span className="font-medium text-gray-200">{entry.state_code as string}</span>
          <span className="text-gray-400">{entry.reportable_miles as number} mi</span>
          <span className="text-gray-400">{entry.gallons_purchased as number} gal</span>
        </div>
      );
    case "expenses":
      return (
        <div className="flex items-center gap-3">
          <span className="font-bold text-rose-400">${(entry.amount as number).toFixed(2)}</span>
          <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-gray-700 text-gray-300">
            {entry.category as string}
          </span>
          {entry.description ? (
            <span className="text-gray-500 truncate">{String(entry.description)}</span>
          ) : null}
          {entry.receipt_image_url ? (
            <a
              href={entry.receipt_image_url as string}
              target="_blank"
              rel="noopener noreferrer"
              title="View receipt"
              className="shrink-0"
            >

              <img
                src={entry.receipt_image_url as string}
                alt="Receipt"
                className="w-10 h-10 rounded object-cover border border-gray-600 hover:border-rose-400 transition-colors"
              />
            </a>
          ) : null}
          {entry.odometer_image_url ? (
            <a
              href={entry.odometer_image_url as string}
              target="_blank"
              rel="noopener noreferrer"
              title="View odometer"
              className="shrink-0"
            >

              <img
                src={entry.odometer_image_url as string}
                alt="Odometer"
                className="w-10 h-10 rounded object-cover border border-gray-600 hover:border-rose-400 transition-colors"
              />
            </a>
          ) : null}
        </div>
      );
    case "maintenance_time":
    case "shop_time":
      return (
        <div className="flex gap-4">
          <span className="font-medium text-gray-200">{entry.log_date as string}</span>
          <span className="text-gray-400">{entry.start_time as string} - {entry.stop_time as string}</span>
          <span className="text-gray-400">{entry.hours_worked as number}h</span>
        </div>
      );
    case "mileage_pay":
      return (
        <div className="flex gap-3">
          <span className="font-medium text-gray-200">{entry.traveling_from as string} → {entry.destination as string}</span>
          <span className="text-orange-400 font-bold">{entry.miles as number} mi</span>
        </div>
      );
    case "flight_pay":
      return (
        <div>
          <span className="font-medium text-gray-200">{entry.traveling_from as string} → {entry.destination as string}</span>
          <span className="text-gray-500 ml-2">{entry.log_date as string}</span>
        </div>
      );
    case "holiday_pay":
      return <span className="font-medium text-gray-200">{entry.holiday_date as string}</span>;
    case "vacation_pay":
      return (
        <div className="flex gap-3">
          <span className="font-medium text-gray-200">{entry.start_date as string} - {entry.end_date as string}</span>
          <span className="text-teal-400 font-bold">{entry.total_hours as number}h</span>
        </div>
      );
    default:
      return <span className="text-gray-500">Entry</span>;
  }
}

// ── Form fields per section ──────────────────────────────────────────

const inputClass =
  "w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-rose-500";
const selectClass = inputClass;
const labelClass = "block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1";

function renderSectionForm(
  section: string,
  data: EntryRecord,
  set: (key: string, value: unknown) => void,
): React.ReactNode {
  switch (section) {
    case "railroad_timecards":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>Railroad</label>
            <select value={data.railroad as string || ""} onChange={(e) => set("railroad", e.target.value)} className={selectClass}>
              {RAILROAD_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Track Supervisor</label>
            <input type="text" value={data.track_supervisor as string || ""} onChange={(e) => set("track_supervisor", e.target.value)} className={inputClass} placeholder="Name" />
          </div>
          <div>
            <label className={labelClass}>Division Engineer</label>
            <input type="text" value={data.division_engineer as string || ""} onChange={(e) => set("division_engineer", e.target.value)} className={inputClass} placeholder="Name" />
          </div>
        </div>
      );

    case "inspections":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Inspection Time</label>
            <input type="datetime-local" value={data.inspection_time as string || ""} onChange={(e) => set("inspection_time", e.target.value)} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Notes</label>
            <textarea value={data.notes as string || ""} onChange={(e) => set("notes", e.target.value)} className={inputClass + " h-20 resize-none"} placeholder="Inspection notes..." />
          </div>
        </div>
      );

    case "ifta_entries":
      return (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>State</label>
            <select value={data.state_code as string || ""} onChange={(e) => set("state_code", e.target.value)} className={selectClass}>
              <option value="">Select...</option>
              {US_STATE_CODES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Miles</label>
            <input type="number" value={data.reportable_miles as number || ""} onChange={(e) => set("reportable_miles", Number(e.target.value))} className={inputClass} min={0} />
          </div>
          <div>
            <label className={labelClass}>Gallons</label>
            <input type="number" value={data.gallons_purchased as number || ""} onChange={(e) => set("gallons_purchased", Number(e.target.value))} className={inputClass} min={0} step="0.1" />
          </div>
        </div>
      );

    case "expenses":
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={labelClass}>Date</label>
              <input type="date" value={data.expense_date as string || ""} onChange={(e) => set("expense_date", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Amount ($)</label>
              <input type="number" value={data.amount as number || ""} onChange={(e) => set("amount", Number(e.target.value))} className={inputClass} min={0} step="0.01" />
            </div>
            <div>
              <label className={labelClass}>Category</label>
              <select value={data.category as string || "Other"} onChange={(e) => set("category", e.target.value)} className={selectClass}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Description</label>
              <input type="text" value={data.description as string || ""} onChange={(e) => set("description", e.target.value)} className={inputClass} placeholder="What was this expense for?" />
            </div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input type="checkbox" checked={data.needs_reimbursement as boolean ?? true} onChange={(e) => set("needs_reimbursement", e.target.checked)} className="rounded" />
                Needs Reimbursement
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input type="checkbox" checked={data.is_fuel as boolean ?? false} onChange={(e) => set("is_fuel", e.target.checked)} className="rounded" />
                Fuel
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Payment Type</label>
              <select value={data.payment_type as string || "credit"} onChange={(e) => set("payment_type", e.target.value)} className={selectClass}>
                <option value="credit">Credit</option>
                <option value="cash">Cash</option>
              </select>
            </div>
            {data.is_fuel ? (
              <>
                <div>
                  <label className={labelClass}>Fuel Vehicle</label>
                  <select value={data.fuel_vehicle_type as string || ""} onChange={(e) => set("fuel_vehicle_type", e.target.value || null)} className={selectClass}>
                    <option value="">N/A</option>
                    <option value="chase">Chase Vehicle</option>
                    <option value="semi">Semi Truck</option>
                  </select>
                </div>
              </>
            ) : null}
          </div>
        </div>
      );

    case "maintenance_time":
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className={labelClass}>Date</label>
            <input type="date" value={data.log_date as string || ""} onChange={(e) => set("log_date", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Start</label>
            <input type="time" value={data.start_time as string || ""} onChange={(e) => set("start_time", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Stop</label>
            <input type="time" value={data.stop_time as string || ""} onChange={(e) => set("stop_time", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Hours</label>
            <input type="number" value={data.hours_worked as number || ""} onChange={(e) => set("hours_worked", Number(e.target.value))} className={inputClass} min={0} step="0.25" />
          </div>
          <div className="sm:col-span-3">
            <label className={labelClass}>Description</label>
            <input type="text" value={data.description as string || ""} onChange={(e) => set("description", e.target.value)} className={inputClass} placeholder="What maintenance was done?" />
          </div>
          <div>
            <label className={labelClass}>Parts Used</label>
            <input type="text" value={data.parts_used as string || ""} onChange={(e) => set("parts_used", e.target.value)} className={inputClass} placeholder="Parts list" />
          </div>
        </div>
      );

    case "shop_time":
      return (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div>
            <label className={labelClass}>Date</label>
            <input type="date" value={data.log_date as string || ""} onChange={(e) => set("log_date", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Start</label>
            <input type="time" value={data.start_time as string || ""} onChange={(e) => set("start_time", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Stop</label>
            <input type="time" value={data.stop_time as string || ""} onChange={(e) => set("stop_time", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Lunch</label>
            <select value={data.lunch_minutes as number ?? 30} onChange={(e) => set("lunch_minutes", Number(e.target.value))} className={selectClass}>
              {LUNCH_OPTIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Hours</label>
            <input type="number" value={data.hours_worked as number || ""} onChange={(e) => set("hours_worked", Number(e.target.value))} className={inputClass} min={0} step="0.25" />
          </div>
        </div>
      );

    case "mileage_pay":
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className={labelClass}>Date</label>
            <input type="date" value={data.log_date as string || ""} onChange={(e) => set("log_date", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>From</label>
            <input type="text" value={data.traveling_from as string || ""} onChange={(e) => set("traveling_from", e.target.value)} className={inputClass} placeholder="Origin" />
          </div>
          <div>
            <label className={labelClass}>To</label>
            <input type="text" value={data.destination as string || ""} onChange={(e) => set("destination", e.target.value)} className={inputClass} placeholder="Destination" />
          </div>
          <div>
            <label className={labelClass}>Miles</label>
            <input type="number" value={data.miles as number || ""} onChange={(e) => set("miles", Number(e.target.value))} className={inputClass} min={0} />
          </div>
          <div>
            <label className={labelClass}>Chase Vehicle</label>
            <input type="text" value={data.chase_vehicle as string || ""} onChange={(e) => set("chase_vehicle", e.target.value)} className={inputClass} placeholder="Vehicle #" />
          </div>
          <div className="sm:col-span-3">
            <label className={labelClass}>Description</label>
            <input type="text" value={data.description as string || ""} onChange={(e) => set("description", e.target.value)} className={inputClass} placeholder="Purpose of trip" />
          </div>
        </div>
      );

    case "flight_pay":
      return (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>Date</label>
            <input type="date" value={data.log_date as string || ""} onChange={(e) => set("log_date", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>From</label>
            <input type="text" value={data.traveling_from as string || ""} onChange={(e) => set("traveling_from", e.target.value)} className={inputClass} placeholder="Origin airport" />
          </div>
          <div>
            <label className={labelClass}>To</label>
            <input type="text" value={data.destination as string || ""} onChange={(e) => set("destination", e.target.value)} className={inputClass} placeholder="Destination airport" />
          </div>
        </div>
      );

    case "holiday_pay":
      return (
        <div className="w-48">
          <label className={labelClass}>Holiday Date</label>
          <input type="date" value={data.holiday_date as string || ""} onChange={(e) => set("holiday_date", e.target.value)} className={inputClass} />
        </div>
      );

    case "vacation_pay":
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className={labelClass}>Start Date</label>
            <input type="date" value={data.start_date as string || ""} onChange={(e) => set("start_date", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>End Date</label>
            <input type="date" value={data.end_date as string || ""} onChange={(e) => set("end_date", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Hours/Day</label>
            <input type="number" value={data.hours_per_day as number ?? 8} onChange={(e) => set("hours_per_day", Number(e.target.value))} className={inputClass} min={0} step="0.5" />
          </div>
          <div>
            <label className={labelClass}>Total Hours</label>
            <input type="number" value={data.total_hours as number || ""} onChange={(e) => set("total_hours", Number(e.target.value))} className={inputClass} min={0} step="0.5" />
          </div>
        </div>
      );

    default:
      return null;
  }
}
