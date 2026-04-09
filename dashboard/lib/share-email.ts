/**
 * Email helper for report sharing.
 * Uses Resend if RESEND_API_KEY is configured; otherwise skips silently.
 */

interface ShareEmailParams {
  to: string;
  recipientName?: string;
  senderName: string;
  title: string;
  message?: string;
  shareUrl: string;
  entityType: string;
}

/**
 * Send a share notification email. Returns true if sent, false if skipped/failed.
 */
export async function sendShareEmail(params: ShareEmailParams): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("[SHARE-EMAIL] Skipped — RESEND_API_KEY not configured");
    return false;
  }

  const fromAddress = process.env.SHARE_FROM_EMAIL || "IronSight <noreply@ironsight.app>";
  const greeting = params.recipientName ? `Hi ${params.recipientName},` : "Hi,";
  const typeLabel = params.entityType.replace("_", " ");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <div style="background: #0a0a0a; border-radius: 12px; padding: 32px; border: 1px solid #1f1f1f;">
        <h2 style="color: #fff; margin: 0 0 8px 0; font-size: 20px;">
          ${params.senderName} shared a ${typeLabel} with you
        </h2>
        <p style="color: #9ca3af; margin: 0 0 20px 0; font-size: 14px;">
          ${greeting}
        </p>
        <div style="background: #111; border-radius: 8px; padding: 16px; margin-bottom: 20px; border: 1px solid #1f1f1f;">
          <p style="color: #e5e7eb; margin: 0; font-size: 15px; font-weight: 600;">
            ${params.title}
          </p>
          ${params.message ? `<p style="color: #9ca3af; margin: 8px 0 0 0; font-size: 13px;">"${params.message}"</p>` : ""}
        </div>
        <a href="${params.shareUrl}"
          style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
          View ${typeLabel}
        </a>
        <p style="color: #6b7280; margin: 20px 0 0 0; font-size: 12px;">
          This link will work without logging in. If you can't click the button, copy this URL:<br/>
          <a href="${params.shareUrl}" style="color: #60a5fa; word-break: break-all;">${params.shareUrl}</a>
        </p>
      </div>
      <p style="color: #4b5563; text-align: center; margin: 16px 0 0 0; font-size: 11px;">
        Sent from IronSight Fleet Monitoring
      </p>
    </div>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [params.to],
        subject: `${params.senderName} shared a ${typeLabel}: ${params.title}`,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[SHARE-EMAIL] Resend error:", res.status, body);
      return false;
    }

    console.log("[SHARE-EMAIL] Sent to", params.to);
    return true;
  } catch (err) {
    console.error("[SHARE-EMAIL] Failed:", err);
    return false;
  }
}
