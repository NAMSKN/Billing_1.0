import { describe, it, expect } from 'vitest';
import {
  sanitizeWhatsAppPhone,
  composeInvoiceWhatsAppMessage,
  composePaymentReminderWhatsAppMessage,
} from './whatsapp';

describe('WhatsApp Integration Helpers', () => {
  it('sanitizes 10-digit Indian phone numbers with 91 prefix', () => {
    expect(sanitizeWhatsAppPhone('9876543210')).toBe('919876543210');
    expect(sanitizeWhatsAppPhone('+91 98765-43210')).toBe('919876543210');
    expect(sanitizeWhatsAppPhone('080-23456789')).toBe('08023456789');
    expect(sanitizeWhatsAppPhone('')).toBe('');
  });

  it('composes invoice message correctly', () => {
    const msg = composeInvoiceWhatsAppMessage({
      invoiceNumber: 'SE-2026-001',
      invoiceDate: '15 Aug 2026',
      customerName: 'Acme Precision',
      totalFormatted: '₹12,500.00',
      companyName: 'Moulder Billing Works',
    });

    expect(msg).toContain('Acme Precision');
    expect(msg).toContain('SE-2026-001');
    expect(msg).toContain('₹12,500.00');
    expect(msg).toContain('Moulder Billing Works');
  });

  it('composes payment reminder message with due date', () => {
    const msg = composePaymentReminderWhatsAppMessage({
      customerName: 'Shree Tooling',
      invoiceNumber: 'INV-889',
      balanceFormatted: '₹4,200.00',
      companyName: 'Moulder Billing Works',
      dueDate: '30 Aug 2026',
    });

    expect(msg).toContain('Shree Tooling');
    expect(msg).toContain('₹4,200.00');
    expect(msg).toContain('INV-889');
    expect(msg).toContain('Due: 30 Aug 2026');
  });
});
