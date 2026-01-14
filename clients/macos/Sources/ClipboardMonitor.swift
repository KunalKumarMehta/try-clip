import Foundation
import AppKit

/// Monitors the system clipboard for changes and syncs with other devices
class ClipboardMonitor: ObservableObject {
    private var timer: Timer?
    private var lastChangeCount: Int = 0
    private var lastContent: String = ""
    private let syncService: SyncService
    private var isUpdatingFromSync = false
    
    @Published var isMonitoring = false
    
    init(syncService: SyncService) {
        self.syncService = syncService
        self.lastChangeCount = NSPasteboard.general.changeCount
        self.lastContent = getCurrentClipboardText() ?? ""
        
        // Listen for sync updates
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleIncomingClipboard),
            name: .clipboardSyncReceived,
            object: nil
        )
    }
    
    deinit {
        stopMonitoring()
        NotificationCenter.default.removeObserver(self)
    }
    
    func startMonitoring() {
        guard !isMonitoring else { return }
        
        isMonitoring = true
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            self?.checkClipboard()
        }
        
        print("[ClipSync] Started clipboard monitoring")
    }
    
    func stopMonitoring() {
        timer?.invalidate()
        timer = nil
        isMonitoring = false
        print("[ClipSync] Stopped clipboard monitoring")
    }
    
    private func checkClipboard() {
        let pasteboard = NSPasteboard.general
        let currentChangeCount = pasteboard.changeCount
        
        // Check if clipboard changed
        guard currentChangeCount != lastChangeCount else { return }
        lastChangeCount = currentChangeCount
        
        // Skip if we're updating from a sync
        guard !isUpdatingFromSync else {
            isUpdatingFromSync = false
            return
        }
        
        // Get clipboard content
        guard let content = getCurrentClipboardText(), !content.isEmpty else { return }
        
        // Skip if content hasn't actually changed
        guard content != lastContent else { return }
        lastContent = content
        
        print("[ClipSync] Clipboard changed: \(content.prefix(50))...")
        
        // Send to sync service
        syncService.sendClipboardUpdate(content: content, type: .text)
    }
    
    private func getCurrentClipboardText() -> String? {
        let pasteboard = NSPasteboard.general
        return pasteboard.string(forType: .string)
    }
    
    @objc private func handleIncomingClipboard(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let content = userInfo["content"] as? String else { return }
        
        DispatchQueue.main.async { [weak self] in
            self?.writeToClipboard(content)
        }
    }
    
    func writeToClipboard(_ content: String) {
        isUpdatingFromSync = true
        lastContent = content
        
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(content, forType: .string)
        
        lastChangeCount = pasteboard.changeCount
        
        print("[ClipSync] Wrote to clipboard: \(content.prefix(50))...")
        
        // Show notification
        showNotification(title: "Clipboard Synced", body: String(content.prefix(100)))
    }
    
    private func showNotification(title: String, body: String) {
        let notification = NSUserNotification()
        notification.title = title
        notification.informativeText = body
        notification.soundName = nil
        
        NSUserNotificationCenter.default.deliver(notification)
    }
}

// Notification name for clipboard sync
extension Notification.Name {
    static let clipboardSyncReceived = Notification.Name("clipboardSyncReceived")
}
