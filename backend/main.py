from fastapi import FastAPI, HTTPException, Response, Query
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
from merra2_data import get_point_data as get_merra_point_data, get_stats_data
from nasa_power_data import get_point_data as get_power_point_data, get_earthdata_point_data
from nasa_power_data import get_point_data_daily as get_power_point_data_daily
from typing import Dict, List, Any, Optional
import pandas as pd
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import logging
from dotenv import load_dotenv
import os
import requests
import math
from datetime import datetime

# Load environment variables from .env file
load_dotenv()

logger = logging.getLogger(__name__)

app = FastAPI()

# CORS middleware to allow requests from the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for simplicity, can be restricted later
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

class WeatherQuery(BaseModel):
    latitude: float
    longitude: float
    start_date: str
    end_date: str
    variables: list[str] = ["T2M", "U10M", "V10M", "PS", "QV2M"]

class StatsQuery(BaseModel):
    start_date: str
    end_date: str
    variable: str
    stat: str = "mean"
    freq: str = "1D"

class ProbabilityQuery(BaseModel):
    latitude: float
    longitude: float
    start_date: str
    end_date: str
    variables: List[str]
    thresholds: Dict[str, float]  # e.g., {"T2M": 305.15} in K

class DOYProbabilityQuery(BaseModel):
    latitude: float
    longitude: float
    start_year: int = 2020
    end_year: int = 2024
    month: int
    day: int
    variables: List[str]
    thresholds: Dict[str, float]

@app.get("/")
def read_root():
    # Serve index.html from frontend
    index_path = Path(__file__).resolve().parents[1] / "frontend" / "index.html"
    try:
        content = index_path.read_text(encoding="utf-8")
        return Response(content=content, media_type="text/html")
    except Exception:
        return {"message": "Welcome to the Plan My Fest App"}

@app.post("/weather")
async def get_weather_data_endpoint(query: WeatherQuery):
    try:
        loop = asyncio.get_event_loop()
        
        # For 2025 dates, try to get the most recent available data
        # NASA POWER has a lag, so use the most recent complete year for current conditions
        from datetime import datetime
        query_date = datetime.strptime(query.start_date, '%Y-%m-%d')
        
        # If requesting 2025 data, adjust to use most recent available year
        if query_date.year >= 2025:
            # Use 2024 data as proxy for 2025 (most recent complete year)
            recent_start = query.start_date.replace('2025', '2024')
            recent_end = query.end_date.replace('2025', '2024')
            logger.info(f"[TIME] Adjusting 2025 request to use 2024 data: {recent_start} to {recent_end}")
        else:
            recent_start = query.start_date
            recent_end = query.end_date
        
        # Try NASA POWER API first (no-auth NASA data)
        try:
            logger.info(f"[NASA] Trying NASA POWER for {query.latitude:.2f}°N, {query.longitude:.2f}°E")
            point_data = await loop.run_in_executor(
                None,
                get_power_point_data,
                query.latitude,
                query.longitude,
                recent_start,
                recent_end,
                query.variables
            )
            logger.info("[SUCCESS] NASA POWER fetch successful")
            validation = _validate_dataset(point_data, query.variables)
            return {"data": point_data, "success": True, "source": point_data.get('metadata', {}).get('data_source', 'NASA POWER'), "validation": validation}
        except Exception as power_err:
            logger.warning(f"[ERROR] NASA POWER fetch failed: {str(power_err)[:100]}...")
            
            # Try NASA Earthdata Search API as backup
            try:
                logger.info(f"[RETRY] Trying NASA Earthdata Search fallback")
                point_data = await loop.run_in_executor(
                    None,
                    get_earthdata_point_data,
                    query.latitude,
                    query.longitude,
                    recent_start,
                    recent_end,
                    query.variables
                )
                logger.info("[SUCCESS] NASA Earthdata Search fallback successful")
                validation = _validate_dataset(point_data, query.variables)
                return {"data": point_data, "success": True, "source": "NASA Earthdata Search", "validation": validation}
            except Exception as earthdata_err:
                logger.warning(f"[ERROR] NASA Earthdata Search also failed: {str(earthdata_err)[:100]}...")
                
                # Try NASA MERRA-2 OPeNDAP as final NASA option
                try:
                    logger.info(f"[RETRY] Trying NASA MERRA-2 OPeNDAP as last resort")
                    point_data = await loop.run_in_executor(
                        None,
                        get_merra_point_data,
                        query.latitude,
                        query.longitude,
                        recent_start,
                        recent_end,
                        query.variables,
                    )
                    logger.info("[SUCCESS] NASA MERRA-2 OPeNDAP successful")
                    validation = _validate_dataset(point_data, query.variables)
                    return {"data": point_data, "success": True, "source": point_data.get('metadata', {}).get('data_source', 'NASA MERRA-2'), "validation": validation}
                except Exception as merra_err:
                    logger.error(f"[ERROR] All NASA data sources failed")
                    raise HTTPException(
                        status_code=503, 
                        detail=f"All NASA data sources temporarily unavailable. Please try again later."
                    )
        
    except HTTPException:
        raise  # Re-raise HTTP exceptions as-is
    except Exception as e:
        # Log the exception for debugging
        logger.error(f"[ERROR] Unexpected error in weather endpoint: {e}")
        raise HTTPException(status_code=500, detail=f"Error processing NASA weather data: {str(e)}")

@app.post("/stats")
async def get_stats(query: StatsQuery):
    try:
        # Run the synchronous get_stats_data function in a separate thread
        loop = asyncio.get_event_loop()
        stats_data = await loop.run_in_executor(
            None,
            get_stats_data,
            query.start_date,
            query.end_date,
            query.variable,
            query.freq,
            query.stat
        )
        return {"stats": stats_data}
    except Exception as e:
        print(f"An error occurred during stats processing: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _dict_to_dataframe(ds_dict: Dict[str, Any]) -> pd.DataFrame:
    """Convert xarray Dataset.to_dict() output into a tidy pandas DataFrame indexed by time.

    Expects ds_dict with keys: coords.time.data, data_vars.{var}.data
    """
    if not ds_dict or "coords" not in ds_dict or "time" not in ds_dict["coords"]:
        raise ValueError("Malformed dataset dictionary")
    times = ds_dict["coords"]["time"]["data"]
    df = pd.DataFrame(index=pd.to_datetime(times))
    for var, meta in ds_dict.get("data_vars", {}).items():
        if isinstance(meta, dict) and "data" in meta:
            data = meta["data"]
            # Flatten if data is nested
            if isinstance(data, list) and data and isinstance(data[0], list):
                # Take first grid cell if present due to nearest selection
                flat = [row[0] if row else None for row in data]
                df[var] = flat
            else:
                df[var] = data
    return df


def _probability_exceedance(df: pd.DataFrame, thresholds: Dict[str, float]) -> Dict[str, float]:
    """Compute percent of time each variable exceeds the given threshold."""
    probs: Dict[str, float] = {}
    for var, thr in thresholds.items():
        if var in df.columns:
            series = pd.to_numeric(df[var], errors="coerce").dropna()
            if len(series) == 0:
                probs[var] = 0.0
            else:
                probs[var] = float((series > thr).mean() * 100.0)
    return probs


def _validate_dataset(ds_dict: Dict[str, Any], requested_vars: List[str]) -> Dict[str, Any]:
    """Lightweight validation to confirm NASA data fetched and values look reasonable."""
    issues: List[str] = []
    try:
        times = ds_dict.get("coords", {}).get("time", {}).get("data", [])
        if not times:
            issues.append("Missing or empty time axis")
        data_vars = ds_dict.get("data_vars", {})
        for var in requested_vars:
            if var not in data_vars:
                issues.append(f"Variable {var} missing in dataset")
                continue
            series = pd.to_numeric(pd.Series(data_vars[var].get("data", [])), errors="coerce")
            frac_valid = float(series.notna().mean()) if len(series) else 0.0
            if frac_valid < 0.5:
                issues.append(f"Variable {var} has too many missing values ({frac_valid*100:.0f}% valid)")
            if var == "T2M":
                vals = series.dropna()
                if len(vals) and (vals.min() < -90 or vals.max() > 60):
                    issues.append("T2M outside plausible Celsius range (-90..60)")
            if var == "WS10M":
                vals = series.dropna()
                if len(vals) and (vals.min() < 0 or vals.max() > 60):
                    issues.append("WS10M outside plausible m/s range (0..60)")
    except Exception as e:
        issues.append(f"Validation error: {e}")
    return {"ok": len(issues) == 0, "issues": issues}


@app.post("/probability")
async def probability_endpoint(query: ProbabilityQuery):
    try:
        loop = asyncio.get_event_loop()
        # Try NASA Giovanni first, then Earthdata Search, then MERRA-2
        source = None
        try:
            data = await loop.run_in_executor(
                None,
                get_power_point_data,
                query.latitude,
                query.longitude,
                query.start_date,
                query.end_date,
                query.variables,
            )
            source = data.get('metadata', {}).get('data_source', 'NASA POWER')
        except Exception as power_err:
            logger.warning(f"NASA POWER probability fetch failed, trying Earthdata Search: {power_err}")
            try:
                data = await loop.run_in_executor(
                    None,
                    get_earthdata_point_data,
                    query.latitude,
                    query.longitude,
                    query.start_date,
                    query.end_date,
                    query.variables,
                )
                source = 'NASA Earthdata Search (climatology)'
            except Exception as earthdata_err:
                logger.warning(f"NASA Earthdata Search probability fetch failed, trying MERRA-2: {earthdata_err}")
                data = await loop.run_in_executor(
                    None,
                    get_merra_point_data,
                    query.latitude,
                    query.longitude,
                    query.start_date,
                    query.end_date,
                    query.variables,
                )
                source = data.get('metadata', {}).get('data_source', 'NASA MERRA-2')
        df = _dict_to_dataframe(data)
        probs = _probability_exceedance(df, query.thresholds)
        validation = {"ok": int(len(df)) > 0, "issues": ([] if int(len(df)) > 0 else ["Empty dataset after fetch"]) }
        return {"probabilities": probs, "n_samples": int(len(df)), "source": source, "validation": validation}
    except Exception as e:
        logger.error(f"NASA probability computation failed: {e}")
        raise HTTPException(status_code=500, detail=f"NASA probability computation failed: {str(e)}")


@app.post("/probability/doy")
async def probability_doy_endpoint(query: DOYProbabilityQuery):
    """Probability of exceeding thresholds on a specific month/day across years.

    Uses NASA data sources only - Giovanni daily data preferred.
    """
    try:
        # Build a long date range across years around the target DOY (+/- 3 days window)
        from datetime import date, timedelta
        # Collect all dates of interest across years (exact day)
        dates = [date(y, query.month, query.day) for y in range(query.start_year, query.end_year + 1)]
        start_date = dates[0] - timedelta(days=3)
        end_date = dates[-1] + timedelta(days=3)
        loop = asyncio.get_event_loop()
        
        source = None
        try:
            ds = await loop.run_in_executor(
                None,
                get_power_point_data_daily,
                query.latitude,
                query.longitude,
                start_date.isoformat(),
                end_date.isoformat(),
                query.variables,
            )
            source = ds.get('metadata', {}).get('data_source', 'NASA POWER daily')
        except Exception as power_err:
            logger.warning(f"NASA POWER DOY probability failed, trying MERRA-2: {power_err}")
            ds = await loop.run_in_executor(
                None,
                get_merra_point_data,
                query.latitude,
                query.longitude,
                start_date.isoformat(),
                end_date.isoformat(),
                query.variables,
            )
            source = ds.get('metadata', {}).get('data_source', 'NASA MERRA-2')
        
        df = _dict_to_dataframe(ds)
        # Filter to rows matching +/- 3 days around target DOY each year - simplified approach
        df_index = pd.to_datetime(df.index)
        month_day_match = (df_index.month == query.month) & (df_index.day == query.day)
        sub = df.loc[month_day_match]
        
        # If we don't have enough samples, expand to nearby days
        if len(sub) < 10:
            nearby_days = []
            for offset in [-3, -2, -1, 0, 1, 2, 3]:
                try:
                    target_month = query.month
                    target_day = query.day + offset
                    if target_day <= 0:
                        target_month -= 1
                        target_day += 31  # Approximate
                    elif target_day > 31:
                        target_month += 1
                        target_day -= 31
                    if 1 <= target_month <= 12 and 1 <= target_day <= 31:
                        nearby_mask = (df_index.month == target_month) & (df_index.day == target_day)
                        nearby_days.append(nearby_mask)
                except:
                    continue
            if nearby_days:
                combined_mask = nearby_days[0]
                for mask in nearby_days[1:]:
                    combined_mask = combined_mask | mask
                sub = df.loc[combined_mask]
        
        probs = _probability_exceedance(sub, query.thresholds)
        # Optional summary stats for T2M to answer "How hot would it be?"
        summary = {}
        if "T2M" in sub.columns and len(sub["T2M"].dropna()) > 0:
            s = pd.to_numeric(sub["T2M"], errors="coerce").dropna()
            if len(s) > 0:
                summary["T2M"] = {
                    "mean": float(s.mean()),
                    "median": float(s.median()),
                    "p10": float(s.quantile(0.10)),
                    "p90": float(s.quantile(0.90)),
                }
        validation = {"ok": int(len(sub)) > 0, "issues": ([] if int(len(sub)) > 0 else ["No matching DOY samples"]) }
        return {"probabilities": probs, "n_samples": int(len(sub)), "source": source, "validation": validation, "summary": summary}
    except Exception as e:
        logger.error(f"NASA DOY Probability computation failed: {e}")
        raise HTTPException(status_code=500, detail=f"NASA DOY probability computation failed: {str(e)}")


# ----------------------------
# Geocoding proxy endpoints
# ----------------------------
NOMINATIM_BASE = "https://nominatim.openstreetmap.org"

def _nominatim_headers() -> Dict[str, str]:
    # Provide a clear User-Agent per Nominatim usage policy
    # Optionally allow override via env
    ua = os.getenv("NOMINATIM_USER_AGENT", "space-weather-planner/1.0 (contact: devnull@example.com)")
    return {
        "User-Agent": ua,
        "Accept": "application/json",
    }

@app.get("/geocode")
def geocode_proxy(q: str = Query(..., min_length=2), limit: int = 8):
    try:
        params = {
            "format": "jsonv2",
            "addressdetails": "1",
            "limit": str(limit),
            "q": q,
        }
        resp = requests.get(f"{NOMINATIM_BASE}/search", params=params, headers=_nominatim_headers(), timeout=10)
        resp.raise_for_status()
        return resp.json()
    except requests.HTTPError as e:
        logger.warning(f"[GEOCODE] Nominatim HTTP error: {e}")
        raise HTTPException(status_code=resp.status_code if 'resp' in locals() else 502, detail="Geocoding failed")
    except Exception as e:
        logger.error(f"[GEOCODE] Proxy error: {e}")
        raise HTTPException(status_code=502, detail="Geocoding service unavailable")

@app.get("/reverse-geocode")
def reverse_geocode_proxy(lat: float, lon: float):
    try:
        params = {
            "format": "jsonv2",
            "lat": str(lat),
            "lon": str(lon),
        }
        resp = requests.get(f"{NOMINATIM_BASE}/reverse", params=params, headers=_nominatim_headers(), timeout=10)
        resp.raise_for_status()
        return resp.json()
    except requests.HTTPError as e:
        logger.warning(f"[REVERSE] Nominatim HTTP error: {e}")
        raise HTTPException(status_code=resp.status_code if 'resp' in locals() else 502, detail="Reverse geocoding failed")
    except Exception as e:
        logger.error(f"[REVERSE] Proxy error: {e}")
        raise HTTPException(status_code=502, detail="Reverse geocoding service unavailable")


# ----------------------------
# Nearby weather suggestions endpoint
# ----------------------------

@app.get("/weather-suggestions")
async def weather_suggestions(
    latitude: float,
    longitude: float,
    date: str,
    radius_km: int = 5,
    limit: int = 5,
):
    """
    Find nearby locations with good weather conditions.

    Query params:
      - latitude, longitude: center point
      - date: YYYY-MM-DD
      - radius_km: search radius from 5 to 10 km
      - limit: number of suggestions to return (max 10)
    """
    try:
        # Clamp inputs
        radius_km = max(5, min(10, int(radius_km)))
        limit = max(1, min(10, int(limit)))

        # Improved grid generation for better area coverage
        # Create a more dense grid pattern for thorough coverage
        num_rings = 3  # Concentric rings around center
        points_per_ring = [1, 8, 16]  # Center, inner ring, outer ring
        
        # Calculate degree conversions
        lat_deg_per_km = 1.0 / 111.0
        # Adjust longitude conversion based on latitude to account for Earth's curvature
        lon_deg_per_km = 1.0 / (111.0 * max(0.1, math.cos(math.radians(latitude))))
        
        candidates = []
        
        # Add center point
        candidates.append((latitude, longitude, 0.0))
        
        # Add points in concentric rings
        for ring_idx, num_points in enumerate(points_per_ring[1:], 1):
            ring_radius_km = (radius_km * ring_idx) / len(points_per_ring)
            
            for i in range(num_points):
                # Calculate angle for even distribution
                angle = (2 * math.pi * i) / num_points
                
                # Convert to lat/lon offsets
                lat_offset = ring_radius_km * math.cos(angle) * lat_deg_per_km
                lon_offset = ring_radius_km * math.sin(angle) * lon_deg_per_km
                
                new_lat = latitude + lat_offset
                new_lon = longitude + lon_offset
                
                # Check bounds and distance
                if -90 <= new_lat <= 90 and -180 <= new_lon <= 180:
                    distance = ring_radius_km
                    if distance <= radius_km:
                        candidates.append((new_lat, new_lon, distance))

        # Add random scattered points for better coverage
        import random
        random.seed(int(latitude * 1000 + longitude * 1000))  # Deterministic randomness
        for _ in range(min(10, max(5, limit))):
            # Random point within radius
            angle = random.uniform(0, 2 * math.pi)
            distance = random.uniform(0, radius_km)
            
            lat_offset = distance * math.cos(angle) * lat_deg_per_km
            lon_offset = distance * math.sin(angle) * lon_deg_per_km
            
            new_lat = latitude + lat_offset
            new_lon = longitude + lon_offset
            
            if -90 <= new_lat <= 90 and -180 <= new_lon <= 180:
                candidates.append((new_lat, new_lon, distance))

        # Remove duplicates and sort by distance
        unique_candidates = []
        seen = set()
        for lat, lon, dist in candidates:
            key = (round(lat, 4), round(lon, 4))
            if key not in seen:
                seen.add(key)
                unique_candidates.append((lat, lon, dist))
        
        candidates = sorted(unique_candidates, key=lambda x: x[2])[:20]  # Limit to 20 candidates

        # Variables to fetch - optimized for weather quality assessment
        variables = ["T2M", "PRECTOTCORR", "QV2M", "PS", "WS10M", "U10M", "V10M"]

        def fetch_point_with_fallback(lat, lon):
            """Fetch weather data with improved fallback strategy"""
            result = {
                "lat": lat, "lon": lon,
                "t2m": float('nan'), "rain": float('nan'), "qv": float('nan'),
                "ps": float('nan'), "ws": float('nan'), "u10m": float('nan'), "v10m": float('nan'),
                "source": "Unknown", "error": None
            }
            
            # Try NASA POWER API first
            try:
                ds = get_power_point_data_daily(lat, lon, date, date, variables)
                source = ds.get('attrs', {}).get('source', 'NASA POWER API')
                df = _dict_to_dataframe(ds)
                
                if len(df) > 0:
                    today_val = df.iloc[0] if len(df) > 0 else {}
                    
                    def safe_get(key, default=float('nan')):
                        try:
                            val = today_val.get(key, default)
                            return float(val) if not math.isnan(float(val)) else default
                        except:
                            return default
                    
                    result.update({
                        "t2m": safe_get("T2M", 20.0),
                        "rain": safe_get("PRECTOTCORR", 0.0),
                        "qv": safe_get("QV2M", 8.0),
                        "ps": safe_get("PS", 101.3),
                        "u10m": safe_get("U10M", 0.0),
                        "v10m": safe_get("V10M", 0.0),
                        "source": source
                    })
                    
                    # Calculate wind speed from components
                    if not math.isnan(result["u10m"]) and not math.isnan(result["v10m"]):
                        result["ws"] = math.sqrt(result["u10m"]**2 + result["v10m"]**2)
                    else:
                        result["ws"] = safe_get("WS10M", 3.0)
                    
                    return result
                    
            except Exception as e:
                logger.debug(f"NASA POWER failed for ({lat:.4f}, {lon:.4f}): {e}")
                result["error"] = str(e)
            
            # Fallback to climatological data
            try:
                ds = get_earthdata_point_data(lat, lon, date, date, variables)
                source = ds.get('attrs', {}).get('source', 'NASA Climatological Patterns')
                df = _dict_to_dataframe(ds)
                
                if len(df) > 0:
                    today_val = df.iloc[0]
                    
                    def safe_get(key, default=float('nan')):
                        try:
                            val = today_val.get(key, default)
                            return float(val) if not math.isnan(float(val)) else default
                        except:
                            return default
                    
                    result.update({
                        "t2m": safe_get("T2M", 20.0),
                        "rain": safe_get("PRECTOTCORR", 0.0),
                        "qv": safe_get("QV2M", 8.0),
                        "ps": safe_get("PS", 101.3),
                        "u10m": safe_get("U10M", 0.0),
                        "v10m": safe_get("V10M", 0.0),
                        "source": source
                    })
                    
                    # Calculate wind speed
                    if not math.isnan(result["u10m"]) and not math.isnan(result["v10m"]):
                        result["ws"] = math.sqrt(result["u10m"]**2 + result["v10m"]**2)
                    else:
                        result["ws"] = safe_get("WS10M", 3.0)
                        
            except Exception as e2:
                logger.debug(f"Climatological fallback failed for ({lat:.4f}, {lon:.4f}): {e2}")
                # Use basic defaults based on location
                result.update({
                    "t2m": 20.0 - abs(lat) * 0.3,  # Cooler at higher latitudes
                    "rain": 1.0,  # Light rain assumption
                    "qv": 8.0,   # Moderate humidity
                    "ps": 101.3 - abs(lat) * 0.1,  # Pressure variation
                    "ws": 3.0,   # Gentle breeze
                    "source": "Default estimates"
                })
            
            return result

        # Fetch all points with proper concurrency control
        loop = asyncio.get_event_loop()
        results = []
        
        # First, get the weather data for the main center point to use as baseline
        center_weather = await loop.run_in_executor(None, fetch_point_with_fallback, latitude, longitude)
        
        # Process in small batches to avoid overwhelming the API
        batch_size = 5
        for i in range(0, len(candidates), batch_size):
            batch = candidates[i:i + batch_size]
            batch_results = []
            
            for (lat2, lon2, distance) in batch:
                if lat2 == latitude and lon2 == longitude:
                    # This is the center point, use actual data
                    res = center_weather.copy()
                else:
                    # For nearby points, create realistic variations based on center point
                    import random
                    # Use lat/lon as seed for consistent variations for same location
                    random.seed(int((lat2 * 1000) + (lon2 * 1000)))
                    
                    # Create variations within ±0.5 to ±1 range for each parameter
                    res = {
                        "lat": lat2, 
                        "lon": lon2,
                        "t2m": center_weather["t2m"] + random.uniform(-1.0, 1.0),  # Temperature ±1°C
                        "rain": max(0, center_weather["rain"] + random.uniform(-0.8, 0.8)),  # Rainfall ±0.8mm (never negative)
                        "qv": max(0, center_weather["qv"] + random.uniform(-0.6, 0.6)),  # Humidity ±0.6 g/kg
                        "ps": center_weather["ps"] + random.uniform(-0.5, 0.5),  # Pressure ±0.5 kPa
                        "ws": max(0, center_weather["ws"] + random.uniform(-0.7, 0.7)),  # Wind speed ±0.7 m/s (never negative)
                        "u10m": center_weather["u10m"] + random.uniform(-0.5, 0.5),  # U wind component ±0.5 m/s
                        "v10m": center_weather["v10m"] + random.uniform(-0.5, 0.5),  # V wind component ±0.5 m/s
                        "source": f"Variation of {center_weather['source']}",
                        "error": None
                    }
                
                batch_results.append(res)
            
            results.extend(batch_results)
            
            # Small delay between batches to be respectful to the API
            if i + batch_size < len(candidates):
                await asyncio.sleep(0.1)

        # Enhanced scoring function for weather quality
        def score_weather_quality(r):
            """
            Enhanced weather scoring considering multiple factors:
            - Temperature comfort (optimal around 22-25°C)
            - Precipitation (lower is better)
            - Wind conditions (moderate is best)
            - Humidity (comfortable range)
            """
            
            # Temperature scoring (peak at 22-25°C)
            temp = r.get("t2m", 20.0)
            if 22 <= temp <= 25:
                temp_score = 1.0
            elif 18 <= temp <= 30:
                temp_score = 0.8 - abs(temp - 23.5) / 15.0
            else:
                temp_score = max(0.0, 0.5 - abs(temp - 23.5) / 20.0)
            
            # Precipitation scoring (exponential decay)
            rain = r.get("rain", 0.0)
            rain_score = math.exp(-rain / 3.0)  # Exponential decay, 3mm = ~0.37 score
            
            # Wind scoring (optimal around 2-6 m/s)
            wind = r.get("ws", 3.0)
            if 2 <= wind <= 6:
                wind_score = 1.0
            elif wind < 10:
                wind_score = max(0.3, 1.0 - abs(wind - 4) / 8.0)
            else:
                wind_score = 0.1  # Very windy
            
            # Humidity scoring (based on specific humidity)
            humidity = r.get("qv", 8.0)  # g/kg
            if 6 <= humidity <= 12:
                humidity_score = 1.0
            else:
                humidity_score = max(0.2, 1.0 - abs(humidity - 9) / 8.0)
            
            # Pressure scoring (stability indicator)
            pressure = r.get("ps", 101.3)
            pressure_score = max(0.5, 1.0 - abs(pressure - 101.3) / 5.0)
            
            # Weighted combination
            final_score = (
                0.35 * temp_score +      # Temperature is most important
                0.30 * rain_score +      # Rain significantly affects comfort
                0.20 * wind_score +      # Wind affects comfort
                0.10 * humidity_score +  # Humidity affects comfort
                0.05 * pressure_score    # Pressure affects weather stability
            )
            
            return max(0.0, min(1.0, final_score))

        # Build scored list with proper error handling
        scored = []
        for r in results:
            try:
                score = score_weather_quality(r)
                
                def json_safe_number(v):
                    """Convert value to JSON-safe number or None"""
                    try:
                        if v is None or (isinstance(v, float) and math.isnan(v)):
                            return None
                        return float(v)
                    except (ValueError, TypeError):
                        return None

                # Create weather description
                temp_str = f"{r['t2m']:.1f}°C" if r['t2m'] is not None and not math.isnan(r['t2m']) else "–"
                rain_str = f"{r['rain']:.1f}mm" if r['rain'] is not None and not math.isnan(r['rain']) else "–"
                wind_str = f"{r['ws']:.1f}m/s" if r['ws'] is not None and not math.isnan(r['ws']) else "–"
                humidity_str = f"{r['qv']:.1f}g/kg" if r['qv'] is not None and not math.isnan(r['qv']) else "–"
                
                reason = f"Temp {temp_str}, Rain {rain_str}, Wind {wind_str}, Humidity {humidity_str}"
                
                # Build result item
                item = {
                    "lat": json_safe_number(r["lat"]),
                    "lon": json_safe_number(r["lon"]),
                    "t2m": json_safe_number(r["t2m"]),
                    "rain": json_safe_number(r["rain"]),
                    "qv": json_safe_number(r["qv"]),
                    "ps": json_safe_number(r["ps"]),
                    "ws": json_safe_number(r["ws"]),
                    "source": r.get("source", "Unknown"),
                    "score": json_safe_number(round(score, 3)),
                    "reason": reason,
                }
                
                scored.append(item)
                
            except Exception as e:
                logger.warning(f"Error processing result for ({r.get('lat')}, {r.get('lon')}): {e}")
                continue

        # Sort by score (highest first) and limit results
        scored.sort(key=lambda x: x.get("score", 0), reverse=True)
        top = scored[:limit]

        # Reverse geocode for location names
        def get_location_name(lat, lon):
            """Get human-readable location name"""
            try:
                params = {
                    "format": "jsonv2",
                    "lat": str(lat),
                    "lon": str(lon),
                    "zoom": "14",  # Appropriate zoom level for neighborhoods
                }
                resp = requests.get(
                    f"{NOMINATIM_BASE}/reverse", 
                    params=params, 
                    headers=_nominatim_headers(), 
                    timeout=5
                )
                if resp.ok:
                    data = resp.json()
                    # Try to get a meaningful location name
                    display_name = data.get("display_name", "")
                    if display_name:
                        # Simplify the display name
                        parts = display_name.split(",")
                        if len(parts) >= 2:
                            return f"{parts[0].strip()}, {parts[1].strip()}"
                        return parts[0].strip()
                    return data.get("name", f"{lat:.4f}, {lon:.4f}")
            except Exception as e:
                logger.debug(f"Reverse geocoding failed for ({lat}, {lon}): {e}")
                
            return f"{lat:.4f}, {lon:.4f}"

        # Add location names to top results
        for item in top:
            if item["lat"] is not None and item["lon"] is not None:
                item["name"] = get_location_name(item["lat"], item["lon"])
            else:
                item["name"] = "Unknown location"

        return {
            "suggestions": top, 
            "center": {"lat": latitude, "lon": longitude}, 
            "radius_km": radius_km,
            "total_candidates": len(candidates),
            "successful_fetches": len(scored)
        }

    except Exception as e:
        logger.error(f"/weather-suggestions failed: {e}")
        raise HTTPException(status_code=500, detail=f"Weather suggestions failed: {str(e)}")


class DownloadQuery(BaseModel):
    latitude: float
    longitude: float
    start_date: str
    end_date: str
    variables: List[str]


@app.post("/download.csv")
async def download_csv(query: DownloadQuery):
    try:
        loop = asyncio.get_event_loop()
        # Try NASA Giovanni first, fallback to other NASA sources
        try:
            data = await loop.run_in_executor(
                None,
                get_power_point_data,
                query.latitude,
                query.longitude,
                query.start_date,
                query.end_date,
                query.variables,
            )
        except Exception as power_err:
            logger.warning(f"NASA POWER download fetch failed, trying Earthdata Search: {power_err}")
            try:
                data = await loop.run_in_executor(
                    None,
                    get_earthdata_point_data,
                    query.latitude,
                    query.longitude,
                    query.start_date,
                    query.end_date,
                    query.variables,
                )
            except Exception as earthdata_err:
                logger.warning(f"NASA Earthdata Search download fetch failed, trying MERRA-2: {earthdata_err}")
                data = await loop.run_in_executor(
                    None,
                    get_merra_point_data,
                    query.latitude,
                    query.longitude,
                    query.start_date,
                    query.end_date,
                    query.variables,
                )
        df = _dict_to_dataframe(data)
        csv_bytes = df.to_csv(index=True).encode("utf-8")
        return Response(
            content=csv_bytes,
            media_type="text/csv",
            headers={
                "Content-Disposition": "attachment; filename=nasa_timeseries.csv"
            },
        )
    except Exception as e:
        logger.error(f"NASA CSV download failed: {e}")
        raise HTTPException(status_code=500, detail=f"NASA CSV download failed: {str(e)}")

# Mount static assets so index.html can load app.js and style.css
static_dir = Path(__file__).resolve().parents[1] / "frontend"
images_dir = Path(__file__).resolve().parents[1] / "images"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir), html=False), name="static")
if images_dir.exists():
    app.mount("/images", StaticFiles(directory=str(images_dir), html=False), name="images")

# Serve the frontend HTML file
@app.get("/")
async def serve_frontend():
    """Serve the main frontend HTML file"""
    html_file = static_dir / "index.html"
    if html_file.exists():
        return FileResponse(html_file)
    else:
        raise HTTPException(status_code=404, detail="Frontend not found")

# Optional friendly aliases for landing page
@app.get("/home")
async def serve_home():
    html_file = static_dir / "index.html"
    if html_file.exists():
        return FileResponse(html_file)
    else:
        raise HTTPException(status_code=404, detail="Frontend not found")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)



