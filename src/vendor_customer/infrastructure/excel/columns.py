"""Business-facing Excel column schema for the party master.

The export column order follows the client-supplied sample (product rules,
section 15). The internal UUID is intentionally omitted (no import/reconciliation
requirement for it, section 15). Import reads the same headers; required headers
are validated before any row is processed (section 17).
"""

from __future__ import annotations

# Business-facing header labels, in the required export/read order.
COL_NAME = "CUSTOMER / VENDOR NAME"
COL_CONTACT_PERSON = "CONTACT PERSON"
COL_CONTACT_NO = "CONTACT NO"
COL_ADDRESS1 = "ADDRESS 1"
COL_ADDRESS2 = "ADDRESS 2"
COL_LANDMARK = "LANDMARK"
COL_COUNTRY = "COUNTRY"
COL_STATE = "STATE"
COL_CITY = "CITY"
COL_COMPANY_TYPE = "COMPANY TYPE"
COL_BANK_NAME = "BANK NAME"
COL_BANK_IFSC = "BANK IFSC CODE"
COL_BANK_ACCOUNT = "BANK ACCOUNT NUMBER"
COL_PINCODE = "PINCODE"
COL_FAX = "FAX NO"
COL_WEBSITE = "WEBSITE"
COL_EMAIL = "EMAIL"
COL_REGISTRATION_TYPE = "Registration Type"
COL_GSTIN = "GSTIN"
COL_PAN = "PAN"
COL_EWAY_DISTANCE = "DISTANCE FOR E-WAY BILL (IN KM)"
COL_GROUP = "CUSTOMER / VENDOR GROUP"
COL_CUSTOM1 = "Custom Field 1"
COL_CUSTOM2 = "Custom Field 2"
COL_CUSTOM3 = "Custom Field 3"
COL_DUE_DAYS = "Due Days"
COL_NOTE = "NOTE"
COL_CUST_BAL_TYPE = "Customer Balance Type"
COL_CUST_BAL_AMOUNT = "Customer Balance Amount"
COL_VENDOR_BAL_TYPE = "Vendor Balance Type"
COL_VENDOR_BAL_AMOUNT = "Vendor Balance Amount"

EXPORT_COLUMNS: tuple[str, ...] = (
    COL_NAME,
    COL_CONTACT_PERSON,
    COL_CONTACT_NO,
    COL_ADDRESS1,
    COL_ADDRESS2,
    COL_LANDMARK,
    COL_COUNTRY,
    COL_STATE,
    COL_CITY,
    COL_COMPANY_TYPE,
    COL_BANK_NAME,
    COL_BANK_IFSC,
    COL_BANK_ACCOUNT,
    COL_PINCODE,
    COL_FAX,
    COL_WEBSITE,
    COL_EMAIL,
    COL_REGISTRATION_TYPE,
    COL_GSTIN,
    COL_PAN,
    COL_EWAY_DISTANCE,
    COL_GROUP,
    COL_CUSTOM1,
    COL_CUSTOM2,
    COL_CUSTOM3,
    COL_DUE_DAYS,
    COL_NOTE,
    COL_CUST_BAL_TYPE,
    COL_CUST_BAL_AMOUNT,
    COL_VENDOR_BAL_TYPE,
    COL_VENDOR_BAL_AMOUNT,
)

# The only header required to be present for a valid import file. Company Type
# may be supplied per-row or overridden by the "Import As" choice.
REQUIRED_IMPORT_HEADERS: tuple[str, ...] = (COL_NAME,)
