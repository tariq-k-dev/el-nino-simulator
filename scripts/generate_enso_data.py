# /// script
# dependencies = [
#     "polars",
#     "pyarrow",
# ]
# ///

"""
Ingest real NOAA CPC ERSSTv5 Niño indices and emit the production parquet.

Source
------
NOAA Climate Prediction Center, monthly ERSSTv5 sea-surface temperature
anomalies for the four Niño regions, on the 1991–2020 climatological base:

    https://www.cpc.ncep.noaa.gov/data/indices/ersst5.nino.mth.91-20.ascii

The file is a fixed-width text table covering 1950 to the most recent completed
month (~919 rows). Missing values are encoded as 999 / -999.

What is real and what is modelled
---------------------------------
Every SST field below is the *observed* CPC value, verbatim:
    nino12_sst, nino12_anomaly, nino3_sst, nino3_anomaly,
    nino4_sst, nino4_anomaly, nino34_sst, nino34_anomaly

The regional impact columns (precipitation / drought / flood / convection /
risk tier) are NOT observations. They are this project's teleconnection model
applied to the observed Niño 3.4 anomaly, using the published coefficients from
the simulator brief. They exist so the DuckDB analog query can join a scenario
to the historical months that produced it. `model_basis` records this per row
so a reader can never mistake a modelled column for a measured one.

Usage
-----
    uv run python scripts/generate_enso_data.py            # fetch + build
    uv run python scripts/generate_enso_data.py --offline  # use cached download
    uv run python scripts/generate_enso_data.py --since 1980

Exit codes: 0 success, 1 the source could not be fetched and no cache exists.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path
from typing import cast
from urllib.error import URLError
from urllib.request import Request, urlopen

import polars as pl

SOURCE_URL = "https://www.cpc.ncep.noaa.gov/data/indices/ersst5.nino.mth.91-20.ascii"
SOURCE_NAME = "NOAA CPC ERSSTv5 (1991-2020 base)"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = PROJECT_ROOT / ".cache"
CACHE_FILE = CACHE_DIR / "cpc_ersst5_nino.ascii"
# The parquet lives in data/, NOT public/, so it is a repo-only source of truth:
# it is never served, never fetched, and never copied into dist/. The browser only
# ever sees the CSV. Keeping it out of public/ makes "no parquet in dist" a
# structural guarantee rather than a convention someone has to remember.
OUTPUT_FILE = PROJECT_ROOT / "data" / "enso_historical.parquet"
CSV_FILE = PROJECT_ROOT / "public" / "data" / "enso.csv"
SCHEMA_FILE = PROJECT_ROOT / "public" / "data" / "schema.sql"

# CPC writes 999 / -999 into fields that are not yet observed.
MISSING = (-999.0, 999.0)

COLUMNS = [
    "year",
    "month",
    "nino12_sst",
    "nino12_anomaly",
    "nino3_sst",
    "nino3_anomaly",
    "nino4_sst",
    "nino4_anomaly",
    "nino34_sst",
    "nino34_anomaly",
]


def fetch(offline: bool) -> str:
    """Download the CPC table, or reuse the cache. Returns the raw text."""
    if offline:
        if not CACHE_FILE.exists():
            print(
                f"ERROR: --offline given but no cache at {CACHE_FILE}", file=sys.stderr
            )
            raise SystemExit(1)
        print(f"  using cached download: {CACHE_FILE.name}")
        return CACHE_FILE.read_text(encoding="utf-8", errors="replace")

    request = Request(SOURCE_URL, headers={"User-Agent": "el-nino-simulator/1.0"})
    try:
        with urlopen(request, timeout=45) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except (URLError, TimeoutError, OSError) as error:
        print(f"ERROR: could not reach CPC: {error}", file=sys.stderr)
        if CACHE_FILE.exists():
            print("  falling back to the cached download.", file=sys.stderr)
            return CACHE_FILE.read_text(encoding="utf-8", errors="replace")
        raise SystemExit(1) from error

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(raw, encoding="utf-8")
    print(f"  downloaded {len(raw):,} bytes -> {CACHE_FILE.relative_to(PROJECT_ROOT)}")
    return raw


def parse(raw: str) -> pl.DataFrame:
    """Whitespace-split the fixed-width table into a typed DataFrame."""
    rows: list[list[float]] = []
    skipped = 0

    for line in raw.splitlines():
        parts = line.split()
        # Header, blank lines, and truncated trailing records.
        if len(parts) != len(COLUMNS):
            if parts and parts[0].lstrip("-").isdigit():
                skipped += 1
            continue
        try:
            rows.append([float(p) for p in parts])
        except ValueError:
            skipped += 1

    if not rows:
        print(
            "ERROR: parsed zero data rows - the source format may have changed.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    print(f"  parsed {len(rows):,} rows" + (f" ({skipped} skipped)" if skipped else ""))
    return pl.DataFrame(rows, schema=COLUMNS, orient="row")


def enrich(df: pl.DataFrame, since: int) -> pl.DataFrame:
    """
    Attach the simulated regional response columns.

    Coefficients are the published ones from the simulator brief, applied to the
    OBSERVED Niño 3.4 anomaly in each row. Modelled, not measured - see module
    docstring. Jet displacement and cropland weight are held at their scenario
    defaults (0.35 and 0.6) so the historical rows are comparable to the app's
    default state.
    """
    JET = 0.35
    AGRI = 0.6

    df = (
        df.filter(pl.col("year") >= since)
        # Drop any month where a field is the missing-value sentinel.
        .filter(~pl.any_horizontal([pl.col(c).is_in(MISSING) for c in COLUMNS[2:]]))
        .with_columns(
            pl.col("year").cast(pl.Int32),
            pl.col("month").cast(pl.Int32),
        )
        .with_columns(
            pl.date(pl.col("year"), pl.col("month"), 1).alias("date"),
            pl.col("nino34_anomaly").alias("nino_34_anomaly"),
            pl.col("nino34_anomaly").alias("global_sst_anomaly"),
        )
    )

    anomaly = pl.col("nino_34_anomaly")

    df = df.with_columns(
        # Equatorial Pacific
        (anomaly * 1.15).alias("sst_deviation"),
        (anomaly * 35.0).clip(0.0, 100.0).alias("convection_shift"),
        # Western US / California
        (15.0 + anomaly * 18.0 + JET * 12.0).alias("precip_anomaly_us"),
        (-0.5 - anomaly * 0.8 - JET * 0.6).alias("temp_deviation_us_f"),
        # Southeast Asia / Indonesia
        (-10.0 - anomaly * 22.0 - JET * 9.0).alias("precip_anomaly_se_asia"),
        (anomaly * 3.2 * (1.0 + JET * 0.15))
        .clip(0.0, 10.0)
        .alias("drought_index_se_asia"),
        # Horn of Africa
        (20.0 + anomaly * 25.0 + JET * -4.0).alias("precip_anomaly_africa"),
        (anomaly * 2.8).clip(0.0, 10.0).alias("flood_index_horn"),
        # Pacific basin precipitation proxy, kept for parity with the brief.
        (anomaly * 15.0).alias("precip_anomaly_pacific"),
    )

    df = df.with_columns(
        # Agriculture exposure blends the drought, flood, and convection extremes.
        (
            (
                (pl.col("drought_index_se_asia") / 10.0) * 0.5
                + (pl.col("flood_index_horn") / 10.0) * 0.3
                + (pl.col("convection_shift") / 100.0) * 0.2
            )
            * (0.55 + AGRI * 0.45)
            * 100.0
        )
        .clip(0.0, 100.0)
        .round(1)
        .alias("agriculture_exposure"),
        pl.when(anomaly < -0.5)
        .then(pl.lit("La Niña"))
        .when(anomaly < 0.5)
        .then(pl.lit("Neutral"))
        .when(anomaly < 1.0)
        .then(pl.lit("Weak Warm Phase"))
        .when(anomaly < 1.5)
        .then(pl.lit("Moderate El Niño"))
        .when(anomaly < 2.0)
        .then(pl.lit("Strong El Niño"))
        .when(anomaly < 2.6)
        .then(pl.lit("Super El Niño"))
        .otherwise(pl.lit("Extreme Mega-El Niño"))
        .alias("risk_tier_pacific"),
        pl.lit(SOURCE_NAME).alias("source"),
        pl.lit("observed SST; modelled regional response").alias("model_basis"),
    )

    order = [
        "date",
        "year",
        "month",
        "nino12_sst",
        "nino12_anomaly",
        "nino3_sst",
        "nino3_anomaly",
        "nino4_sst",
        "nino4_anomaly",
        "nino34_sst",
        "nino_34_anomaly",
        "global_sst_anomaly",
        "sst_deviation",
        "convection_shift",
        "precip_anomaly_pacific",
        "precip_anomaly_us",
        "temp_deviation_us_f",
        "precip_anomaly_se_asia",
        "drought_index_se_asia",
        "precip_anomaly_africa",
        "flood_index_horn",
        "agriculture_exposure",
        "risk_tier_pacific",
        "source",
        "model_basis",
    ]

    return df.select(order).sort("date")


def write_schema(df: pl.DataFrame) -> None:
    """Regenerate schema.sql from the actual frame so the two can never drift."""
    duck_type = {
        pl.Date: "DATE",
        pl.Int64: "INTEGER",
        pl.Int32: "INTEGER",
        pl.Float64: "DOUBLE",
        pl.Utf8: "VARCHAR",
        pl.String: "VARCHAR",
    }
    lines = ["-- Generated by scripts/generate_enso_data.py - do not hand-edit.", ""]
    lines.append("CREATE TABLE enso_historical (")
    rendered = []
    for name, dtype in df.schema.items():
        rendered.append(f"    {name} {duck_type.get(dtype, 'DOUBLE')}")
    lines.append(",\n".join(rendered))
    lines.append(");")
    SCHEMA_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"  wrote {SCHEMA_FILE.relative_to(PROJECT_ROOT)}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build the ENSO parquet from NOAA CPC data."
    )
    parser.add_argument(
        "--offline", action="store_true", help="use the cached CPC download"
    )
    parser.add_argument(
        "--since", type=int, default=1950, help="drop months before this year"
    )
    parser.add_argument(
        "--out", type=Path, default=OUTPUT_FILE, help="output parquet path"
    )
    args = parser.parse_args()

    print(f"Source: {SOURCE_NAME}")
    raw = fetch(args.offline)

    df = enrich(parse(raw), args.since)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    # Snappy, not ZSTD: it is the most portable parquet codec (readable by
    # duckdb-wasm, pyarrow, and browser-side readers like hyparquet without
    # extra decompression codecs). At 918 rows the size difference is nil.
    df.write_parquet(args.out, compression="snappy")

    # Also emit CSV for the browser boot path. duckdb-wasm's read_parquet()
    # requires the parquet extension, which it tries to fetch from
    # extensions.duckdb.org at runtime; read_csv() needs no extension at all, so
    # the wasm build stays self-contained. The parquet remains the source of
    # truth — this CSV is a derived artifact written from the same frame, so the
    # two can never disagree. Regenerate both with:
    #
    #     uv run python scripts/generate_enso_data.py            # fetch + build
    #     uv run python scripts/generate_enso_data.py --offline  # cached source
    #
    # Dates are written as ISO YYYY-MM-DD because read_csv maps that to DATE
    # directly. Float formatting keeps full precision (no rounding here) so the
    # CSV and parquet produce byte-identical query results.
    df.write_csv(CSV_FILE, date_format="%Y-%m-%d")

    stats = df.select(
        pl.len().alias("rows"),
        pl.col("date").min().alias("first"),
        pl.col("date").max().alias("last"),
        pl.col("nino_34_anomaly").min().round(2).alias("min"),
        pl.col("nino_34_anomaly").max().round(2).alias("max"),
    ).row(0, named=True)

    print(
        f"\n  {stats['rows']:,} monthly observations ({stats['first']} -> {stats['last']})"
    )
    print(f"  Niño 3.4 anomaly range: {stats['min']} .. {stats['max']} C")
    print(
        f"  wrote {args.out.relative_to(PROJECT_ROOT)} ({args.out.stat().st_size / 1024:.0f} KB)"
    )
    print(
        f"  wrote {CSV_FILE.relative_to(PROJECT_ROOT)} ({CSV_FILE.stat().st_size / 1024:.0f} KB)"
    )

    duplicates = df.height - df["date"].n_unique()
    if duplicates:
        print(f"ERROR: {duplicates} duplicate dates", file=sys.stderr)
        return 1
    max_date = cast(date | None, df["date"].max())
    if max_date is None or max_date < date(2020, 1, 1):
        print("ERROR: dataset looks truncated - check the source.", file=sys.stderr)
        return 1

    write_schema(df)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
