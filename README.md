# ClipSync — Hackathon Prototype

> Status: Archived hackathon exploration. This repository is retained as an
> unfinished experiment and is not presented as a shipped product.

An unfinished exploration of cross-platform clipboard synchronization across a
server, browser extension, and macOS client. The scope below records the intended
hackathon direction rather than completed product capabilities.

![ClipSync Demo](docs/demo.gif)

## Intended scope

- Real-time clipboard synchronization
- End-to-end encryption with device pairing
- Browser and native clients
- Clipboard history
- Reconnection after network interruptions
- Pairing codes for connecting devices

## 🏗️ Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  macOS App  │     │   Chrome    │     │  Android    │
│  (Swift)    │     │  Extension  │     │    App      │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │ WebSocket (WSS)
                           ▼
                 ┌─────────────────┐
                 │   Sync Server   │
                 │  (Node.js)      │
                 └─────────────────┘
```

## 🚀 Quick Start

### 1. Start the Server

```bash
cd server
npm install
npm run dev
```

The server will start on `http://localhost:3000`

### 2. Install the Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `clients/web-extension` folder

### 3. (Optional) Build macOS App

```bash
cd clients/macos
swift build
swift run ClipSync
```

## 📱 Usage

### Creating a Sync Room

1. Click the ClipSync icon in your browser/menu bar
2. Click "Create New Room"
3. You'll receive a 6-digit pairing code

### Joining a Room

1. Open ClipSync on another device
2. Enter the 6-digit pairing code
3. Click "Join"

### Syncing Clipboard

Once paired, any text you copy on one device will automatically appear on all other paired devices!

## 🔧 Configuration

### Server

Create a `.env` file in the server directory:

```env
PORT=3000
```

### Extension

Click the settings icon (⚙️) to configure:

- Server URL
- Auto-connect on startup
- Notifications

## 📁 Project Structure

```
try clip/
├── server/                 # Node.js WebSocket server
│   ├── src/
│   │   └── index.js       # Main server with Socket.IO
│   └── package.json
├── clients/
│   ├── web-extension/     # Chrome/Firefox extension
│   │   ├── manifest.json
│   │   ├── background.js  # Service worker
│   │   ├── popup.html/css/js
│   │   └── offscreen.html/js
│   └── macos/             # Native macOS app
│       ├── Package.swift
│       └── Sources/
│           ├── ClipSyncApp.swift
│           ├── ClipboardMonitor.swift
│           ├── SyncService.swift
│           └── MenuBarView.swift
└── README.md
```

## 🔐 Security

- **Device Pairing**: 6-digit codes expire after 5 minutes
- **Room Isolation**: Devices can only sync within their room
- **Transport Security**: WebSocket with TLS (in production)
- **No Persistence**: Clipboard data is not stored on the server

## 🛠️ Tech Stack

| Component     | Technology                            |
| ------------- | ------------------------------------- |
| Server        | Node.js, Express, Socket.IO           |
| Web Extension | Chrome Extension (MV3), JavaScript    |
| macOS Client  | Swift, SwiftUI, SocketIO-Client-Swift |

## 🧪 Testing

### Server

```bash
cd server
npm test
```

### Manual Testing

1. Start the server
2. Open extension in two different browsers
3. Create room on Browser 1, join on Browser 2
4. Copy text in Browser 1 → Should appear in Browser 2

## 🚧 Roadmap

- [ ] Image clipboard sync
- [ ] File clipboard sync (< 10MB)
- [ ] End-to-end encryption with libsodium
- [ ] Peer-to-peer mode (WebRTC)
- [ ] Windows native client
- [ ] Linux native client
- [ ] iOS app
- [ ] Android app

## 📄 License

MIT License - feel free to use for any purpose!

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

Made with ❤️ for the Universal Clipboard Sync Hackathon
