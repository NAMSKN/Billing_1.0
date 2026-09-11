"""Add / Edit Customer / Vendor dialog (product rules, sections 2-13, 22).

A scrollable, sectioned form over :class:`PartyController`. Sections: Basic
Information, Billing Address, Shipping Address (with "Same as Billing"), Group,
Opening Balance (customer + vendor), Bank Details, Additional Details, and
Document Visibility. Uses the existing centralized LIGHT theme. Required fields:
Company Name, City, State (India), Company Type. GSTIN is entered manually; there
is NO GSTIN auto-fill. The widget performs no SQL and no business rules
(DECISIONS D-021).
"""

from __future__ import annotations

import uuid
from decimal import Decimal, InvalidOperation

from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QDoubleSpinBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPlainTextEdit,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from common.domain.india_states import INDIA_STATES, state_code_for
from invoice_generator.ui.common.ui_kit import (
    StatusBanner,
    make_primary,
    scrollable,
    title_label,
)
from vendor_customer.application.dto import PartyInput
from vendor_customer.application.errors import DuplicatePartyError, PartyValidationError
from vendor_customer.domain.models import (
    INDIA,
    BalanceType,
    OpeningBalance,
    Party,
    PartyAddress,
    PartyType,
    RegistrationType,
)
from vendor_customer.ui.party_controller import PartyController

_COUNTRIES = (INDIA, "Other")


class PartyEditorDialog(QDialog):
    """Modal editor for creating or editing a party."""

    def __init__(
        self,
        controller: PartyController,
        party: Party | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._controller = controller
        self._party = party
        self._saved_id: uuid.UUID | None = None
        self.setWindowTitle("Add Customer / Vendor" if party is None else "Edit Customer / Vendor")
        self.setMinimumSize(720, 600)

        self._build_widgets()
        self._build_layout()
        self._wire()
        self._load_groups()
        if party is not None:
            self._load_party(party)
        self._update_state_requirement()

    # --- construction ---

    def _build_widgets(self) -> None:
        self.company_type = QComboBox()
        for pt in (PartyType.CUSTOMER, PartyType.VENDOR, PartyType.CUSTOMER_VENDOR):
            self.company_type.addItem(pt.label, userData=pt.value)

        self.company_name = QLineEdit()
        self.contact_person = QLineEdit()
        self.contact_no = QLineEdit()
        self.email = QLineEdit()

        self.registration_type = QComboBox()
        for rt in RegistrationType:
            self.registration_type.addItem(rt.label, userData=rt.value)

        self.gstin = QLineEdit()
        self.gstin.setPlaceholderText("15-char GSTIN, entered manually (no auto-fill)")
        self.pan = QLineEdit()

        # Billing.
        self.bill_address1 = QLineEdit()
        self.bill_address2 = QLineEdit()
        self.bill_landmark = QLineEdit()
        self.bill_country = QComboBox()
        self.bill_country.addItems(list(_COUNTRIES))
        self.bill_state = self._make_state_combo()
        self.bill_city = QLineEdit()
        self.bill_pincode = QLineEdit()
        self.bill_eway = QLineEdit()
        self.bill_eway.setPlaceholderText("Optional; leave blank if unknown")

        # Shipping.
        self.same_as_billing = QCheckBox("Same as Billing Address")
        self.same_as_billing.setChecked(True)
        self.ship_address1 = QLineEdit()
        self.ship_address2 = QLineEdit()
        self.ship_landmark = QLineEdit()
        self.ship_country = QComboBox()
        self.ship_country.addItems(list(_COUNTRIES))
        self.ship_state = self._make_state_combo()
        self.ship_city = QLineEdit()
        self.ship_pincode = QLineEdit()

        # Group.
        self.group = QComboBox()
        self.add_group_button = self._small_button("Add Group\u2026")

        # Opening balances.
        self.customer_balance_type = self._balance_type_combo()
        self.customer_balance_amount = self._money_spin()
        self.vendor_balance_type = self._balance_type_combo()
        self.vendor_balance_amount = self._money_spin()

        # Bank.
        self.bank_name = QLineEdit()
        self.bank_ifsc = QLineEdit()
        self.bank_account = QLineEdit()

        # Additional (all optional).
        self.fax_no = QLineEdit()
        self.website = QLineEdit()
        self.credit_limit = QLineEdit()
        self.credit_limit.setPlaceholderText("Optional")
        self.due_days = QSpinBox()
        self.due_days.setRange(0, 100000)
        self.due_days.setSpecialValueText("")  # empty display at 0 -> treated as unset
        self.note = QPlainTextEdit()
        self.note.setFixedHeight(60)
        self.custom_field_1 = QLineEdit()
        self.custom_field_2 = QLineEdit()
        self.custom_field_3 = QLineEdit()

        self.visible_on_documents = QCheckBox("Company will be visible on all document.")

        self.status = StatusBanner()
        self.buttons = QDialogButtonBox()
        save_btn = self.buttons.addButton("Save", QDialogButtonBox.ButtonRole.AcceptRole)
        self.save_button = make_primary(save_btn)
        self.buttons.addButton("Cancel", QDialogButtonBox.ButtonRole.RejectRole)

    def _make_state_combo(self) -> QComboBox:
        combo = QComboBox()
        combo.addItem("-- Select State --", userData="")
        for code, name in INDIA_STATES:
            combo.addItem(name, userData=code)
        return combo

    def _balance_type_combo(self) -> QComboBox:
        combo = QComboBox()
        for bt in (BalanceType.DEBIT, BalanceType.CREDIT):
            combo.addItem(bt.label, userData=bt.value)
        return combo

    def _money_spin(self) -> QDoubleSpinBox:
        spin = QDoubleSpinBox()
        spin.setRange(0.0, 1_000_000_000.0)
        spin.setDecimals(2)
        spin.setPrefix("\u20b9 ")
        return spin

    def _small_button(self, text: str) -> QWidget:
        from PySide6.QtWidgets import QPushButton

        return QPushButton(text)

    def _build_layout(self) -> None:
        body = QWidget()
        inner = QVBoxLayout(body)
        inner.addWidget(title_label("Add Customer / Vendor"))

        inner.addWidget(self._basic_section())
        inner.addWidget(self._billing_section())
        inner.addWidget(self._shipping_section())
        inner.addWidget(self._group_section())
        inner.addWidget(self._balance_section())
        inner.addWidget(self._bank_section())
        inner.addWidget(self._additional_section())
        inner.addWidget(self._document_section())

        outer = QVBoxLayout(self)
        outer.addWidget(scrollable(body), stretch=1)
        outer.addWidget(self.status)
        outer.addWidget(self.buttons)

    def _basic_section(self) -> QGroupBox:
        box = QGroupBox("Basic Information")
        form = QFormLayout(box)
        form.addRow(_req("Company Type"), self.company_type)
        form.addRow("GSTIN", self.gstin)
        form.addRow(_req("Company Name"), self.company_name)
        form.addRow("Contact Person", self.contact_person)
        form.addRow("Contact No", self.contact_no)
        form.addRow("Email", self.email)
        form.addRow("Registration Type", self.registration_type)
        form.addRow("PAN", self.pan)
        return box

    def _billing_section(self) -> QGroupBox:
        box = QGroupBox("Billing Address")
        form = QFormLayout(box)
        form.addRow("Address", self.bill_address1)
        form.addRow("Address (line 2)", self.bill_address2)
        form.addRow("Landmark", self.bill_landmark)
        form.addRow(_req("Country"), self.bill_country)
        self._bill_state_label = _req("State")
        form.addRow(self._bill_state_label, self.bill_state)
        form.addRow(_req("City"), self.bill_city)
        form.addRow("Pincode", self.bill_pincode)
        form.addRow("Distance for E-Way Bill (Km)", self.bill_eway)
        return box

    def _shipping_section(self) -> QGroupBox:
        box = QGroupBox("Shipping Address")
        outer = QVBoxLayout(box)
        outer.addWidget(self.same_as_billing)
        self._ship_fields = QWidget()
        form = QFormLayout(self._ship_fields)
        form.addRow("Address", self.ship_address1)
        form.addRow("Address (line 2)", self.ship_address2)
        form.addRow("Landmark", self.ship_landmark)
        form.addRow("Country", self.ship_country)
        form.addRow("State", self.ship_state)
        form.addRow("City", self.ship_city)
        form.addRow("Pincode", self.ship_pincode)
        outer.addWidget(self._ship_fields)
        self._ship_fields.setVisible(False)
        return box

    def _group_section(self) -> QGroupBox:
        box = QGroupBox("Customer / Vendor Group")
        row = QHBoxLayout(box)
        row.addWidget(QLabel("Group"))
        row.addWidget(self.group, stretch=1)
        row.addWidget(self.add_group_button)
        return box

    def _balance_section(self) -> QGroupBox:
        box = QGroupBox("Opening Balance")
        outer = QVBoxLayout(box)
        hint = QLabel(
            "Debit = the party owes you; Credit = you owe the party. "
            "Amounts default to \u20b9 0."
        )
        hint.setObjectName("statusMuted")
        hint.setWordWrap(True)
        outer.addWidget(hint)

        cust = QFormLayout()
        cust.addRow("Customer Balance Type", self.customer_balance_type)
        cust.addRow("Customer Balance Amount", self.customer_balance_amount)
        outer.addLayout(cust)

        vend = QFormLayout()
        vend.addRow("Vendor Balance Type", self.vendor_balance_type)
        vend.addRow("Vendor Balance Amount", self.vendor_balance_amount)
        outer.addLayout(vend)
        return box

    def _bank_section(self) -> QGroupBox:
        box = QGroupBox("Bank Details")
        form = QFormLayout(box)
        form.addRow("Bank Name", self.bank_name)
        form.addRow("Bank IFSC Code", self.bank_ifsc)
        form.addRow("Bank Account Number", self.bank_account)
        return box

    def _additional_section(self) -> QGroupBox:
        box = QGroupBox("Additional Details (all optional)")
        form = QFormLayout(box)
        form.addRow("Fax No", self.fax_no)
        form.addRow("Website", self.website)
        form.addRow("Credit Limit", self.credit_limit)
        form.addRow("Due Days", self.due_days)
        form.addRow("Note", self.note)
        form.addRow("Custom Field 1", self.custom_field_1)
        form.addRow("Custom Field 2", self.custom_field_2)
        form.addRow("Custom Field 3", self.custom_field_3)
        return box

    def _document_section(self) -> QGroupBox:
        box = QGroupBox("Document Visibility")
        outer = QVBoxLayout(box)
        outer.addWidget(self.visible_on_documents)
        return box

    def _wire(self) -> None:
        self.same_as_billing.toggled.connect(self._on_same_as_billing)
        self.bill_country.currentTextChanged.connect(lambda _t: self._update_state_requirement())
        self.bill_state.currentIndexChanged.connect(self._on_bill_state_changed)
        self.add_group_button.clicked.connect(self._on_add_group)  # type: ignore[attr-defined]
        self.buttons.accepted.connect(self._on_save)
        self.buttons.rejected.connect(self.reject)

    # --- behavior ---

    def _on_same_as_billing(self, checked: bool) -> None:
        self._ship_fields.setVisible(not checked)

    def _update_state_requirement(self) -> None:
        is_india = self.bill_country.currentText().strip().lower() == INDIA.lower()
        self.bill_state.setEnabled(is_india)

    def _on_bill_state_changed(self, _index: int) -> None:
        # State code is derived from the selected state master entry (not a
        # network lookup and not from the GSTIN).
        pass

    def _load_groups(self, select_id: uuid.UUID | None = None) -> None:
        self.group.blockSignals(True)
        self.group.clear()
        self.group.addItem("-- No Group --", userData=None)
        for group in self._controller.list_groups():
            self.group.addItem(group.name, userData=str(group.id))
        if select_id is not None:
            idx = self.group.findData(str(select_id))
            if idx >= 0:
                self.group.setCurrentIndex(idx)
        self.group.blockSignals(False)

    def _on_add_group(self) -> None:
        from PySide6.QtWidgets import QInputDialog

        name, ok = QInputDialog.getText(self, "Add Group", "Group name:")
        if not ok or not name.strip():
            return
        try:
            group = self._controller.create_group(name.strip())
        except Exception as exc:  # noqa: BLE001 - boundary
            self.status.show_error(str(exc))
            return
        self._load_groups(select_id=group.id)

    # --- load / collect ---

    def _load_party(self, party: Party) -> None:
        self._set_combo(self.company_type, party.company_type.value)
        self.company_name.setText(party.company_name)
        self.contact_person.setText(party.contact_person)
        self.contact_no.setText(party.contact_no)
        self.email.setText(party.email)
        self._set_combo(self.registration_type, party.registration_type.value)
        self.gstin.setText(party.gstin)
        self.pan.setText(party.pan)

        b = party.billing_address
        self.bill_address1.setText(b.address1)
        self.bill_address2.setText(b.address2)
        self.bill_landmark.setText(b.landmark)
        self._set_combo_text(self.bill_country, b.country)
        self._set_combo(self.bill_state, b.state_code)
        self.bill_city.setText(b.city)
        self.bill_pincode.setText(b.pincode)
        if party.distance_for_eway_bill_km is not None:
            self.bill_eway.setText(str(party.distance_for_eway_bill_km))

        if party.shipping_address is not None:
            self.same_as_billing.setChecked(False)
            s = party.shipping_address
            self.ship_address1.setText(s.address1)
            self.ship_address2.setText(s.address2)
            self.ship_landmark.setText(s.landmark)
            self._set_combo_text(self.ship_country, s.country)
            self._set_combo(self.ship_state, s.state_code)
            self.ship_city.setText(s.city)
            self.ship_pincode.setText(s.pincode)

        if party.group_id is not None:
            self._load_groups(select_id=party.group_id)

        self._set_combo(self.customer_balance_type, party.customer_balance.balance_type.value)
        self.customer_balance_amount.setValue(float(party.customer_balance.amount))
        self._set_combo(self.vendor_balance_type, party.vendor_balance.balance_type.value)
        self.vendor_balance_amount.setValue(float(party.vendor_balance.amount))

        self.bank_name.setText(party.bank_name)
        self.bank_ifsc.setText(party.bank_ifsc_code)
        self.bank_account.setText(party.bank_account_number)

        self.fax_no.setText(party.fax_no)
        self.website.setText(party.website)
        if party.credit_limit is not None:
            self.credit_limit.setText(str(party.credit_limit))
        if party.due_days is not None:
            self.due_days.setValue(party.due_days)
        self.note.setPlainText(party.note)
        self.custom_field_1.setText(party.custom_field_1)
        self.custom_field_2.setText(party.custom_field_2)
        self.custom_field_3.setText(party.custom_field_3)
        self.visible_on_documents.setChecked(party.visible_on_documents)

    def _collect(self) -> PartyInput:
        party_type = PartyType(self.company_type.currentData())
        registration = RegistrationType(self.registration_type.currentData())

        billing = self._collect_address(
            self.bill_address1,
            self.bill_address2,
            self.bill_landmark,
            self.bill_country,
            self.bill_state,
            self.bill_city,
            self.bill_pincode,
        )
        shipping: PartyAddress | None = None
        if not self.same_as_billing.isChecked():
            shipping = self._collect_address(
                self.ship_address1,
                self.ship_address2,
                self.ship_landmark,
                self.ship_country,
                self.ship_state,
                self.ship_city,
                self.ship_pincode,
            )

        group_data = self.group.currentData()
        group_id = uuid.UUID(str(group_data)) if group_data else None

        return PartyInput(
            company_name=self.company_name.text(),
            company_type=party_type,
            contact_person=self.contact_person.text(),
            contact_no=self.contact_no.text(),
            email=self.email.text(),
            registration_type=registration,
            gstin=self.gstin.text(),
            pan=self.pan.text(),
            billing_address=billing,
            shipping_address=shipping,
            distance_for_eway_bill_km=_parse_decimal(self.bill_eway.text()),
            group_id=group_id,
            bank_name=self.bank_name.text(),
            bank_ifsc_code=self.bank_ifsc.text(),
            bank_account_number=self.bank_account.text(),
            fax_no=self.fax_no.text(),
            website=self.website.text(),
            credit_limit=_parse_decimal(self.credit_limit.text()),
            due_days=(self.due_days.value() or None),
            note=self.note.toPlainText(),
            visible_on_documents=self.visible_on_documents.isChecked(),
            custom_field_1=self.custom_field_1.text(),
            custom_field_2=self.custom_field_2.text(),
            custom_field_3=self.custom_field_3.text(),
            customer_balance=OpeningBalance(
                balance_type=BalanceType(self.customer_balance_type.currentData()),
                amount=_spin_decimal(self.customer_balance_amount.value()),
            ),
            vendor_balance=OpeningBalance(
                balance_type=BalanceType(self.vendor_balance_type.currentData()),
                amount=_spin_decimal(self.vendor_balance_amount.value()),
            ),
        )

    def _collect_address(
        self,
        addr1: QLineEdit,
        addr2: QLineEdit,
        landmark: QLineEdit,
        country: QComboBox,
        state: QComboBox,
        city: QLineEdit,
        pincode: QLineEdit,
    ) -> PartyAddress:
        state_name = state.currentText() if state.currentIndex() > 0 else ""
        state_code = str(state.currentData() or "") if state.currentIndex() > 0 else ""
        if state_name and not state_code:
            state_code = state_code_for(state_name)
        return PartyAddress(
            address1=addr1.text().strip(),
            address2=addr2.text().strip(),
            landmark=landmark.text().strip(),
            country=country.currentText().strip() or INDIA,
            state=state_name,
            state_code=state_code,
            city=city.text().strip(),
            pincode=pincode.text().strip(),
        )

    def _on_save(self) -> None:
        data = self._collect()
        try:
            if self._party is None:
                saved = self._controller.create_party(data)
            else:
                saved = self._controller.update_party(
                    self._party.id, data, is_active=self._party.is_active
                )
        except PartyValidationError as exc:
            self.status.show_error("Please fix: " + "; ".join(exc.errors))
            return
        except DuplicatePartyError as exc:
            self.status.show_error(str(exc))
            return
        except Exception as exc:  # noqa: BLE001 - boundary
            self.status.show_error(str(exc))
            return
        self._saved_id = saved.id
        self.accept()

    @property
    def saved_id(self) -> uuid.UUID | None:
        return self._saved_id

    # --- helpers ---

    def _set_combo(self, combo: QComboBox, value: str) -> None:
        idx = combo.findData(value)
        if idx >= 0:
            combo.setCurrentIndex(idx)

    def _set_combo_text(self, combo: QComboBox, text: str) -> None:
        idx = combo.findText(text)
        combo.setCurrentIndex(idx if idx >= 0 else 0)


def _req(label: str) -> QLabel:
    """A required-field label with a red asterisk."""
    lbl = QLabel(f"{label} *")
    lbl.setObjectName("sectionTitle")
    return lbl


def _parse_decimal(text: str) -> Decimal | None:
    clean = text.strip()
    if not clean:
        return None
    try:
        return Decimal(clean)
    except (InvalidOperation, ValueError):
        return None


def _spin_decimal(value: float) -> Decimal:
    # The spin box is a display control; convert its value via string to avoid
    # binary float artifacts before it becomes an exact Decimal amount.
    return Decimal(str(value))
