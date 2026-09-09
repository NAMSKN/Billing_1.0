"""ReportLab PDF rendering.

Composes the production A4 invoice from focused components (Tasks 32-41),
consuming only the immutable render DTO (DECISIONS D-011): the renderer never
queries the database, resolves asset IDs, or recalculates values.
"""
