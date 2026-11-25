/**
 * WhatsApp 1-Click Sharing Utility.
 * Formats customized messages for Invoices, Outstanding Payment Reminders,
 * and Purchase Orders, and deep-links to WhatsApp Web or Desktop.
 */

export function sanitizeWhatsAppPhone(phone?: string | null): string {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  // If 10 digits (India standard without prefix), prepend '91'
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export function openWhatsAppShare(phone: string | null | undefined, message: string): void {
  const clean = sanitizeWhatsAppPhone(phone);
  const encoded = encodeURIComponent(message || '');
  const url = clean
    ? `https://api.whatsapp.com/send?phone=${clean}&text=${encoded}`
    : `https://api.whatsapp.com/send?text=${encoded}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function composeInvoiceWhatsAppMessage(params: {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  totalFormatted: string;
  companyName: string;
}): string {
  return [
    `Dear *${params.customerName}*,`,
    ``,
    `Please find details of your invoice from *${params.companyName}*:`,
    `📄 *Invoice No:* ${params.invoiceNumber}`,
    `📅 *Date:* ${params.invoiceDate}`,
    `💰 *Amount:* ${params.totalFormatted}`,
    ``,
    `Thank you for your business! 🙏`,
  ].join('\n');
}

export function composePaymentReminderWhatsAppMessage(params: {
  customerName: string;
  invoiceNumber: string;
  balanceFormatted: string;
  companyName: string;
  dueDate?: string;
}): string {
  return [
    `Dear *${params.customerName}*,`,
    ``,
    `Gentle reminder regarding pending payment of *${params.balanceFormatted}* for Invoice *${params.invoiceNumber}* from *${params.companyName}*${params.dueDate ? ` (Due: ${params.dueDate})` : ''}.`,
    ``,
    `Kindly arrange settlement at your earliest convenience. If already paid, please ignore this reminder.`,
    ``,
    `Thank you,`,
    `*${params.companyName}*`,
  ].join('\n');
}

export function composeStatementWhatsAppMessage(params: {
  partyName: string;
  totalOutstandingFormatted: string;
  companyName: string;
  overdueCount: number;
}): string {
  return [
    `Dear *${params.partyName}*,`,
    ``,
    `Your outstanding balance statement from *${params.companyName}*:`,
    `📊 *Total Overdue:* ${params.totalOutstandingFormatted} (${params.overdueCount} pending bills)`,
    ``,
    `Please review and let us know if any reconciliation is required.`,
    ``,
    `Regards,`,
    `*${params.companyName}*`,
  ].join('\n');
}
