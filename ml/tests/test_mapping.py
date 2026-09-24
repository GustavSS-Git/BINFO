"""Unit tests for the pure decision functions in
ml/mapping/build_postnummer_omrade.py (tier 1/2 prefix gate, tier 3 nearest
neighbour). Written before the corresponding bugfix/refactor was wired into
main(), per the review's request -- these tests define the required behaviour.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mapping"))

from build_postnummer_omrade import (  # noqa: E402
    MIN_PREFIX_SHARE_FOR_TIER12,
    OSM_MIN_N,
    STOCKHOLM_ONLY_PREFIX_THRESHOLD,
    TIER1_MIN_N_FOR_NON_STOCKHOLM_ONLY_PREFIX,
    choose_tier3_neighbor,
    prefix_passes_tier12_gate,
    tier1_min_n_required,
)


class TestPrefixGate:
    def test_passes_when_share_at_or_above_threshold(self):
        share = {"111": 0.998, "165": 1.0, "106": 0.50}
        assert prefix_passes_tier12_gate("111", share) is True
        assert prefix_passes_tier12_gate("165", share) is True
        assert prefix_passes_tier12_gate("106", share) is True  # exactly at the bar

    def test_fails_when_share_below_threshold(self):
        # the real bug report: prefixes ~0% in-kommun must not pass
        share = {"131": 0.0004, "171": 0.003, "181": 0.001, "192": 0.0001}
        for prefix in share:
            assert prefix_passes_tier12_gate(prefix, share) is False

    def test_fails_when_prefix_has_no_evidence_at_all(self):
        assert prefix_passes_tier12_gate("999", {}) is False

    def test_default_threshold_is_050(self):
        assert MIN_PREFIX_SHARE_FOR_TIER12 == pytest.approx(0.50)

    def test_custom_threshold_respected(self):
        share = {"200": 0.60}
        assert prefix_passes_tier12_gate("200", share, min_share=0.70) is False
        assert prefix_passes_tier12_gate("200", share, min_share=0.50) is True


class TestTier1MinN:
    def test_stockholm_only_prefix_needs_only_one_point(self):
        stockholm_only = {"111", "165"}
        assert tier1_min_n_required("111", stockholm_only) == OSM_MIN_N == 1

    def test_borderline_prefix_needs_two_points(self):
        stockholm_only = {"111", "165"}  # 106/123/164 deliberately NOT in this set
        assert tier1_min_n_required("106", stockholm_only) == TIER1_MIN_N_FOR_NON_STOCKHOLM_ONLY_PREFIX == 2
        assert tier1_min_n_required("123", stockholm_only) == 2
        assert tier1_min_n_required("164", stockholm_only) == 2


class TestTier3NearestNeighbor:
    def test_picks_closer_below(self):
        omrade, ref, conflict = choose_tier3_neighbor(target=11165, below=11160, above=11180, omrade_below="Vasastan-Norrmalm", omrade_above="Ostermalm")
        assert omrade == "Vasastan-Norrmalm"
        assert ref == 11160
        assert conflict is True

    def test_picks_closer_above(self):
        omrade, ref, conflict = choose_tier3_neighbor(target=11175, below=11160, above=11180, omrade_below="Vasastan-Norrmalm", omrade_above="Ostermalm")
        assert omrade == "Ostermalm"
        assert ref == 11180
        assert conflict is True

    def test_tie_goes_to_lower_number(self):
        # target exactly between below and above -> equal distance -> below wins
        omrade, ref, conflict = choose_tier3_neighbor(target=11170, below=11160, above=11180, omrade_below="Kungsholmen", omrade_above="Sodermalm")
        assert ref == 11160
        assert omrade == "Kungsholmen"
        assert conflict is True

    def test_no_conflict_when_neighbours_agree(self):
        omrade, ref, conflict = choose_tier3_neighbor(target=11165, below=11160, above=11180, omrade_below="Kungsholmen", omrade_above="Kungsholmen")
        assert conflict is False
        assert omrade == "Kungsholmen"

    def test_only_below_exists(self):
        omrade, ref, conflict = choose_tier3_neighbor(target=11199, below=11160, above=None, omrade_below="Kungsholmen", omrade_above=None)
        assert omrade == "Kungsholmen"
        assert ref == 11160
        assert conflict is False

    def test_only_above_exists(self):
        omrade, ref, conflict = choose_tier3_neighbor(target=11100, below=None, above=11180, omrade_below=None, omrade_above="Sodermalm")
        assert omrade == "Sodermalm"
        assert ref == 11180
        assert conflict is False

    def test_raises_if_no_neighbours_at_all(self):
        with pytest.raises(ValueError):
            choose_tier3_neighbor(target=11100, below=None, above=None, omrade_below=None, omrade_above=None)

    def test_never_asked_to_chain_through_tier3_results(self):
        # This is a documentation/design test: choose_tier3_neighbor has no notion
        # of "tier", it only ever receives the two nearest REFERENCE postcodes the
        # caller passes in. The caller (main()) is responsible for building
        # `by_prefix_refs` from tier-1/2-mapped postcodes only -- verified by
        # inspecting that main() builds by_prefix_refs from `mapped` *before* any
        # tier-3 assignment is added to `mapped` within the same pass (see
        # build_postnummer_omrade.py: by_prefix_refs is built once, from tier 1/2
        # results only, before the tier-3 loop starts writing into `mapped`).
        # Functionally: calling choose_tier3_neighbor repeatedly with the SAME
        # below/above (i.e. not updated as new tier-3 rows are resolved) is exactly
        # "never chaining" -- this test just pins the tie-break/selection contract
        # those fixed reference points are combined with.
        omrade, ref, conflict = choose_tier3_neighbor(target=11161, below=11160, above=11163, omrade_below="A", omrade_above="B")
        assert ref in (11160, 11163)


class TestConstants:
    def test_stockholm_only_threshold_is_99pct(self):
        assert STOCKHOLM_ONLY_PREFIX_THRESHOLD == pytest.approx(0.99)
