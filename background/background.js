// CinemaSub - Background Service Worker (Manifest V3)
// Supports NVIDIA NIM (Riva-Translate-4B-Instruct-v2 & LLaMA 3.1) & Google Gemini

const DEFAULT_SETTINGS = {
  provider: 'nvidia', // 'nvidia' | 'gemini'
  apiKey: '',
  nvidiaApiKey: '',
  geminiApiKey: '',
  nvidiaModel: 'nvidia/riva-translate-4b-instruct-v2',
  geminiModel: 'gemini-2.0-flash',
  mode: 'bilingual', // 'bilingual' | 'vi-only'
  fontSize: 'medium', // 'small' | 'medium' | 'large'
  subColor: '#FCD34D', // Cinema Gold
  hasBackdrop: true,
  enabled: true
};

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const toSet = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (current[key] === undefined) {
      toSet[key] = value;
    }
  }
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
  console.log('[CinemaSub] Background worker initialized.');
});

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'TEST_API_KEY') {
    handleTestApiKey(request.apiKey, request.provider, request.model)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // async response
  }

  if (request.action === 'TRANSLATE_CHUNKS') {
    handleTranslateChunks(request.videoId, request.chunks, request.chunkIndex, request.totalChunks)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'CLEAR_CACHE') {
    handleClearCache()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// Test API Key
async function handleTestApiKey(apiKey, provider = 'nvidia', model = 'nvidia/riva-translate-4b-instruct-v2') {
  if (!apiKey || !apiKey.trim()) {
    return { success: false, error: 'Vui lòng nhập API Key' };
  }

  const cleanKey = apiKey.trim();

  if (provider === 'nvidia') {
    const url = 'https://integrate.api.nvidia.com/v1/chat/completions';
    const isRiva = model.toLowerCase().includes('riva-translate');

    const messages = isRiva
      ? [
          { role: 'system', content: 'en-vi' },
          { role: 'user', content: 'Hello world' }
        ]
      : [
          { role: 'user', content: 'Say OK' }
        ];

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cleanKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: 16,
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = errorData.detail || errorData.message || errorData.error?.message || `Lỗi HTTP ${response.status}: ${response.statusText}`;
      throw new Error(`NVIDIA API: ${msg}`);
    }

    return { success: true };
  } else {
    const geminiModel = model || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${cleanKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Trả về từ: OK' }] }],
        generationConfig: { maxOutputTokens: 10 }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = errorData.error?.message || `Lỗi HTTP ${response.status}: ${response.statusText}`;
      throw new Error(`Gemini API: ${msg}`);
    }

    return { success: true };
  }
}

// Translate a batch of subtitle fragments
async function handleTranslateChunks(videoId, fragments, chunkIndex = 0, totalChunks = 1) {
  const settings = await chrome.storage.local.get([
    'provider', 'apiKey', 'nvidiaApiKey', 'geminiApiKey', 'nvidiaModel', 'geminiModel'
  ]);

  const provider = settings.provider || 'nvidia';
  const apiKey = (provider === 'nvidia' ? (settings.nvidiaApiKey || settings.apiKey) : (settings.geminiApiKey || settings.apiKey))?.trim();

  if (!apiKey) {
    throw new Error(`Chưa cài đặt ${provider === 'nvidia' ? 'NVIDIA' : 'Gemini'} API Key. Vui lòng mở popup extension để nhập key.`);
  }

  if (provider === 'nvidia') {
    const model = settings.nvidiaModel || 'nvidia/riva-translate-4b-instruct-v2';
    return await translateWithNvidia(apiKey, model, fragments, chunkIndex, totalChunks);
  } else {
    const model = settings.geminiModel || 'gemini-2.0-flash';
    return await translateWithGemini(apiKey, model, fragments, chunkIndex, totalChunks);
  }
}

// --- NVIDIA NIM TRANSLATION PIPELINE ---
async function translateWithNvidia(apiKey, model, items, chunkIndex, totalChunks) {
  const units = ensureSubtitleUnits(items);
  if (units.length === 0) {
    return { success: true, chunkIndex, totalChunks, subtitles: [] };
  }

  const isRiva = model.toLowerCase().includes('riva-translate');

  if (isRiva) {
    // Riva Translate 4B is an NMT model optimized for direct en-vi translation
    // We send numbered lines using local 1-based indices: 1. Text
    const inputLines = units.map((u, idx) => `${idx + 1}. ${u.text}`).join('\n');

    const url = 'https://integrate.api.nvidia.com/v1/chat/completions';
    const payload = {
      model: model,
      messages: [
        { role: 'system', content: 'en-vi' },
        { role: 'user', content: inputLines }
      ],
      temperature: 0.1,
      max_tokens: 4096
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err.detail || err.error?.message || `Lỗi HTTP ${response.status}: ${response.statusText}`;
      throw new Error(`NVIDIA API (${response.status}): ${msg}`);
    }

    const data = await response.json();
    const rawOutput = data.choices?.[0]?.message?.content || '';

    // Map each translated line back to original unit's exact audio timestamps!
    const subtitles = mapTranslationsToUnits(units, rawOutput);

    return {
      success: true,
      chunkIndex,
      totalChunks,
      subtitles
    };
  } else {
    // General LLM on NVIDIA NIM (e.g. meta/llama-3.1-8b-instruct or mistralai/mistral-nemo-12b-instruct)
    const jsonInput = units.map((u, idx) => ({
      id: idx + 1,
      start: u.start,
      end: u.end,
      en: u.text
    }));

    const prompt = 
`You are a professional cinema subtitle translator. Translate each subtitle into natural, fluent Vietnamese for movie subtitles.
Keep the exact same JSON array structure and IDs.
Output MUST strictly be a JSON array of objects:
[
  {
    "id": 1,
    "start": 0.5,
    "end": 3.8,
    "en": "English sentence",
    "vi": "Câu dịch tiếng Việt chuẩn phụ đề phim rạp"
  }
]

Subtitles to translate:
${JSON.stringify(jsonInput, null, 2)}`;

    const url = 'https://integrate.api.nvidia.com/v1/chat/completions';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 3500
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`NVIDIA API: ${err.detail || err.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const textOutput = data.choices?.[0]?.message?.content || '';
    const subtitles = parseSubtitlesJsonWithUnits(units, textOutput);

    return {
      success: true,
      chunkIndex,
      totalChunks,
      subtitles
    };
  }
}

// --- GEMINI TRANSLATION PIPELINE ---
async function translateWithGemini(apiKey, model, items, chunkIndex, totalChunks) {
  const units = ensureSubtitleUnits(items);
  if (units.length === 0) {
    return { success: true, chunkIndex, totalChunks, subtitles: [] };
  }

  const jsonInput = units.map((u, idx) => ({
    id: idx + 1,
    start: u.start,
    end: u.end,
    en: u.text
  }));

  const systemInstruction = 
`You are a professional Hollywood cinema subtitler and Vietnamese translator.
Translate the English subtitles into natural, fluent Vietnamese cinema subtitles.
Maintain the exact JSON array schema and IDs.
Output MUST strictly be a JSON array of objects:
[
  {
    "id": 1,
    "start": 0.5,
    "end": 3.8,
    "en": "English sentence",
    "vi": "Câu dịch tiếng Việt chuẩn phụ đề phim rạp."
  }
]`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: `${systemInstruction}\n\nSubtitles to translate:\n${JSON.stringify(jsonInput, null, 2)}` }]
      }],
      generationConfig: {
        temperature: 0.2,
        response_mime_type: 'application/json'
      }
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Lỗi API (${response.status}): ${response.statusText}`);
  }

  const data = await response.json();
  const textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const subtitles = parseSubtitlesJsonWithUnits(units, textOutput);

  return {
    success: true,
    chunkIndex,
    totalChunks,
    subtitles
  };
}

// Convert input items to well-defined Subtitle Units (with id, start, end, text)
function ensureSubtitleUnits(items) {
  if (!items || items.length === 0) return [];
  // If items already have unit structure (id, end, text)
  if (items[0].id !== undefined && items[0].end !== undefined && items[0].text !== undefined) {
    return items;
  }
  // Otherwise, group raw fragments into cinema units
  return buildCinemaSubtitleUnits(items);
}

// Group raw speech fragments into cinema-length subtitle units (3.0s - 5.5s)
// respecting natural pauses (> 0.35s) and sentence endings
function buildCinemaSubtitleUnits(fragments) {
  if (!fragments || fragments.length === 0) return [];

  const units = [];
  let currentFrags = [];
  let currentStart = null;
  let currentEnd = null;

  for (let i = 0; i < fragments.length; i++) {
    const f = fragments[i];
    const text = (f.text || '').trim();
    if (!text) continue;

    if (currentStart === null) {
      currentStart = f.start;
    }
    currentEnd = f.start + f.duration;
    currentFrags.push(f);

    const fullText = currentFrags.map(x => x.text.trim()).join(' ');
    const wordCount = fullText.split(/\s+/).length;
    const curDuration = currentEnd - currentStart;

    // Check gap/silence pause to next fragment
    let hasPause = false;
    if (i + 1 < fragments.length) {
      const nextFrag = fragments[i + 1];
      const gap = nextFrag.start - currentEnd;
      if (gap >= 0.35) {
        hasPause = true;
      }
    }

    const hasPunctuation = /[.?!;]$/.test(text);
    const isLast = i === fragments.length - 1;

    // Subtitle unit boundary condition:
    // Natural cinema sentence: up to 6.5s duration, 16-18 words max
    // Only close early if sentence punctuation or distinct speech pause occurs
    const shouldClose = isLast
      || hasPunctuation
      || (hasPause && curDuration >= 2.8)
      || (curDuration >= 5.0 && wordCount >= 12)
      || curDuration >= 6.5
      || wordCount >= 18;

    if (shouldClose) {
      units.push({
        id: units.length + 1,
        start: parseFloat(currentStart.toFixed(2)),
        end: parseFloat(currentEnd.toFixed(2)),
        duration: parseFloat(curDuration.toFixed(2)),
        text: capitalizeFirst(fullText)
      });
      currentFrags = [];
      currentStart = null;
      currentEnd = null;
    }
  }

  if (currentFrags.length > 0 && currentStart !== null) {
    const fullText = currentFrags.map(x => x.text.trim()).join(' ');
    units.push({
      id: units.length + 1,
      start: parseFloat(currentStart.toFixed(2)),
      end: parseFloat(currentEnd.toFixed(2)),
      duration: parseFloat((currentEnd - currentStart).toFixed(2)),
      text: capitalizeFirst(fullText)
    });
  }

  return units;
}

// Map Riva translation output back to original Subtitle Units
// Guaranteed: audio timestamps (start, end) are 100% PRESERVED from YouTube audio!
function mapTranslationsToUnits(units, rawOutput) {
  if (!units || units.length === 0) return [];
  if (!rawOutput || !rawOutput.trim()) {
    return units.map(u => ({ id: u.id, start: u.start, end: u.end, en: u.text, vi: u.text }));
  }

  // Step 1: Riva often returns everything on ONE line like:
  // "1. Xin chào 2. Thế giới 3. Tạm biệt"
  // We need to split on numbered patterns first, THEN fall back to newlines.
  const lineMap = new Map();

  // Try splitting by numbered pattern inline: look for "N. text" or "N) text" patterns
  const numberedPattern = /(?:^|\s)(\d+)\s*[.\):\-]\s+/g;
  const inlineMatches = [...rawOutput.matchAll(numberedPattern)];

  if (inlineMatches.length >= 2) {
    for (let m = 0; m < inlineMatches.length; m++) {
      const match = inlineMatches[m];
      const id = parseInt(match[1], 10);
      const startPos = match.index + match[0].length;
      let endPos;
      if (m + 1 < inlineMatches.length) {
        endPos = inlineMatches[m + 1].index;
      } else {
        endPos = rawOutput.length;
      }
      const text = rawOutput.slice(startPos, endPos).trim();
      if (text) lineMap.set(id, text);
    }
  }

  // If inline parsing found enough matches, use them
  if (lineMap.size >= Math.max(1, Math.floor(units.length * 0.4))) {
    console.log('[CinemaSub] Mapped ' + lineMap.size + '/' + units.length + ' via inline numbered pattern.');
    return units.map(function(u, idx) {
      var localId = idx + 1;
      var vi = lineMap.get(localId) || lineMap.get(u.id) || u.text;
      return { id: u.id, start: u.start, end: u.end, en: u.text, vi: vi };
    });
  }

  // Fallback: Try newline-separated parsing
  var lines = rawOutput.replace(/\r\n/g, '\n').split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
  var lineMap2 = new Map();

  for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    var m2 = line.match(/^(?:\[(\d+)\]|(\d+)[\.:\-\)\s]+)\s*(.+)$/);
    if (m2) {
      var id2 = parseInt(m2[1] || m2[2], 10);
      var text2 = (m2[3] || '').trim();
      if (text2) lineMap2.set(id2, text2);
    }
  }

  if (lineMap2.size >= Math.max(1, Math.floor(units.length * 0.4))) {
    console.log('[CinemaSub] Mapped ' + lineMap2.size + '/' + units.length + ' via newline numbered pattern.');
    return units.map(function(u, idx) {
      var localId = idx + 1;
      var vi = lineMap2.get(localId) || lineMap2.get(u.id) || u.text;
      return { id: u.id, start: u.start, end: u.end, en: u.text, vi: vi };
    });
  }

  // Last fallback: Sequential line-by-line matching
  console.log('[CinemaSub] Falling back to sequential line matching.');
  return units.map(function(u, idx) {
    var vi = u.text;
    if (idx < lines.length) {
      vi = cleanNumberedPrefix(lines[idx]) || u.text;
    }
    return { id: u.id, start: u.start, end: u.end, en: u.text, vi: vi };
  });
}

// Parse structured JSON array from LLM (LLaMA 3.1 / Gemini)
// Guaranteed: audio timestamps (start, end) are 100% PRESERVED from YouTube audio!
function parseSubtitlesJsonWithUnits(units, textOutput) {
  let parsed = [];
  try {
    parsed = JSON.parse(textOutput);
  } catch (parseErr) {
    const jsonMatch = textOutput.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (e) {}
    }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    // If model returned plain text instead of JSON, map as text
    return mapTranslationsToUnits(units, textOutput);
  }

  // Map parsed JSON objects back to our immutable audio units
  return units.map((u, idx) => {
    const localId = idx + 1;
    const item = parsed.find(p => p.id === localId || p.id === u.id) || parsed[idx] || {};
    const vi = (item.vi || item.text || item.vietnamese || '').trim();
    return {
      id: u.id,
      start: u.start, // Always enforce audio start
      end: u.end,     // Always enforce audio end
      en: u.text,
      vi: vi || u.text
    };
  });
}

function cleanNumberedPrefix(str) {
  if (!str) return '';
  return str.replace(/^(?:\[\d+\]|\d+[\.\:\-\)]\s*)/, '').trim();
}

function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Clear cached subtitle data from local storage
async function handleClearCache() {
  const allData = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(allData).filter(key => key.startsWith('cinemasub_cache_'));
  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
  return { success: true, removedCount: keysToRemove.length };
}
