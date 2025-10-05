document.addEventListener('DOMContentLoaded', () => {
  // Expose map invalidate helper for site-level view switch
  window.appInvalidateMap = function(){ try { if (window.__leafletMapInstance) { window.__leafletMapInstance.invalidateSize(false); } } catch(e) {} };
  // Analysis state tracking
  let hasAnalyzed = false;

  // Store weather data for CSV export
  let currentWeatherData = null;
  let currentHistoryData = null;
  let currentPredictionData = null;
  let currentLocationInfo = null;

  // Tutorial System
  const tutorialSteps = [
    {
      title: "Welcome to Plan My Fest",
      description: "Let's take a quick tour to help you get started with analyzing weather data for your events.",
      highlight: null,
      action: null
    },
    {
      title: "Step 1: Choose Your Location",
      description: "Search for a place in the search bar above, or click anywhere on the map to drop a pin at your desired location.",
      highlight: ".search-container",
      action: "highlightSearch"
    },
    {
      title: "Step 2: Select Event Date",
      description: "Pick the date when your event is planned. You can select any date up to 6 months in the future.",
      highlight: ".controls-panel",
      action: "highlightDate"
    },
    {
      title: "Step 3: Analyze Weather",
      description: "Click the Analyze button to get detailed weather predictions and analysis for your selected location and date.",
      highlight: "#get-weather-btn",
      action: "highlightAnalyze"
    },
    {
      title: "Step 4: View Results",
      description: "Check the results panel on the right for weather conditions, and the history panel on the left for past 7 days data to help you plan better.",
      highlight: ".results-panel, #history-sidebar",
      action: "highlightResults"
    },
    {
      title: "You're All Set!",
      description: "You now know how to use Plan My Fest! Click anywhere on the map to get started, or close this tutorial.",
      highlight: null,
      action: null
    }
  ];

  let currentTutorialStep = 0;
  let tutorialActive = false;

  // Tutorial Elements
  const tutorialOverlay = document.getElementById('tutorial-overlay');
  const tutorialTitle = document.getElementById('tutorial-title');
  const tutorialDescription = document.getElementById('tutorial-description');
  const tutorialStepCurrent = document.getElementById('tutorial-step-current');
  const tutorialStepTotal = document.getElementById('tutorial-step-total');
  const tutorialPrevBtn = document.getElementById('tutorial-prev');
  const tutorialNextBtn = document.getElementById('tutorial-next');
  const tutorialSkipBtn = document.getElementById('tutorial-skip');
  const tutorialCloseBtn = document.getElementById('tutorial-close');
  const tutorialHighlight = document.getElementById('tutorial-highlight');

  // Check if tutorial elements exist
  if (!tutorialOverlay) {
    console.error('Tutorial overlay element not found');
    return;
  }

  console.log('Tutorial elements loaded successfully'); // Debug log

  // Tutorial Functions
  function startTutorial() {
    // Temporarily disable localStorage check for development/testing
    // if (localStorage.getItem('planMyFestTutorialCompleted') === 'true') {
    //   return; // Don't show tutorial if already completed
    // }
    
    tutorialActive = true;
    currentTutorialStep = 0;
    updateTutorialStep();
    tutorialOverlay.classList.remove('hidden');
    console.log('Tutorial started'); // Debug log
  }

  function updateTutorialStep() {
    const step = tutorialSteps[currentTutorialStep];
    tutorialTitle.textContent = step.title;
    tutorialDescription.textContent = step.description;
    tutorialStepCurrent.textContent = currentTutorialStep + 1;
    tutorialStepTotal.textContent = tutorialSteps.length;
    
    // Update button states
    tutorialPrevBtn.disabled = currentTutorialStep === 0;
    tutorialNextBtn.textContent = currentTutorialStep === tutorialSteps.length - 1 ? 'Finish' : 'Next';
    
    // Handle highlighting
    if (step.highlight) {
      highlightElement(step.highlight);
    } else {
      hideHighlight();
    }
  }

  function highlightElement(selector) {
    const elements = document.querySelectorAll(selector);
    if (elements.length === 0) {
      console.warn(`Tutorial highlight: No elements found for selector "${selector}"`);
      return;
    }
    
    // Calculate bounding box for multiple elements
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    elements.forEach(el => {
      const rect = el.getBoundingClientRect();
      minX = Math.min(minX, rect.left);
      minY = Math.min(minY, rect.top);
      maxX = Math.max(maxX, rect.right);
      maxY = Math.max(maxY, rect.bottom);
    });
    
    const width = maxX - minX;
    const height = maxY - minY;
    const padding = 12; // Increased padding for better visual alignment
    
    tutorialHighlight.style.left = `${minX - padding}px`;
    tutorialHighlight.style.top = `${minY - padding}px`;
    tutorialHighlight.style.width = `${width + (padding * 2)}px`;
    tutorialHighlight.style.height = `${height + (padding * 2)}px`;
    tutorialHighlight.classList.add('active');
    
    console.log(`Highlighting element: ${selector}, bounds: ${minX},${minY} ${width}x${height}`);
  }

  function hideHighlight() {
    tutorialHighlight.classList.remove('active');
  }

  function nextTutorialStep() {
    if (currentTutorialStep < tutorialSteps.length - 1) {
      currentTutorialStep++;
      updateTutorialStep();
    } else {
      completeTutorial();
    }
  }

  function prevTutorialStep() {
    if (currentTutorialStep > 0) {
      currentTutorialStep--;
      updateTutorialStep();
    }
  }

  function completeTutorial() {
    tutorialActive = false;
    localStorage.setItem('planMyFestTutorialCompleted', 'true');
    tutorialOverlay.classList.add('hidden');
    hideHighlight();
  }

  function skipTutorial() {
    completeTutorial();
  }

  // Tutorial Event Listeners
  tutorialNextBtn?.addEventListener('click', nextTutorialStep);
  tutorialPrevBtn?.addEventListener('click', prevTutorialStep);
  tutorialSkipBtn?.addEventListener('click', skipTutorial);
  tutorialCloseBtn?.addEventListener('click', skipTutorial);

  // Tab functionality for sidebar
  function initializeTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    let isTransitioning = false;

    function switchTab(targetTab) {
      if (isTransitioning) return;
      
      isTransitioning = true;
      const activeButton = document.querySelector(`[data-tab="${targetTab}"]`);
      const activeContent = document.getElementById(`${targetTab}-tab`);
      const currentContent = document.querySelector('.tab-content.active');

      if (!activeButton || !activeContent) {
        isTransitioning = false;
        return;
      }

      // Phase 1: Fade out current content
      if (currentContent && currentContent !== activeContent) {
        currentContent.style.transition = 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        currentContent.style.opacity = '0';
        currentContent.style.transform = 'translateY(-10px) scale(0.98)';
        currentContent.style.filter = 'blur(1px)';
        
        setTimeout(() => {
          currentContent.classList.remove('active');
          currentContent.style.display = 'none';
        }, 300);
      }

      // Update button states immediately for responsiveness
      tabButtons.forEach(btn => {
        btn.classList.remove('active');
        btn.style.transform = '';
      });
      activeButton.classList.add('active');

      // Phase 2: Prepare and show new content
      setTimeout(() => {
        activeContent.style.display = 'flex';
        activeContent.style.opacity = '0';
        activeContent.style.transform = 'translateY(20px) scale(0.98)';
        activeContent.style.filter = 'blur(2px)';
        activeContent.classList.add('entering');
        
        // Force reflow
        activeContent.offsetHeight;
        
        // Phase 3: Animate in new content
        requestAnimationFrame(() => {
          activeContent.style.transition = 'all 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
          activeContent.style.opacity = '1';
          activeContent.style.transform = 'translateY(0) scale(1)';
          activeContent.style.filter = 'blur(0)';
          activeContent.classList.add('active');
          
          setTimeout(() => {
            activeContent.classList.remove('entering');
            activeContent.style.transition = '';
            isTransitioning = false;
          }, 600);
        });
      }, currentContent && currentContent !== activeContent ? 200 : 0);
    }

    // Add click event listeners to tab buttons with haptic-like feedback
    tabButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        if (button.classList.contains('active') || isTransitioning) return;
        
        // Add subtle click feedback
        button.style.transform = 'translateY(-1px) scale(0.98)';
        setTimeout(() => {
          button.style.transform = '';
        }, 100);
        
        const targetTab = button.getAttribute('data-tab');
        switchTab(targetTab);
      });

      // Add subtle hover effects
      button.addEventListener('mouseenter', () => {
        if (!button.classList.contains('active') && !isTransitioning) {
          button.style.transform = 'translateY(-2px) scale(1.02)';
        }
      });

      button.addEventListener('mouseleave', () => {
        if (!button.classList.contains('active')) {
          button.style.transform = '';
        }
      });
    });

    // Set default active tab (history) with initial animation
    setTimeout(() => {
      switchTab('history');
    }, 100);
  }

  // Initialize tabs
  initializeTabs();

  // ----------------------------
  // Suggestions Tab UI & Logic
  // ----------------------------
  const suggestionsContainer = document.getElementById('suggestions-container');
  const suggestionsTabBtn = document.querySelector('.tab-btn[data-tab="suggestions"]');

  function renderSuggestionsUI() {
    console.log('renderSuggestionsUI called');
    if (!suggestionsContainer) {
      console.log('suggestionsContainer not found');
      return;
    }
    console.log('Creating suggestions UI');
    const ui = document.createElement('div');
    ui.className = 'suggestions-ui';
    ui.innerHTML = `
      <div class="sugg-controls">
        <div class="radius-slider">
          <label for="radius-input">5 km radius</label>
          <input type="range" id="radius-input" min="5" max="10" value="5" step="1">
        </div>
        <button id="find-spots" class="primary-btn small">Find spots</button>
      </div>
      <ul id="sugg-list" class="sugg-list"></ul>
    `;
    suggestionsContainer.innerHTML = '';
    suggestionsContainer.appendChild(ui);
    console.log('Suggestions UI created');

    // Radius slider update
    const radiusInput = ui.querySelector('#radius-input');
    const radiusLabel = ui.querySelector('label[for="radius-input"]');
    radiusInput.addEventListener('input', () => {
      radiusLabel.textContent = `${radiusInput.value} km radius`;
    });

    const findBtn = ui.querySelector('#find-spots');
    findBtn.addEventListener('click', async () => {
      const radius = radiusInput.value;
      await fetchAndRenderSuggestions(radius);
    });
  }

  async function fetchAndRenderSuggestions(radius = 5) {
    const list = document.getElementById('sugg-list');
    if (!list) return;
    
    // Check if analysis has been done first
    const resultsPanel = document.querySelector('.results-panel');
    if (!resultsPanel || resultsPanel.classList.contains('hidden')) {
      list.innerHTML = `<li class="sugg-empty">Please click "Analyze" first to get weather data.</li>`;
      return;
    }
    
    list.innerHTML = `<li class="sugg-loading">Finding the best nearby spots…</li>`;

    // Resolve current selected location and date
    let centerLat = null, centerLon = null;
    if (marker) {
      const ll = marker.getLatLng();
      centerLat = ll.lat; centerLon = ll.lng;
    }
    if (centerLat == null || centerLon == null) {
      list.innerHTML = `<li class="sugg-empty">Pick a spot on the map first.</li>`;
      return;
    }
    const dateStr = document.getElementById('date-input')?.value || new Date().toISOString().slice(0,10);

    try {
      // Show the search zone circle first
      showSearchZone(centerLat, centerLon, radius);
      
      const url = new URL(`${API_BASE}/weather-suggestions`, window.location.origin);
      url.searchParams.set('latitude', centerLat.toFixed(5));
      url.searchParams.set('longitude', centerLon.toFixed(5));
      url.searchParams.set('date', dateStr);
      url.searchParams.set('radius_km', radius);
      url.searchParams.set('limit', '5');
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = (data && data.suggestions) || [];
      if (!items.length) {
        list.innerHTML = `<li class="sugg-empty">No suggestions found. Try a different radius.</li>`;
        // Still keep the circle visible even with no results
        return;
      }
      list.innerHTML = '';
      
      // Add suggestion markers to the map with staggered animation
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        // Add marker to map
        setTimeout(() => {
          addSuggestionMarker(it.lat, it.lon, it);
        }, i * 200); // Stagger marker appearances
        
        // Add to list UI
        const li = document.createElement('li');
        li.className = 'sugg-item';
        const name = it.name || `${it.lat.toFixed(3)}, ${it.lon.toFixed(3)}`;
        
        // Calculate distance from main location
        const distance = calculateDistance(centerLat, centerLon, it.lat, it.lon);
        const distanceText = distance < 1 ? `${(distance * 1000).toFixed(0)}m` : `${distance.toFixed(1)}km`;
        
        const info = `T ${fmt(it.t2m)}°C · Rain ${fmt(it.rain)}mm · Wind ${fmt(it.ws)}m/s`;
        li.innerHTML = `
          <div class="sugg-row">
            <div class="sugg-title">${name}</div>
            <div class="sugg-distance" title="Distance from main location">${distanceText}</div>
          </div>
          <div class="sugg-sub">${info}</div>
        `;
        li.addEventListener('click', () => {
          // Clear the search zone first
          clearSearchZone();
          placeMarker(it.lat, it.lon, true);
          // ensure history subtitle updates via reverse geocode
          reverseGeocode(it.lat, it.lon);
          // switch to history tab for context
          const historyBtn = document.querySelector('.tab-btn[data-tab="history"]');
          historyBtn?.click();
        });
        list.appendChild(li);
      }
    } catch (e) {
      list.innerHTML = `<li class="sugg-error">Failed to fetch suggestions. ${e.message}</li>`;
      // Clear zone on error
      clearSearchZone();
    }
  }

  function fmt(v) {
    return (v === null || v === undefined || Number.isNaN(v)) ? '–' : Number(v).toFixed(1);
  }

  // Calculate distance between two points in kilometers
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // Render UI immediately and prefetch when Suggestions tab opened
  renderSuggestionsUI();
  suggestionsTabBtn?.addEventListener('click', () => {
    // Re-render UI to ensure it's properly loaded
    setTimeout(() => renderSuggestionsUI(), 100);
  });

  // Add keyboard shortcut to manually trigger tutorial (Ctrl+H)
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'h') {
      e.preventDefault();
      localStorage.removeItem('planMyFestTutorialCompleted');
      startTutorial();
    }
  });

  // Start tutorial immediately for testing, then after delay for normal use
  console.log('Starting tutorial in 2 seconds...');
  
  // Make tutorial functions globally accessible for debugging
  window.showTutorial = () => {
    localStorage.removeItem('planMyFestTutorialCompleted');
    startTutorial();
  };
  
  window.hideTutorial = () => {
    completeTutorial();
  };
  
  setTimeout(() => {
    startTutorial();
  }, 2000);

  // Map init with iOS-style controls
  const map = L.map('map', { zoomControl: false, attributionControl: false }).setView([20, 0], 3);
  // store globally so shell can call invalidateSize after view switch
  window.__leafletMapInstance = map;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(map);
  L.control.zoom({ position: 'bottomright', zoomInTitle: 'Zoom in', zoomOutTitle: 'Zoom out' }).addTo(map);

  // Elements
  const searchInput = document.getElementById('location-search');
  const suggestions = document.getElementById('search-suggestions');
  const getBtn = document.getElementById('get-weather-btn');
  const dateInput = document.getElementById('date-input');
  const resultsEl = document.getElementById('results-container');
  const resultsPanel = document.querySelector('.results-panel');
  const latlonEl = document.getElementById('latlon-display');
  const locateBtn = document.getElementById('locate-btn');
  const historyEl = document.getElementById('history-container');
  const historyLocationEl = document.getElementById('history-location');

  // Set up date input for next 6 months from today (dynamic)
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const maxDate = new Date(today);
  maxDate.setMonth(maxDate.getMonth() + 6);
  dateInput.min = today.toISOString().split('T')[0];
  dateInput.max = maxDate.toISOString().split('T')[0];
  dateInput.value = today.toISOString().split('T')[0];

  let marker = null;
  let searchCircle = null;
  let suggestionMarkers = [];
  let searchZoneActive = false;

  function placeMarker(lat, lon, isMainLocation = true) {
    const latNum = Number(lat), lonNum = Number(lon);
    if (marker) marker.remove();
    
    let customIcon;
    if (isMainLocation) {
      // Red pulsing marker for main location
      customIcon = L.divIcon({
        className: 'main-location-marker',
        html: `
          <div class="marker-pulse-container">
            <div class="marker-pulse"></div>
            <div class="marker-dot main-marker-dot"></div>
          </div>
        `,
        iconSize: [40, 40], 
        iconAnchor: [20, 20]
      });
    } else {
      // Blue marker for suggestions
      customIcon = L.divIcon({
        className: 'suggestion-marker',
        html: `<div class="marker-dot suggestion-marker-dot"></div>`,
        iconSize: [16, 16], 
        iconAnchor: [8, 8]
      });
    }
    
    marker = L.marker([latNum, lonNum], { 
      draggable: isMainLocation, 
      icon: customIcon 
    }).addTo(map);
    
    if (isMainLocation) {
      map.setView([latNum, lonNum], 12);
      getBtn.disabled = false;
      updateLatLon(latNum, lonNum);
      marker.on('dragend', () => {
        const ll = marker.getLatLng();
        updateLatLon(ll.lat, ll.lng);
        reverseGeocode(ll.lat, ll.lng);
        // refresh sidebar for new location
        loadPast7Days(ll.lat, ll.lng);
        // Clear any existing search zone when marker is moved
        clearSearchZone();
      });
      // initial load for location
      loadPast7Days(latNum, lonNum);
    }
  }

  function updateLatLon(lat, lon) {
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lon >= 0 ? 'E' : 'W';
    latlonEl.textContent = `${Math.abs(lat).toFixed(4)}°${ns}, ${Math.abs(lon).toFixed(4)}°${ew}`;
  }

  // Search zone visualization functions
  function showSearchZone(centerLat, centerLon, radiusKm) {
    // Clear any existing zone first
    clearSearchZone();
    
    if (!centerLat || !centerLon || !radiusKm) return;
    
    // Create the search circle with glass effect
    searchCircle = L.circle([centerLat, centerLon], {
      radius: radiusKm * 1000, // Convert km to meters
      color: 'rgba(0, 122, 255, 0.6)',
      fillColor: 'rgba(0, 122, 255, 0.1)',
      fillOpacity: 0.1,
      weight: 2,
      opacity: 0,
      className: 'search-zone-circle'
    }).addTo(map);
    
    // Animate the circle appearance
    setTimeout(() => {
      if (searchCircle) {
        searchCircle.setStyle({ opacity: 0.6, fillOpacity: 0.1 });
      }
    }, 100);
    
    searchZoneActive = true;
  }
  
  function clearSearchZone() {
    // Remove circle
    if (searchCircle) {
      searchCircle.remove();
      searchCircle = null;
    }
    
    // Remove suggestion markers
    suggestionMarkers.forEach(marker => marker.remove());
    suggestionMarkers = [];
    
    searchZoneActive = false;
  }
  
  function addSuggestionMarker(lat, lon, data) {
    const suggestionIcon = L.divIcon({
      className: 'suggestion-marker',
      html: `
        <div class="suggestion-marker-container">
          <div class="suggestion-marker-dot"></div>
          <div class="suggestion-marker-pulse"></div>
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    
    const suggestionMarker = L.marker([lat, lon], { 
      icon: suggestionIcon,
      opacity: 0 
    }).addTo(map);
    
    // Create weather information tooltip
    const name = data.name || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    const temp = data.t2m ? `${fmt(data.t2m)}°C` : 'N/A';
    const rain = data.rain ? `${fmt(data.rain)}mm` : 'N/A';
    const wind = data.ws ? `${fmt(data.ws)}m/s` : 'N/A';
    
    const tooltipContent = `
      <div class="weather-tooltip">
        <div class="tooltip-title">${name}</div>
        <div class="weather-info">
          <div class="weather-item">
            <span class="weather-icon">🌡️</span>
            <span class="weather-value">${temp}</span>
          </div>
          <div class="weather-item">
            <span class="weather-icon">🌧️</span>
            <span class="weather-value">${rain}</span>
          </div>
          <div class="weather-item">
            <span class="weather-icon">💨</span>
            <span class="weather-value">${wind}</span>
          </div>
        </div>
        <div class="tooltip-action">Click to analyze this location</div>
      </div>
    `;
    
    // Bind tooltip that shows on hover
    suggestionMarker.bindTooltip(tooltipContent, {
      permanent: false,
      sticky: true,
      opacity: 1,
      className: 'custom-tooltip',
      offset: [0, -10],
      direction: 'top'
    });
    
    // Animate marker appearance with delay
    const delay = suggestionMarkers.length * 150; // Stagger animations
    setTimeout(() => {
      if (suggestionMarker) {
        suggestionMarker.setOpacity(1);
      }
    }, delay);
    
    // Add click handler for suggestion markers
    suggestionMarker.on('click', () => {
      // Clear current zone and markers
      clearSearchZone();
      // Place new main marker at this location
      placeMarker(lat, lon, true);
      reverseGeocode(lat, lon);
      // Switch to history tab
      const historyBtn = document.querySelector('.tab-btn[data-tab="history"]');
      historyBtn?.click();
    });
    
    suggestionMarkers.push(suggestionMarker);
    return suggestionMarker;
  }

  // Debounce utility
  function debounce(fn, ms = 300) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

  // API base URL
  const API_BASE = window.location.origin;

  // Search + autocomplete via backend proxy
  async function geocode(q) {
    const url = new URL(`${API_BASE}/geocode`);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '8');
    const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`Geocode failed: ${res.status}`);
    return res.json();
  }

  async function reverseGeocode(lat, lon) {
    try {
      const url = new URL(`${API_BASE}/reverse-geocode`);
      url.searchParams.set('lat', lat);
      url.searchParams.set('lon', lon);
      const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.display_name) {
        searchInput.value = data.display_name;
        historyLocationEl.textContent = data.display_name;
        
        // Store location info for CSV export
        currentLocationInfo = {
          latitude: lat,
          longitude: lon,
          displayName: data.display_name,
          timestamp: new Date().toISOString()
        };
      }
    } catch {}
  }

  function renderSuggestions(items) {
    suggestions.innerHTML = '';
    if (!items || items.length === 0) { suggestions.classList.add('hidden'); return; }
    items.forEach((it, idx) => {
      const li = document.createElement('li');
      
      // Create a more structured display with location icon and better formatting
      const locationIcon = '📍';
      const displayText = formatLocationDisplay(it);
      
      li.innerHTML = `
        <div class="suggestion-item">
          <span class="suggestion-icon">${locationIcon}</span>
          <div class="suggestion-content">
            <div class="suggestion-name">${displayText.name}</div>
            <div class="suggestion-details">${displayText.details}</div>
          </div>
        </div>
      `;
      
      li.dataset.lat = it.lat; 
      li.dataset.lon = it.lon;
      li.dataset.fullname = it.display_name;
      
      if (idx === 0) li.classList.add('active');
      li.addEventListener('click', () => { selectSuggestion(li); });
      suggestions.appendChild(li);
    });
    suggestions.classList.remove('hidden');
  }

  function formatLocationDisplay(item) {
    const addr = item.address || {};
    const parts = [];
    
    // Primary name (city, town, village, etc.)
    const primaryName = addr.city || addr.town || addr.village || addr.municipality || 
                       addr.county || item.name || 'Location';
    
    // Secondary details (state, country)
    if (addr.state || addr.region) parts.push(addr.state || addr.region);
    if (addr.country) parts.push(addr.country);
    
    return {
      name: primaryName,
      details: parts.join(', ') || 'Unknown region'
    };
  }

  function clearSuggestions() { suggestions.innerHTML = ''; suggestions.classList.add('hidden'); }

  function selectSuggestion(el) { 
    const lat = el.dataset.lat, lon = el.dataset.lon;
    const fullName = el.dataset.fullname || el.textContent;
    searchInput.value = fullName; 
    historyLocationEl.textContent = fullName; 
    clearSuggestions(); 
    placeMarker(lat, lon); 
    reverseGeocode(lat, lon); 
  }

  // Keyboard navigation
  const doSearch = debounce(async () => {
    const q = searchInput.value.trim();
    console.log('Search triggered for:', q);
    if (q.length < 3) { 
      console.log('Query too short, clearing suggestions');
      clearSuggestions(); 
      return; 
    }
    try { 
      console.log('Calling geocode for:', q);
      const items = await geocode(q); 
      console.log('Geocode results:', items);
      renderSuggestions(items); 
    } catch (error) { 
      console.log('Geocode error:', error);
      clearSuggestions(); 
    }
  }, 350);
  searchInput.addEventListener('input', doSearch);

  // API base URL is defined above

  getBtn.addEventListener('click', async () => {
    if (!marker) return;
    const ll = marker.getLatLng();
    const selectedDate = new Date(dateInput.value);
    const startDate = new Date(selectedDate); startDate.setDate(startDate.getDate() - 1);
    const endDate = new Date(selectedDate); endDate.setDate(endDate.getDate() + 1);
    const payload = {
      latitude: ll.lat, longitude: ll.lng,
      start_date: startDate.toISOString().split('T')[0], end_date: endDate.toISOString().split('T')[0],
      variables: ['T2M','U10M','V10M','PS','RH2M','WS10M','PRECTOTCORR']
    };
    resultsEl.innerHTML = '<div class="loading">Analyzing weather data...</div>';
    
    // Set analysis flag and load past 7 days
    hasAnalyzed = true;
    loadPast7Days(ll.lat, ll.lng);
    
    try {
      const res = await fetch(`${API_BASE}/weather`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await res.json();
      if (res.ok) {
        renderResults(result.data, result.source, result.validation);
        // keep sidebar independent; we don't override it here
        await computeAndRenderProbabilities(ll.lat, ll.lng, selectedDate);
        
        // Add download button after all data is loaded
        addDownloadButton();
        
        if (resultsPanel) {
          resultsPanel.classList.remove('hidden');
          resultsPanel.classList.add('show');
        }
      } else {
        resultsEl.innerHTML = `<div class="error">Error: ${result.detail || 'Failed to fetch data'}</div>`;
      }
    } catch (err) {
      resultsEl.innerHTML = `<div class="error">Network Error: ${err.message}</div>`;
    }
  });

  // Load past 7 days into left sidebar
  async function loadPast7Days(lat, lon) {
    if (!hasAnalyzed) {
      historyEl.innerHTML = `<div class="analysis-required">
        <div class="analysis-message">
          <div class="analysis-icon">📊</div>
          <h3>Past 7 Days Analysis</h3>
          <p>Click the "Analyze" button to view historical weather data for this location.</p>
        </div>
      </div>`;
      return;
    }
    
    historyEl.innerHTML = '<div class="loading">Loading past 7 days...</div>';
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const start = new Date(end); start.setDate(end.getDate() - 6); // 7 days inclusive
    const payload = {
      latitude: lat,
      longitude: lon,
      start_date: start.toISOString().split('T')[0],
      end_date: end.toISOString().split('T')[0],
      variables: ['T2M','U10M','V10M','PS','RH2M','WS10M','PRECTOTCORR']
    };
    try {
      const res = await fetch(`${API_BASE}/weather`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await res.json();
      if (res.ok) {
        renderSevenDayHistory(result.data);
      } else {
        historyEl.innerHTML = `<div class="error">${result.detail || 'Failed to fetch history'}</div>`;
      }
    } catch (e) {
      historyEl.innerHTML = `<div class="error">Network error loading history: ${e.message}</div>`;
    }
  }

  async function computeAndRenderProbabilities(lat, lon, selectedDate) {
    const month = selectedDate.getMonth() + 1;
    const day = selectedDate.getDate();
    let hotTempThreshold = 30.0, windyThreshold = 8.0, heavyRainThreshold = 10.0;
    if (Math.abs(lat) > 30) hotTempThreshold = 25.0; else if (Math.abs(lat) < 15) hotTempThreshold = 35.0;
    const isWinter = (lat < 0 && (month >= 6 && month <= 8)) || (lat > 0 && (month >= 12 || month <= 2));
    const isSummer = (lat < 0 && (month >= 12 || month <= 2)) || (lat > 0 && (month >= 6 && month <= 8));
    if (isWinter) hotTempThreshold -= 5; else if (isSummer) hotTempThreshold += 2;
    const thresholds = { T2M: hotTempThreshold, WS10M: windyThreshold, PRECTOTCORR: heavyRainThreshold };
    const body = { latitude: lat, longitude: lon, start_year: 2020, end_year: 2024, month, day, variables: ['T2M','WS10M','PRECTOTCORR'], thresholds };
    try {
      const res = await fetch(`${API_BASE}/probability/doy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) {
        // Store prediction data for CSV export
        currentPredictionData = {
          ...data,
          selectedDate: selectedDate,
          hotTempThreshold: hotTempThreshold,
          windyThreshold: windyThreshold,
          heavyRainThreshold: heavyRainThreshold
        };
        
        const probs = data.probabilities || {}; const summary = data.summary || {};
        const severeChance = Math.max((probs.WS10M ?? 0), (probs.PRECTOTCORR ?? 0));
        let html = `<div class="probabilities"><h3>Weather Outlook for ${selectedDate.toLocaleDateString()}</h3>`;
        if (summary.T2M) { html += `<div class="prob-row"><span>Expected Temperature:</span><strong>${summary.T2M.median.toFixed(1)}°C</strong></div><div class="prob-row"><span>Temperature Range:</span><span>${summary.T2M.p10.toFixed(1)}°C - ${summary.T2M.p90.toFixed(1)}°C</span></div>`; }
        html += `<div class="prob-row"><span>Hot weather chance (≥${hotTempThreshold}°C):</span><strong>${(probs.T2M ?? 0).toFixed(0)}%</strong></div><div class="prob-row"><span>Windy conditions (≥${windyThreshold} m/s):</span><strong>${(probs.WS10M ?? 0).toFixed(0)}%</strong></div><div class="prob-row"><span>Heavy rain (≥${heavyRainThreshold} mm/day):</span><strong>${(probs.PRECTOTCORR ?? 0).toFixed(0)}%</strong></div><div class="prob-row"><span>Severe weather risk:</span><strong>${severeChance.toFixed(0)}%</strong></div><div class="muted">Based on ${data.n_samples || 0} historical observations (2020-2024)</div>${data.source ? `<div class="muted">Source: ${data.source}</div>` : ''}</div>`;
        const container = document.createElement('div'); container.innerHTML = html; resultsEl.appendChild(container);
      }
    } catch {}
  }

  function predictWeatherCondition(tempC, windU, windV, pressureVal, humidityFrac, dailyRainMm = 0) {
    // Normalize pressure to hPa if needed
    let p_hPa = 1013.25;
    if (typeof pressureVal === 'number') {
      if (pressureVal > 2000) p_hPa = pressureVal / 100; // Pa -> hPa
      else if (pressureVal < 200) p_hPa = pressureVal * 10; // kPa -> hPa
      else p_hPa = pressureVal; // already hPa
    }
    const windSpeed = Math.sqrt(windU * windU + windV * windV);
    const h = Math.max(0, Math.min(1, humidityFrac ?? 0.5));
    const t = tempC ?? 0;
    const rain = dailyRainMm ?? 0;
    
    // Enhanced weather conditions with emojis
    if (rain >= 20) return { condition: 'Heavy Rain', icon: '⛈️', description: 'Heavy rainfall expected' };
    if (rain >= 10 || (h >= 0.85 && p_hPa < 1008)) return { condition: 'Rainy', icon: '🌧️', description: 'Likely showers or rain' };
    if (rain >= 1 && rain < 10) return { condition: 'Light Rain', icon: '🌦️', description: 'Light showers possible' };
    if (windSpeed >= 15) return { condition: 'Very Windy', icon: '🌪️', description: 'Very strong winds' };
    if (windSpeed >= 10) return { condition: 'Windy', icon: '💨', description: 'Strong winds' };
    if (t >= 35) return { condition: 'Very Hot', icon: '🔥', description: 'Extremely hot conditions' };
    if (t >= 32 && h <= 0.6 && p_hPa >= 1008) return { condition: 'Hot & Sunny', icon: '☀️', description: 'Hot and mostly sunny' };
    if (t <= 0) return { condition: 'Freezing', icon: '🧊', description: 'Freezing temperatures' };
    if (t <= 5) return { condition: 'Cold', icon: '❄️', description: 'Cold conditions' };
    if (h >= 0.9) return { condition: 'Very Humid', icon: '🌫️', description: 'Very humid and foggy' };
    if (h >= 0.75) return { condition: 'Humid', icon: '☁️', description: 'Humid and muggy' };
    if (t >= 26 && h <= 0.65) return { condition: 'Sunny', icon: '☀️', description: 'Generally clear and sunny' };
    if (h >= 0.65 && h < 0.75) return { condition: 'Cloudy', icon: '☁️', description: 'Overcast skies' };
    return { condition: 'Partly Cloudy', icon: '⛅', description: 'Mixed clouds and sun' };
  }

  function renderResults(data, sourceLabel, validation) {
    if (!data || !data.coords || !data.coords.time || !data.coords.time.data) { resultsEl.innerHTML = '<div class="error">No data returned from server or data is malformed.</div>'; return; }
    
    // Store current weather data for CSV export
    currentWeatherData = data;
    
    const latest = data.coords.time.data.length - 1;
    const temp = data.data_vars.T2M?.data?.[latest] ?? null;
    const windU = data.data_vars.U10M?.data?.[latest] ?? 0;
    const windV = data.data_vars.V10M?.data?.[latest] ?? 0;
    const pressureVal = data.data_vars.PS?.data?.[latest];
    let pressureHpa = 1013.25;
    if (typeof pressureVal === 'number') {
      if (pressureVal > 2000) pressureHpa = pressureVal / 100; else if (pressureVal < 200) pressureHpa = pressureVal * 10; else pressureHpa = pressureVal;
    }
    let humidity = 0.5; if (data.data_vars.RH2M) humidity = (data.data_vars.RH2M.data[latest] || 50) / 100.0;
    const rainToday = data.data_vars.PRECTOTCORR?.data?.[latest] ?? 0;
    const prediction = predictWeatherCondition(temp, windU, windV, pressureHpa, humidity, rainToday);
    const windSpeed = Math.sqrt(windU * windU + windV * windV);
    let html = `<div class="weather-prediction"><div class="condition-main">${prediction.icon} ${prediction.condition}</div><div class="condition-desc">${prediction.description}</div></div><div class="weather-details"><div class="detail">Temp ${temp.toFixed(1)}°C</div><div class="detail">Wind ${windSpeed.toFixed(1)} m/s</div><div class="detail">Press ${pressureHpa.toFixed(0)} hPa</div><div class="detail">Humid ${(humidity*100).toFixed(0)}%</div></div>`;
    const src = sourceLabel || data?.attrs?.source || data?.metadata?.data_source; if (src) html += `<div class="muted">Source: ${src}</div>`;
    
    resultsEl.innerHTML = html;
  }

  function renderSevenDayHistory(data) {
    if (!data || !data.coords || !data.coords.time || !data.coords.time.data) { historyEl.innerHTML = '<div class="error">No historical data available.</div>'; return; }
    
    // Store historical data for CSV export
    currentHistoryData = data;
    const timeData = data.coords.time.data;
    const tempData = data.data_vars.T2M?.data || [];
    const windUData = data.data_vars.U10M?.data || [];
    const windVData = data.data_vars.V10M?.data || [];
  const pressureData = data.data_vars.PS?.data || [];
  const rainData = data.data_vars.PRECTOTCORR?.data || [];
    const humidityData = data.data_vars.RH2M ? data.data_vars.RH2M.data : null;
    // group by date
    const daily = new Map();
    timeData.forEach((t, i) => {
      const d = new Date(t);
      const key = d.toISOString().slice(0,10);
      const wind = Math.sqrt((windUData[i]||0)**2 + (windVData[i]||0)**2);
      const p = pressureData[i] != null ? (pressureData[i] < 200 ? pressureData[i] * 10 : pressureData[i]) : null;
      const h = humidityData ? (humidityData[i] || 50)/100 : null;
      const entry = daily.get(key) || { temps: [], winds: [], pressures: [], humidities: [], rains: [] };
      if (tempData[i] != null) entry.temps.push(tempData[i]);
      entry.winds.push(wind);
      if (p != null) entry.pressures.push(p);
      if (h != null) entry.humidities.push(h);
      if (rainData[i] != null) entry.rains.push(rainData[i]);
      daily.set(key, entry);
    });
    const days = Array.from(daily.entries()).sort(([a],[b]) => a.localeCompare(b)).slice(-7);
    let html = '<div class="history-cards">';
    for (const [key, day] of days) {
      const avgTemp = day.temps.length ? day.temps.reduce((a,b)=>a+b,0)/day.temps.length : NaN;
      const avgWind = day.winds.length ? day.winds.reduce((a,b)=>a+b,0)/day.winds.length : 0;
      const avgPressure = day.pressures.length ? day.pressures.reduce((a,b)=>a+b,0)/day.pressures.length : 1013.25;
      const avgHumidity = day.humidities.length ? day.humidities.reduce((a,b)=>a+b,0)/day.humidities.length : 0.5;
      const totalRain = day.rains.length ? day.rains.reduce((a,b)=>a+b,0) : 0;
  const pred = predictWeatherCondition(avgTemp||0, avgWind*Math.cos(Math.PI/4), avgWind*Math.sin(Math.PI/4), avgPressure, avgHumidity, totalRain);
      const label = new Date(key).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      html += `<div class="history-card">
        <div class="history-date">${label}</div>
        <div class="history-condition">${pred.icon} ${pred.condition}</div>
        <div class="history-temp">Temp ${isFinite(avgTemp)?avgTemp.toFixed(1)+'°C':'—'}</div>
        <div class="history-wind">Wind ${avgWind.toFixed(1)} m/s</div>
        <div class="history-wind">Rain ${totalRain.toFixed(1)} mm</div>
      </div>`;
    }
    html += '</div>';
    historyEl.innerHTML = html;
  }

  // Map interactions
  map.on('click', (e) => { placeMarker(e.latlng.lat, e.latlng.lng); reverseGeocode(e.latlng.lat, e.latlng.lng); });

  // Locate me
  locateBtn.addEventListener('click', () => {
    if (!navigator.geolocation) return alert('Geolocation not supported');
    navigator.geolocation.getCurrentPosition((pos) => { const { latitude, longitude } = pos.coords; placeMarker(latitude, longitude); reverseGeocode(latitude, longitude); }, () => alert('Unable to retrieve your location'));
  });

  // Add download button function
  function addDownloadButton() {
    // Check if download button already exists
    if (document.getElementById('download-csv-btn')) return;
    
    // Only add if we have data to download
    if (!currentWeatherData && !currentHistoryData && !currentPredictionData) return;
    
    const downloadHtml = `<div class="download-section">
      <button id="download-csv-btn" class="download-btn glass">
        <svg class="download-icon" viewBox="0 0 24 24" fill="none">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <polyline points="7,10 12,15 17,10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        Download CSV Data
      </button>
    </div>`;
    
    // Append to results container
    resultsEl.insertAdjacentHTML('beforeend', downloadHtml);
    
    // Add event listener
    const downloadBtn = document.getElementById('download-csv-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', downloadWeatherCSV);
    }
  }

  // CSV Download Functions
  function escapeCSV(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function generateCSVHeader() {
    const header = [
      'Dataset_Type',
      'Timestamp',
      'Date',
      'Time_UTC',
      'Location_Name', 
      'Latitude',
      'Longitude',
      'Temperature_C',
      'Temperature_Unit',
      'Wind_U_Component_ms',
      'Wind_V_Component_ms', 
      'Wind_Speed_ms',
      'Wind_Unit',
      'Pressure_hPa',
      'Pressure_Unit',
      'Humidity_Percent',
      'Humidity_Unit',
      'Precipitation_mm',
      'Precipitation_Unit',
      'Weather_Condition',
      'Weather_Description',
      'Data_Source',
      'Source_URL',
      'Analysis_Date',
      'Notes'
    ];
    return header.join(',') + '\n';
  }

  function formatWeatherDataToCSV(data, datasetType, locationInfo) {
    if (!data || !data.coords || !data.coords.time || !data.coords.time.data) return '';
    
    const timeData = data.coords.time.data;
    const tempData = data.data_vars.T2M?.data || [];
    const windUData = data.data_vars.U10M?.data || [];
    const windVData = data.data_vars.V10M?.data || [];
    const pressureData = data.data_vars.PS?.data || [];
    const rainData = data.data_vars.PRECTOTCORR?.data || [];
    const humidityData = data.data_vars.RH2M ? data.data_vars.RH2M.data : null;
    
    const source = data?.attrs?.source || data?.metadata?.data_source || 'NASA POWER';
    const sourceUrl = source.includes('NASA') ? 'https://power.larc.nasa.gov/' : 'Unknown';
    
    let csvContent = '';
    
    timeData.forEach((timestamp, i) => {
      const date = new Date(timestamp);
      const windU = windUData[i] || 0;
      const windV = windVData[i] || 0;
      const windSpeed = Math.sqrt(windU * windU + windV * windV);
      const temp = tempData[i];
      const pressure = pressureData[i];
      let pressureHpa = pressure;
      if (typeof pressure === 'number') {
        if (pressure > 2000) pressureHpa = pressure / 100;
        else if (pressure < 200) pressureHpa = pressure * 10;
      }
      const humidity = humidityData ? humidityData[i] : null;
      const rain = rainData[i] || 0;
      
      // Get weather condition prediction
      const prediction = predictWeatherCondition(temp, windU, windV, pressureHpa, humidity ? humidity/100 : 0.5, rain);
      
      const row = [
        escapeCSV(datasetType),
        escapeCSV(timestamp),
        escapeCSV(date.toISOString().split('T')[0]),
        escapeCSV(date.toISOString().split('T')[1]),
        escapeCSV(locationInfo?.displayName || 'Unknown Location'),
        escapeCSV(locationInfo?.latitude || ''),
        escapeCSV(locationInfo?.longitude || ''),
        escapeCSV(temp),
        escapeCSV('Celsius'),
        escapeCSV(windU),
        escapeCSV(windV),
        escapeCSV(windSpeed.toFixed(2)),
        escapeCSV('m/s'),
        escapeCSV(pressureHpa),
        escapeCSV('hPa'),
        escapeCSV(humidity),
        escapeCSV('Percent'),
        escapeCSV(rain),
        escapeCSV('mm'),
        escapeCSV(prediction.condition),
        escapeCSV(prediction.description),
        escapeCSV(source),
        escapeCSV(sourceUrl),
        escapeCSV(new Date().toISOString()),
        escapeCSV('')
      ];
      csvContent += row.join(',') + '\n';
    });
    
    return csvContent;
  }

  function formatPredictionDataToCSV(predictionData, locationInfo) {
    if (!predictionData) return '';
    
    const probs = predictionData.probabilities || {};
    const summary = predictionData.summary || {};
    const source = predictionData.source || 'NASA POWER daily';
    const sourceUrl = 'https://power.larc.nasa.gov/';
    
    let csvContent = '';
    
    // Add prediction summary row
    const predictionRow = [
      escapeCSV('Weather_Prediction'),
      escapeCSV(predictionData.selectedDate?.toISOString() || ''),
      escapeCSV(predictionData.selectedDate?.toISOString()?.split('T')[0] || ''),
      escapeCSV(''),
      escapeCSV(locationInfo?.displayName || 'Unknown Location'),
      escapeCSV(locationInfo?.latitude || ''),
      escapeCSV(locationInfo?.longitude || ''),
      escapeCSV(summary.T2M?.median || ''),
      escapeCSV('Celsius'),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(source),
      escapeCSV(sourceUrl),
      escapeCSV(new Date().toISOString()),
      escapeCSV(`Expected Temp: ${summary.T2M?.median?.toFixed(1) || 'N/A'}°C, Range: ${summary.T2M?.p10?.toFixed(1) || 'N/A'}°C - ${summary.T2M?.p90?.toFixed(1) || 'N/A'}°C, Hot chance: ${(probs.T2M || 0).toFixed(0)}%, Windy chance: ${(probs.WS10M || 0).toFixed(0)}%, Rain chance: ${(probs.PRECTOTCORR || 0).toFixed(0)}%, Based on ${predictionData.n_samples || 0} observations`)
    ];
    csvContent += predictionRow.join(',') + '\n';
    
    return csvContent;
  }

  function downloadWeatherCSV() {
    try {
      let csvContent = '';
      
      // Add metadata header
      csvContent += `# Plan My Fest Data Export\n`;
      csvContent += `# Generated: ${new Date().toISOString()}\n`;
      csvContent += `# Location: ${currentLocationInfo?.displayName || 'Unknown'}\n`;
      csvContent += `# Coordinates: ${currentLocationInfo?.latitude || 'N/A'}, ${currentLocationInfo?.longitude || 'N/A'}\n`;
      csvContent += `# Data Sources: NASA POWER, MERRA-2\n`;
      csvContent += `# Source URLs: https://power.larc.nasa.gov/, https://gmao.gsfc.nasa.gov/reanalysis/MERRA-2/\n`;
      csvContent += `#\n`;
      csvContent += `# Dataset Types:\n`;
      csvContent += `# - Current_Weather: Latest weather conditions\n`;
      csvContent += `# - Historical_7Day: Past 7 days historical data\n`;
      csvContent += `# - Weather_Prediction: Future weather outlook and probabilities\n`;
      csvContent += `#\n`;
      csvContent += `# Units:\n`;
      csvContent += `# - Temperature: Celsius (°C)\n`;
      csvContent += `# - Wind Speed: meters per second (m/s)\n`;
      csvContent += `# - Pressure: hectopascals (hPa)\n`;
      csvContent += `# - Precipitation: millimeters (mm)\n`;
      csvContent += `# - Humidity: Percent (%)\n`;
      csvContent += `#\n`;
      
      // Add CSV header
      csvContent += generateCSVHeader();
      
      // Add current weather data
      if (currentWeatherData) {
        csvContent += formatWeatherDataToCSV(currentWeatherData, 'Current_Weather', currentLocationInfo);
      }
      
      // Add historical data
      if (currentHistoryData) {
        csvContent += formatWeatherDataToCSV(currentHistoryData, 'Historical_7Day', currentLocationInfo);
      }
      
      // Add prediction data
      if (currentPredictionData) {
        csvContent += formatPredictionDataToCSV(currentPredictionData, currentLocationInfo);
      }
      
      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const fileName = `weather_analysis_${currentLocationInfo?.displayName?.replace(/[^a-zA-Z0-9]/g, '_') || 'location'}_${new Date().toISOString().split('T')[0]}.csv`;
      
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Error generating CSV:', error);
      alert('Error generating CSV file. Please try again.');
    }
  }
});

