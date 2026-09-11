"""India state / GST state-code master (reference data).

Offline, static reference data used to render the required India state dropdown
and to resolve the two-digit GST state code from a state name (product rules,
section 9). The list follows the standard GST state codes. Free-text Indian
state entry is not permitted; the UI selects from this master.
"""

from __future__ import annotations

# (state_code, state_name) ordered by code. Includes states and union
# territories per the GST state-code list.
INDIA_STATES: tuple[tuple[str, str], ...] = (
    ("01", "Jammu and Kashmir"),
    ("02", "Himachal Pradesh"),
    ("03", "Punjab"),
    ("04", "Chandigarh"),
    ("05", "Uttarakhand"),
    ("06", "Haryana"),
    ("07", "Delhi"),
    ("08", "Rajasthan"),
    ("09", "Uttar Pradesh"),
    ("10", "Bihar"),
    ("11", "Sikkim"),
    ("12", "Arunachal Pradesh"),
    ("13", "Nagaland"),
    ("14", "Manipur"),
    ("15", "Mizoram"),
    ("16", "Tripura"),
    ("17", "Meghalaya"),
    ("18", "Assam"),
    ("19", "West Bengal"),
    ("20", "Jharkhand"),
    ("21", "Odisha"),
    ("22", "Chhattisgarh"),
    ("23", "Madhya Pradesh"),
    ("24", "Gujarat"),
    ("26", "Dadra and Nagar Haveli and Daman and Diu"),
    ("27", "Maharashtra"),
    ("28", "Andhra Pradesh (Old)"),
    ("29", "Karnataka"),
    ("30", "Goa"),
    ("31", "Lakshadweep"),
    ("32", "Kerala"),
    ("33", "Tamil Nadu"),
    ("34", "Puducherry"),
    ("35", "Andaman and Nicobar Islands"),
    ("36", "Telangana"),
    ("37", "Andhra Pradesh"),
    ("38", "Ladakh"),
    ("97", "Other Territory"),
)

_NAME_TO_CODE: dict[str, str] = {name.strip().lower(): code for code, name in INDIA_STATES}
_CODE_TO_NAME: dict[str, str] = {code: name for code, name in INDIA_STATES}


def state_code_for(state_name: str) -> str:
    """Return the GST state code for ``state_name`` (empty string if unknown)."""
    return _NAME_TO_CODE.get(state_name.strip().lower(), "")


def state_name_for(state_code: str) -> str:
    """Return the state name for a two-digit GST ``state_code`` (empty if unknown)."""
    return _CODE_TO_NAME.get(state_code.strip(), "")


def is_known_state(state_name: str) -> bool:
    """True if ``state_name`` is a recognized Indian state / union territory."""
    return state_name.strip().lower() in _NAME_TO_CODE


def state_names() -> tuple[str, ...]:
    """Return all state names in GST-code order for a dropdown."""
    return tuple(name for _code, name in INDIA_STATES)
