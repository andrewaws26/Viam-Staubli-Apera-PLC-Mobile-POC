"use client";

/**
 * ProfileForm — Employee profile view and editor.
 *
 * Displays the current user's profile with editable fields.
 * Managers can view/edit other users' profiles via the userId prop.
 *
 * Features:
 *   - Profile picture upload with preview
 *   - Phone, emergency contact, hire date, job title, department
 *   - Training compliance status badge (fetched from /api/training)
 *   - Save with loading/success/error feedback
 */

import { useState, useEffect, useRef } from "react";
import {
  DEPARTMENT_OPTIONS,
  JOB_TITLE_OPTIONS,
  type EmployeeProfile,
  type UpdateProfilePayload,
} from "@ironsight/shared";
interface TrainingRecord {
  id: string;
  compliance_status: "current" | "expiring" | "expired";
  [key: string]: unknown;
}

interface Props {
  /** Clerk user ID of the profile to display. */
  currentUserId: string;
  /** Role of the currently logged-in user (for manager permissions). */
  currentUserRole: string;
  /** If set, view/edit this user's profile instead of the current user's. */
  targetUserId?: string;
}

export default function ProfileForm({ currentUserId, currentUserRole, targetUserId }: Props) {
  const isManager = currentUserRole === "developer" || currentUserRole === "manager";
  const profileUserId = targetUserId || currentUserId;
  const canEdit = profileUserId === currentUserId || isManager;

  // ── Profile state ───────────────────────────────────────────────────
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Form fields ─────────────────────────────────────────────────────
  const [phone, setPhone] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [pictureUrl, setPictureUrl] = useState("");

  // ── Profile picture upload ──────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // ── Training compliance ─────────────────────────────────────────────
  const [trainingStatus, setTrainingStatus] = useState<{ is_compliant: boolean; expired: number } | null>(null);

  // ── Load profile data ───────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setError("");

    const params = new URLSearchParams();
    if (targetUserId) params.set("user_id", targetUserId);

    fetch(`/api/profiles?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load profile");
        return r.json();
      })
      .then((data: EmployeeProfile) => {
        setProfile(data);
        setPhone(data.phone || "");
        setEmergencyName(data.emergency_contact_name || "");
        setEmergencyPhone(data.emergency_contact_phone || "");
        setHireDate(data.hire_date || "");
        setJobTitle(data.job_title || "");
        setDepartment(data.department || "");
        setPictureUrl(data.profile_picture_url || "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load profile"))
      .finally(() => setLoading(false));
  }, [targetUserId]);

  // ── Load training compliance ────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams();
    if (targetUserId) params.set("user_id", targetUserId);

    fetch(`/api/training?${params}`)
      .then((r) => r.json())
      .then((records: TrainingRecord[]) => {
        if (!Array.isArray(records)) return;
        const expired = records.filter((r) => r.compliance_status === "expired").length;
        const is_compliant = expired === 0 && records.length > 0;
        setTrainingStatus({ is_compliant, expired });
      })
      .catch(() => {}); // Non-critical — badge just won't show
  }, [targetUserId]);

  // ── Profile picture upload handler ──────────────────────────────────
  async function handlePictureUpload(file: File) {
    setUploading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (targetUserId) formData.append("user_id", targetUserId);

      const res = await fetch("/api/profiles/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      const data = await res.json();
      setPictureUrl(data.url);
      setSuccess("Profile picture updated!");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // ── Save profile ───────────────────────────────────────────────────
  async function handleSave() {
    setError("");
    setSuccess("");
    setSaving(true);

    try {
      const payload: UpdateProfilePayload = {
        phone: phone || undefined,
        emergency_contact_name: emergencyName || undefined,
        emergency_contact_phone: emergencyPhone || undefined,
        hire_date: hireDate || undefined,
        job_title: jobTitle || undefined,
        department: department || undefined,
        profile_picture_url: pictureUrl || undefined,
      };

      const params = new URLSearchParams();
      if (targetUserId) params.set("user_id", targetUserId);

      const res = await fetch(`/api/profiles?${params}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      setSuccess("Profile saved!");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  // ── Loading skeleton ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-14 rounded-lg bg-gray-800/50 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Feedback banners */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-900/50 border border-red-700 text-red-200 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-red-400 hover:text-white ml-4">
            Dismiss
          </button>
        </div>
      )}
      {success && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-green-900/50 border border-green-700 text-green-200 text-sm">
          {success}
        </div>
      )}

      {/* Profile Picture + Name Section */}
      <section className="mb-8 p-6 rounded-xl bg-gray-900/50 border border-gray-800 flex flex-col sm:flex-row items-center gap-6">
        {/* Avatar / picture */}
        <div className="relative group shrink-0">
          <div className="w-24 h-24 rounded-full bg-gray-800 border-2 border-gray-700 overflow-hidden flex items-center justify-center">
            {pictureUrl ? (
              <img
                src={pictureUrl}
                alt="Profile"
                className="w-full h-full object-cover"
              />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 text-gray-600" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
            )}
          </div>
          {canEdit && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
            >
              {uploading ? (
                <div className="w-6 h-6 rounded-full border-2 border-gray-400 border-t-white animate-spin" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z" />
                </svg>
              )}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handlePictureUpload(file);
            }}
          />
        </div>

        {/* Name and email */}
        <div className="text-center sm:text-left">
          <h2 className="text-xl font-bold text-gray-100">{profile?.user_name || "Unknown User"}</h2>
          <p className="text-sm text-gray-500">{profile?.user_email || ""}</p>

          {/* Training compliance badge */}
          {trainingStatus && (
            <div className="mt-2">
              {trainingStatus.is_compliant ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-900/50 border border-green-700 text-green-300 text-xs font-bold uppercase tracking-wider">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Training Compliant
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-900/50 border border-amber-700 text-amber-300 text-xs font-bold uppercase tracking-wider">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {trainingStatus.expired > 0 ? "Training Expired" : "Training Incomplete"}
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Contact Information */}
      <section className="mb-8 p-6 rounded-xl bg-gray-900/50 border border-gray-800">
        <h3 className="text-lg font-bold text-gray-100 mb-6 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-violet-400" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
          </svg>
          Contact Information
        </h3>

        <div className="space-y-4">
          {/* Phone */}
          <div>
            <label className="block text-sm font-semibold text-gray-400 mb-2">Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={!canEdit}
              placeholder="(555) 123-4567"
              className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 disabled:opacity-50"
            />
          </div>

          {/* Emergency Contact */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-400 mb-2">Emergency Contact Name</label>
              <input
                type="text"
                value={emergencyName}
                onChange={(e) => setEmergencyName(e.target.value)}
                disabled={!canEdit}
                placeholder="Jane Doe"
                className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-400 mb-2">Emergency Contact Phone</label>
              <input
                type="tel"
                value={emergencyPhone}
                onChange={(e) => setEmergencyPhone(e.target.value)}
                disabled={!canEdit}
                placeholder="(555) 987-6543"
                className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 disabled:opacity-50"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Employment Details */}
      <section className="mb-8 p-6 rounded-xl bg-gray-900/50 border border-gray-800">
        <h3 className="text-lg font-bold text-gray-100 mb-6 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-violet-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M6 6V5a3 3 0 013-3h2a3 3 0 013 3v1h2a2 2 0 012 2v3.57A22.952 22.952 0 0110 13a22.95 22.95 0 01-8-1.43V8a2 2 0 012-2h2zm2-1a1 1 0 011-1h2a1 1 0 011 1v1H8V5zm-3 8a23.001 23.001 0 005 .55A23.001 23.001 0 0015 13v3a2 2 0 01-2 2H7a2 2 0 01-2-2v-3z" clipRule="evenodd" />
          </svg>
          Employment Details
        </h3>

        <div className="space-y-4">
          {/* Hire Date */}
          <div>
            <label className="block text-sm font-semibold text-gray-400 mb-2">Hire Date</label>
            <input
              type="date"
              value={hireDate}
              onChange={(e) => setHireDate(e.target.value)}
              disabled={!canEdit}
              className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-violet-500 disabled:opacity-50"
            />
          </div>

          {/* Job Title */}
          <div>
            <label className="block text-sm font-semibold text-gray-400 mb-2">Job Title</label>
            <select
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              disabled={!canEdit}
              className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-violet-500 disabled:opacity-50"
            >
              <option value="">Select job title...</option>
              {JOB_TITLE_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Department */}
          <div>
            <label className="block text-sm font-semibold text-gray-400 mb-2">Department</label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              disabled={!canEdit}
              className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-violet-500 disabled:opacity-50"
            >
              <option value="">Select department...</option>
              {DEPARTMENT_OPTIONS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Save button */}
      {canEdit && (
        <div className="flex gap-3 pb-8">
          <button
            onClick={handleSave}
            disabled={saving}
            className="min-h-[44px] px-6 py-3 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Profile"}
          </button>
          <a
            href="/"
            className="min-h-[44px] px-6 py-3 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white font-bold uppercase tracking-wider transition-colors flex items-center"
          >
            Dashboard
          </a>
        </div>
      )}
    </div>
  );
}
