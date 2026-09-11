-- Reference seed data for the Invoice Generator.
--
-- Pre-populates the master data taken from the two reference invoices
-- (SE/26-27/043 for DI-TECH MOULDS and SE/26-27/089 for BMSS STEEL) so a fresh
-- install runs smoothly with real data: the SUNTECH ENTERPRISES company, both
-- customers, the numbering configuration, service templates, and two ready
-- DRAFT invoices that reproduce the reference line items.
--
-- WHY DRAFTS (not finalized): a FINALIZED invoice also stores an immutable
-- snapshot_json (a nested serialized document) and an allocated invoice number.
-- Those are produced correctly only by the application's finalization use case
-- (which builds the snapshot, computes tax/totals/round-off via the single
-- calculation engine, and allocates the number transactionally). Hand-writing
-- snapshot JSON here would be fragile and could diverge from the engine. So the
-- script seeds the two invoices as DRAFTS with the exact line data; open each in
-- the app and click Finalize to allocate SE/26-27/043 and /089 and generate the
-- PDF. The numbering sequence below is primed so the next finalization is 043.
--
-- STORAGE ENCODING (DECISIONS D-004/D-005) — values below are pre-encoded:
--   money  -> INTEGER paise      (amount x 100)
--   qty    -> INTEGER millis     (quantity x 1000)
--   percent-> INTEGER hundredths (percent x 100)
-- UUIDs are canonical lowercase TEXT (D-024).
--
-- USAGE (apply to the app database; back up first if it already has data):
--   sqlite3 "%LOCALAPPDATA%\InvoiceGenerator\database\invoices.db" ".read packaging/seed_reference_data.sql"
-- The script is idempotent (INSERT OR IGNORE / OR REPLACE on fixed ids).

PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

-- ---------------------------------------------------------------------------
-- Company (single active company, V1). GSTIN state code 27 = Maharashtra.
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO companies (
    id, name, address_line, state_name, state_code, gstin, email, phone,
    bank_name, account_number, branch, ifsc, upi_id, authorized_signatory, active
) VALUES (
    'a0000000-0000-4000-8000-000000000001',
    'SUNTECH ENTERPRISES',
    'Survey No. 181/1, Gala No.7, Near Mali Compound, Behind Mathura Hotel, Village Poman, PO. Kaman, Tal. Vasai (E), Dist. Palghar-401208',
    'Maharashtra', '27',
    '27DEZPS3898C1ZH',
    'suntechech88@gmail.com', '',
    'STATE BANK OF INDIA', '43765247122', 'KOLSHET ROAD, THANA', 'SBIN0021282',
    '', 'Authorised Signatory', 1
);

-- ---------------------------------------------------------------------------
-- Customers. Bill-to and ship-to are the same in both source invoices.
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO customers (
    id, company_id, name, gstin, phone, email,
    bill_line, bill_state_name, bill_state_code, bill_godown,
    ship_line, ship_state_name, ship_state_code, ship_godown, is_active
) VALUES (
    'c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'DI-TECH MOULDS', '27AAIFD4249A1ZQ', '', '',
    'A/1, A/2, Deewan & Shah Complex No.2, Valiv Phata, Opp. SETCO, Sativali Road, Vasai (East), Palghar-401208',
    'Maharashtra', '27', '',
    'A/1, A/2, Deewan & Shah Complex No.2, Valiv Phata, Opp. SETCO, Sativali Road, Vasai (East), Palghar-401208',
    'Maharashtra', '27', '', 1
);

INSERT OR REPLACE INTO customers (
    id, company_id, name, gstin, phone, email,
    bill_line, bill_state_name, bill_state_code, bill_godown,
    ship_line, ship_state_name, ship_state_code, ship_godown, is_active
) VALUES (
    'c0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001',
    'BMSS STEEL INDUSTRIES PRIVATE LIMITED', '27AAACG1519K1ZP', '', '',
    '227 / 228 B-5 SHRAMJEEVAN, NEAR WADALA R.T.O, WADALA EAST, MUMBAI 400037',
    'Maharashtra', '27',
    'SHED NO 1257/1256 SURVEY NO 87/4B, NEAR ZIA HOSPITAL PALAWA ROAD, AT VILLAGE VAVANGE TALUKA PANVEL, DIST RAIGAD 410208',
    '227 / 228 B-5 SHRAMJEEVAN, NEAR WADALA R.T.O, WADALA EAST, MUMBAI 400037',
    'Maharashtra', '27',
    'SHED NO 1257/1256 SURVEY NO 87/4B, NEAR ZIA HOSPITAL PALAWA ROAD, AT VILLAGE VAVANGE TALUKA PANVEL, DIST RAIGAD 410208',
    1
);

-- ---------------------------------------------------------------------------
-- Numbering configuration + sequence.
-- Prefix SE, pad width 3, Indian FY. Sequence primed so the NEXT finalized
-- invoice in FY 26-27 is number 043 (next_sequence 43, high-water 42).
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO numbering_config (company_id, scope, prefix, pad_width, start_value, fy_scheme)
VALUES ('a0000000-0000-4000-8000-000000000001', 'default', 'SE', 3, 1, 'IN');

INSERT OR REPLACE INTO invoice_sequences (company_id, financial_year, prefix, next_sequence, high_water_mark)
VALUES ('a0000000-0000-4000-8000-000000000001', '26-27', 'SE', 43, 42);

-- ---------------------------------------------------------------------------
-- Service templates (reusable descriptions; no price/qty -> not inventory).
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO service_templates (id, company_id, name, description, hsn_sac, unit) VALUES
    ('50000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
     'Gundrilling', 'Service Charges @18% (Gundrilling)', '998898', 'MM'),
    ('50000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
     '6 Side Machining', 'Service Charges @18% (Machining)', '998898', 'NOS');

-- ---------------------------------------------------------------------------
-- DRAFT invoice matching reference SE/26-27/043 (DI-TECH MOULDS).
-- Line: qty 4912.00 MM x rate 2.50 = 12,280.00 taxable. 18% GST intra-state.
-- Finalize in the app to allocate the number and generate totals/snapshot/PDF.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO invoices (
    id, company_id, customer_id, status, payment_status, invoice_number,
    invoice_date, place_of_supply_state, place_of_supply_code,
    payment_terms, due_date, notes, terms, declaration,
    references_json
) VALUES (
    '10000000-0000-4000-8000-000000000043',
    'a0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000001',
    'DRAFT', 'UNPAID', NULL,
    '', 'Maharashtra', '27',
    '', '', '', '', '',
    '{"buyer_order_number":"CHALLAN NO. 033","buyer_order_date":"2026-05-08","dispatch_doc_number":"CHALLAN NO. 290"}'
);

INSERT OR IGNORE INTO invoice_items (
    id, invoice_id, sequence, job_or_mould_reference, component_or_part, operation,
    description, specification, hsn_sac, quantity_millis, unit, rate_paise,
    discount_hundredths, tax_treatment, tax_rate_hundredths
) VALUES (
    '11000000-0000-4000-8000-000000000043',
    '10000000-0000-4000-8000-000000000043',
    1, 'DT-663', '', 'PUNCH GUN DRILLING',
    'Service Charges @18% (Gundrilling)', 'DRILL DIA 9X307MM DEEP',
    '998898', 4912000, 'MM', 250,
    0, 'TAXABLE', 1800
);

-- ---------------------------------------------------------------------------
-- DRAFT invoice matching reference SE/26-27/089 (BMSS STEEL), two lines.
-- Line 1: 1 NOS x 4061.00 = 4,061.00 ; Line 2: 1 NOS x 4271.00 = 4,271.00.
-- Taxable 8,332.00 ; 18% GST intra-state ; 30-day terms.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO invoices (
    id, company_id, customer_id, status, payment_status, invoice_number,
    invoice_date, place_of_supply_state, place_of_supply_code,
    payment_terms, due_date, notes, terms, declaration,
    references_json
) VALUES (
    '10000000-0000-4000-8000-000000000089',
    'a0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000002',
    'DRAFT', 'UNPAID', NULL,
    '', 'Maharashtra', '27',
    '30 Days', '', '', '', '',
    '{"buyer_order_number":"BMSS/L/070/26-27","buyer_order_date":"2026-06-20","dispatch_doc_number":"CHALLAN NO. 353","vehicle_number":"MH48CQ5748"}'
);

INSERT OR IGNORE INTO invoice_items (
    id, invoice_id, sequence, job_or_mould_reference, component_or_part, operation,
    description, specification, hsn_sac, quantity_millis, unit, rate_paise,
    discount_hundredths, tax_treatment, tax_rate_hundredths
) VALUES
    ('11000000-0000-4000-8000-000000000089',
     '10000000-0000-4000-8000-000000000089',
     1, '', '', '',
     'Service Charges @18% (Machining)', '6 SIDE MACHINING 510X430X130',
     '998898', 1000, 'NOS', 406100,
     0, 'TAXABLE', 1800),
    ('11000000-0000-4000-8000-00000000008a',
     '10000000-0000-4000-8000-000000000089',
     2, '', '', '',
     'Service Charges @18% (Machining)', '6 SIDE MACHINING 510X430X150',
     '998898', 1000, 'NOS', 427100,
     0, 'TAXABLE', 1800);

COMMIT;
