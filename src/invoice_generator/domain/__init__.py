"""Domain layer: business models, enums, rules, and repository ports.

The domain layer depends on nothing outside itself (see steering
`architecture.md`). It contains the business concepts and rules; it performs
no I/O, holds no global mutable state, and never imports UI, application, or
infrastructure modules.
"""
