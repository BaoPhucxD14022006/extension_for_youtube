// CinemaSub - Page Bridge (Runs in MAIN world to intercept network and access YouTube player)

(() => {
  console.log('[CinemaSub Bridge] Running in YouTube MAIN world with Network Interceptor.');

  let capturedTranscript = {
    videoId: null,
    url: null,
    lang: null,
    text: null
  };

  function getCurrentVideoId() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('v');
    } catch (e) {
      return null;
    }
  }

  // --- 1. NETWORK INTERCEPTOR ---
  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    const response = await originalFetch.apply(this, args);

    if (url && url.includes('/api/timedtext')) {
      try {
        const clone = response.clone();
        const text = await clone.text();
        if (text && text.trim()) {
          const urlObj = new URL(url, window.location.href);
          const lang = urlObj.searchParams.get('lang') || urlObj.searchParams.get('hl') || null;
          const v = urlObj.searchParams.get('v') || getCurrentVideoId();

          console.log('[CinemaSub Bridge] Intercepted timedtext via fetch! Video:', v, 'Lang:', lang, 'Length:', text.length);
          capturedTranscript = {
            videoId: v,
            url: url,
            lang: lang,
            text: text
          };

          window.postMessage({
            type: 'CINEMA_SUB_INTERCEPTED_TRANSCRIPT',
            videoId: v,
            url: url,
            lang: lang,
            text: text
          }, '*');
          setTimeout(hideNativePlayerCaptions, 150);
        }
      } catch (e) {
        // Ignore clone errors
      }
    }
    return response;
  };

  // Intercept XMLHttpRequest
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._cinemaUrl = url;
    return originalXhrOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    if (this._cinemaUrl && this._cinemaUrl.includes('/api/timedtext')) {
      this.addEventListener('load', function() {
        if (this.responseText && this.responseText.trim()) {
          try {
            const urlObj = new URL(this._cinemaUrl, window.location.href);
            const lang = urlObj.searchParams.get('lang') || urlObj.searchParams.get('hl') || null;
            const v = urlObj.searchParams.get('v') || getCurrentVideoId();

            console.log('[CinemaSub Bridge] Intercepted timedtext via XHR! Video:', v, 'Lang:', lang, 'Length:', this.responseText.length);
            capturedTranscript = {
              videoId: v,
              url: this._cinemaUrl,
              lang: lang,
              text: this.responseText
            };

            window.postMessage({
              type: 'CINEMA_SUB_INTERCEPTED_TRANSCRIPT',
              videoId: v,
              url: this._cinemaUrl,
              lang: lang,
              text: this.responseText
            }, '*');
            setTimeout(hideNativePlayerCaptions, 150);
          } catch (e) {}
        }
      });
    }
    return originalXhrSend.apply(this, args);
  };

  // --- 2. PLAYER CONTROLLER ---
  function getCaptionTracksFromPage() {
    try {
      // Strategy 1: YouTube movie_player instance
      const player = document.getElementById('movie_player');
      if (player && typeof player.getPlayerResponse === 'function') {
        const resp = player.getPlayerResponse();
        const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (tracks && tracks.length > 0) {
          console.log('[CinemaSub Bridge] Found tracks via movie_player:', tracks.length);
          return tracks;
        }
      }

      // Strategy 2: ytd-watch-flexy component data
      const watchFlexy = document.querySelector('ytd-watch-flexy');
      if (watchFlexy?.playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
        const tracks = watchFlexy.playerData.captions.playerCaptionsTracklistRenderer.captionTracks;
        if (tracks && tracks.length > 0) {
          console.log('[CinemaSub Bridge] Found tracks via ytd-watch-flexy:', tracks.length);
          return tracks;
        }
      }

      // Strategy 3: window.ytInitialPlayerResponse
      if (window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
        const tracks = window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
        if (tracks && tracks.length > 0) {
          console.log('[CinemaSub Bridge] Found tracks via ytInitialPlayerResponse:', tracks.length);
          return tracks;
        }
      }

      // Strategy 4: Raw player response in ytplayer config
      const rawResp = window.ytplayer?.config?.args?.raw_player_response;
      if (rawResp) {
        const parsed = typeof rawResp === 'string' ? JSON.parse(rawResp) : rawResp;
        const tracks = parsed?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (tracks && tracks.length > 0) {
          console.log('[CinemaSub Bridge] Found tracks via ytplayer.config:', tracks.length);
          return tracks;
        }
      }
    } catch (e) {
      console.warn('[CinemaSub Bridge] Error extracting caption tracks:', e);
    }
    return [];
  }

  // Tell player to activate/request captions to trigger network fetch
  function triggerPlayerCaptions(lang = 'en') {
    try {
      const player = document.getElementById('movie_player');
      if (player) {
        console.log('[CinemaSub Bridge] Triggering player to load captions for:', lang);
        if (typeof player.loadModule === 'function') {
          player.loadModule('captions');
        }
        if (typeof player.setOption === 'function') {
          player.setOption('captions', 'track', { languageCode: lang });
          player.setOption('captions', 'reload', true);
        }
      }
    } catch (e) {
      console.warn('[CinemaSub Bridge] Error triggering player captions:', e);
    }
  }

  // Turn off native YouTube captions inside the player so native English CC never renders
  function hideNativePlayerCaptions() {
    try {
      const player = document.getElementById('movie_player');
      if (player && typeof player.setOption === 'function') {
        player.setOption('captions', 'track', {});
      }
    } catch (e) {
      // Ignore
    }
  }

  function respondTracks() {
    const tracks = getCaptionTracksFromPage();
    const curVideoId = getCurrentVideoId();
    const text = (capturedTranscript.videoId === curVideoId) ? capturedTranscript.text : null;
    window.postMessage({
      type: 'CINEMA_SUB_TRACKS_RESULT',
      videoId: curVideoId,
      tracks: tracks,
      capturedTranscript: text
    }, '*');

    document.dispatchEvent(new CustomEvent('CINEMA_SUB_TRACKS_RESULT_DOC', {
      detail: JSON.stringify({ videoId: curVideoId, tracks: tracks })
    }));
  }

  // --- 3. EVENT LISTENERS ---
  window.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.type === 'CINEMA_SUB_GET_TRACKS') {
      respondTracks();
    } else if (event.data.type === 'CINEMA_SUB_TRIGGER_CAPTIONS') {
      triggerPlayerCaptions(event.data.lang || 'en');
    } else if (event.data.type === 'CINEMA_SUB_HIDE_NATIVE_CAPTIONS') {
      hideNativePlayerCaptions();
    }
  });

  document.addEventListener('CINEMA_SUB_GET_TRACKS_DOC', () => {
    respondTracks();
  });

  window.addEventListener('yt-navigate-finish', () => {
    capturedTranscript = { videoId: null, url: null, lang: null, text: null };
    hideNativePlayerCaptions();
    setTimeout(respondTracks, 1000);
  });
})();
