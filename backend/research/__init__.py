"""Reproducible research harness for the Value Score / backtest experiments.

Everything here is read-only and deterministic: scripts never write to the
application database, bootstrap draws use a fixed seed and every run records
the database fingerprint and git commit it was produced from.
"""
