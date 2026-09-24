"""Cleaning rules for the valuation transaction data (task 4c).

Every function here is a pure, documented, unit-tested transformation of one raw
column. Nothing is dropped silently: implausible values become NaN (missing), and
`clean_dataframe()` returns both the cleaned frame and a report of how many rows each
rule affected, so the caller can print/log it.

Design principle taken from CLAUDE.md: "implausible values -> NaN not dropped
silently; report every rule and how many rows it affects." Balcony missingness is
kept as its own category (unknown != no) rather than being imputed to False.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# apartment_floor
# ---------------------------------------------------------------------------
# Observed raw formats (5,000-row workbook, profiled 2026-09-24) and the rule applied
# to each, in the order checked:
#
#  1. Plain numbers, incl. negative and decimal ("2", "-1", "0.5", "1.5") -> parsed
#     as-is. Negative = below-ground floor (Swedish "-1 tr" = one floor below street).
#  2. "1, 5" (comma as decimal separator) -> 1.5.
#  3. "½" -> 0.5.
#  4. "BV" / "Bv" / "bv" (bottenvaning = ground floor) -> 0.
#  5. "EP" / "Entréplan" (entrance level) -> 0. We treat EP and BV as the same floor
#     (ground/entrance level) -- a simplifying, documented assumption; in some
#     buildings EP and BV can technically differ by half a level, but the raw data
#     gives us no way to tell them apart.
#  6. "N tr", "Ntr", "N trappor" (trappor = the Swedish floor-count convention) -> N.
#  7. "N tr ned" ("ned" = down) -> N - 1 (one floor below the stated reference floor).
#     Single occurrence in the data; documented best-effort interpretation.
#  8. Ranges/combinations "A-B", "A/B", "A+B", "A&B" (duplex apartments spanning two
#     floors, or an ambiguous separator) -> the LOWER of the two numbers (consistent
#     with the build_year "first year" rule below). "A/BV" -> min(A, 0).
#  9. Parenthetical explicit floor clarification containing "tr"/"trappor", e.g.
#     "1 (0,5 tr)", "5 ( 4tr )", "2 (3 tr)", "7 (5 trappor)" -> the parenthetical
#     number is used (the number outside the parenthesis is assumed to be an
#     apartment/lgh number, not a floor).
# 10. Ambiguous single-occurrence Swedish codes we could not confidently map to a
#     numeric floor -- "MP" (mellanplan), "NB" (nedre botten), "Vind" (attic, no
#     numeric floor given) -> NaN. Not guessed.
# 11. Anything else that fails to parse -> NaN.
# 12. Implausibility cap: parsed floor > 25 -> NaN (Swedish residential buildings this
#     tall are essentially unheard of outside a handful of named towers; this cap is a
#     documented modelling judgement call, not a verified fact, see ml/mapping style
#     caveat in README). Only affects apartment_floor == 28 in this dataset (paired
#     with a building_storeys value of 36, itself capped by the building_storeys rule
#     below).

_AMBIGUOUS_FLOOR_CODES = {"MP", "NB", "VIND"}


def clean_apartment_floor(raw: object) -> float:
    if raw is None or (isinstance(raw, float) and np.isnan(raw)):
        return np.nan
    s = str(raw).strip()
    if s == "" or s.lower() == "nan":
        return np.nan

    # already-numeric (int/float from openpyxl)
    if isinstance(raw, (int, float)):
        val = float(raw)
        return val if abs(val) <= 25 else np.nan

    s_norm = s.replace("\xad", "-")  # soft hyphen -> regular hyphen

    # rule 10: ambiguous codes
    if s_norm.strip().upper() in _AMBIGUOUS_FLOOR_CODES:
        return np.nan

    # rule 4/5: BV / EP / Entréplan (possibly combined with a number via "/")
    upper = s_norm.upper()
    if upper in {"BV", "EP", "ENTRÉPLAN", "ENTREPLAN"}:
        return 0.0

    # rule 9: parenthetical explicit "tr"/"trappor" clarification wins
    paren = re.search(r"\(([^)]*)\)", s_norm)
    if paren and re.search(r"tr(appor)?\b", paren.group(1), re.IGNORECASE):
        inner = paren.group(1).replace(",", ".")
        m = re.search(r"-?\d+(\.\d+)?", inner)
        if m:
            val = float(m.group())
            return val if abs(val) <= 25 else np.nan

    # rule 7: "N tr ned"
    m = re.match(r"^\s*(-?\d+(?:[.,]\d+)?)\s*tr\s*ned\s*$", s_norm, re.IGNORECASE)
    if m:
        val = float(m.group(1).replace(",", ".")) - 1
        return val if abs(val) <= 25 else np.nan

    # rule 6: "N tr" / "Ntr" / "N trappor"
    m = re.match(r"^\s*(-?\d+(?:[.,]\d+)?)\s*tr(appor)?\s*$", s_norm, re.IGNORECASE)
    if m:
        val = float(m.group(1).replace(",", "."))
        return val if abs(val) <= 25 else np.nan

    # rule 3: half symbol
    if s_norm.strip() == "½":
        return 0.5

    # rule 2: comma decimal, e.g. "1, 5"
    m = re.match(r"^\s*(-?\d+)\s*,\s*(\d+)\s*$", s_norm)
    if m:
        val = float(f"{m.group(1)}.{m.group(2)}")
        return val if abs(val) <= 25 else np.nan

    # rule 8: ranges / combinations -> lower value
    for sep in ("-", "/", "+", "&"):
        if sep in s_norm:
            parts = [p.strip() for p in s_norm.split(sep) if p.strip() != ""]
            nums = []
            for p in parts:
                pu = p.upper()
                if pu in {"BV", "EP", "ENTRÉPLAN", "ENTREPLAN"}:
                    nums.append(0.0)
                    continue
                pm = re.match(r"^-?\d+(\.\d+)?$", p.replace(",", "."))
                if pm:
                    nums.append(float(p.replace(",", ".")))
            if len(nums) >= 2:
                val = min(nums)
                return val if abs(val) <= 25 else np.nan

    # rule 1: plain number
    m = re.match(r"^\s*(-?\d+(?:\.\d+)?)\s*$", s_norm)
    if m:
        val = float(m.group(1))
        return val if abs(val) <= 25 else np.nan

    return np.nan


# ---------------------------------------------------------------------------
# build_year
# ---------------------------------------------------------------------------
# Rule: strip any renovation/valuation-year annotation ("OB:", "Ombyggd"/"ombyggt",
# "oå", "Värdeår:"/"värdeår"), then extract every remaining 4-digit number in
# [1000, 2035] and take the FIRST (leftmost) one as the build year. This handles
# ranges ("1929-1932" -> 1929), slash-joined years ("1975/76" -> 1975, "1932 / 2007"
# -> 1932), "och"/"resp." joined years ("1700 och 1762" -> 1700), century notation
# ("1600-tal" -> 1600, an approximation), "ca YYYY" ("ca 1880" -> 1880), and stray
# punctuation ("2019§" -> 2019, "2004," -> 2004). It intentionally always takes the
# EARLIEST-POSITION year, not the earliest VALUE, to stay consistent and simple; for
# the "2012(1972)" style value (main year newer than the parenthetical one) this is a
# known, documented limitation -- we cannot tell from the text alone whether the
# parenthetical number is an original build year or a renovation year, so we take the
# leftmost/primary figure as given.
_YEAR_RE = re.compile(r"(1[0-9]{3}|20[0-3][0-9])")
_RENOVATION_ANNOTATION_RE = re.compile(
    r"\(?\s*(OB|Ombyggd|ombyggt|oå|Värdeår|värdeår)\s*:?.*?\)?",
    re.IGNORECASE,
)

_MIN_PLAUSIBLE_YEAR = 1000
_MAX_PLAUSIBLE_YEAR = 2035


def clean_build_year(raw: object) -> float:
    if raw is None or (isinstance(raw, float) and np.isnan(raw)):
        return np.nan
    if isinstance(raw, (int, float)):
        val = float(raw)
        return val if _MIN_PLAUSIBLE_YEAR <= val <= _MAX_PLAUSIBLE_YEAR else np.nan

    s = str(raw).strip()
    if s == "" or s.lower() == "nan":
        return np.nan

    # strip renovation/valuation-year annotations so they are not picked up as the
    # (leftmost) build year when they happen to precede it -- e.g. "OB:1994-1995)"
    # standing alone. We only strip when the annotation itself does not contain the
    # sole year in the string; simplest robust approach: remove any parenthetical
    # segment whose content starts with one of the annotation keywords.
    def _strip_paren_annotation(m: re.Match) -> str:
        return ""

    s_stripped = re.sub(
        r"\(\s*(OB|Ombyggd|ombyggt|o[åa]|Värdeår|värdeår)\b[^)]*\)",
        "",
        s,
        flags=re.IGNORECASE,
    )
    # also drop a trailing/standalone "OB: ..." / "Värdeår: ..." with no parens
    s_stripped = re.sub(
        r"\b(OB|Värdeår|värdeår)\s*:\s*[0-9/\-–\s]+",
        "",
        s_stripped,
        flags=re.IGNORECASE,
    )

    m = _YEAR_RE.search(s_stripped)
    if not m:
        # fall back to the original (unstripped) string in case stripping removed
        # the only year present (defensive; not hit by the profiled data)
        m = _YEAR_RE.search(s)
        if not m:
            return np.nan
    val = float(m.group())
    return val if _MIN_PLAUSIBLE_YEAR <= val <= _MAX_PLAUSIBLE_YEAR else np.nan


# ---------------------------------------------------------------------------
# monthly_fee
# ---------------------------------------------------------------------------
# Rule: monthly_fee / living_area > 250 kr/m^2/month is treated as implausible (an
# order of magnitude above the ~50-160 kr/m^2/month range seen for the other 4,993
# rows) and set to NaN. This affects exactly the 6 rows flagged in profiling, all in
# postcode 12634. Threshold chosen from the data's own distribution (clear gap
# between ~249 and ~898 kr/m^2/month) -- documented modelling judgement, not a cited
# domain fact.
_FEE_PER_SQM_CAP = 250.0


def flag_implausible_monthly_fee(monthly_fee: pd.Series, living_area: pd.Series) -> pd.Series:
    with np.errstate(invalid="ignore", divide="ignore"):
        fee_per_sqm = monthly_fee / living_area
    return fee_per_sqm > _FEE_PER_SQM_CAP


# ---------------------------------------------------------------------------
# building_storeys
# ---------------------------------------------------------------------------
# Rule: building_storeys > 30 is treated as implausible for Stockholm residential
# buildings and set to NaN. Documented judgement call, not a cited fact: Stockholm has
# very few residential buildings above ~20 storeys; the handful of >30 values in this
# dataset (34-36) cluster in postcodes flagged as suspicious during profiling
# (11365, 16453) and are more likely a data-entry unit error than genuine towers.
_STOREYS_CAP = 30


def clean_building_storeys(raw: object) -> float:
    if raw is None or (isinstance(raw, float) and np.isnan(raw)):
        return np.nan
    val = float(raw)
    return val if val <= _STOREYS_CAP else np.nan


# ---------------------------------------------------------------------------
# postal_code
# ---------------------------------------------------------------------------
def clean_postal_code(raw: object) -> str | float:
    if raw is None or (isinstance(raw, float) and np.isnan(raw)):
        return np.nan
    try:
        return str(int(float(raw))).zfill(5)
    except (ValueError, TypeError):
        return np.nan


# ---------------------------------------------------------------------------
# elevator / balcony -> tristate category
# ---------------------------------------------------------------------------
# Kept as pandas nullable-boolean-like category with an explicit "unknown" level
# rather than imputed to False: "unknown != no" (CLAUDE.md convention, applied here
# to the modelling data too). balcony is 44.8% missing -- imputing to False would
# silently bias every hedonic coefficient that touches it.
def clean_tristate(raw: object) -> str:
    if raw is None or (isinstance(raw, float) and np.isnan(raw)):
        return "okant"
    if isinstance(raw, bool):
        return "ja" if raw else "nej"
    s = str(raw).strip().lower()
    if s in {"true", "1", "ja", "yes"}:
        return "ja"
    if s in {"false", "0", "nej", "no"}:
        return "nej"
    return "okant"


@dataclass
class CleaningReport:
    rows_in: int = 0
    rows_out: int = 0
    duplicate_rows_dropped: int = 0
    missing_target_rows_dropped: int = 0
    apartment_floor_parsed_nonnull: int = 0
    apartment_floor_still_missing: int = 0
    build_year_parsed_nonnull: int = 0
    build_year_still_missing: int = 0
    monthly_fee_implausible_nulled: int = 0
    building_storeys_implausible_nulled: int = 0
    postal_code_missing: int = 0
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}


def clean_dataframe(df_raw: pd.DataFrame) -> tuple[pd.DataFrame, CleaningReport]:
    """Applies every cleaning rule above to the raw valuation transactions frame.

    Expects the raw column names as read from `data/raw/Transaction data for
    valuation.xlsx` (sheet1, header row 2): contract_date, price_per_sq_meter,
    monthly_fee, number_of_rooms, living_area, elevator, balcony, apartment_floor,
    building_storeys, build_year, postal_code.
    """
    report = CleaningReport(rows_in=len(df_raw))

    df = df_raw.copy()

    # 1. drop exact duplicate rows (1 row in the profiled data -- a fully-blank
    #    duplicate with no price/postcode)
    before = len(df)
    df = df.drop_duplicates(keep="first")
    report.duplicate_rows_dropped = before - len(df)

    # 2. drop rows with missing target (price_per_sq_meter) -- cannot train on them
    before = len(df)
    df = df[df["price_per_sq_meter"].notna()].copy()
    report.missing_target_rows_dropped = before - len(df)

    # 3. postal_code -> 5-digit string
    df["postal_code_clean"] = df["postal_code"].apply(clean_postal_code)
    report.postal_code_missing = int(df["postal_code_clean"].isna().sum())

    # 4. apartment_floor
    df["apartment_floor_clean"] = df["apartment_floor"].apply(clean_apartment_floor)
    report.apartment_floor_parsed_nonnull = int(df["apartment_floor_clean"].notna().sum())
    report.apartment_floor_still_missing = int(df["apartment_floor_clean"].isna().sum())

    # 5. build_year
    df["build_year_clean"] = df["build_year"].apply(clean_build_year)
    report.build_year_parsed_nonnull = int(df["build_year_clean"].notna().sum())
    report.build_year_still_missing = int(df["build_year_clean"].isna().sum())

    # 6. monthly_fee implausibility
    implausible = flag_implausible_monthly_fee(df["monthly_fee"], df["living_area"])
    report.monthly_fee_implausible_nulled = int(implausible.sum())
    df["monthly_fee_clean"] = df["monthly_fee"].where(~implausible, np.nan)

    # 7. building_storeys implausibility
    df["building_storeys_clean"] = df["building_storeys"].apply(clean_building_storeys)
    report.building_storeys_implausible_nulled = int(
        (df["building_storeys"].notna() & df["building_storeys_clean"].isna()).sum()
    )

    # 8. elevator / balcony -> tristate
    df["elevator_clean"] = df["elevator"].apply(clean_tristate)
    df["balcony_clean"] = df["balcony"].apply(clean_tristate)

    report.rows_out = len(df)
    return df, report
