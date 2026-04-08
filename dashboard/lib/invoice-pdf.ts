import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

interface InvoiceData {
  invoice_number: number;
  invoice_date: string;
  due_date: string;
  status: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  notes: string | null;
  terms: string | null;
  customers: {
    company_name: string;
    contact_name: string | null;
    email: string | null;
    phone: string | null;
    billing_address: string | null;
  } | null;
  invoice_line_items: InvoiceLineItem[];
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function fmtDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export async function generateInvoicePDF(invoiceId: string): Promise<void> {
  const res = await fetch(`/api/accounting/invoices?id=${invoiceId}`);
  if (!res.ok) throw new Error("Failed to fetch invoice");
  const inv: InvoiceData = await res.json();

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 50;
  let y = 50;

  // ── Header ──────────────────────────────────────────────────────
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text("INVOICE", margin, y);

  // Company info (right side)
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  const companyLines = ["B&B Metals LLC", "Railroad Tie Plate Services", "Kentucky, USA"];
  companyLines.forEach((line, i) => {
    doc.text(line, pageWidth - margin, y - 10 + i * 14, { align: "right" });
  });

  y += 20;

  // Accent line
  doc.setDrawColor(124, 58, 237); // violet-600
  doc.setLineWidth(2);
  doc.line(margin, y, pageWidth - margin, y);
  y += 25;

  // ── Invoice details ─────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(100, 100, 100);
  doc.text("INVOICE #", margin, y);
  doc.text("DATE", margin + 150, y);
  doc.text("DUE DATE", margin + 300, y);
  doc.text("STATUS", pageWidth - margin - 60, y);

  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(40, 40, 40);
  doc.setFontSize(11);
  doc.text(`INV-${String(inv.invoice_number).padStart(4, "0")}`, margin, y);
  doc.text(fmtDate(inv.invoice_date), margin + 150, y);
  doc.text(fmtDate(inv.due_date), margin + 300, y);

  // Status badge
  const statusColors: Record<string, [number, number, number]> = {
    draft: [107, 114, 128],
    sent: [59, 130, 246],
    partial: [245, 158, 11],
    paid: [34, 197, 94],
    overdue: [239, 68, 68],
    voided: [107, 114, 128],
  };
  const statusColor = statusColors[inv.status] || statusColors.draft;
  doc.setTextColor(...statusColor);
  doc.setFont("helvetica", "bold");
  doc.text(inv.status.toUpperCase(), pageWidth - margin - 60, y);

  y += 30;

  // ── Bill To ─────────────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(100, 100, 100);
  doc.text("BILL TO", margin, y);
  y += 16;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(40, 40, 40);
  doc.setFontSize(11);

  if (inv.customers) {
    doc.setFont("helvetica", "bold");
    doc.text(inv.customers.company_name, margin, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    if (inv.customers.contact_name) {
      doc.text(inv.customers.contact_name, margin, y);
      y += 14;
    }
    if (inv.customers.billing_address) {
      const addrLines = inv.customers.billing_address.split("\n");
      addrLines.forEach((line) => {
        doc.text(line, margin, y);
        y += 14;
      });
    }
    if (inv.customers.email) {
      doc.text(inv.customers.email, margin, y);
      y += 14;
    }
    if (inv.customers.phone) {
      doc.text(inv.customers.phone, margin, y);
      y += 14;
    }
  }

  y += 10;

  // ── Line Items Table ────────────────────────────────────────────
  const tableData = (inv.invoice_line_items || []).map((item) => [
    item.description,
    String(item.quantity),
    fmt(Number(item.unit_price)),
    fmt(Number(item.amount)),
  ]);

  autoTable(doc, {
    startY: y,
    head: [["Description", "Qty", "Unit Price", "Amount"]],
    body: tableData,
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 10,
      cellPadding: 8,
      textColor: [40, 40, 40],
      lineColor: [220, 220, 220],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: [80, 80, 80],
      fontStyle: "bold",
      fontSize: 9,
    },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { halign: "center", cellWidth: 50 },
      2: { halign: "right", cellWidth: 90 },
      3: { halign: "right", cellWidth: 90 },
    },
    alternateRowStyles: {
      fillColor: [252, 252, 252],
    },
  });

  // Get Y after table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 20;

  // ── Totals ──────────────────────────────────────────────────────
  const totalsX = pageWidth - margin - 200;
  const valX = pageWidth - margin;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  doc.text("Subtotal", totalsX, y);
  doc.setTextColor(40, 40, 40);
  doc.text(fmt(Number(inv.subtotal)), valX, y, { align: "right" });
  y += 18;

  if (Number(inv.tax_rate) > 0) {
    doc.setTextColor(100, 100, 100);
    doc.text(`Tax (${inv.tax_rate}%)`, totalsX, y);
    doc.setTextColor(40, 40, 40);
    doc.text(fmt(Number(inv.tax_amount)), valX, y, { align: "right" });
    y += 18;
  }

  // Total line
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.line(totalsX, y, valX, y);
  y += 16;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text("Total", totalsX, y);
  doc.text(fmt(Number(inv.total)), valX, y, { align: "right" });
  y += 20;

  if (Number(inv.amount_paid) > 0) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(34, 197, 94);
    doc.text("Amount Paid", totalsX, y);
    doc.text(`-${fmt(Number(inv.amount_paid))}`, valX, y, { align: "right" });
    y += 18;

    doc.setDrawColor(200, 200, 200);
    doc.line(totalsX, y, valX, y);
    y += 16;

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(Number(inv.balance_due) > 0 ? 239 : 34, Number(inv.balance_due) > 0 ? 68 : 197, Number(inv.balance_due) > 0 ? 68 : 94);
    doc.text("Balance Due", totalsX, y);
    doc.text(fmt(Number(inv.balance_due)), valX, y, { align: "right" });
    y += 20;
  }

  // ── Notes / Terms ───────────────────────────────────────────────
  y += 10;
  if (inv.notes) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 100, 100);
    doc.text("NOTES", margin, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 80);
    const noteLines = doc.splitTextToSize(inv.notes, pageWidth - 2 * margin);
    doc.text(noteLines, margin, y);
    y += noteLines.length * 12 + 10;
  }

  if (inv.terms) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 100, 100);
    doc.text("TERMS", margin, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 80);
    const termLines = doc.splitTextToSize(inv.terms, pageWidth - 2 * margin);
    doc.text(termLines, margin, y);
  }

  // ── Footer ──────────────────────────────────────────────────────
  const footerY = doc.internal.pageSize.getHeight() - 30;
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(160, 160, 160);
  doc.text("Thank you for your business.", pageWidth / 2, footerY, { align: "center" });
  doc.text(
    `Generated ${new Date().toLocaleDateString("en-US")} | IronSight Company OS`,
    pageWidth / 2,
    footerY + 12,
    { align: "center" }
  );

  // Save
  doc.save(`Invoice-${inv.invoice_number}.pdf`);
}
