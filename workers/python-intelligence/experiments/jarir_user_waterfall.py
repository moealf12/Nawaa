"""Compatibility shim for the original PR #166 experiments; the worker lives in nawaa_py.jarir_pdp."""
from nawaa_py.jarir_pdp import EvidenceTrace, JarirOfferEvidence, JarirScraperEngine, VERSION, run_worker

if __name__ == "__main__":
    run_worker()
