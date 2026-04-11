import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";

/** Maximum allowed file size: 10 MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Allowed MIME types for receipt/odometer photos */
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

/** Map MIME type to file extension */
const TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/** Allowed target fields on timesheet_expenses */
const ALLOWED_FIELDS = ["receipt_image_url", "odometer_image_url"] as const;
type ImageField = (typeof ALLOWED_FIELDS)[number];

/**
 * Fetches display name and role from Clerk for audit logging.
 */
async function getUserInfo(userId: string) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const name = user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.emailAddresses?.[0]?.emailAddress ?? "Unknown";
    const role =
      ((user.publicMetadata as Record<string, unknown>)?.role as string) ||
      "operator";
    return { name, role };
  } catch {
    return { name: "Unknown", role: "operator" };
  }
}

/**
 * POST /api/timesheets/upload
 *
 * Accepts a base64-encoded receipt/odometer image, uploads it to the
 * Supabase Storage 'expense-receipts' bucket, updates the expense entry,
 * and creates a documents row.
 *
 * Request body:
 *   {
 *     "image": "<base64 data>",
 *     "content_type": "image/jpeg",
 *     "timesheet_id": "<uuid>",
 *     "entry_id": "<uuid>",
 *     "field": "receipt_image_url" | "odometer_image_url"
 *   }
 *
 * File stored at: expense-receipts/{timesheet_id}/{entry_id}_{field}.{ext}
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { image, content_type, timesheet_id, entry_id, field } = body as {
    image?: string;
    content_type?: string;
    timesheet_id?: string;
    entry_id?: string;
    field?: string;
  };

  // --- Validation ---

  if (!image || typeof image !== "string") {
    return NextResponse.json({ error: "Missing image data" }, { status: 400 });
  }

  if (!content_type || !ALLOWED_TYPES.includes(content_type)) {
    return NextResponse.json(
      { error: `Invalid content type. Allowed: ${ALLOWED_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  if (!timesheet_id || typeof timesheet_id !== "string") {
    return NextResponse.json({ error: "Missing timesheet_id" }, { status: 400 });
  }

  if (!entry_id || typeof entry_id !== "string") {
    return NextResponse.json({ error: "Missing entry_id" }, { status: 400 });
  }

  if (!field || !ALLOWED_FIELDS.includes(field as ImageField)) {
    return NextResponse.json(
      { error: `Invalid field. Allowed: ${ALLOWED_FIELDS.join(", ")}` },
      { status: 400 },
    );
  }

  // Decode base64 and check file size
  let buffer: Buffer;
  try {
    buffer = Buffer.from(image, "base64");
  } catch {
    return NextResponse.json({ error: "Invalid base64 data" }, { status: 400 });
  }

  if (buffer.length > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` },
      { status: 400 },
    );
  }

  if (buffer.length === 0) {
    return NextResponse.json({ error: "Empty image data" }, { status: 400 });
  }

  const ext = TYPE_TO_EXT[content_type];
  const filePath = `${timesheet_id}/${entry_id}_${field}.${ext}`;
  const bucketName = "expense-receipts";

  try {
    const sb = getSupabase();

    // Ensure the bucket exists (no-op if it already does)
    const { error: bucketErr } = await sb.storage.createBucket(bucketName, {
      public: true,
      fileSizeLimit: MAX_FILE_SIZE,
      allowedMimeTypes: ALLOWED_TYPES,
    });

    // Ignore "already exists" errors -- only throw on real failures
    if (bucketErr && !bucketErr.message?.includes("already exists")) {
      throw bucketErr;
    }

    // Upload with upsert so re-uploads replace the old photo
    const { error: uploadErr } = await sb.storage
      .from(bucketName)
      .upload(filePath, buffer, {
        contentType: content_type,
        upsert: true,
      });

    if (uploadErr) throw uploadErr;

    // Build the public URL
    const { data: urlData } = sb.storage.from(bucketName).getPublicUrl(filePath);
    const publicUrl = urlData.publicUrl;

    // Update the expense entry with the image URL
    const { error: updateErr } = await sb
      .from("timesheet_expenses")
      .update({
        [field]: publicUrl,
      })
      .eq("id", entry_id)
      .eq("timesheet_id", timesheet_id);

    if (updateErr) throw updateErr;

    // Create a documents row for polymorphic file tracking
    const { error: docErr } = await sb.from("documents").insert({
      entity_type: "expense",
      entity_id: entry_id,
      file_name: `${entry_id}_${field}.${ext}`,
      file_url: publicUrl,
      file_type: content_type,
      file_size: buffer.length,
      uploaded_by: userId,
    });

    if (docErr) {
      // Log but don't fail the request -- the upload and expense update succeeded
      console.error("[DOCUMENTS-INSERT-WARN]", docErr.message);
    }

    await logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "timesheet_updated",
      details: {
        timesheet_id,
        entry_id,
        field,
        file_path: filePath,
        content_type,
        size_bytes: buffer.length,
      },
    });

    return NextResponse.json({ url: publicUrl }, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/timesheets/upload POST", err);
    return NextResponse.json(
      { error: "Failed to upload receipt image" },
      { status: 502 },
    );
  }
}
