"""
MERRA-2 Data Access Layer

Robust OPeNDAP + xarray implementation with Earthdata Login (URS) authentication.
References:
- https://github.com/nasa/gesdisc-tutorials/blob/main/notebooks/How_to_Access_MERRA2_Using_OPeNDAP_with_Python3_Calculate_Weekly_from_Hourly.ipynb
- Product: M2T1NXSLV.5.12.4 (MERRA-2 1-hourly, single-level diagnostics)
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import List, Dict
from netrc import netrc

import xarray as xr
from pydap.cas.urs import setup_session

GES_DISC_HOST = "https://goldsmr4.gesdisc.eosdis.nasa.gov"
PRODUCT = "M2T1NXSLV"
VERSION = "5.12.4"


def _get_urs_credentials() -> tuple[str | None, str | None]:
    """Load Earthdata Login credentials from env or ~/.netrc.

    Returns (username, password) or (None, None) if not found.
    """
    user = os.getenv("EARTHDATA_USERNAME")
    pwd = os.getenv("EARTHDATA_PASSWORD")
    if user and pwd:
        return user, pwd
    # Try netrc
    try:
        auth = netrc().authenticators("urs.earthdata.nasa.gov")
        if auth:
            return auth[0], auth[2]
    except Exception:
        pass
    return None, None


def _create_urs_session(check_url: str = GES_DISC_HOST):
    """Create an authenticated requests.Session for OPeNDAP with URS creds."""
    user, pwd = _get_urs_credentials()
    if not user or not pwd:
        raise RuntimeError(
            "Missing Earthdata credentials. Set EARTHDATA_USERNAME and EARTHDATA_PASSWORD env vars, "
            "or configure ~/.netrc for 'urs.earthdata.nasa.gov'."
        )
    return setup_session(user, pwd, check_url=check_url)


def validate_weather_data(data: Dict, variables: List[str]) -> bool:
    """
    Validate that weather data contains expected structure and reasonable values.
    Returns True if data looks good, raises ValueError with details if not.
    """
    if not data or "data_vars" not in data:
        raise ValueError("Invalid data structure: missing data_vars")
    
    missing_vars = [v for v in variables if v not in data["data_vars"]]
    if missing_vars:
        raise ValueError(f"Missing variables in data: {missing_vars}")
    
    # Check for reasonable value ranges
    for var in variables:
        if var in data["data_vars"]:
            values = data["data_vars"][var]["data"]
            if not values:
                raise ValueError(f"No data for variable {var}")
                
            # Basic sanity checks for weather variables
            if var == "T2M":  # Temperature should be reasonable (200-350K)
                temp_range = [min(values), max(values)]
                if temp_range[0] < 200 or temp_range[1] > 350:
                    raise ValueError(f"Temperature values out of range: {temp_range}")
            elif var in ["U10M", "V10M"]:  # Wind components (-100 to 100 m/s)
                wind_range = [min(values), max(values)]
                if wind_range[0] < -100 or wind_range[1] > 100:
                    raise ValueError(f"Wind values out of range: {wind_range}")
            elif var == "PS":  # Surface pressure (50000-110000 Pa)
                pressure_range = [min(values), max(values)]
                if pressure_range[0] < 50000 or pressure_range[1] > 110000:
                    raise ValueError(f"Pressure values out of range: {pressure_range}")
    
    return True


def _merra2_stream_for_date(dt: datetime) -> str:
    """Return MERRA-2 stream number for a given date.

    Streams per NASA docs: 100 (1980-01-01 to 1991-12-31),
    200 (1992-01-01 to 2000-12-31), 300 (2001-01-01 to 2010-12-31),
    400 (2011-01-01 to present).
    """
    if dt.year <= 1991:
        return "100"
    if dt.year <= 2000:
        return "200"
    if dt.year <= 2010:
        return "300"
    return "400"


def _generate_merra2_daily_urls(start_date: str, end_date: str) -> List[str]:
    """Build daily OPeNDAP file URLs for M2T1NXSLV between start and end (inclusive)."""
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    if end < start:
        raise ValueError("end_date must be >= start_date")

    urls: List[str] = []
    cur = start
    while cur <= end:
        stream = _merra2_stream_for_date(cur)
        yyyy = cur.strftime("%Y")
        mm = cur.strftime("%m")
        yyyymmdd = cur.strftime("%Y%m%d")
        # Correct MERRA-2 filename format: MERRA2_400.tavg1_2d_slv_Nx.20230925.nc4
        url = (
            f"{GES_DISC_HOST}/opendap/MERRA2/{PRODUCT}.{VERSION}/{yyyy}/{mm}/"
            f"MERRA2_{stream}.tavg1_2d_slv_Nx.{yyyymmdd}.nc4"
        )
        urls.append(url)
        cur += timedelta(days=1)
    return urls


def _open_dataset(urls: List[str]):
    """Open multiple OPeNDAP URLs as a single xarray Dataset with auth session."""
    session = _create_urs_session(check_url=GES_DISC_HOST)
    # pydap engine understands sessions for authenticated requests
    ds = xr.open_mfdataset(
        urls,
        engine="pydap",
        combine="by_coords",
        backend_kwargs={"session": session},
    )
    return ds


def get_point_data(latitude: float, longitude: float, start_date: str, end_date: str, variables: List[str]) -> Dict:
    """
    Fetch MERRA-2 hourly data for a point using OPeNDAP (xarray+pydap with URS).
    
    Optimized for website use:
    - Validates date range (max 7 days for performance)
    - Pre-filters variables to only weather essentials
    - Returns structured data ready for frontend consumption
    """
    # Validate date range for performance
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    date_diff = (end - start).days + 1
    
    if date_diff > 7:
        raise ValueError("Date range too large. Maximum 7 days allowed for performance.")
    
    # Pre-filter to essential weather variables only
    weather_vars = ['T2M', 'U10M', 'V10M', 'PS', 'QV2M', 'PRECTOT']
    variables = [v for v in variables if v in weather_vars]
    
    if not variables:
        raise ValueError(f"No valid weather variables requested. Available: {weather_vars}")
    
    urls = _generate_merra2_daily_urls(start_date, end_date)
    print(f"🌍 Accessing MERRA-2 data for {date_diff} days, {len(variables)} variables...")
    
    try:
        ds = _open_dataset(urls)
        print(f"✅ Successfully opened dataset with {len(urls)} files")
    except Exception as e:
        raise RuntimeError(f"Failed opening OPeNDAP dataset: {e}")

    # Harmonize coordinate names (MERRA-2 uses lat/lon)
    coord_lon = "lon" if "lon" in ds.coords else ("longitude" if "longitude" in ds.coords else None)
    coord_lat = "lat" if "lat" in ds.coords else ("latitude" if "latitude" in ds.coords else None)
    if coord_lon is None or coord_lat is None:
        raise RuntimeError("Dataset missing lat/lon coordinate names.")

    # Only keep requested variables that exist
    vars_present = [v for v in variables if v in ds.variables]
    if not vars_present:
        raise RuntimeError(f"None of the requested variables found in dataset: {variables}")
    
    print(f"📊 Found variables: {vars_present}")

    try:
        # Select point data with nearest neighbor
        ds_subset = ds[vars_present].sel({coord_lon: longitude, coord_lat: latitude}, method="nearest")
        print(f"🎯 Extracted data for point ({latitude:.2f}°N, {longitude:.2f}°E)")
    except Exception as e:
        raise RuntimeError(f"Failed to subset variables/point: {e}")

    # Ensure time-sorted
    if "time" in ds_subset.coords:
        ds_subset = ds_subset.sortby("time")
    
    # Add metadata for frontend
    result = ds_subset.to_dict()
    result['metadata'] = {
        'location': {'lat': latitude, 'lon': longitude},
        'variables': vars_present,
        'date_range': {'start': start_date, 'end': end_date, 'days': date_diff},
        'data_source': 'MERRA-2 M2T1NXSLV.5.12.4',
        'access_method': 'NASA GES DISC OPeNDAP'
    }
    
    return result


def get_stats_data(start_date: str, end_date: str, variable: str, freq: str, stat: str) -> Dict:
    """Compute time-aggregated stats for a single variable over a date range.

    Returns a dictionary (xarray to_dict with data as lists) suitable for JSON.
    """
    urls = _generate_merra2_daily_urls(start_date, end_date)
    try:
        ds = _open_dataset(urls)
    except Exception as e:
        raise RuntimeError(f"Failed opening OPeNDAP dataset: {e}")

    if variable not in ds.variables:
        raise ValueError(f"Variable '{variable}' not found in dataset")

    da = ds[variable]
    if "time" not in da.dims:
        raise RuntimeError("Variable has no 'time' dimension for resampling")

    resampler = da.resample(time=freq)
    if stat == "mean":
        result_da = resampler.mean()
    elif stat == "sum":
        result_da = resampler.sum()
    elif stat == "max":
        result_da = resampler.max()
    elif stat == "min":
        result_da = resampler.min()
    else:
        raise ValueError(f"Unsupported statistic: {stat}")

    # Convert to JSON-serializable dict (lists)
    return result_da.to_dict(data="list")
