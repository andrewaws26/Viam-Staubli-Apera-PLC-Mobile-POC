import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getUserRole(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return (
      ((user.publicMetadata as Record<string, unknown>)?.role as string) ||
      "operator"
    );
  } catch {
    return "operator";
  }
}

const VALID_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

// ---------------------------------------------------------------------------
// POST  /api/accounting/receipt-ocr
// ---------------------------------------------------------------------------
// Body: { image: string (base64), mime_type: string }
// Returns extracted receipt data via Claude Vision.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(userId);
  if (role !== "developer" && role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const imageBase64 = body.image as string;
  const mime_type = body.mime_type as string;

  if (!imageBase64 || !mime_type)
    return NextResponse.json(
      { error: "image (base64) and mime_type are required" },
      { status: 400 },
    );

  if (!VALID_MIME_TYPES.includes(mime_type))
    return NextResponse.json(
      { error: `mime_type must be one of: ${VALID_MIME_TYPES.join(", ")}` },
      { status: 400 },
    );

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[RECEIPT-OCR] ANTHROPIC_API_KEY not configured");
    return NextResponse.json(
      { error: "OCR service not configured" },
      { status: 500 },
    );
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mime_type,
                  data: imageBase64,
                },
              },
              {
                type: "text",
                text: `Extract the following from this receipt image and return ONLY valid JSON (no markdown, no code blocks):
{
  "vendor_name": "store/business name",
  "date": "YYYY-MM-DD",
  "total_amount": 0.00,
  "tax_amount": 0.00,
  "subtotal": 0.00,
  "line_items": [{"description": "item name", "amount": 0.00}],
  "payment_method": "cash/credit/debit/unknown",
  "category_suggestion": "one of: fuel, meals, office_supplies, tools, auto_parts, lodging, other"
}
If any field cannot be determined, use null.`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[RECEIPT-OCR] Anthropic API error:", response.status, errBody);
      return NextResponse.json(
        { error: "OCR service returned an error", detail: errBody },
        { status: 502 },
      );
    }

    const result = await response.json();

    // Extract the text content from the Claude response
    const textBlock = result.content?.find(
      (block: { type: string }) => block.type === "text",
    );
    if (!textBlock?.text) {
      console.error("[RECEIPT-OCR] No text content in response:", JSON.stringify(result));
      return NextResponse.json(
        { error: "OCR returned no content" },
        { status: 502 },
      );
    }

    // Parse the JSON from Claude's response and validate structure
    let extracted;
    try {
      // Strip any accidental markdown fencing Claude might add
      let raw = textBlock.text.trim();
      if (raw.startsWith("```")) {
        raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      extracted = JSON.parse(raw);
    } catch {
      console.error("[RECEIPT-OCR] Failed to parse Claude response as JSON:", textBlock.text);
      return NextResponse.json(
        {
          error: "OCR returned invalid JSON",
          raw_text: textBlock.text,
        },
        { status: 502 },
      );
    }

    // Validate extracted data has expected shape
    if (typeof extracted !== "object" || extracted === null || Array.isArray(extracted)) {
      console.error("[RECEIPT-OCR] Parsed JSON is not an object:", typeof extracted);
      return NextResponse.json(
        { error: "OCR returned unexpected data format", raw_text: textBlock.text },
        { status: 502 },
      );
    }

    // Coerce numeric fields (Claude sometimes returns strings)
    if (typeof extracted.total_amount === "string") {
      extracted.total_amount = parseFloat(extracted.total_amount) || null;
    }
    if (typeof extracted.tax_amount === "string") {
      extracted.tax_amount = parseFloat(extracted.tax_amount) || null;
    }
    if (typeof extracted.subtotal === "string") {
      extracted.subtotal = parseFloat(extracted.subtotal) || null;
    }
    if (Array.isArray(extracted.line_items)) {
      for (const item of extracted.line_items) {
        if (typeof item.amount === "string") {
          item.amount = parseFloat(item.amount) || null;
        }
      }
    }

    console.log("[RECEIPT-OCR]", "Scan complete:", {
      vendor: extracted.vendor_name,
      total: extracted.total_amount,
      items: extracted.line_items?.length ?? 0,
    });

    return NextResponse.json({
      success: true,
      data: extracted,
      usage: {
        input_tokens: result.usage?.input_tokens,
        output_tokens: result.usage?.output_tokens,
      },
    });
  } catch (err) {
    console.error("[RECEIPT-OCR] Unexpected error:", err);
    return NextResponse.json(
      { error: "Failed to process receipt" },
      { status: 502 },
    );
  }
}
