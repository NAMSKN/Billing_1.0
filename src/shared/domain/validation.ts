import Decimal from 'decimal.js';
import { TaxTreatment } from './enums';
import type { Company, Customer, Invoice, InvoiceLine } from './models';

/**
 * Validation: draft (permissive) vs finalization (strict). Faithful port of
 * Python `domain/validation.py`.
 *
 * - validateDraft is permissive: missing required data is a WARNING (so work
 *   in progress can be saved); data that is present but malformed is BLOCKING.
 * - validateForFinalization is strict: every required rule is enforced in the
 *   documented order and failures are BLOCKING.
 *
 * All format validators (GSTIN/IFSC/email) are offline/format-only — no network
 * call is ever made. Pure module: no I/O, no clock, no global state.
 */

// --- Offline format patterns ---
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidGstin(value: string): boolean {
  return GSTIN_RE.test(value);
}
export function isValidIfsc(value: string): boolean {
  return IFSC_RE.test(value);
}
export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

export type Severity = 'BLOCKING' | 'WARNING';

export interface Issue {
  field: string;
  message: string;
  severity: Severity;
}

export interface ValidationResult {
  issues: Issue[];
}

export function blockingIssues(result: ValidationResult): Issue[] {
  return result.issues.filter((i) => i.severity === 'BLOCKING');
}
export function warningIssues(result: ValidationResult): Issue[] {
  return result.issues.filter((i) => i.severity === 'WARNING');
}
export function isOk(result: ValidationResult): boolean {
  return blockingIssues(result).length === 0;
}

class IssueCollector {
  private issues: Issue[] = [];
  add(issue: Issue): void {
    this.issues.push(issue);
  }
  block(field: string, message: string): void {
    this.issues.push({ field, message, severity: 'BLOCKING' });
  }
  warn(field: string, message: string): void {
    this.issues.push({ field, message, severity: 'WARNING' });
  }
  result(): ValidationResult {
    return { issues: this.issues };
  }
}

function checkCompanyFormats(c: Company, out: IssueCollector): void {
  if (c.gstin && !isValidGstin(c.gstin)) out.block('company.gstin', 'GSTIN format is invalid');
  if (c.email && !isValidEmail(c.email)) out.block('company.email', 'email format is invalid');
  if (c.ifsc && !isValidIfsc(c.ifsc)) out.block('company.ifsc', 'IFSC format is invalid');
}

function checkCustomerFormats(c: Customer, out: IssueCollector): void {
  if (c.gstin && !isValidGstin(c.gstin)) out.block('customer.gstin', 'GSTIN format is invalid');
  if (c.email && !isValidEmail(c.email)) out.block('customer.email', 'email format is invalid');
}

/**
 * Validate a single line item. When strict (finalization) missing required
 * data is blocking; when not strict (draft) the same is a warning. Malformed
 * numeric values are always blocking.
 */
export function validateLine(line: InvoiceLine, index: number, strict: boolean): Issue[] {
  const out = new IssueCollector();
  const prefix = `lines[${index}]`;
  const missing = (field: string, message: string) =>
    strict ? out.block(field, message) : out.warn(field, message);

  if (!line.description.trim()) missing(`${prefix}.description`, 'description is required');

  if (line.tax_treatment === TaxTreatment.TAXABLE && !line.hsn_sac.trim()) {
    missing(`${prefix}.hsn_sac`, 'HSN/SAC is required for a taxable line');
  }

  if (line.quantity.lessThanOrEqualTo(new Decimal(0))) {
    out.block(`${prefix}.quantity`, 'quantity must be greater than zero');
  }
  if (line.rate.lessThan(new Decimal(0))) {
    out.block(`${prefix}.rate`, 'rate must not be negative');
  }
  if (
    line.discount_percent.lessThan(new Decimal(0)) ||
    line.discount_percent.greaterThan(new Decimal(100))
  ) {
    out.block(`${prefix}.discount_percent`, 'discount percent must be between 0 and 100');
  }

  return out.result().issues;
}

function checkDates(
  invoiceDate: Date | null,
  dueDate: Date | null,
  today: Date | null,
  out: IssueCollector,
  strict: boolean,
): void {
  if (invoiceDate === null) {
    if (strict) out.block('invoice_date', 'invoice date is required');
    else out.warn('invoice_date', 'invoice date is not set');
    return;
  }
  if (dueDate !== null && dueDate < invoiceDate) {
    out.block('due_date', 'due date must not be earlier than the invoice date');
  }
  if (today !== null && invoiceDate > today) {
    // Future-dated policy is undecided (Q-001): warn, never hard-block.
    out.warn('invoice_date', 'invoice date is in the future');
  }
}

export interface DraftValidationArgs {
  company?: Company | null;
  customer?: Customer | null;
  invoiceDate?: Date | null;
  dueDate?: Date | null;
  today?: Date | null;
}

/** Permissive validation for saving a draft. */
export function validateDraft(invoice: Invoice, args: DraftValidationArgs = {}): ValidationResult {
  const out = new IssueCollector();
  if (args.company) checkCompanyFormats(args.company, out);
  if (args.customer) checkCustomerFormats(args.customer, out);
  checkDates(args.invoiceDate ?? null, args.dueDate ?? null, args.today ?? null, out, false);

  if (invoice.lines.length === 0) out.warn('lines', 'invoice has no line items');
  invoice.lines.forEach((line, i) => {
    for (const issue of validateLine(line, i, false)) out.add(issue);
  });

  return out.result();
}

export interface FinalizationValidationArgs {
  company: Company;
  customer: Customer;
  invoiceDate: Date;
  dueDate?: Date | null;
  today?: Date | null;
}

/** Strict validation gating finalization; all failures are blocking. */
export function validateForFinalization(
  invoice: Invoice,
  args: FinalizationValidationArgs,
): ValidationResult {
  const out = new IssueCollector();

  // 1. Company
  if (!args.company.name.trim()) out.block('company.name', 'company name is required');
  checkCompanyFormats(args.company, out);

  // 2. Customer
  if (!args.customer.name.trim()) out.block('customer.name', 'customer name is required');
  if (!args.customer.bill_to.line.trim()) out.block('customer.bill_to', 'billing address is required');
  if (!args.customer.bill_to.state_code.trim())
    out.block('customer.bill_to.state_code', 'billing state is required');
  checkCustomerFormats(args.customer, out);

  // 3. Invoice date (and due-date ordering)
  checkDates(args.invoiceDate, args.dueDate ?? null, args.today ?? null, out, true);

  // 4. Place of supply (authoritative tax input)
  if (!invoice.place_of_supply.state_code.trim())
    out.block('place_of_supply.state_code', 'place of supply is required');

  // 5. Line items
  if (invoice.lines.length === 0) out.block('lines', 'at least one line item is required');
  invoice.lines.forEach((line, i) => {
    for (const issue of validateLine(line, i, true)) out.add(issue);
  });

  return out.result();
}
