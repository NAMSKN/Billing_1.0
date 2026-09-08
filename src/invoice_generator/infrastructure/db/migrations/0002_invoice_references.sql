-- Migration 0002: store invoice reference/logistics fields.
--
-- The initial schema kept only structured invoice columns plus snapshot_json.
-- Draft invoices also carry optional reference/logistics fields (PO, challan,
-- vehicle, etc.; Req 3) that must round-trip before finalization. Store them
-- as a JSON object so the optional set stays flexible without one column per
-- field. For finalized invoices the same values are also captured in the
-- immutable snapshot (design section 11).

ALTER TABLE invoices ADD COLUMN references_json TEXT NOT NULL DEFAULT '{}';
