import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";

/** Maximum allowed file size: 5 MB */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Allowed MIME types for profile pictures */
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Map MIME type to file extension */
const TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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
 * POST /api/profiles/upload
 * Accepts a base64-encoded image, uploads it to the Supabase Storage
 * 'profile-pictures' bucket, and returns the public URL.
 *
 * Request body:
 *   { "image": "<base64 data>", "content_type": "image/jpeg" }
 *
 * The file is stored at: profile-pictures/<user_id>.<ext>
 * Uploading again overwrites the previous picture (upsert).
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

  const { image, content_type } = body as { image?: string; content_type?: string };

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
  const filePath = `${userId}.${ext}`;
  const bucketName = "profile-pictures";

  try {
    const sb = getSupabase();

    // Ensure the bucket exists (no-op if it already does)
    const { error: bucketErr } = await sb.storage.createBucket(bucketName, {
      public: true,
      fileSizeLimit: MAX_FILE_SIZE,
      allowedMimeTypes: ALLOWED_TYPES,
    });

    // Ignore "already exists" errors — only throw on real failures
    if (bucketErr && !bucketErr.message?.includes("already exists")) {
      throw bucketErr;
    }

    // Upload with upsert so re-uploads replace the old picture
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

    // Also update the profile row so the URL is persisted
    await sb
      .from("profiles")
      .update({
        profile_picture_url: publicUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    await logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "profile_picture_uploaded",
      details: {
        file_path: filePath,
        content_type,
        size_bytes: buffer.length,
      },
    });

    return NextResponse.json({ url: publicUrl }, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/profiles/upload POST", err);
    return NextResponse.json(
      { error: "Failed to upload profile picture" },
      { status: 502 },
    );
  }
}
