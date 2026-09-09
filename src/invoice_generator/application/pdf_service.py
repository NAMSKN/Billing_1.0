"""PDF service: build the immutable render DTO from a finalized invoice.

Bridges the stored invoice (its authoritative snapshot, Task 24) and the
ReportLab renderer. It resolves pinned asset IDs to concrete references via the
:class:`AssetRepository` and formats all display strings, so the renderer
receives everything it needs and never touches the database or resolves asset
IDs itself (DECISIONS D-011).

References: requirements Req 19.6, 19.8; DECISIONS D-011, D-020; design sections
11, 17.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from invoice_generator.application.render_dto import (
    InvoiceRenderDTO,
    RenderAssetRef,
    RenderLine,
    RenderParty,
    RenderReference,
    RenderTaxRow,
    RenderTotals,
    format_money,
    format_quantity,
)
from invoice_generator.domain.enums import InvoiceStatus, TaxType
from invoice_generator.domain.models import (
    Address,
    Company,
    Invoice,
    InvoiceSnapshot,
    TaxRateConfig,
)
from invoice_generator.domain.repositories import AssetRepository

# Human-readable labels for optional reference/logistics fields (Req 19.6).
_REFERENCE_LABELS: tuple[tuple[str, str], ...] = (
    ("buyer_order_number", "PO No."),
    ("buyer_order_date", "PO Date"),
    ("delivery_note", "Delivery Note"),
    ("delivery_note_date", "Delivery Note Date"),
    ("reference_number", "Ref No."),
    ("reference_date", "Ref Date"),
    ("dispatch_doc_number", "Dispatch Doc No."),
    ("dispatch_date", "Dispatch Date"),
    ("lr_rr_number", "LR/RR No."),
    ("vehicle_number", "Vehicle No."),
    ("dispatched_through", "Dispatched Through"),
    ("destination", "Destination"),
    ("terms_of_delivery", "Terms of Delivery"),
    ("other_references", "Other References"),
)


class PdfService:
    def __init__(self, asset_repository: AssetRepository | None = None) -> None:
        self._assets = asset_repository

    def build_dto(self, invoice: Invoice) -> InvoiceRenderDTO:
        """Build the render DTO for a finalized invoice from its snapshot.

        Raises:
            ValueError: if the invoice has no stored snapshot (only finalized
                invoices carry one; drafts are not renderable here).
        """
        snap = invoice.snapshot
        if snap is None:
            raise ValueError("invoice has no snapshot; only finalized invoices are renderable")

        cfg = snap.tax_rate_config
        is_intra = _is_intra_state(snap)
        pos = snap.place_of_supply

        return InvoiceRenderDTO(
            invoice_number=invoice.invoice_number or "",
            invoice_date=invoice.invoice_date,
            due_date=snap.due_date,
            place_of_supply=_format_state(pos.state_name, pos.state_code),
            payment_terms=snap.payment_terms,
            is_intra_state=is_intra,
            company=_company_party(snap.company),
            bill_to=_address_party(snap.customer.name, snap.bill_to, snap.customer.gstin),
            ship_to=_address_party(snap.customer.name, snap.ship_to, snap.customer.gstin),
            references=_references(snap),
            lines=_lines(snap),
            tax_summary=_tax_rows(snap, cfg, is_intra),
            totals=_totals(snap),
            notes=snap.notes,
            terms=snap.terms,
            declaration=snap.declaration,
            authorized_signatory=snap.company.authorized_signatory,
            bank_details=_bank_details(snap.company),
            upi_id=snap.company.upi_id,
            logo=self._resolve_asset(snap.logo_asset_id),
            signature=self._resolve_asset(snap.signature_asset_id),
            template_version=invoice.template_version or 1,
            cancelled=invoice.status is InvoiceStatus.CANCELLED,
        )

    def _resolve_asset(self, asset_id: uuid.UUID | None) -> RenderAssetRef | None:
        """Resolve a pinned asset id to a concrete reference (or None).

        Missing repository or missing asset degrades gracefully to ``None`` so
        the renderer omits it (Req 19.5).
        """
        if asset_id is None or self._assets is None:
            return None
        asset = self._assets.get(asset_id)
        if asset is None:
            return None
        return RenderAssetRef(stored_path=asset.stored_path, version=asset.version)


def _is_intra_state(snap: InvoiceSnapshot) -> bool:
    if snap.tax_summary:
        return snap.tax_summary[0].tax_type is TaxType.INTRA_STATE
    return snap.company.address.state_code.strip() == snap.place_of_supply.state_code.strip()


def _format_state(name: str, code: str) -> str:
    if name and code:
        return f"{name} ({code})"
    return name or code


def _company_party(company: Company) -> RenderParty:
    lines = tuple(line for line in (company.address.line,) if line)
    return RenderParty(
        name=company.name,
        address_lines=lines,
        gstin=company.gstin,
        state=_format_state(company.address.state_name, company.address.state_code),
    )


def _address_party(name: str, address: Address, gstin: str) -> RenderParty:
    lines = tuple(line for line in (address.line, address.godown) if line)
    return RenderParty(
        name=name,
        address_lines=lines,
        gstin=gstin,
        state=_format_state(address.state_name, address.state_code),
    )


def _references(snap: InvoiceSnapshot) -> tuple[RenderReference, ...]:
    refs = snap.references
    out: list[RenderReference] = []
    for attr, label in _REFERENCE_LABELS:
        value = getattr(refs, attr)
        if value:  # omit empty optionals (Req 19.6)
            out.append(RenderReference(label=label, value=value))
    return tuple(out)


def _bank_details(company: Company) -> tuple[RenderReference, ...]:
    pairs = (
        ("Bank Name", company.bank_name),
        ("A/C No.", company.account_number),
        ("Branch", company.branch),
        ("IFSC", company.ifsc),
    )
    return tuple(RenderReference(label=label, value=value) for label, value in pairs if value)


def _lines(snap: InvoiceSnapshot) -> tuple[RenderLine, ...]:
    out: list[RenderLine] = []
    for i, line in enumerate(snap.lines, start=1):
        amount = line.taxable_amount if line.taxable_amount is not None else Decimal("0.00")
        out.append(
            RenderLine(
                serial=i,
                job_or_mould=line.job_or_mould_reference,
                operation=line.operation,
                description=line.description,
                specification=line.specification,
                hsn_sac=line.hsn_sac,
                quantity=format_quantity(line.quantity),
                unit=line.unit,
                rate=format_money(line.rate),
                discount_percent=format_quantity(line.discount_percent),
                amount=format_money(amount),
            )
        )
    return tuple(out)


def _tax_rows(
    snap: InvoiceSnapshot, cfg: TaxRateConfig, is_intra: bool
) -> tuple[RenderTaxRow, ...]:
    out: list[RenderTaxRow] = []
    for row in snap.tax_summary:
        if is_intra:
            cgst_rate = format_quantity(cfg.cgst_rate)
            sgst_rate = format_quantity(cfg.sgst_rate)
            igst_rate = ""
        else:
            cgst_rate = ""
            sgst_rate = ""
            igst_rate = format_quantity(cfg.igst_rate)
        out.append(
            RenderTaxRow(
                hsn_sac=row.hsn_sac,
                taxable_value=format_money(row.taxable_value),
                cgst_rate=cgst_rate,
                cgst_amount=format_money(row.cgst_amount),
                sgst_rate=sgst_rate,
                sgst_amount=format_money(row.sgst_amount),
                igst_rate=igst_rate,
                igst_amount=format_money(row.igst_amount),
                total_tax=format_money(row.total_tax),
            )
        )
    return tuple(out)


def _totals(snap: InvoiceSnapshot) -> RenderTotals:
    t = snap.totals
    return RenderTotals(
        taxable=format_money(t.total_taxable),
        cgst=format_money(t.total_cgst),
        sgst=format_money(t.total_sgst),
        igst=format_money(t.total_igst),
        round_off=format_money(t.round_off),
        grand_total=format_money(t.grand_total),
        grand_total_words=snap.grand_total_words,
        tax_amount_words=snap.tax_amount_words,
    )
