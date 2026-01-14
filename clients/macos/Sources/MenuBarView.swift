import SwiftUI

struct MenuBarView: View {
    @StateObject private var syncService = SyncService.shared
    @State private var pairingCodeInput = ""
    @State private var showingHistory = false
    @State private var errorMessage: String?
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            headerView
            
            Divider()
            
            // Content
            if syncService.roomCode != nil {
                connectedView
            } else {
                notConnectedView
            }
            
            Divider()
            
            // Footer
            footerView
        }
        .frame(width: 320)
        .background(Color(nsColor: .windowBackgroundColor))
    }
    
    // MARK: - Header
    
    private var headerView: some View {
        HStack {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.title2)
                .foregroundColor(.accentColor)
            
            Text("ClipSync")
                .font(.headline)
            
            Spacer()
            
            // Connection status
            HStack(spacing: 6) {
                Circle()
                    .fill(syncService.isConnected ? Color.green : Color.gray)
                    .frame(width: 8, height: 8)
                
                Text(syncService.isConnected ? "Connected" : "Disconnected")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Color(nsColor: .controlBackgroundColor))
            .cornerRadius(12)
        }
        .padding()
    }
    
    // MARK: - Not Connected View
    
    private var notConnectedView: some View {
        VStack(spacing: 16) {
            Text("Get Started")
                .font(.title3)
                .fontWeight(.semibold)
            
            Text("Create a new sync room or join an existing one")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            
            Button(action: createRoom) {
                Label("Create New Room", systemImage: "plus.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            
            Divider()
                .padding(.vertical, 8)
            
            HStack {
                TextField("Enter 6-digit code", text: $pairingCodeInput)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: .infinity)
                    .onChange(of: pairingCodeInput) { _, newValue in
                        pairingCodeInput = String(newValue.filter { $0.isNumber }.prefix(6))
                        if pairingCodeInput.count == 6 {
                            joinRoom()
                        }
                    }
                
                Button("Join") {
                    joinRoom()
                }
                .buttonStyle(.bordered)
                .disabled(pairingCodeInput.count != 6)
            }
            
            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
            }
        }
        .padding()
    }
    
    // MARK: - Connected View
    
    private var connectedView: some View {
        VStack(spacing: 16) {
            // Pairing Code
            if let code = syncService.pairingCode {
                VStack(spacing: 8) {
                    Text("PAIRING CODE")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    Text(code.map { String($0) }.joined(separator: " "))
                        .font(.system(size: 28, weight: .bold, design: .monospaced))
                        .foregroundColor(.accentColor)
                    
                    Text("Enter this code on another device")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    
                    Button(action: refreshPairingCode) {
                        Label("Refresh", systemImage: "arrow.clockwise")
                            .font(.caption)
                    }
                    .buttonStyle(.plain)
                    .foregroundColor(.accentColor)
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(Color(nsColor: .controlBackgroundColor))
                .cornerRadius(12)
            }
            
            // Connected Devices
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Connected Devices")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    Spacer()
                    
                    Text("\(syncService.connectedDevices.count)")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Color.accentColor)
                        .foregroundColor(.white)
                        .cornerRadius(8)
                }
                
                ForEach(0..<syncService.connectedDevices.count, id: \.self) { index in
                    let device = syncService.connectedDevices[index]
                    deviceRow(device)
                }
            }
            
            // Quick Actions
            HStack(spacing: 12) {
                Button(action: syncNow) {
                    VStack {
                        Image(systemName: "doc.on.clipboard")
                            .font(.title2)
                        Text("Sync Now")
                            .font(.caption)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                }
                .buttonStyle(.bordered)
                
                Button(action: { showingHistory.toggle() }) {
                    VStack {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.title2)
                        Text("History")
                            .font(.caption)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                }
                .buttonStyle(.bordered)
            }
            
            Button("Disconnect", role: .destructive) {
                disconnect()
            }
            .buttonStyle(.bordered)
            .frame(maxWidth: .infinity)
        }
        .padding()
        .sheet(isPresented: $showingHistory) {
            historyView
        }
    }
    
    private func deviceRow(_ device: [String: Any]) -> some View {
        HStack {
            Image(systemName: deviceIcon(for: device["platform"] as? String))
                .font(.title3)
                .foregroundColor(.secondary)
            
            VStack(alignment: .leading) {
                Text(device["name"] as? String ?? "Unknown")
                    .font(.subheadline)
                
                Text(device["platform"] as? String ?? "Unknown")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
            
            Circle()
                .fill(Color.green)
                .frame(width: 8, height: 8)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(8)
    }
    
    private func deviceIcon(for platform: String?) -> String {
        switch platform?.lowercased() {
        case "macos": return "laptopcomputer"
        case "windows": return "pc"
        case "linux": return "terminal"
        case "android": return "smartphone"
        case "ios": return "iphone"
        case "web": return "globe"
        default: return "desktopcomputer"
        }
    }
    
    // MARK: - History View
    
    private var historyView: some View {
        NavigationStack {
            List {
                ForEach(0..<syncService.clipboardHistory.count, id: \.self) { index in
                    let item = syncService.clipboardHistory[index]
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item["content"] as? String ?? "")
                            .lineLimit(2)
                            .font(.subheadline)
                        
                        if let timestamp = item["timestamp"] as? Double {
                            Text(formatDate(timestamp))
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        if let content = item["content"] as? String {
                            copyToClipboard(content)
                        }
                    }
                }
            }
            .navigationTitle("Clipboard History")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        showingHistory = false
                    }
                }
            }
        }
        .frame(width: 320, height: 400)
    }
    
    private func formatDate(_ timestamp: Double) -> String {
        let date = Date(timeIntervalSince1970: timestamp / 1000)
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }
    
    // MARK: - Footer
    
    private var footerView: some View {
        HStack {
            Button(action: openSettings) {
                Image(systemName: "gear")
            }
            .buttonStyle(.plain)
            
            Spacer()
            
            Text("v1.0.0")
                .font(.caption2)
                .foregroundColor(.secondary)
            
            Spacer()
            
            Button(action: quit) {
                Image(systemName: "power")
            }
            .buttonStyle(.plain)
        }
        .padding()
    }
    
    // MARK: - Actions
    
    private func createRoom() {
        errorMessage = nil
        syncService.createRoom { success, error in
            if !success {
                errorMessage = error ?? "Failed to create room"
            }
        }
    }
    
    private func joinRoom() {
        guard pairingCodeInput.count == 6 else { return }
        errorMessage = nil
        syncService.joinRoom(pairingCode: pairingCodeInput) { success, error in
            if success {
                pairingCodeInput = ""
            } else {
                errorMessage = error ?? "Failed to join room"
            }
        }
    }
    
    private func refreshPairingCode() {
        syncService.refreshPairingCode()
    }
    
    private func syncNow() {
        if let content = NSPasteboard.general.string(forType: .string) {
            syncService.sendClipboardUpdate(content: content, type: .text)
        }
    }
    
    private func disconnect() {
        syncService.disconnect()
        UserDefaults.standard.removeObject(forKey: "roomCode")
    }
    
    private func copyToClipboard(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        showingHistory = false
    }
    
    private func openSettings() {
        if #available(macOS 14.0, *) {
            NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        } else {
            NSApp.sendAction(Selector(("showPreferencesWindow:")), to: nil, from: nil)
        }
    }
    
    private func quit() {
        NSApp.terminate(nil)
    }
}

struct SettingsView: View {
    @AppStorage("serverURL") private var serverURL = "http://localhost:3000"
    @AppStorage("autoConnect") private var autoConnect = true
    @AppStorage("showNotifications") private var showNotifications = true
    
    var body: some View {
        Form {
            Section("Server") {
                TextField("Server URL", text: $serverURL)
                    .textFieldStyle(.roundedBorder)
            }
            
            Section("General") {
                Toggle("Auto-connect on launch", isOn: $autoConnect)
                Toggle("Show notifications", isOn: $showNotifications)
            }
        }
        .formStyle(.grouped)
        .frame(width: 400, height: 200)
        .padding()
    }
}

#Preview {
    MenuBarView()
}
