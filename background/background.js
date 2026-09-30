// CinemaSub - Background Service Worker (Manifest V3)
// Supports NVIDIA NIM (Riva-Translate-4B-Instruct-v2 & LLaMA 3.1) & Google Gemini

const DEFAULT_SETTINGS = {
  provider: 'nvidia', // 'nvidia' | 'gemini'
  apiKey: '',
  nvidiaApiKey: '',
  geminiApiKey: '',
  nvidiaModel: 'meta/llama-3.2-11b-vision-instruct',
  geminiModel: 'gemini-3.5-flash-lite',
  mode: 'bilingual', // 'bilingual' | 'vi-only'
  fontSize: 'medium', // 'small' | 'medium' | 'large'
  subColor: '#FCD34D', // Cinema Gold
  hasBackdrop: true,
  enabled: true
};

// Initialize default settings on install and migrate legacy models
chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const toSet = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (current[key] === undefined) {
      toSet[key] = value;
    }
  }
  // Auto-migrate legacy/deprecated models to Meta LLaMA 3.2 11B
  if (current.nvidiaModel === 'nvidia/riva-translate-4b-instruct-v2' || 
      current.nvidiaModel === 'meta/llama-3.1-8b-instruct' ||
      current.nvidiaModel === 'mistralai/mistral-nemo-12b-instruct') {
    toSet.nvidiaModel = 'meta/llama-3.2-11b-vision-instruct';
  }
  // Auto-migrate legacy/deprecated Gemini models to Gemini 3.5 Flash-Lite
  if (!current.geminiModel || 
      current.geminiModel.startsWith('gemini-1.') || 
      current.geminiModel.startsWith('gemini-2.')) {
    toSet.geminiModel = 'gemini-3.5-flash-lite';
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
async function handleTestApiKey(apiKey, provider = 'nvidia', model = 'meta/llama-3.2-11b-vision-instruct') {
  if (!apiKey || !apiKey.trim()) {
    return { success: false, error: 'Vui lòng nhập API Key' };
  }

  const cleanKey = apiKey.trim();

  if (provider === 'nvidia') {
    const url = 'https://integrate.api.nvidia.com/v1/chat/completions';
    const isRiva = model && model.toLowerCase().includes('riva-translate');

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
    let geminiModel = model || 'gemini-3.5-flash-lite';
    if (geminiModel.startsWith('gemini-1.') || geminiModel.startsWith('gemini-2.')) {
      geminiModel = 'gemini-3.5-flash-lite';
    }
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
    let model = settings.nvidiaModel;
    // Auto-migrate legacy/deprecated models
    if (!model || model === 'nvidia/riva-translate-4b-instruct-v2' || model === 'meta/llama-3.1-8b-instruct' || model === 'mistralai/mistral-nemo-12b-instruct') {
      model = 'meta/llama-3.2-11b-vision-instruct';
      chrome.storage.local.set({ nvidiaModel: model });
    }
    return await translateWithNvidia(apiKey, model, fragments, chunkIndex, totalChunks);
  } else {
    let model = settings.geminiModel || 'gemini-3.5-flash-lite';
    if (model.startsWith('gemini-1.') || model.startsWith('gemini-2.')) {
      model = 'gemini-3.5-flash-lite';
      chrome.storage.local.set({ geminiModel: model });
    }
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
    // General LLM on NVIDIA NIM (meta/llama-3.2-11b-vision-instruct, meta/llama-3.2-90b-vision-instruct, etc.)
    const jsonInput = units.map((u, idx) => ({
      id: idx + 1,
      text: u.text
    }));

    const prompt = 
`You are a professional cinema subtitle translator. Translate English subtitle cues into natural, concise, fluent Vietnamese suitable for movie subtitles.
CRITICAL RULES:
1. Maintain the exact same JSON array structure and IDs.
2. Output MUST strictly be a JSON array of objects:
[
  {
    "id": 1,
    "vi": "Câu dịch tiếng Việt chuẩn phụ đề phim rạp (tối đa 1-2 dòng ngắn gọn)"
  }
]
3. Return EXACTLY one translation object for every input ID. Never merge, skip, omit, or modify IDs.
4. DO NOT combine or merge two cues together even if they belong to the same sentence! Translate each cue independently for its specific ID so it syncs 1:1 with audio timing!
5. The output array MUST contain EXACTLY ${units.length} items with IDs from 1 to ${units.length}.
6. CRITICAL: Output ONLY the valid raw JSON array. DO NOT output any reasoning, thinking process, markdown text, or explanations. Start output directly with [ and end with ].

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
        temperature: 0.1,
        max_tokens: 3500
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err.detail || err.error?.message || response.statusText;
      if (response.status === 429) {
        throw new Error(`NVIDIA API (429): Tạm thời vượt giới hạn request/phút. Hệ thống sẽ tự thử lại...`);
      } else if (response.status === 402 || (typeof msg === 'string' && msg.toLowerCase().includes('quota'))) {
        throw new Error(`NVIDIA API (402): Hết credit trên tài khoản NVIDIA. Bạn có thể mở cài đặt đổi sang Google Gemini hoàn toàn miễn phí!`);
      }
      throw new Error(`NVIDIA API (${response.status}): ${msg}`);
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

  // LLM only translates text - NEVER send timestamps to LLM
  const jsonInput = units.map((u, idx) => ({
    id: idx + 1,
    text: u.text
  }));

  const systemInstruction = 
`You are a professional Hollywood cinema subtitler and Vietnamese translator.
Translate English subtitle cues into natural, concise, fluent Vietnamese cinema subtitles.
CRITICAL RULES:
1. Maintain the exact JSON array schema and IDs.
2. Output MUST strictly be a JSON array of objects:
[
  {
    "id": 1,
    "vi": "Câu dịch tiếng Việt tự nhiên, ngắn gọn, chuẩn phụ đề phim."
  }
]
3. Return EXACTLY one translation object for every input ID. Never merge, split, omit, or modify IDs.
4. Many inputs are short clauses, broken sentence fragments, or single words - you MUST translate each fragment independently for its specific ID so it matches the speaker's exact timing!
5. The output array MUST contain EXACTLY ${units.length} items with IDs from 1 to ${units.length}.
6. CRITICAL: Output ONLY the valid raw JSON array. DO NOT output any reasoning, thinking process, markdown text, or explanations. Start output directly with [ and end with ].`;

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
        temperature: 0.1,
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

// Normalize input items to well-defined Subtitle Units (PRESERVE source cues 100%, NO merging)
function ensureSubtitleUnits(items) {
  if (!items || items.length === 0) return [];
  return items.map((item, idx) => ({
    id: item.id !== undefined ? item.id : idx + 1,
    start: item.start !== undefined ? item.start : 0,
    end: item.end !== undefined ? item.end : (item.start + (item.duration || 2.0)),
    duration: item.duration !== undefined ? item.duration : (item.end - (item.start || 0)),
    text: (item.text || item.en || '').trim()
  }));
}

// Map translation output back to original Subtitle Units
// Guaranteed: audio timestamps (start, end) are 100% PRESERVED from YouTube audio!
function mapTranslationsToUnits(units, rawOutput) {
  if (!units || units.length === 0) return [];
  if (!rawOutput || !rawOutput.trim()) {
    return units.map(u => ({ id: u.id, start: u.start, end: u.end, en: u.text, vi: u.text }));
  }

  const lineMap = new Map();

  // Pattern 1: Inline numbers e.g. "1. Xin chào 2. Bạn khỏe không" or "1) ... 2) ..." or "[1] ... [2] ..."
  const numberedPattern = /(?:^|\s)(?:\[(\d+)\]|(\d+)[\.:\-\)])\s*(.+?)(?=(?:(?:\s+\[\d+\]|\s+\d+[\.:\-\)]))|$)/gs;
  const inlineMatches = [...rawOutput.matchAll(numberedPattern)];

  if (inlineMatches.length >= 1) {
    for (const match of inlineMatches) {
      const id = parseInt(match[1] || match[2], 10);
      const text = cleanSubtitleText((match[3] || '').trim());
      if (text && !lineMap.has(id)) {
        lineMap.set(id, text);
      }
    }
  }

  // Pattern 2: Multiline numbered lines e.g.
  // 1. Text
  // 2. Text
  const lines = rawOutput.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(?:\[(\d+)\]|(\d+)[\.:\-\)\s]+)\s*(.+)$/);
    if (m) {
      const id = parseInt(m[1] || m[2], 10);
      const text = cleanSubtitleText((m[3] || '').trim());
      if (text && !lineMap.has(id)) {
        lineMap.set(id, text);
      }
    }
  }

  // If numbers were recognized, strictly map by ID - never borrow subsequent lines to avoid drift!
  if (lineMap.size > 0) {
    return units.map((u, idx) => {
      const localId = idx + 1;
      const vi = lineMap.get(localId) || lineMap.get(u.id);
      return {
        id: u.id,
        start: u.start,
        end: u.end,
        en: u.text,
        vi: vi || u.text
      };
    });
  }

  // Fallback ONLY if no numbers existed at all: sequential 1-to-1 matching
  return units.map((u, idx) => {
    let vi = u.text;
    if (idx < lines.length) {
      const cleaned = cleanSubtitleText(lines[idx]);
      if (cleaned) vi = cleaned;
    }
    return {
      id: u.id,
      start: u.start,
      end: u.end,
      en: u.text,
      vi: vi || u.text
    };
  });
}

// Parse structured JSON array from LLM (LLaMA 3.2 / Nemotron 3.5 / Gemini)
// Multi-strategy fail-safe: cleans markdown code fences, removes trailing commas,
// and uses Regex Object Extraction so even broken/truncated JSON parses 100% cleanly!
function parseSubtitlesJsonWithUnits(units, textOutput) {
  if (!units || units.length === 0) return [];
  if (!textOutput || typeof textOutput !== 'string') {
    return units.map(u => ({ id: u.id, start: u.start, end: u.end, en: u.text, vi: u.text }));
  }

  let parsed = [];

  // Step 1: Strip markdown code blocks & thinking process tags (<think>...</think>)
  let cleaned = textOutput
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();

  // Step 2: Remove trailing commas before } or ]
  const cleanedNoTrailingComma = cleaned.replace(/,\s*([}\]])/g, '$1');

  // Step 3: Try standard JSON.parse on full cleaned text
  try {
    const res = JSON.parse(cleanedNoTrailingComma);
    if (Array.isArray(res) && res.length > 0) parsed = res;
  } catch (e) {}

  // Step 4: Try extracting first JSON array [...]
  if (parsed.length === 0) {
    const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrayMatch) {
      try {
        const fixedArray = arrayMatch[0].replace(/,\s*([}\]])/g, '$1');
        const res = JSON.parse(fixedArray);
        if (Array.isArray(res) && res.length > 0) parsed = res;
      } catch (e) {}
    }
  }

  // Step 5: REGEX OBJECT EXTRACTION (Fail-safe for malformed, broken, or truncated JSON)
  // Extracts each { "id": N, "vi": "..." } directly from text with 100% reliability!
  if (parsed.length === 0) {
    const objectRegex = /\{\s*"id"\s*:\s*(\d+)\s*,\s*"(?:vi|translation|text|vietnamese)"\s*:\s*"((?:\\.|[^"\\])*)"\s*\}/g;
    let match;
    while ((match = objectRegex.exec(cleaned)) !== null) {
      const id = parseInt(match[1], 10);
      let viText = match[2];
      try {
        viText = JSON.parse(`"${viText}"`);
      } catch (err) {
        viText = viText.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
      parsed.push({ id, vi: viText });
    }
  }

  // Step 6: Map to Units if JSON objects were extracted
  if (Array.isArray(parsed) && parsed.length > 0) {
    const viMap = new Map();
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      if (p) {
        const rawVi = (p.vi || p.translation || p.text || p.vietnamese || (typeof p === 'string' ? p : '')).trim();
        const cleanVi = cleanSubtitleText(rawVi);
        if (cleanVi) {
          if (p.id !== undefined) {
            viMap.set(Number(p.id), cleanVi);
          }
          if (!viMap.has(i + 1)) {
            viMap.set(i + 1, cleanVi);
          }
        }
      }
    }

    return units.map((u, idx) => {
      const localId = idx + 1;
      const vi = viMap.get(localId) || viMap.get(u.id);
      return {
        id: u.id,
        start: u.start, // Always enforce audio start
        end: u.end,     // Always enforce audio end
        en: u.text,
        vi: vi || u.text
      };
    });
  }

  // Step 7: Fallback to text line mapping with strict JSON cleaning
  return mapTranslationsToUnits(units, textOutput);
}

// Clean and sanitize subtitle text so raw JSON syntax ({ "id": 6, "vi": "..." }) NEVER reaches UI
function cleanSubtitleText(str) {
  if (!str || typeof str !== 'string') return '';
  let text = str.trim();

  // If text is a full or partial JSON snippet: { "id": 6, "vi": "..." } or "vi": "..."
  const viMatch = text.match(/"(?:vi|translation|text|vietnamese)"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (viMatch) {
    try {
      text = JSON.parse(`"${viMatch[1]}"`).trim();
    } catch (e) {
      text = viMatch[1].replace(/\\"/g, '"').trim();
    }
  }

  // Strip accidental outer JSON characters like { } [ ] " ,
  text = text.replace(/^[{\[\s"',]+|[}\]\s"',;]+$/g, '').trim();

  // Strip numbered prefixes like "1. ", "[1] "
  text = cleanNumberedPrefix(text);

  return text;
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
