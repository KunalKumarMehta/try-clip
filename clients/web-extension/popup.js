// ClipSync Popup Script
// Handles UI interactions and communication with background service

// DOM Elements
const elements = {
  statusIndicator: document.getElementById('statusIndicator'),
  notConnectedView: document.getElementById('notConnectedView'),
  connectedView: document.getElementById('connectedView'),
  historyView: document.getElementById('historyView'),
  
  // Not Connected View
  createRoomBtn: document.getElementById('createRoomBtn'),
  pairingCodeInput: document.getElementById('pairingCodeInput'),
  joinRoomBtn: document.getElementById('joinRoomBtn'),
  
  // Connected View
  pairingCode: document.getElementById('pairingCode'),
  refreshCodeBtn: document.getElementById('refreshCodeBtn'),
  devicesList: document.getElementById('devicesList'),
  deviceCount: document.getElementById('deviceCount'),
  syncNowBtn: document.getElementById('syncNowBtn'),
  historyBtn: document.getElementById('historyBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  
  // History View
  historyList: document.getElementById('historyList'),
  backFromHistoryBtn: document.getElementById('backFromHistoryBtn'),
  
  // Settings
  settingsBtn: document.getElementById('settingsBtn'),
  settingsModal: document.getElementById('settingsModal'),
  serverUrlInput: document.getElementById('serverUrlInput'),
  autoConnectToggle: document.getElementById('autoConnectToggle'),
  notificationsToggle: document.getElementById('notificationsToggle'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn')
};

// State
let currentPairingCode = null;

// Initialize
async function init() {
  await loadSettings();
  await checkConnectionStatus();
  setupEventListeners();
  setupMessageListener();
}

// Load settings from storage
async function loadSettings() {
  const settings = await chrome.storage.local.get([
    'serverUrl',
    'autoConnect',
    'notifications'
  ]);
  
  elements.serverUrlInput.value = settings.serverUrl || 'http://localhost:3000';
  elements.autoConnectToggle.checked = settings.autoConnect !== false;
  elements.notificationsToggle.checked = settings.notifications !== false;
}

// Check connection status
async function checkConnectionStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getStatus' });
    updateConnectionUI(response.isConnected, response.roomCode);
    
    if (response.isConnected && response.roomCode) {
      await loadDevices();
    }
  } catch (error) {
    console.error('Error checking status:', error);
    updateConnectionUI(false, null);
  }
}

// Update UI based on connection status
function updateConnectionUI(isConnected, roomCode) {
  const statusIndicator = elements.statusIndicator;
  const statusText = statusIndicator.querySelector('.status-text');
  
  if (isConnected && roomCode) {
    statusIndicator.className = 'status-indicator connected';
    statusText.textContent = 'Connected';
    showView('connected');
  } else if (isConnected) {
    statusIndicator.className = 'status-indicator connected';
    statusText.textContent = 'Connected';
    showView('notConnected');
  } else {
    statusIndicator.className = 'status-indicator disconnected';
    statusText.textContent = 'Disconnected';
    showView('notConnected');
  }
}

// Show a specific view
function showView(viewName) {
  elements.notConnectedView.classList.add('hidden');
  elements.connectedView.classList.add('hidden');
  elements.historyView.classList.add('hidden');
  
  switch (viewName) {
    case 'notConnected':
      elements.notConnectedView.classList.remove('hidden');
      break;
    case 'connected':
      elements.connectedView.classList.remove('hidden');
      break;
    case 'history':
      elements.historyView.classList.remove('hidden');
      break;
  }
}

// Setup event listeners
function setupEventListeners() {
  // Create room
  elements.createRoomBtn.addEventListener('click', async () => {
    elements.createRoomBtn.classList.add('loading');
    try {
      const response = await chrome.runtime.sendMessage({ type: 'createRoom' });
      if (response.success) {
        currentPairingCode = response.pairingCode;
        elements.pairingCode.textContent = formatPairingCode(response.pairingCode);
        updateConnectionUI(true, response.roomCode);
        await loadDevices();
      } else {
        showError(response.error);
      }
    } catch (error) {
      showError(error.message);
    }
    elements.createRoomBtn.classList.remove('loading');
  });

  // Join room
  elements.joinRoomBtn.addEventListener('click', async () => {
    const code = elements.pairingCodeInput.value.trim();
    if (!code || code.length !== 6) {
      showError('Please enter a valid 6-digit code');
      return;
    }
    
    elements.joinRoomBtn.classList.add('loading');
    try {
      const response = await chrome.runtime.sendMessage({ 
        type: 'joinRoom',
        pairingCode: code
      });
      if (response.success) {
        updateConnectionUI(true, response.roomCode);
        await loadDevices();
        // Get a new pairing code for this room
        const pairingResponse = await chrome.runtime.sendMessage({ type: 'refreshPairingCode' });
        if (pairingResponse.success) {
          currentPairingCode = pairingResponse.pairingCode;
          elements.pairingCode.textContent = formatPairingCode(pairingResponse.pairingCode);
        }
      } else {
        showError(response.error);
      }
    } catch (error) {
      showError(error.message);
    }
    elements.joinRoomBtn.classList.remove('loading');
  });

  // Pairing code input - auto-submit on 6 digits
  elements.pairingCodeInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    if (e.target.value.length === 6) {
      elements.joinRoomBtn.click();
    }
  });

  // Refresh pairing code
  elements.refreshCodeBtn.addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'refreshPairingCode' });
      if (response.success) {
        currentPairingCode = response.pairingCode;
        elements.pairingCode.textContent = formatPairingCode(response.pairingCode);
        elements.pairingCode.classList.add('pulse');
        setTimeout(() => elements.pairingCode.classList.remove('pulse'), 500);
      }
    } catch (error) {
      showError(error.message);
    }
  });

  // Sync now
  elements.syncNowBtn.addEventListener('click', async () => {
    try {
      // Read from clipboard and send
      const text = await navigator.clipboard.readText();
      if (text) {
        await chrome.runtime.sendMessage({
          type: 'sendClipboard',
          content: text,
          contentType: 'text'
        });
        showSuccess('Clipboard synced!');
      } else {
        showError('Clipboard is empty');
      }
    } catch (error) {
      showError('Cannot access clipboard. Please grant permission.');
    }
  });

  // View history
  elements.historyBtn.addEventListener('click', async () => {
    await loadHistory();
    showView('history');
  });

  // Back from history
  elements.backFromHistoryBtn.addEventListener('click', () => {
    showView('connected');
  });

  // Disconnect
  elements.disconnectBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'disconnect' });
    await chrome.storage.local.remove(['roomCode']);
    updateConnectionUI(false, null);
  });

  // Settings
  elements.settingsBtn.addEventListener('click', () => {
    elements.settingsModal.classList.remove('hidden');
  });

  elements.closeSettingsBtn.addEventListener('click', () => {
    elements.settingsModal.classList.add('hidden');
  });

  elements.saveSettingsBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({
      serverUrl: elements.serverUrlInput.value,
      autoConnect: elements.autoConnectToggle.checked,
      notifications: elements.notificationsToggle.checked
    });
    elements.settingsModal.classList.add('hidden');
    
    // Reconnect with new settings
    await chrome.runtime.sendMessage({ 
      type: 'connect',
      serverUrl: elements.serverUrlInput.value
    });
  });

  // Close modal on backdrop click
  elements.settingsModal.querySelector('.modal-backdrop').addEventListener('click', () => {
    elements.settingsModal.classList.add('hidden');
  });
}

// Setup message listener for updates from background
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'clipboard:received':
        showSuccess('Clipboard received');
        break;
      case 'device:update':
        loadDevices();
        break;
    }
  });
}

// Load connected devices
async function loadDevices() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getDevices' });
    if (response.success) {
      renderDevices(response.devices);
    }
  } catch (error) {
    console.error('Error loading devices:', error);
  }
}

// Render devices list
function renderDevices(devices) {
  elements.deviceCount.textContent = devices.length;
  elements.devicesList.innerHTML = devices.map(device => `
    <li>
      <span class="device-icon">${getDeviceIcon(device.platform)}</span>
      <div class="device-info">
        <div class="device-name">${escapeHtml(device.name || 'Unknown Device')}</div>
        <div class="device-platform">${escapeHtml(device.platform || 'Unknown')}</div>
      </div>
      <span class="device-status"></span>
    </li>
  `).join('');
}

// Load clipboard history
async function loadHistory() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getHistory' });
    if (response.success) {
      renderHistory(response.history);
    }
  } catch (error) {
    console.error('Error loading history:', error);
  }
}

// Render history list
function renderHistory(history) {
  if (history.length === 0) {
    elements.historyList.innerHTML = '<li><div class="history-content">No history yet</div></li>';
    return;
  }
  
  elements.historyList.innerHTML = history.reverse().map(item => `
    <li data-content="${escapeHtml(item.content)}">
      <div class="history-content">${escapeHtml(item.content.substring(0, 100))}</div>
      <div class="history-meta">
        <span>${item.type}</span>
        <span>${formatTime(item.timestamp)}</span>
      </div>
    </li>
  `).join('');
  
  // Add click to copy
  elements.historyList.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', async () => {
      const content = li.dataset.content;
      await navigator.clipboard.writeText(content);
      showSuccess('Copied to clipboard');
    });
  });
}

// Helper functions
function getDeviceIcon(platform) {
  const icons = {
    web: '🌐',
    macos: '🍎',
    windows: '🪟',
    linux: '🐧',
    android: '🤖',
    ios: '📱'
  };
  return icons[platform?.toLowerCase()] || '💻';
}

function formatPairingCode(code) {
  return code.split('').join(' ');
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showError(message) {
  // Simple error display - could be enhanced with toast
  alert(message);
}

function showSuccess(message) {
  // Simple success display - could be enhanced with toast
  console.log('[ClipSync]', message);
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', init);
