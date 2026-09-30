// CinemaSub - Popup Logic (NVIDIA NIM & Google Gemini Support)

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const toggleEnabled = document.getElementById('toggle-enabled');
  const providerGroup = document.getElementById('provider-group');
  const apiKeyLabel = document.getElementById('api-key-label');
  const apiKeyDesc = document.getElementById('api-key-desc');
  const apiKeyInput = document.getElementById('api-key');
  const apiKeyLink = document.getElementById('api-key-link');
  const toggleKeyVisibilityBtn = document.getElementById('toggle-key-visibility');
  const btnTestKey = document.getElementById('btn-test-key');
  const apiStatus = document.getElementById('api-status');
  const modelSelect = document.getElementById('model-select');
  const modeGroup = document.getElementById('mode-group');
  const sizeGroup = document.getElementById('size-group');
  const colorPalette = document.getElementById('color-palette');
  const toggleBackdrop = document.getElementById('toggle-backdrop');
  const btnClearCache = document.getElementById('btn-clear-cache');
  const saveToast = document.getElementById('save-toast');

  // Preview elements
  const previewBox = document.getElementById('preview-sub-box');
  const previewEn = document.getElementById('preview-en');
  const previewVi = document.getElementById('preview-vi');

  const MODEL_OPTIONS = {
    nvidia: [
      { value: 'meta/llama-3.2-11b-vision-instruct', label: 'Meta LLaMA 3.2 11B Instruct (Khuyên dùng - Chuẩn Schema, Khớp 100%)' },
      { value: 'nvidia/nemotron-3.5-lightning-30b-a3b', label: 'NVIDIA Nemotron 3.5 Lightning 30B (Mới nhất - Cực thông minh)' },
      { value: 'meta/llama-3.2-90b-vision-instruct', label: 'Meta LLaMA 3.2 90B Instruct (Mạnh nhất - Siêu thông minh)' },
      { value: 'nvidia/riva-translate-4b-instruct-v2', label: 'Riva-Translate-4B-Instruct-v2 (NVIDIA NIM - Siêu nhẹ)' }
    ],
    gemini: [
      { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (Khuyên dùng - Siêu tốc & Mới nhất)' },
      { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite (Rất nhanh & Ổn định)' },
      { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (Mạnh mẽ - Ngữ cảnh sâu)' }
    ]
  };

  let currentSettings = {
    provider: 'nvidia', // 'nvidia' | 'gemini'
    apiKey: '',
    nvidiaApiKey: '',
    geminiApiKey: '',
    nvidiaModel: 'meta/llama-3.2-11b-vision-instruct',
    geminiModel: 'gemini-3.5-flash-lite',
    mode: 'bilingual',
    fontSize: 'medium',
    subColor: '#FCD34D',
    hasBackdrop: true,
    enabled: true
  };

  // 1. Load settings from storage
  const saved = await chrome.storage.local.get(Object.keys(currentSettings));
  currentSettings = { ...currentSettings, ...saved };

  // Auto-migrate legacy/deprecated models to Meta LLaMA 3.2 11B
  if (!currentSettings.nvidiaModel || 
      currentSettings.nvidiaModel === 'nvidia/riva-translate-4b-instruct-v2' || 
      currentSettings.nvidiaModel === 'meta/llama-3.1-8b-instruct' ||
      currentSettings.nvidiaModel === 'mistralai/mistral-nemo-12b-instruct') {
    currentSettings.nvidiaModel = 'meta/llama-3.2-11b-vision-instruct';
    chrome.storage.local.set({ nvidiaModel: 'meta/llama-3.2-11b-vision-instruct' });
  }

  // Auto-migrate legacy/deprecated Gemini models to Gemini 3.5 Flash-Lite
  if (!currentSettings.geminiModel || 
      currentSettings.geminiModel.startsWith('gemini-1.') || 
      currentSettings.geminiModel.startsWith('gemini-2.')) {
    currentSettings.geminiModel = 'gemini-3.5-flash-lite';
    chrome.storage.local.set({ geminiModel: 'gemini-3.5-flash-lite' });
  }

  // 2. Populate UI
  toggleEnabled.checked = currentSettings.enabled !== false;
  toggleBackdrop.checked = currentSettings.hasBackdrop !== false;

  setActiveSegment(providerGroup, currentSettings.provider || 'nvidia');
  updateProviderUI(currentSettings.provider || 'nvidia');

  setActiveSegment(modeGroup, currentSettings.mode);
  setActiveSegment(sizeGroup, currentSettings.fontSize);
  setActiveColor(currentSettings.subColor);
  updatePreview();

  // --- Provider Change ---
  providerGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment-btn');
    if (!btn) return;
    const provider = btn.dataset.value;
    setActiveSegment(providerGroup, provider);
    currentSettings.provider = provider;
    updateProviderUI(provider);
    saveSetting('provider', provider);
  });

  function updateProviderUI(provider) {
    if (provider === 'nvidia') {
      apiKeyLabel.textContent = 'NVIDIA API Key';
      apiKeyDesc.textContent = 'Dùng Meta LLaMA 3.2 qua NVIDIA NIM (khớp ID 100%).';
      apiKeyInput.placeholder = 'nvapi-...';
      apiKeyInput.value = currentSettings.nvidiaApiKey || (currentSettings.apiKey?.startsWith('nvapi-') ? currentSettings.apiKey : '');
      apiKeyLink.href = 'https://build.nvidia.com/';
      apiKeyLink.textContent = 'Lấy Key NVIDIA ↗';
    } else {
      apiKeyLabel.textContent = 'Google Gemini API Key';
      apiKeyDesc.textContent = 'Cần API Key để AI dịch câu tự nhiên. Miễn phí từ Google.';
      apiKeyInput.placeholder = 'AIzaSy...';
      apiKeyInput.value = currentSettings.geminiApiKey || (currentSettings.apiKey?.startsWith('AIzaSy') ? currentSettings.apiKey : '');
      apiKeyLink.href = 'https://aistudio.google.com/app/apikey';
      apiKeyLink.textContent = 'Lấy Key Gemini ↗';
    }

    // Populate model dropdown
    modelSelect.innerHTML = '';
    const models = MODEL_OPTIONS[provider] || [];
    const selectedModel = provider === 'nvidia' ? currentSettings.nvidiaModel : currentSettings.geminiModel;

    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.value;
      opt.textContent = m.label;
      if (m.value === selectedModel) {
        opt.selected = true;
      }
      modelSelect.appendChild(opt);
    });

    apiStatus.style.display = 'none';
  }

  // --- Event Listeners ---

  // Enabled toggle
  toggleEnabled.addEventListener('change', () => {
    saveSetting('enabled', toggleEnabled.checked);
  });

  // API Key input change
  apiKeyInput.addEventListener('input', () => {
    const key = apiKeyInput.value.trim();
    if (currentSettings.provider === 'nvidia') {
      currentSettings.nvidiaApiKey = key;
      chrome.storage.local.set({ nvidiaApiKey: key, apiKey: key });
    } else {
      currentSettings.geminiApiKey = key;
      chrome.storage.local.set({ geminiApiKey: key, apiKey: key });
    }
    apiStatus.style.display = 'none';
    showSaveToast();
  });

  // Toggle API Key visibility
  toggleKeyVisibilityBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyVisibilityBtn.textContent = '🔒';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyVisibilityBtn.textContent = '👁️';
    }
  });

  // Test API Key button
  btnTestKey.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    const provider = currentSettings.provider || 'nvidia';
    const model = modelSelect.value;

    if (!key) {
      showStatus(`Vui lòng nhập ${provider === 'nvidia' ? 'NVIDIA' : 'Gemini'} API Key trước khi kiểm tra.`, 'error');
      return;
    }

    btnTestKey.disabled = true;
    btnTestKey.querySelector('.btn-text').textContent = 'Đang kiểm tra...';
    apiStatus.style.display = 'none';

    try {
      chrome.runtime.sendMessage({
        action: 'TEST_API_KEY',
        apiKey: key,
        provider: provider,
        model: model
      }, (response) => {
        btnTestKey.disabled = false;
        btnTestKey.querySelector('.btn-text').textContent = 'Kiểm tra kết nối';

        if (response && response.success) {
          showStatus(`Kết nối ${provider === 'nvidia' ? 'NVIDIA' : 'Gemini'} API thành công! Sẵn sàng dịch.`, 'success');
        } else {
          showStatus(`Lỗi: ${response?.error || 'Không thể kết nối API'}`, 'error');
        }
      });
    } catch (err) {
      btnTestKey.disabled = false;
      btnTestKey.querySelector('.btn-text').textContent = 'Kiểm tra kết nối';
      showStatus(`Lỗi: ${err.message}`, 'error');
    }
  });

  // Model change
  modelSelect.addEventListener('change', () => {
    const val = modelSelect.value;
    if (currentSettings.provider === 'nvidia') {
      saveSetting('nvidiaModel', val);
    } else {
      saveSetting('geminiModel', val);
    }
  });

  // Mode change (Bilingual / Vi-only)
  modeGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment-btn');
    if (!btn) return;
    const value = btn.dataset.value;
    setActiveSegment(modeGroup, value);
    saveSetting('mode', value);
  });

  // Size change
  sizeGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment-btn');
    if (!btn) return;
    const value = btn.dataset.value;
    setActiveSegment(sizeGroup, value);
    saveSetting('fontSize', value);
  });

  // Color change
  colorPalette.addEventListener('click', (e) => {
    const btn = e.target.closest('.color-dot');
    if (!btn) return;
    const color = btn.dataset.color;
    setActiveColor(color);
    saveSetting('subColor', color);
  });

  // Backdrop toggle
  toggleBackdrop.addEventListener('change', () => {
    saveSetting('hasBackdrop', toggleBackdrop.checked);
  });

  // Clear cache button
  btnClearCache.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'CLEAR_CACHE' }, (response) => {
      if (response && response.success) {
        alert(`Đã xóa bộ nhớ đệm (${response.removedCount} video đã dịch).`);
      }
    });
  });

  // --- Helper Functions ---

  function setActiveSegment(groupEl, value) {
    groupEl.querySelectorAll('.segment-btn').forEach(btn => {
      if (btn.dataset.value === value) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function setActiveColor(color) {
    colorPalette.querySelectorAll('.color-dot').forEach(dot => {
      if (dot.dataset.color.toLowerCase() === color.toLowerCase()) {
        dot.classList.add('active');
      } else {
        dot.classList.remove('active');
      }
    });
  }

  async function saveSetting(key, value) {
    currentSettings[key] = value;
    await chrome.storage.local.set({ [key]: value });
    updatePreview();
    showSaveToast();
  }

  function updatePreview() {
    if (currentSettings.mode === 'vi-only') {
      previewEn.style.display = 'none';
    } else {
      previewEn.style.display = 'block';
    }

    previewBox.classList.remove('size-small', 'size-medium', 'size-large');
    previewBox.classList.add(`size-${currentSettings.fontSize}`);

    previewVi.style.color = currentSettings.subColor;

    if (currentSettings.hasBackdrop) {
      previewBox.classList.add('has-backdrop');
    } else {
      previewBox.classList.remove('has-backdrop');
    }
  }

  let toastTimer = null;
  function showSaveToast() {
    saveToast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      saveToast.classList.remove('visible');
    }, 1500);
  }

  function showStatus(text, type) {
    apiStatus.textContent = text;
    apiStatus.className = `status-msg ${type}`;
    apiStatus.style.display = 'block';
  }
});
