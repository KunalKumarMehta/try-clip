import Foundation
import SocketIO

/// Content type for clipboard data
enum ClipboardContentType: String, Codable {
    case text
    case image
    case file
}

/// Service for syncing clipboard data with server
class SyncService: ObservableObject {
    static let shared = SyncService()
    
    private var manager: SocketManager?
    private var socket: SocketIOClient?
    
    @Published var isConnected = false
    @Published var roomCode: String?
    @Published var pairingCode: String?
    @Published var connectedDevices: [[String: Any]] = []
    @Published var clipboardHistory: [[String: Any]] = []
    
    private let deviceInfo: [String: Any] = [
        "name": Host.current().localizedName ?? "Mac",
        "platform": "macos",
        "version": ProcessInfo.processInfo.operatingSystemVersionString
    ]
    
    private var serverURL: String {
        UserDefaults.standard.string(forKey: "serverURL") ?? "http://localhost:3000"
    }
    
    private init() {}
    
    // MARK: - Connection
    
    func connect(to url: String? = nil) {
        let serverUrl = url ?? serverURL
        
        guard let socketURL = URL(string: serverUrl) else {
            print("[SyncService] Invalid server URL: \(serverUrl)")
            return
        }
        
        manager = SocketManager(socketURL: socketURL, config: [
            .log(true),
            .compress,
            .reconnects(true),
            .reconnectWait(1),
            .reconnectWaitMax(5)
        ])
        
        socket = manager?.defaultSocket
        
        setupSocketHandlers()
        socket?.connect()
        
        print("[SyncService] Connecting to \(serverUrl)")
    }
    
    func disconnect() {
        socket?.disconnect()
        isConnected = false
        roomCode = nil
        pairingCode = nil
        connectedDevices = []
    }
    
    private func setupSocketHandlers() {
        socket?.on(clientEvent: .connect) { [weak self] _, _ in
            print("[SyncService] Connected to server")
            DispatchQueue.main.async {
                self?.isConnected = true
            }
            
            // Try to rejoin previous room
            if let savedRoomCode = UserDefaults.standard.string(forKey: "roomCode") {
                self?.rejoinRoom(roomCode: savedRoomCode)
            }
        }
        
        socket?.on(clientEvent: .disconnect) { [weak self] _, _ in
            print("[SyncService] Disconnected from server")
            DispatchQueue.main.async {
                self?.isConnected = false
            }
        }
        
        socket?.on(clientEvent: .error) { _, error in
            print("[SyncService] Socket error: \(error)")
        }
        
        // Handle clipboard sync from other devices
        socket?.on("clipboard:sync") { [weak self] data, _ in
            guard let clipboardData = data.first as? [String: Any],
                  let contentType = clipboardData["type"] as? String,
                  let content = clipboardData["content"] as? String else { return }
            
            print("[SyncService] Received clipboard: \(contentType)")
            
            // Notify clipboard monitor
            NotificationCenter.default.post(
                name: .clipboardSyncReceived,
                object: nil,
                userInfo: ["content": content, "type": contentType]
            )
            
            // Update history
            DispatchQueue.main.async {
                self?.clipboardHistory.insert(clipboardData, at: 0)
                if (self?.clipboardHistory.count ?? 0) > 50 {
                    self?.clipboardHistory.removeLast()
                }
            }
        }
        
        socket?.on("device:joined") { [weak self] data, _ in
            guard let deviceData = data.first as? [String: Any] else { return }
            print("[SyncService] Device joined: \(deviceData)")
            self?.refreshDevices()
        }
        
        socket?.on("device:left") { [weak self] data, _ in
            guard let deviceData = data.first as? [String: Any] else { return }
            print("[SyncService] Device left: \(deviceData)")
            self?.refreshDevices()
        }
    }
    
    // MARK: - Room Management
    
    func createRoom(completion: @escaping (Bool, String?) -> Void) {
        socket?.emitWithAck("room:create", deviceInfo).timingOut(after: 10) { [weak self] response in
            guard let data = response.first as? [String: Any],
                  let success = data["success"] as? Bool, success,
                  let roomCode = data["roomCode"] as? String,
                  let pairingCode = data["pairingCode"] as? String else {
                let error = (response.first as? [String: Any])?["error"] as? String
                completion(false, error ?? "Failed to create room")
                return
            }
            
            DispatchQueue.main.async {
                self?.roomCode = roomCode
                self?.pairingCode = pairingCode
                UserDefaults.standard.set(roomCode, forKey: "roomCode")
            }
            
            print("[SyncService] Room created: \(roomCode), pairing: \(pairingCode)")
            completion(true, nil)
        }
    }
    
    func joinRoom(pairingCode: String, completion: @escaping (Bool, String?) -> Void) {
        let data: [String: Any] = [
            "pairingCode": pairingCode,
            "deviceInfo": deviceInfo
        ]
        
        socket?.emitWithAck("room:join", data).timingOut(after: 10) { [weak self] response in
            guard let data = response.first as? [String: Any],
                  let success = data["success"] as? Bool, success,
                  let roomCode = data["roomCode"] as? String else {
                let error = (response.first as? [String: Any])?["error"] as? String
                completion(false, error ?? "Failed to join room")
                return
            }
            
            DispatchQueue.main.async {
                self?.roomCode = roomCode
                UserDefaults.standard.set(roomCode, forKey: "roomCode")
                
                if let devices = data["devices"] as? [[String: Any]] {
                    self?.connectedDevices = devices
                }
            }
            
            print("[SyncService] Joined room: \(roomCode)")
            self?.refreshPairingCode()
            completion(true, nil)
        }
    }
    
    func rejoinRoom(roomCode: String) {
        let data: [String: Any] = [
            "roomCode": roomCode,
            "deviceInfo": deviceInfo
        ]
        
        socket?.emitWithAck("room:rejoin", data).timingOut(after: 10) { [weak self] response in
            guard let data = response.first as? [String: Any],
                  let success = data["success"] as? Bool, success else {
                print("[SyncService] Failed to rejoin room, clearing saved room")
                UserDefaults.standard.removeObject(forKey: "roomCode")
                return
            }
            
            DispatchQueue.main.async {
                self?.roomCode = roomCode
                if let devices = data["devices"] as? [[String: Any]] {
                    self?.connectedDevices = devices
                }
            }
            
            print("[SyncService] Rejoined room: \(roomCode)")
            self?.refreshPairingCode()
        }
    }
    
    func refreshPairingCode() {
        socket?.emitWithAck("pairing:refresh", [:]).timingOut(after: 5) { [weak self] response in
            guard let data = response.first as? [String: Any],
                  let success = data["success"] as? Bool, success,
                  let pairingCode = data["pairingCode"] as? String else { return }
            
            DispatchQueue.main.async {
                self?.pairingCode = pairingCode
            }
        }
    }
    
    func refreshDevices() {
        socket?.emitWithAck("devices:list", [:]).timingOut(after: 5) { [weak self] response in
            guard let data = response.first as? [String: Any],
                  let success = data["success"] as? Bool, success,
                  let devices = data["devices"] as? [[String: Any]] else { return }
            
            DispatchQueue.main.async {
                self?.connectedDevices = devices
            }
        }
    }
    
    // MARK: - Clipboard Sync
    
    func sendClipboardUpdate(content: String, type: ClipboardContentType) {
        guard roomCode != nil else {
            print("[SyncService] Not in a room, cannot send clipboard")
            return
        }
        
        let data: [String: Any] = [
            "type": type.rawValue,
            "content": content,
            "timestamp": Date().timeIntervalSince1970 * 1000
        ]
        
        socket?.emit("clipboard:update", data)
        print("[SyncService] Sent clipboard update")
    }
    
    func getClipboardHistory(completion: @escaping ([[String: Any]]?) -> Void) {
        socket?.emitWithAck("clipboard:history", [:]).timingOut(after: 5) { [weak self] response in
            guard let data = response.first as? [String: Any],
                  let success = data["success"] as? Bool, success,
                  let history = data["history"] as? [[String: Any]] else {
                completion(nil)
                return
            }
            
            DispatchQueue.main.async {
                self?.clipboardHistory = history.reversed()
            }
            
            completion(history)
        }
    }
}
