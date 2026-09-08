"""Application layer: use-case services coordinating domain and repositories.

Services depend on repository ports (not concrete SQLite classes) and own
transaction boundaries; repositories participate but never self-commit
(DECISIONS D-021, D-026).
"""
