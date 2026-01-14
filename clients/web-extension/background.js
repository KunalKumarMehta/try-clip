// ClipSync Background Service Worker
// Handles WebSocket connection and clipboard synchronization

import { io } from './lib/socket.io.esm.min.js';

let socket = null;
let currentRoomCode = null;
let isConnected = false;
let deviceInfo = {
  name: 'Chrome Browser',
  platform: 'web',
  browser: navigator.userAgent.includes('Firefox') ? 'Firefox' : 'Chrome'
};

// Configuration
const DEFAULT_SERVER = 'http://localhost:3000';

// Initialize connection
async function connect(serverUrl = DEFAULT_SERVER) {
  if (socket?.connected) {
    console.log('[ClipSync] Already connected');
    return;
  }

  const config = await chrome.storage.local.get(['serverUrl']);
  const url = config.serverUrl || serverUrl;

  console.log('[ClipSync] Connecting to:', url);

  socket = io(url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  });

  socket.on('connect', () => {
    console.log('[ClipSync] Connected to server');
    isConnected = true;
    updateBadge('connected');
    
    // Try to rejoin previous room
    chrome.storage.local.get(['roomCode'], (data) => {
      if (data.roomCode) {
        rejoinRoom(data.roomCode);
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('[ClipSync] Disconnected from server');
    isConnected = false;
    updateBadge('disconnected');
  });

  socket.on('connect_error', (error) => {
    console.error('[ClipSync] Connection error:', error.message);
    updateBadge('error');
  });

  // Handle incoming clipboard sync
  socket.on('clipboard:sync', async (data) => {
    console.log('[ClipSync] Received clipboard:', data.type);
    
    if (data.type === 'text') {
      await writeToClipboard(data.content);
      showNotification('Clipboard Synced', data.content.substring(0, 100));
    } else if (data.type === 'image') {
      // Handle image sync (base64)
      await writeImageToClipboard(data.content);
      showNotification('Image Synced', 'An image was synced to your clipboard');
    }
    
    // Broadcast to popup if open
    chrome.runtime.sendMessage({ type: 'clipboard:received', data });
  });

  socket.on('device:joined', (data) => {
    console.log('[ClipSync] Device joined:', data.deviceInfo?.name);
    showNotification('Device Connected', `${data.deviceInfo?.name || 'A device'} joined the sync`);
    chrome.runtime.sendMessage({ type: 'device:update', data });
  });

  socket.on('device:left', (data) => {
    console.log('[ClipSync] Device left:', data.deviceInfo?.name);
    chrome.runtime.sendMessage({ type: 'device:update', data });
  });
}

// Create a new room
function createRoom() {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('Not connected to server'));
      return;
    }

    socket.emit('room:create', deviceInfo, (response) => {
      if (response.success) {
        currentRoomCode = response.roomCode;
        chrome.storage.local.set({ roomCode: response.roomCode });
        console.log('[ClipSync] Room created:', response.roomCode);
        resolve(response);
      } else {
        reject(new Error(response.error));
      }
    });
  });
}

// Join an existing room
function joinRoom(pairingCode) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('Not connected to server'));
      return;
    }

    socket.emit('room:join', { pairingCode, deviceInfo }, (response) => {
      if (response.success) {
        currentRoomCode = response.roomCode;
        chrome.storage.local.set({ roomCode: response.roomCode });
        console.log('[ClipSync] Joined room:', response.roomCode);
        
        // Sync latest clipboard if available
        if (response.latestClipboard) {
          writeToClipboard(response.latestClipboard.content);
        }
        
        resolve(response);
      } else {
        reject(new Error(response.error));
      }
    });
  });
}

// Rejoin a room after reconnection
function rejoinRoom(roomCode) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('Not connected to server'));
      return;
    }

    socket.emit('room:rejoin', { roomCode, deviceInfo }, (response) => {
      if (response.success) {
        currentRoomCode = response.roomCode;
        console.log('[ClipSync] Rejoined room:', response.roomCode);
        resolve(response);
      } else {
        console.log('[ClipSync] Failed to rejoin room, clearing stored room');
        chrome.storage.local.remove(['roomCode']);
        reject(new Error(response.error));
      }
    });
  });
}

// Send clipboard update to server
function sendClipboardUpdate(content, type = 'text') {
  if (!socket?.connected || !currentRoomCode) {
    console.log('[ClipSync] Cannot send: not connected or not in room');
    return false;
  }

  socket.emit('clipboard:update', {
    type,
    content,
    timestamp: Date.now()
  });

  console.log('[ClipSync] Sent clipboard update:', type);
  return true;
}

// Get clipboard history
function getClipboardHistory() {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('Not connected to server'));
      return;
    }

    socket.emit('clipboard:history', (response) => {
      if (response.success) {
        resolve(response.history);
      } else {
        reject(new Error(response.error));
      }
    });
  });
}

// Get connected devices
function getDevices() {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('Not connected to server'));
      return;
    }

    socket.emit('devices:list', (response) => {
      if (response.success) {
        resolve(response.devices);
      } else {
        reject(new Error(response.error));
      }
    });
  });
}

// Refresh pairing code
function refreshPairingCode() {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('Not connected to server'));
      return;
    }

    socket.emit('pairing:refresh', (response) => {
      if (response.success) {
        resolve(response);
      } else {
        reject(new Error(response.error));
      }
    });
  });
}

// Write text to clipboard
async function writeToClipboard(text) {
  try {
    // Use offscreen document for clipboard access in service worker
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['CLIPBOARD'],
      justification: 'Write synced text to clipboard'
    }).catch(() => {}); // Ignore if already exists

    await chrome.runtime.sendMessage({
      type: 'clipboard:write',
      target: 'offscreen',
      data: text
    });
  } catch (error) {
    console.error('[ClipSync] Error writing to clipboard:', error);
  }
}

// Write image to clipboard
async function writeImageToClipboard(base64Data) {
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['CLIPBOARD'],
      justification: 'Write synced image to clipboard'
    }).catch(() => {});

    await chrome.runtime.sendMessage({
      type: 'clipboard:writeImage',
      target: 'offscreen',
      data: base64Data
    });
  } catch (error) {
    console.error('[ClipSync] Error writing image to clipboard:', error);
  }
}

// Show notification
function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message: message.substring(0, 200)
  });
}

// Update extension badge
function updateBadge(status) {
  const colors = {
    connected: '#4CAF50',
    disconnected: '#9E9E9E',
    error: '#F44336',
    syncing: '#2196F3'
  };

  const text = {
    connected: '✓',
    disconnected: '',
    error: '!',
    syncing: '↻'
  };

  chrome.action.setBadgeBackgroundColor({ color: colors[status] || '#9E9E9E' });
  chrome.action.setBadgeText({ text: text[status] || '' });
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handleAsync = async () => {
    try {
      switch (message.type) {
        case 'connect':
          await connect(message.serverUrl);
          sendResponse({ success: true });
          break;

        case 'disconnect':
          socket?.disconnect();
          sendResponse({ success: true });
          break;

        case 'createRoom':
          const createResult = await createRoom();
          sendResponse({ success: true, ...createResult });
          break;

        case 'joinRoom':
          const joinResult = await joinRoom(message.pairingCode);
          sendResponse({ success: true, ...joinResult });
          break;

        case 'sendClipboard':
          const sent = sendClipboardUpdate(message.content, message.contentType);
          sendResponse({ success: sent });
          break;

        case 'getHistory':
          const history = await getClipboardHistory();
          sendResponse({ success: true, history });
          break;

        case 'getDevices':
          const devices = await getDevices();
          sendResponse({ success: true, devices });
          break;

        case 'refreshPairingCode':
          const pairingResult = await refreshPairingCode();
          sendResponse({ success: true, ...pairingResult });
          break;

        case 'getStatus':
          sendResponse({
            isConnected,
            roomCode: currentRoomCode
          });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  };

  handleAsync();
  return true; // Keep message channel open for async response
});

// Auto-connect on startup
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['serverUrl', 'autoConnect'], (data) => {
    if (data.autoConnect !== false) {
      connect(data.serverUrl);
    }
  });
});

// Connect on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('[ClipSync] Extension installed');
  connect();
});

// Initialize
connect();
