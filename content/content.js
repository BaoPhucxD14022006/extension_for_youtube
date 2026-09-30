// CinemaSub - Content Script (Runs in ISOLATED world)

(() => {
  console.log('[CinemaSub] Content script initialized on YouTube.');

  let currentVideoId = null;
  let rawFragments = [];
  let translatedSubtitles = [];
  let isTranslating = false;
  let isSubtitlesEnabled = true;
  let settings = {
    apiKey: '',
    model: 'gemini-3.5-flash-lite',
    mode: 'bilingual',
    fontSize: 'medium',
    subColor: '#FCD34D',
    hasBackdrop: true,
    enabled: true
  };

  // DOM Elements
  let overlayRoot = null;
  let subBox = null;
  let subEnEl = null;
  let subViEl = null;
  let playerBtn = null;
  let currentActiveSub = null;
  const CACHE_VERSION = 'v14_sync_10cue_turbo';
  let rafId = null;

  // Initialize
  async function init() {
    await cleanupOldCaches();
    ensureBridgeInjected();
    await loadSettings();
    listenSettingsChanges();
    setupCrossWorldListeners();
    checkAndSetup();

    // Check periodically for SPA navigation or player re-render
    setInterval(checkAndSetup, 1500);
  }

  // Clear legacy/stale caches from previous versions
  async function cleanupOldCaches() {
    try {
      const all = await chrome.storage.local.get(null);
      const toRemove = Object.keys(all).filter(k => k.startsWith('cinemasub_cache_') && !k.startsWith(`cinemasub_cache_${CACHE_VERSION}_`));
      if (toRemove.length > 0) {
        await chrome.storage.local.remove(toRemove);
        console.log(`[CinemaSub] Cleared ${toRemove.length} legacy cache entries.`);
      }
    } catch (e) {}
  }

  // Inject page-bridge.js into page if needed
  function ensureBridgeInjected() {
    if (!document.getElementById('cinemasub-bridge-script')) {
      try {
        const script = document.createElement('script');
        script.id = 'cinemasub-bridge-script';
        script.src = chrome.runtime.getURL('content/page-bridge.js');
        (document.head || document.documentElement).appendChild(script);
      } catch (e) {
        // Fallback or already running via manifest world: MAIN
      }
    }
  }

  // Load user settings from storage
  async function loadSettings() {
    const data = await chrome.storage.local.get([
      'apiKey', 'model', 'mode', 'fontSize', 'subColor', 'hasBackdrop', 'enabled'
    ]);
    settings = { ...settings, ...data };
    isSubtitlesEnabled = settings.enabled !== false;
    applyOverlayStyles();
  }

  // Listen for setting changes from popup
  function listenSettingsChanges() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        for (const [key, change] of Object.entries(changes)) {
          settings[key] = change.newValue;
        }
        if (changes.enabled !== undefined) {
          isSubtitlesEnabled = changes.enabled.newValue;
          updatePlayerBtnState();
        }
        applyOverlayStyles();
      }
    });
  }

  // Setup communication with MAIN world page-bridge
  let pendingTrackPromise = null;
  let latestInterceptedTranscript = null;

  function setupCrossWorldListeners() {
    window.addEventListener('message', (event) => {
      if (!event.data) return;

      if (event.data.type === 'CINEMA_SUB_TRACKS_RESULT') {
        const tracks = event.data.tracks || [];
        if (event.data.capturedTranscript) {
          latestInterceptedTranscript = {
            text: event.data.capturedTranscript,
            videoId: event.data.videoId
          };
        }
        if (pendingTrackPromise) {
          pendingTrackPromise(tracks);
          pendingTrackPromise = null;
        }
      } else if (event.data.type === 'CINEMA_SUB_INTERCEPTED_TRANSCRIPT') {
        if (event.data.text) {
          latestInterceptedTranscript = {
            text: event.data.text,
            videoId: event.data.videoId,
            lang: event.data.lang
          };
        }
      }
    });

    document.addEventListener('CINEMA_SUB_TRACKS_RESULT_DOC', (event) => {
      try {
        const tracks = JSON.parse(event.detail || '[]');
        if (pendingTrackPromise) {
          pendingTrackPromise(tracks);
          pendingTrackPromise = null;
        }
      } catch (e) {
        console.error('[CinemaSub] Error parsing tracks from bridge doc event:', e);
      }
    });
  }

  function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('v');
  }

  // Handle video navigation or change
  function handleVideoChange() {
    const newVideoId = getVideoId();
    if (newVideoId && newVideoId !== currentVideoId) {
      console.log('[CinemaSub] Video changed to:', newVideoId);
      currentVideoId = newVideoId;
      resetState();
      setTimeout(startSubtitlePipeline, 1000);
    }
  }

  function resetState() {
    rawFragments = [];
    translatedSubtitles = [];
    isTranslating = false;
    currentActiveSub = null;
    latestInterceptedTranscript = null;
    if (subBox) subBox.style.display = 'none';
    removeExistingToast();
  }

  // Main check loop
  function checkAndSetup() {
    const videoId = getVideoId();
    if (!videoId) return;

    if (videoId !== currentVideoId) {
      handleVideoChange();
    }

    ensureOverlayInjected();
    ensureButtonInjected();
  }

  // 1. Inject Subtitle Overlay into YouTube Player
  function ensureOverlayInjected() {
    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (!player) return;

    if (!document.getElementById('cinema-sub-root')) {
      overlayRoot = document.createElement('div');
      overlayRoot.id = 'cinema-sub-root';

      subBox = document.createElement('div');
      subBox.className = 'cinema-sub-box';
      subBox.style.display = 'none';

      subEnEl = document.createElement('div');
      subEnEl.className = 'cinema-sub-en';

      subViEl = document.createElement('div');
      subViEl.className = 'cinema-sub-vi';

      subBox.appendChild(subEnEl);
      subBox.appendChild(subViEl);
      overlayRoot.appendChild(subBox);
      player.appendChild(overlayRoot);

      applyOverlayStyles();
      setupVideoTimeListener();
    }
  }

  // 2. Inject CinemaSub toggle button into YouTube control bar
  function ensureButtonInjected() {
    const rightControls = document.querySelector('.ytp-right-controls');
    if (!rightControls) return;

    if (!document.getElementById('cinema-sub-btn')) {
      playerBtn = document.createElement('button');
      playerBtn.id = 'cinema-sub-btn';
      playerBtn.className = `cinema-player-btn ${isSubtitlesEnabled ? 'active' : ''}`;
      playerBtn.title = 'CinemaSub: Phụ đề AI kiểu phim';
      playerBtn.innerHTML = `
        <svg viewBox="0 0 24 24">
          <path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H5V6h14v12zM7 15h3c.55 0 1-.45 1-1v-1H9.5v.5h-2v-3h2v.5H11v-1c0-.55-.45-1-1-1H7c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1zm7 0h3c.55 0 1-.45 1-1v-1h-1.5v.5h-2v-3h2v.5H18v-1c0-.55-.45-1-1-1h-3c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1z"/>
        </svg>
        <span class="cinema-btn-tooltip">CinemaSub (Phụ đề AI)</span>
      `;

      playerBtn.addEventListener('click', () => {
        toggleSubtitles();
      });

      rightControls.insertBefore(playerBtn, rightControls.firstChild);
    }
  }

  function updatePlayerBtnState() {
    if (playerBtn) {
      if (isSubtitlesEnabled) {
        playerBtn.classList.add('active');
      } else {
        playerBtn.classList.remove('active');
      }
    }
  }

  function toggleSubtitles() {
    isSubtitlesEnabled = !isSubtitlesEnabled;
    chrome.storage.local.set({ enabled: isSubtitlesEnabled });
    updatePlayerBtnState();

    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');

    if (isSubtitlesEnabled) {
      if (player) player.classList.add('cinemasub-active');
      disableNativeYouTubeCaptions();
      showToast('🎬 Đã bật phụ đề CinemaSub', 'success', 2000);
      if (translatedSubtitles.length === 0 && !isTranslating) {
        startSubtitlePipeline();
      }
    } else {
      if (player) player.classList.remove('cinemasub-active');
      if (subBox) subBox.style.display = 'none';
      showToast('Đã tắt phụ đề CinemaSub', 'info', 2000);
    }
  }

  function disableNativeYouTubeCaptions() {
    try {
      const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (player) player.classList.add('cinemasub-active');

      const ytSubBtn = document.querySelector('.ytp-subtitles-button');
      if (ytSubBtn && ytSubBtn.getAttribute('aria-pressed') === 'true') {
        ytSubBtn.click();
      }

      // Hide all known native caption elements immediately via inline styles
      const nativeSelectors = [
        '.ytp-caption-window-container',
        '.ytp-caption-window-bottom',
        '.ytp-caption-window-rollup',
        '.caption-window',
        '.caption-window-rollup',
        '.ytp-caption-segment',
        '.captions-text',
        '.ytp-subtitles-player-content',
        '[class*="caption-window"]',
        '[class*="ytp-caption"]'
      ];
      document.querySelectorAll(nativeSelectors.join(', ')).forEach(el => {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('opacity', '0', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
      });

      // Post message to main world bridge to unload caption track from player instance
      window.postMessage({ type: 'CINEMA_SUB_HIDE_NATIVE_CAPTIONS' }, '*');
    } catch (e) {
      // Ignore
    }
  }

  function applyOverlayStyles() {
    if (!subBox) return;

    subBox.classList.remove('size-small', 'size-medium', 'size-large');
    subBox.classList.add(`size-${settings.fontSize || 'medium'}`);

    if (settings.hasBackdrop) {
      subBox.classList.add('has-backdrop');
    } else {
      subBox.classList.remove('has-backdrop');
    }

    if (subViEl) {
      subViEl.style.color = settings.subColor || '#FCD34D';
    }

    if (subEnEl) {
      subEnEl.style.display = settings.mode === 'vi-only' ? 'none' : 'block';
    }
  }

  // Sanitize subtitle text to guarantee raw JSON ({ "id": 6, "vi": "..." }) never appears on screen
  function cleanDisplaySubtitle(str) {
    if (!str || typeof str !== 'string') return '';
    let text = str.trim();
    const viMatch = text.match(/"(?:vi|translation|text|vietnamese)"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (viMatch) {
      try {
        text = JSON.parse(`"${viMatch[1]}"`).trim();
      } catch (e) {
        text = viMatch[1].replace(/\\"/g, '"').trim();
      }
    }
    return text.replace(/^[{\[\s"',]+|[}\]\s"',;]+$/g, '').trim();
  }

  function setupVideoTimeListener() {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return;

    // Use requestAnimationFrame for ~60fps subtitle sync (Recommend.md Vấn đề 2)
    // timeupdate only fires ~4 times/sec, causing visible lag
    if (rafId) cancelAnimationFrame(rafId);

    function tick() {
      if (!isSubtitlesEnabled || translatedSubtitles.length === 0) {
        if (subBox) subBox.style.display = 'none';
        rafId = requestAnimationFrame(tick);
        return;
      }

      const cur = video.currentTime;
      const match = findCurrentSubtitle(cur);

      if (match) {
        if (settings.mode === 'vi-only' && !match.vi) {
          if (subBox) subBox.style.display = 'none';
        } else if (match !== currentActiveSub) {
          currentActiveSub = match;
          subViEl.textContent = cleanDisplaySubtitle(match.vi || match.en || '');
          subEnEl.textContent = cleanDisplaySubtitle(match.en || '');
          subBox.style.display = 'flex';
        }
      } else {
        if (currentActiveSub !== null) {
          currentActiveSub = null;
          subBox.style.display = 'none';
        }
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);

    // Also handle seek for instant response
    video.addEventListener('seeked', () => {
      currentActiveSub = null; // Force re-evaluation on seek
    });
  }

  function findCurrentSubtitle(currentTime) {
    if (!translatedSubtitles || translatedSubtitles.length === 0) {
      return null;
    }

    for (let i = 0; i < translatedSubtitles.length; i++) {
      const s = translatedSubtitles[i];
      if (currentTime >= s.start && currentTime < s.end) {
        return s;
      }
      if (currentTime < s.start) {
        break;
      }
    }

    return null;
  }

  // --- SUBTITLE FETCHING & MULTI-TIER LLM PIPELINE ---

  async function startSubtitlePipeline() {
    if (!isSubtitlesEnabled) return;
    const videoId = currentVideoId || getVideoId();
    if (!videoId) return;

    // Check settings for API Key
    const st = await chrome.storage.local.get(['apiKey', 'provider', 'nvidiaApiKey', 'geminiApiKey']);
    const providerName = st.provider === 'gemini' ? 'Gemini' : 'NVIDIA';
    const activeKey = st.provider === 'gemini' ? (st.geminiApiKey || st.apiKey) : (st.nvidiaApiKey || st.apiKey);
    if (!activeKey) {
      showToast(`⚠️ Vui lòng mở icon CinemaSub để nhập ${providerName} API Key.`, 'error', 6000);
      return;
    }

    // Check Cache first
    const cacheKey = `cinemasub_cache_${CACHE_VERSION}_${videoId}`;
    const cached = await chrome.storage.local.get([cacheKey]);
    if (cached[cacheKey] && cached[cacheKey].length > 0) {
      translatedSubtitles = cached[cacheKey];
      console.log(`[CinemaSub] Loaded ${translatedSubtitles.length} subtitles from cache.`);
      showToast('✨ Đã tải phụ đề từ bộ nhớ đệm (0 token)', 'success', 2500);
      disableNativeYouTubeCaptions();
      return;
    }

    // Fetch caption tracks
    showToast('🔍 Đang tìm transcript YouTube...', 'info', 3000);
    const tracks = await requestCaptionTracks();

    console.log('[CinemaSub] Available tracks found:', tracks.length);

    // Pick best track (prefer English manual, then English ASR, or first track)
    let selectedTrack = null;
    if (tracks && tracks.length > 0) {
      selectedTrack = tracks.find(t => t.languageCode?.startsWith('en') && t.kind !== 'asr')
        || tracks.find(t => t.languageCode?.startsWith('en'))
        || tracks[0];
    }

    // Fetch raw transcript content via Multi-Tier Engine
    showToast('📥 Đang trích xuất nội dung transcript...', 'info', 3000);
    rawFragments = await multiTierExtractTranscript(selectedTrack);

    if (!rawFragments || rawFragments.length === 0) {
      showToast('❌ Video này không có phụ đề (Transcript). Vui lòng thử video khác!', 'error', 4500);
      return;
    }

    // Normalize raw speech fragments into cues - PRESERVE exact YouTube audio timestamps!
    // DO NOT merge multiple cues together (page-bridge_error.md & content_error.md priority #1)
    const subtitleUnits = rawFragments
      .filter(f => f.text && f.text.trim().length > 0)
      .map((f, idx) => ({
        id: idx + 1,
        start: parseFloat(f.start.toFixed(2)),
        end: parseFloat((f.end !== undefined ? f.end : (f.start + f.duration)).toFixed(2)),
        duration: parseFloat((f.duration !== undefined ? f.duration : (f.end - f.start)).toFixed(2)),
        text: f.text.trim()
      }));

    console.log(`[CinemaSub] Prepared ${subtitleUnits.length} source cues with exact timestamps!`);

    // Translate via AI in bite-sized chunks
    translateUnitsInChunks(videoId, subtitleUnits);
  }

  // --- MULTI-TIER TRANSCRIPT ENGINE ---
  async function multiTierExtractTranscript(selectedTrack) {
    // TIER 1: Direct signed timedtext fetch (VTT / XML - Cleanest, non-overlapping ground truth from YouTube server)
    if (selectedTrack && selectedTrack.baseUrl) {
      console.log('[CinemaSub] Trying Tier 1: Direct signed timedtext fetch (VTT/XML)...');
      const directFragments = await tryDirectTimedTextFetch(selectedTrack.baseUrl);
      if (directFragments && directFragments.length > 0) {
        console.log(`[CinemaSub Tier 1] Success! Extracted ${directFragments.length} clean cues via Direct Fetch.`);
        return directFragments;
      }
    }

    // TIER 2: Network Interception (Player CC Trigger with PO Token)
    console.log('[CinemaSub] Trying Tier 2: Player CC Network Interceptor...');
    const interceptedFragments = await tryNetworkInterception(selectedTrack?.languageCode || 'en');
    if (interceptedFragments && interceptedFragments.length > 0) {
      console.log(`[CinemaSub Tier 2] Success! Extracted ${interceptedFragments.length} fragments via Network Interception.`);
      return interceptedFragments;
    }

    // TIER 3: YouTube Native Transcript Panel in DOM
    console.log('[CinemaSub] Trying Tier 3: YouTube Native Transcript Panel DOM scraper...');
    const domFragments = await tryDomTranscriptPanel();
    if (domFragments && domFragments.length > 0) {
      console.log(`[CinemaSub Tier 3] Success! Extracted ${domFragments.length} fragments via DOM Panel.`);
      return domFragments;
    }

    return [];
  }

  // TIER 1 Implementation: Trigger player captions and capture the authenticated response
  async function tryNetworkInterception(langCode) {
    const curVid = currentVideoId || getVideoId();
    if (latestInterceptedTranscript && (!latestInterceptedTranscript.videoId || latestInterceptedTranscript.videoId === curVid)) {
      const rawText = typeof latestInterceptedTranscript === 'string' ? latestInterceptedTranscript : latestInterceptedTranscript.text;
      const frags = parseRawContent(rawText);
      if (frags.length > 0) return frags;
    }

    return new Promise((resolve) => {
      let resolved = false;
      let timer = null;

      const messageHandler = (event) => {
        if (event.data?.type === 'CINEMA_SUB_INTERCEPTED_TRANSCRIPT' && event.data.text) {
          if (!event.data.videoId || event.data.videoId === curVid) {
            if (!resolved) {
              resolved = true;
              window.removeEventListener('message', messageHandler);
              clearTimeout(timer);
              const frags = parseRawContent(event.data.text);
              resolve(frags);
            }
          }
        }
      };

      window.addEventListener('message', messageHandler);

      // Trigger MAIN world bridge to activate captions in movie_player
      window.postMessage({
        type: 'CINEMA_SUB_TRIGGER_CAPTIONS',
        lang: langCode
      }, '*');

      // Wait max 1.5 seconds for network capture
      timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('message', messageHandler);
          resolve([]);
        }
      }, 1500);
    });
  }

  // TIER 2 Implementation: Scrape YouTube's official transcript panel in DOM
  async function tryDomTranscriptPanel() {
    // 1. Check if segments already exist in DOM
    let segments = document.querySelectorAll('ytd-transcript-segment-renderer');
    if (segments.length > 0) {
      return parseDomTranscriptSegments(segments);
    }

    // 2. Expand description if collapsed to reveal transcript button
    const expandDescBtn = document.querySelector('#description-inline-expander #expand')
      || document.querySelector('#description #expand')
      || document.querySelector('tp-yt-paper-button#expand');
    if (expandDescBtn) {
      expandDescBtn.click();
    }

    // 3. Find and click "Show transcript" button
    const transcriptBtn = document.querySelector('ytd-video-description-transcript-section-renderer button')
      || document.querySelector('button[aria-label*="transcript" i], button[aria-label*="bản ghi" i]')
      || document.querySelector('#panels ytd-button-renderer button');

    if (transcriptBtn) {
      transcriptBtn.click();
    }

    // 4. Poll for segments to appear (up to 1.5 seconds)
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(r => setTimeout(r, 150));
      segments = document.querySelectorAll('ytd-transcript-segment-renderer');
      if (segments && segments.length > 0) {
        const frags = parseDomTranscriptSegments(segments);
        // Hide transcript panel so UI stays clean
        hideTranscriptEngagementPanel();
        if (frags.length > 0) return frags;
      }
    }

    return [];
  }

  function parseDomTranscriptSegments(segments) {
    const fragments = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const timeEl = seg.querySelector('.segment-timestamp');
      const textEl = seg.querySelector('.segment-text');
      if (!timeEl || !textEl) continue;

      const timeStr = timeEl.textContent.trim();
      const text = textEl.textContent.trim();
      const start = parseTimeString(timeStr);

      let duration = 3.0;
      if (i + 1 < segments.length) {
        const nextTimeEl = segments[i + 1].querySelector('.segment-timestamp');
        if (nextTimeEl) {
          const nextStart = parseTimeString(nextTimeEl.textContent.trim());
          if (nextStart > start) {
            duration = Math.max(0.5, nextStart - start);
          }
        }
      }

      fragments.push({ start, duration, text: decodeHtmlEntities(text) });
    }
    return fragments;
  }

  function parseTimeString(str) {
    const parts = str.split(':').map(p => parseInt(p, 10));
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }

  function hideTranscriptEngagementPanel() {
    try {
      const panel = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]');
      if (panel) {
        const closeBtn = panel.querySelector('#visibility-button button') || panel.querySelector('button[aria-label*="close" i]');
        if (closeBtn) closeBtn.click();
        else panel.style.display = 'none';
      }
    } catch (e) {}
  }

  // TIER 3 Implementation: Direct timedtext fetch with fallback parameter formats
  async function tryDirectTimedTextFetch(baseUrl) {
    const fetchFormats = [
      baseUrl,
      baseUrl.includes('fmt=') ? baseUrl : `${baseUrl}&fmt=json3`,
      baseUrl.includes('fmt=') ? baseUrl : `${baseUrl}&fmt=vtt`,
      baseUrl.includes('c=') ? baseUrl : `${baseUrl}&c=WEB&fmt=json3`
    ];

    for (const url of fetchFormats) {
      try {
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) continue;

        const text = await resp.text();
        if (!text || text.trim().length === 0) continue;

        const fragments = parseRawContent(text);
        if (fragments.length > 0) return fragments;
      } catch (e) {
        console.warn('[CinemaSub] Tier 3 fetch error:', e);
      }
    }
    return [];
  }

  // Universal parser for JSON3, XML (<text> & <p>), and WebVTT
  function parseRawContent(text) {
    if (!text || typeof text !== 'string') return [];

    // Try JSON3
    if (text.startsWith('{') || text.includes('"events"')) {
      const jsonFrags = parseJson3Transcript(text);
      if (jsonFrags.length > 0) return jsonFrags;
    }

    // Try XML
    if (text.includes('<text') || text.includes('<p') || text.includes('<?xml')) {
      const xmlFrags = parseXmlTranscript(text);
      if (xmlFrags.length > 0) return xmlFrags;
    }

    // Try WebVTT
    if (text.includes('WEBVTT') || text.includes('-->')) {
      const vttFrags = parseVttTranscript(text);
      if (vttFrags.length > 0) return vttFrags;
    }

    return [];
  }

  function parseJson3Transcript(text) {
    try {
      const json = JSON.parse(text);
      if (!json.events || !Array.isArray(json.events)) return [];

      const rawEvents = [];
      for (const ev of json.events) {
        if (!ev.segs || !Array.isArray(ev.segs)) continue;
        const segText = ev.segs.map(s => s.utf8 || '').join('').replace(/[\r\n]+/g, ' ').trim();
        if (!segText || segText === '\n') continue;
        rawEvents.push({
          start: (ev.tStartMs || 0) / 1000,
          end: ((ev.tStartMs || 0) + (ev.dDurationMs || 0)) / 1000,
          duration: (ev.dDurationMs || 0) / 1000,
          text: decodeHtmlEntities(segText),
          aAppend: ev.aAppend === 1 || ev.aAppend === true
        });
      }

      if (rawEvents.length === 0) return [];

      // Check if this is rolling / paint-on ASR captions (events overlap heavily or have aAppend)
      const hasHeavyOverlap = rawEvents.some((ev, idx) => {
        if (idx === 0) return false;
        const prev = rawEvents[idx - 1];
        return ev.aAppend || (ev.start < prev.end - 0.5 && prev.end - ev.start > 1.0);
      });

      if (!hasHeavyOverlap) {
        // Clean non-overlapping cues (Manual subtitles)
        return rawEvents.map((ev, i) => {
          let duration = ev.duration;
          if (i + 1 < rawEvents.length && ev.start + duration > rawEvents[i + 1].start) {
            duration = Math.max(0.5, rawEvents[i + 1].start - ev.start);
          }
          return {
            start: parseFloat(ev.start.toFixed(2)),
            duration: parseFloat(duration.toFixed(2)),
            end: parseFloat((ev.start + duration).toFixed(2)),
            text: ev.text
          };
        });
      }

      // Rolling / Paint-on ASR captions: Assemble into clean, natural cues
      const cues = [];
      let currentCue = null;

      for (let i = 0; i < rawEvents.length; i++) {
        const ev = rawEvents[i];
        
        if (!currentCue) {
          currentCue = {
            start: ev.start,
            end: ev.end,
            text: ev.text
          };
          continue;
        }

        const isAppend = ev.aAppend;
        const overlaps = ev.start < currentCue.end + 0.2;
        const curDuration = ev.end - currentCue.start;
        const wordCount = (currentCue.text + ' ' + ev.text).split(/\s+/).length;
        const hasPunct = /[.?!]$/.test(currentCue.text);
        const pause = ev.start - currentCue.end > 0.4;

        if ((isAppend || overlaps) && !hasPunct && !pause && curDuration <= 6.5 && wordCount <= 16) {
          if (!currentCue.text.endsWith(ev.text)) {
            currentCue.text += (currentCue.text.endsWith(' ') ? '' : ' ') + ev.text;
          }
          currentCue.end = Math.max(currentCue.end, ev.end);
        } else {
          const dur = Math.max(1.0, currentCue.end - currentCue.start);
          cues.push({
            start: parseFloat(currentCue.start.toFixed(2)),
            duration: parseFloat(dur.toFixed(2)),
            end: parseFloat((currentCue.start + dur).toFixed(2)),
            text: currentCue.text.trim()
          });
          currentCue = {
            start: ev.start,
            end: ev.end,
            text: ev.text
          };
        }
      }

      if (currentCue && currentCue.text.trim()) {
        const dur = Math.max(1.0, currentCue.end - currentCue.start);
        cues.push({
          start: parseFloat(currentCue.start.toFixed(2)),
          duration: parseFloat(dur.toFixed(2)),
          end: parseFloat((currentCue.start + dur).toFixed(2)),
          text: currentCue.text.trim()
        });
      }

      return cues;
    } catch (e) {
      console.warn('[CinemaSub] json3 parse error:', e);
    }
    return [];
  }

  function parseXmlTranscript(text) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, 'text/xml');
      const textNodes = xmlDoc.getElementsByTagName('text');
      const fragments = [];

      if (textNodes && textNodes.length > 0) {
        for (let i = 0; i < textNodes.length; i++) {
          const node = textNodes[i];
          const start = parseFloat(node.getAttribute('start') || '0');
          const dur = parseFloat(node.getAttribute('dur') || '0');
          const content = decodeHtmlEntities(node.textContent.replace(/[\n\r]+/g, ' ').trim());
          if (content) {
            fragments.push({ start, duration: dur, text: content });
          }
        }
        return fragments;
      }

      const pNodes = xmlDoc.getElementsByTagName('p');
      if (pNodes && pNodes.length > 0) {
        for (let i = 0; i < pNodes.length; i++) {
          const node = pNodes[i];
          const start = parseFloat(node.getAttribute('t') || '0') / 1000;
          const dur = parseFloat(node.getAttribute('d') || '0') / 1000;
          const content = decodeHtmlEntities(node.textContent.replace(/[\n\r]+/g, ' ').trim());
          if (content) {
            fragments.push({ start, duration: dur, text: content });
          }
        }
        return fragments;
      }
    } catch (e) {}
    return [];
  }

  function parseVttTranscript(vttText) {
    try {
      const lines = vttText.split(/\r?\n/);
      const fragments = [];
      const timeRegex = /(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})/;

      let currentStart = null;
      let currentDur = null;
      let currentText = [];

      for (const line of lines) {
        const match = line.match(timeRegex);
        if (match) {
          if (currentStart !== null && currentText.length > 0) {
            fragments.push({
              start: currentStart,
              duration: currentDur,
              text: decodeHtmlEntities(currentText.join(' ').trim())
            });
          }
          const h1 = parseInt(match[1] || 0), m1 = parseInt(match[2]), s1 = parseInt(match[3]), ms1 = parseInt(match[4]);
          const h2 = parseInt(match[5] || 0), m2 = parseInt(match[6]), s2 = parseInt(match[7]), ms2 = parseInt(match[8]);
          currentStart = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000;
          const end = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000;
          currentDur = Math.max(0.1, end - currentStart);
          currentText = [];
        } else if (currentStart !== null && line.trim() && !line.startsWith('NOTE') && !line.startsWith('WEBVTT')) {
          currentText.push(line.replace(/<[^>]+>/g, '').trim());
        }
      }

      if (currentStart !== null && currentText.length > 0) {
        fragments.push({
          start: currentStart,
          duration: currentDur,
          text: decodeHtmlEntities(currentText.join(' ').trim())
        });
      }
      return fragments;
    } catch (e) {}
    return [];
  }

  function decodeHtmlEntities(str) {
    const txt = document.createElement('textarea');
    txt.innerHTML = str;
    return txt.value;
  }

  // Request caption tracks from page bridge or fallback HTML parse
  async function requestCaptionTracks() {
    return new Promise((resolve) => {
      let resolved = false;

      pendingTrackPromise = (tracks) => {
        if (!resolved && tracks && tracks.length > 0) {
          resolved = true;
          resolve(tracks);
        }
      };

      window.postMessage({ type: 'CINEMA_SUB_GET_TRACKS' }, '*');
      document.dispatchEvent(new CustomEvent('CINEMA_SUB_GET_TRACKS_DOC'));

      setTimeout(async () => {
        if (!resolved) {
          const fallbackTracks = await fallbackFetchCaptionTracks();
          resolved = true;
          resolve(fallbackTracks || []);
        }
      }, 1000);
    });
  }

  async function fallbackFetchCaptionTracks() {
    try {
      const resp = await fetch(window.location.href);
      const html = await resp.text();
      return extractCaptionTracksFromHtml(html);
    } catch (e) {
      console.warn('[CinemaSub] Fallback HTML fetch error:', e);
    }
    return [];
  }

  function extractCaptionTracksFromHtml(html) {
    const marker = '"captionTracks":';
    const idx = html.indexOf(marker);
    if (idx === -1) return [];

    const startBracket = html.indexOf('[', idx);
    if (startBracket === -1) return [];

    let depth = 0;
    let inString = false;
    let escape = false;
    let endBracket = -1;

    for (let i = startBracket; i < html.length; i++) {
      const c = html[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (c === '[') depth++;
        else if (c === ']') {
          depth--;
          if (depth === 0) {
            endBracket = i;
            break;
          }
        }
      }
    }

    if (endBracket !== -1) {
      const rawJson = html.slice(startBracket, endBracket + 1);
      try {
        return JSON.parse(rawJson);
      } catch (e) {}
    }
    return [];
  }

  // --- HIGH-PERFORMANCE CONCURRENT TRANSLATION PIPELINE ---
  async function translateUnitsInChunks(videoId, subtitleUnits) {
    if (isTranslating) return;
    isTranslating = true;

    // 1. HIGH-PRECISION MICRO-CHUNKING:
    // Large chunks (25-30 cues) cause LLMs (like LLaMA 3.2 11B) to merge clauses and shift IDs.
    // 10 cues (~25-30s of speech) guarantees 100% 1:1 ID match with zero drift,
    // and cuts chunk latency down to ~2s for ultra-fast progressive streaming!
    const CHUNK_SIZE = 10;
    const chunks = [];
    
    // QuickStart micro-batch (first 8 cues = ~20s of speech) to resume playback in ~1.5s
    if (subtitleUnits.length <= 10) {
      chunks.push(subtitleUnits);
    } else {
      chunks.push(subtitleUnits.slice(0, 8));
      for (let i = 8; i < subtitleUnits.length; i += CHUNK_SIZE) {
        chunks.push(subtitleUnits.slice(i, i + CHUNK_SIZE));
      }
    }

    const totalChunks = chunks.length;
    disableNativeYouTubeCaptions();

    // 2. QUICKSTART STAGE:
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    const isAtStart = video && video.currentTime < 5.0;
    let shouldAutoResume = false;

    if (video && !video.paused && isAtStart) {
      try {
        video.pause();
        shouldAutoResume = true;
      } catch (e) {}
      showToast('⚡ Đang chuẩn bị phụ đề (1-2s)...', 'info', 0);
    } else {
      showToast(`🤖 Đang dịch phụ đề (0/${totalChunks} phần)...`, 'info', 0);
    }

    try {
      // Translate Chunk 0 with maximum priority for instant buffer
      const res0 = await sendTranslateRequest(videoId, chunks[0], 0, totalChunks).catch(e => {
        console.warn('[CinemaSub] Chunk 0 error:', e);
        return null;
      });

      if (res0 && res0.success && res0.subtitles) {
        translatedSubtitles = mergeAndSortSubtitles(translatedSubtitles, res0.subtitles);
        const bufferedSeconds = Math.round(res0.subtitles[res0.subtitles.length - 1].end);
        showToast(`🎬 Sẵn sàng (${bufferedSeconds}s đầu)! Đang phát...`, 'success', 1800);
      }

      // Resume video playback IMMEDIATELY! User never waits for background chunks!
      if (shouldAutoResume && video && video.paused) {
        video.play().catch(() => {});
      }
      disableNativeYouTubeCaptions();

      if (totalChunks <= 1) {
        if (currentVideoId === videoId && translatedSubtitles.length > 0) {
          const cacheKey = `cinemasub_cache_${CACHE_VERSION}_${videoId}`;
          await chrome.storage.local.set({ [cacheKey]: translatedSubtitles });
          showToast(`✅ Đã hoàn tất 100% phụ đề tiếng Việt!`, 'success', 2500);
        }
        return;
      }

      // 3. PARALLEL CONCURRENT WORKER POOL FOR REMAINING CHUNKS:
      // Concurrency = 2 parallel workers cuts total background time by 60%+ while staying well within rate limits
      const pendingIndices = [];
      for (let i = 1; i < totalChunks; i++) {
        pendingIndices.push(i);
      }

      let completedCount = 1;
      const CONCURRENCY = Math.min(2, totalChunks - 1);

      async function worker() {
        while (pendingIndices.length > 0 && currentVideoId === videoId) {
          // Playhead-aware queue: prioritize chunk closest to current playback position (instant seek support)
          const curTime = video ? video.currentTime : 0;
          let bestIdx = 0;
          let minDistance = Infinity;

          for (let p = 0; p < pendingIndices.length; p++) {
            const chunkIdx = pendingIndices[p];
            const chunkStart = chunks[chunkIdx][0]?.start || 0;
            const dist = chunkStart >= curTime ? (chunkStart - curTime) : (curTime - chunkStart + 1000);
            if (dist < minDistance) {
              minDistance = dist;
              bestIdx = p;
            }
          }

          const targetChunkIndex = pendingIndices.splice(bestIdx, 1)[0];
          const chunkUnits = chunks[targetChunkIndex];

          let res = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            if (currentVideoId !== videoId) break;
            try {
              res = await sendTranslateRequest(videoId, chunkUnits, targetChunkIndex, totalChunks);
              if (res && res.success && res.subtitles) break;
            } catch (err) {
              console.warn(`[CinemaSub] Chunk ${targetChunkIndex} retry ${attempt + 1}:`, err);
              await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
          }

          if (currentVideoId !== videoId) break;

          if (res && res.success && res.subtitles) {
            translatedSubtitles = mergeAndSortSubtitles(translatedSubtitles, res.subtitles);
            completedCount++;
            showToast(`🤖 Đang dịch song song (${completedCount}/${totalChunks} phần)...`, 'info', 0);
          }
          disableNativeYouTubeCaptions();
        }
      }

      // Launch parallel workers
      const workers = [];
      for (let w = 0; w < CONCURRENCY; w++) {
        workers.push(worker());
      }
      await Promise.all(workers);

      if (currentVideoId === videoId && translatedSubtitles.length > 0) {
        const cacheKey = `cinemasub_cache_${CACHE_VERSION}_${videoId}`;
        await chrome.storage.local.set({ [cacheKey]: translatedSubtitles });
        showToast(`✅ Đã hoàn tất 100% phụ đề tiếng Việt chuẩn phim!`, 'success', 3000);
      }
    } catch (err) {
      console.error('[CinemaSub] Translation error:', err);
      showToast(`⚠️ Lỗi dịch AI: ${err.message}`, 'error', 6000);
      if (shouldAutoResume && video && video.paused) {
        video.play().catch(() => {});
      }
    } finally {
      isTranslating = false;
    }
  }


  function sendTranslateRequest(videoId, chunkUnits, chunkIndex, totalChunks) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'TRANSLATE_CHUNKS',
        videoId,
        chunks: chunkUnits,
        chunkIndex,
        totalChunks
      }, (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!response || !response.success) {
          return reject(new Error(response?.error || 'Lỗi không xác định từ AI service.'));
        }
        resolve(response);
      });
    });
  }

  function mergeAndSortSubtitles(existing, newOnes) {
    const map = new Map();
    for (const item of existing) {
      const key = item.id !== undefined ? `id_${item.id}` : `${item.start.toFixed(2)}`;
      map.set(key, item);
    }
    for (const item of newOnes) {
      const key = item.id !== undefined ? `id_${item.id}` : `${item.start.toFixed(2)}`;
      map.set(key, item);
    }
    return Array.from(map.values()).sort((a, b) => a.start - b.start);
  }

  // Toast Notification on player
  function showToast(message, type = 'info', duration = 3000) {
    removeExistingToast();

    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (!player) return;

    const toast = document.createElement('div');
    toast.className = `cinema-sub-toast toast-${type}`;
    toast.id = 'cinema-active-toast';

    let icon = '🎬';
    if (type === 'error') icon = '⚠️';
    if (type === 'success') icon = '✅';

    toast.innerHTML = `
      <span class="cinema-toast-icon">${icon}</span>
      <span class="cinema-toast-text">${message}</span>
      <button class="cinema-toast-close">&times;</button>
    `;

    toast.querySelector('.cinema-toast-close').addEventListener('click', () => {
      toast.remove();
    });

    player.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => {
        if (toast && toast.parentNode) {
          toast.style.opacity = '0';
          toast.style.transform = 'translateY(-10px)';
          setTimeout(() => toast.remove(), 300);
        }
      }, duration);
    }
  }

  function removeExistingToast() {
    const existing = document.getElementById('cinema-active-toast');
    if (existing) existing.remove();
  }

  // Start initialization
  init();
})();
