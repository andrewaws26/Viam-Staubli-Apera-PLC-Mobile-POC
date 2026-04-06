"""
Tests for j1939_dtc.py — DTC namespacing per ECU source address.

This module handles the critical mapping from raw DM1 decoded data to
namespaced readings keys (dtc_engine_0_spn, dtc_acm_0_spn, etc.) and
the backward-compatible flat keys (dtc_0_spn).

If this breaks, the dashboard either shows DTCs from the wrong ECU,
shows duplicates, or misses aftertreatment DTCs entirely (the exact
bug fixed in the 2026-04-05 emissions DTC incident).

Run: python3 -m pytest modules/j1939-sensor/tests/test_j1939_dtc.py -v
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.models.j1939_dtc import SA_SUFFIX, apply_namespaced_dtcs


class TestSASuffix:
    """Verify source address to suffix mapping."""

    def test_all_expected_mappings(self):
        assert SA_SUFFIX[0x00] == "engine"
        assert SA_SUFFIX[0x03] == "trans"
        assert SA_SUFFIX[0x0B] == "abs"
        assert SA_SUFFIX[0x17] == "inst"
        assert SA_SUFFIX[0x21] == "body"
        assert SA_SUFFIX[0x3D] == "acm"

    def test_has_six_entries(self):
        assert len(SA_SUFFIX) == 6


class TestApplyNamespacedDTCs:
    """Tests for apply_namespaced_dtcs — the core DTC namespacing logic."""

    def _make_decoded(self, dtcs):
        """Build a decoded dict like decode_pgn returns for DM1."""
        d = {"active_dtc_count": len(dtcs)}
        for i, dtc in enumerate(dtcs):
            d[f"dtc_{i}_spn"] = dtc["spn"]
            d[f"dtc_{i}_fmi"] = dtc["fmi"]
            d[f"dtc_{i}_occurrence"] = dtc.get("occurrence", 1)
        return d

    def test_engine_dtcs_namespaced(self):
        """Engine ECU (SA 0x00) DTCs go to dtc_engine_* keys."""
        readings = {}
        dtc_by_source = {}
        decoded = self._make_decoded([
            {"spn": 110, "fmi": 0, "occurrence": 3},
        ])

        apply_namespaced_dtcs(readings, dtc_by_source, 0x00, decoded)

        assert readings["dtc_engine_count"] == 1
        assert readings["dtc_engine_0_spn"] == 110
        assert readings["dtc_engine_0_fmi"] == 0
        assert readings["dtc_engine_0_occurrence"] == 3
        assert readings["active_dtc_count"] == 1

    def test_acm_dtcs_namespaced(self):
        """Aftertreatment (SA 0x3D) DTCs go to dtc_acm_* keys."""
        readings = {}
        dtc_by_source = {}
        decoded = self._make_decoded([
            {"spn": 3226, "fmi": 18, "occurrence": 5},
        ])

        apply_namespaced_dtcs(readings, dtc_by_source, 0x3D, decoded)

        assert readings["dtc_acm_count"] == 1
        assert readings["dtc_acm_0_spn"] == 3226
        assert readings["dtc_acm_0_fmi"] == 18

    def test_backward_compat_flat_keys_from_engine(self):
        """Engine DTCs populate the flat dtc_0_* keys for backward compat."""
        readings = {}
        dtc_by_source = {}
        decoded = self._make_decoded([{"spn": 100, "fmi": 1}])

        apply_namespaced_dtcs(readings, dtc_by_source, 0x00, decoded)

        assert readings["dtc_0_spn"] == 100
        assert readings["dtc_0_fmi"] == 1

    def test_flat_keys_fallback_to_non_engine(self):
        """If no engine DTCs, flat keys come from first ECU with DTCs."""
        readings = {}
        dtc_by_source = {}
        decoded = self._make_decoded([{"spn": 3226, "fmi": 18}])

        apply_namespaced_dtcs(readings, dtc_by_source, 0x3D, decoded)

        # No engine DTCs exist, so flat keys fall back to ACM
        assert readings["dtc_0_spn"] == 3226

    def test_multi_ecu_combined_count(self):
        """DTCs from multiple ECUs sum into active_dtc_count."""
        readings = {}
        dtc_by_source = {}

        # Engine ECU: 1 DTC
        engine_decoded = self._make_decoded([{"spn": 100, "fmi": 1}])
        apply_namespaced_dtcs(readings, dtc_by_source, 0x00, engine_decoded)
        assert readings["active_dtc_count"] == 1

        # ACM ECU: 2 DTCs
        acm_decoded = self._make_decoded([
            {"spn": 3226, "fmi": 18},
            {"spn": 3246, "fmi": 7},
        ])
        apply_namespaced_dtcs(readings, dtc_by_source, 0x3D, acm_decoded)

        assert readings["active_dtc_count"] == 3
        assert readings["dtc_engine_count"] == 1
        assert readings["dtc_acm_count"] == 2

    def test_ecu_clears_dtcs(self):
        """When an ECU reports 0 DTCs, its namespaced count goes to 0."""
        readings = {}
        dtc_by_source = {}

        # First: ACM has 1 DTC
        apply_namespaced_dtcs(
            readings, dtc_by_source, 0x3D,
            self._make_decoded([{"spn": 3226, "fmi": 18}])
        )
        assert readings["dtc_acm_count"] == 1

        # Then: ACM reports 0 DTCs
        apply_namespaced_dtcs(
            readings, dtc_by_source, 0x3D,
            self._make_decoded([])
        )
        assert readings["dtc_acm_count"] == 0
        assert readings["active_dtc_count"] == 0

    def test_unknown_sa_gets_hex_suffix(self):
        """Unknown source addresses get a hex suffix like sa2a."""
        readings = {}
        dtc_by_source = {}
        decoded = self._make_decoded([{"spn": 999, "fmi": 3}])

        apply_namespaced_dtcs(readings, dtc_by_source, 0x2A, decoded)

        assert readings["dtc_sa2a_count"] == 1
        assert readings["dtc_sa2a_0_spn"] == 999

    def test_caps_at_10_dtcs_per_ecu(self):
        """Maximum 10 DTCs written per ECU source."""
        readings = {}
        dtc_by_source = {}
        dtcs = [{"spn": i, "fmi": 0} for i in range(15)]
        decoded = self._make_decoded(dtcs)

        apply_namespaced_dtcs(readings, dtc_by_source, 0x00, decoded)

        # Should only write dtc_engine_0 through dtc_engine_9
        assert readings["dtc_engine_count"] == 10  # capped
        assert "dtc_engine_9_spn" in readings
        # The 11th shouldn't be written as a namespaced key
        # (active_dtc_count reflects actual count from dtc_by_source)

    def test_engine_preferred_for_flat_keys(self):
        """Even if ACM has DTCs, flat keys come from engine when available."""
        readings = {}
        dtc_by_source = {}

        # ACM first
        apply_namespaced_dtcs(
            readings, dtc_by_source, 0x3D,
            self._make_decoded([{"spn": 3226, "fmi": 18}])
        )
        # Then engine
        apply_namespaced_dtcs(
            readings, dtc_by_source, 0x00,
            self._make_decoded([{"spn": 100, "fmi": 1}])
        )

        # Flat keys should be from engine (preferred)
        assert readings["dtc_0_spn"] == 100
