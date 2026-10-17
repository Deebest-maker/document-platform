"""Conversion-engine adapters.

M4A shipped ``FakeEngine``; M4B adds ``LibreOfficeEngine`` which drives
``soffice --headless`` through the shared async runner. The engine
interface stays small so swapping engines never touches the HTTP layer."""
