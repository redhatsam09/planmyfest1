Plan My Fest

> A event planning companion that helps you pick the best spot and date with live weather data, nearby suggestions, and a calm glass UI.


— Keep momentum while you plan: the app responds to your clicks and searches with an elegant flow, quick analysis, and gentle UI cues.

## Youtube


### [Youtube video](https://youtu.be/FDCffY7zKM0)

<br>
<img width="1920" height="1080" alt="Screenshot 2025-10-05 093718" src="https://github.com/user-attachments/assets/867d542f-2dde-4a17-b102-92785e5e3d3f" />
<br>
<br>
<br>
<img width="1920" height="1080" alt="Screenshot 2025-10-05 093750" src="https://github.com/user-attachments/assets/134bd586-e3a2-4cb8-a7e1-6fe8483c3a8f" />

<br>
<br>

> Space Dev — NASA Space Apps 2025

## Website

- Development: http://localhost:8000/

## Features

- Search and pin any location on the world map
- Pick an event date (up to 6 months ahead) and Analyze in one click
- Results panel with an at-a-glance condition summary and key metrics
- History panel: Past 7 days breakdown for context at your chosen spot
- Nearby Spots: find better micro‑locations in a 5–10 km radius, ranked by weather comfort
- CSV export: download current, historical, and probability summaries in one file
- Smooth onboarding: built‑in tutorial overlay that highlights the main controls
- Modern “glass” styling with subtle motion and responsive layout

## How It Works

1. Frontend (Leaflet + vanilla JS)
   - An interactive map with search, draggable marker, and polished panels (see `frontend/`).
   - A guided tutorial overlay introduces location search, date selection, Analyze, and results.
2. Backend (FastAPI)
   - POST `/weather`: fetches daily time series for NASA variables (POWER first; falls back to climatology or MERRA‑2).
   - POST `/probability/doy`: estimates the chance of exceeding thresholds (e.g., hot, windy, heavy rain) around your selected month/day based on historical observations.
   - GET `/weather-suggestions`: samples nearby coordinates and scores them for comfort (temperature, rain, wind, humidity, pressure), then reverse‑geocodes names.
   - GET `/geocode` and `/reverse-geocode`: proxy to Nominatim with proper headers.
   - POST `/download.csv`: returns a consolidated CSV export of your session data.
3. NASA variables in use
   - T2M (2‑m temperature, °C), U10M/V10M (10‑m wind components, m/s), WS10M (wind speed, m/s), PS (surface pressure), QV2M (specific humidity, g/kg), PRECTOTCORR (precipitation, mm/day), RH2M (relative humidity, % when available).

## Running Locally

### Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Start the server:
   ```bash
   cd /workspaces/planmyfest1/backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```

   Server will run at: http://0.0.0.0:8000

## Usage

1. Open the website and switch to the App.
2. Search for a place or click on the map to drop a pin, then pick your event date.
3. Click Analyze to see a prediction summary and metrics for your selected day.
4. Explore the History tab for the past 7 days and the Nearby Spots tab for higher‑scoring locations.
5. Download CSV for current, historical, and probability data to share with your team.

## Acknowledgements

- AI assistance: parts of this project were created with help from tools, including Google Gemini and GitHub Copilot (for code and asset creation).
- Datasets and services:
  - NASA POWER (Prediction of Worldwide Energy Resources)
  - NASA MERRA‑2 (GES DISC OPeNDAP) for reanalysis fallback and validation
  - OpenStreetMap Nominatim for geocoding and reverse geocoding
  - OpenStreetMap tiles for base map rendering


Create with Plan My Fest! 🌤️
