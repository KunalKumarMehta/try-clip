import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;

// In-memory storage for rooms and devices
const rooms = new Map(); // roomCode -> { devices: Map<socketId, deviceInfo>, createdAt, clipboardHistory }
const deviceToRoom = new Map(); // socketId -> roomCode
const pairingCodes = new Map(); // pairingCode -> { roomCode, expiresAt }

// Generate a 6-digit pairing code
function generatePairingCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Generate a room code
function generateRoomCode() {
  return uuidv4().slice(0, 8);
}

// Clean up expired pairing codes
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of pairingCodes.entries()) {
    if (data.expiresAt < now) {
      pairingCodes.delete(code);
    }
  }
}, 60000); // Clean up every minute

// Express routes
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "ClipSync Server",
    version: "1.0.0",
    status: "running",
    connectedDevices: io.engine.clientsCount,
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`[${new Date().toISOString()}] Device connected: ${socket.id}`);

  // Create a new room and get pairing code
  socket.on("room:create", (deviceInfo, callback) => {
    const roomCode = generateRoomCode();
    const pairingCode = generatePairingCode();

    // Create the room
    rooms.set(roomCode, {
      devices: new Map([
        [socket.id, { ...deviceInfo, id: socket.id, joinedAt: Date.now() }],
      ]),
      createdAt: Date.now(),
      clipboardHistory: [],
      latestClipboard: null,
    });

    // Store pairing code (expires in 5 minutes)
    pairingCodes.set(pairingCode, {
      roomCode,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    // Join socket to room
    socket.join(roomCode);
    deviceToRoom.set(socket.id, roomCode);

    console.log(
      `[${new Date().toISOString()}] Room created: ${roomCode} with pairing code: ${pairingCode}`
    );

    callback({
      success: true,
      roomCode,
      pairingCode,
      expiresIn: 300, // seconds
    });
  });

  // Join an existing room using pairing code
  socket.on("room:join", (data, callback) => {
    const { pairingCode, deviceInfo } = data;

    const pairingData = pairingCodes.get(pairingCode);

    if (!pairingData) {
      callback({ success: false, error: "Invalid or expired pairing code" });
      return;
    }

    if (pairingData.expiresAt < Date.now()) {
      pairingCodes.delete(pairingCode);
      callback({ success: false, error: "Pairing code has expired" });
      return;
    }

    const { roomCode } = pairingData;
    const room = rooms.get(roomCode);

    if (!room) {
      callback({ success: false, error: "Room no longer exists" });
      return;
    }

    // Add device to room
    room.devices.set(socket.id, {
      ...deviceInfo,
      id: socket.id,
      joinedAt: Date.now(),
    });
    socket.join(roomCode);
    deviceToRoom.set(socket.id, roomCode);

    // Invalidate pairing code after use (optional: keep for multi-device)
    // pairingCodes.delete(pairingCode);

    // Notify other devices in the room
    socket.to(roomCode).emit("device:joined", {
      deviceId: socket.id,
      deviceInfo,
      totalDevices: room.devices.size,
    });

    // Send current devices list and latest clipboard to new device
    const devices = Array.from(room.devices.values());

    console.log(
      `[${new Date().toISOString()}] Device joined room ${roomCode}: ${
        deviceInfo.name || socket.id
      }`
    );

    callback({
      success: true,
      roomCode,
      devices,
      latestClipboard: room.latestClipboard,
    });
  });

  // Rejoin a room (for reconnection)
  socket.on("room:rejoin", (data, callback) => {
    const { roomCode, deviceInfo } = data;

    const room = rooms.get(roomCode);

    if (!room) {
      callback({ success: false, error: "Room no longer exists" });
      return;
    }

    // Add/update device in room
    room.devices.set(socket.id, {
      ...deviceInfo,
      id: socket.id,
      joinedAt: Date.now(),
    });
    socket.join(roomCode);
    deviceToRoom.set(socket.id, roomCode);

    // Notify other devices
    socket.to(roomCode).emit("device:joined", {
      deviceId: socket.id,
      deviceInfo,
      totalDevices: room.devices.size,
    });

    const devices = Array.from(room.devices.values());

    console.log(
      `[${new Date().toISOString()}] Device rejoined room ${roomCode}: ${
        deviceInfo.name || socket.id
      }`
    );

    callback({
      success: true,
      roomCode,
      devices,
      latestClipboard: room.latestClipboard,
    });
  });

  // Handle clipboard update from a device
  socket.on("clipboard:update", (data) => {
    const roomCode = deviceToRoom.get(socket.id);

    if (!roomCode) {
      console.log(
        `[${new Date().toISOString()}] Clipboard update from unjoined device: ${
          socket.id
        }`
      );
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) return;

    const clipboardEntry = {
      ...data,
      sourceDeviceId: socket.id,
      timestamp: Date.now(),
      id: uuidv4(),
    };

    // Store in history (keep last 50 entries)
    room.clipboardHistory.push(clipboardEntry);
    if (room.clipboardHistory.length > 50) {
      room.clipboardHistory.shift();
    }
    room.latestClipboard = clipboardEntry;

    // Broadcast to all other devices in the room
    socket.to(roomCode).emit("clipboard:sync", clipboardEntry);

    const contentPreview =
      data.type === "text"
        ? data.content.substring(0, 50) +
          (data.content.length > 50 ? "..." : "")
        : `[${data.type}]`;
    console.log(
      `[${new Date().toISOString()}] Clipboard synced in room ${roomCode}: ${contentPreview}`
    );
  });

  // Get clipboard history
  socket.on("clipboard:history", (callback) => {
    const roomCode = deviceToRoom.get(socket.id);

    if (!roomCode) {
      callback({ success: false, error: "Not in a room" });
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      callback({ success: false, error: "Room not found" });
      return;
    }

    callback({
      success: true,
      history: room.clipboardHistory.slice(-20), // Return last 20 entries
    });
  });

  // Get connected devices
  socket.on("devices:list", (callback) => {
    const roomCode = deviceToRoom.get(socket.id);

    if (!roomCode) {
      callback({ success: false, error: "Not in a room" });
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      callback({ success: false, error: "Room not found" });
      return;
    }

    callback({
      success: true,
      devices: Array.from(room.devices.values()),
    });
  });

  // Generate new pairing code for existing room
  socket.on("pairing:refresh", (callback) => {
    const roomCode = deviceToRoom.get(socket.id);

    if (!roomCode) {
      callback({ success: false, error: "Not in a room" });
      return;
    }

    const pairingCode = generatePairingCode();
    pairingCodes.set(pairingCode, {
      roomCode,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    callback({
      success: true,
      pairingCode,
      expiresIn: 300,
    });
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    const roomCode = deviceToRoom.get(socket.id);

    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
        const deviceInfo = room.devices.get(socket.id);
        room.devices.delete(socket.id);

        // Notify other devices
        socket.to(roomCode).emit("device:left", {
          deviceId: socket.id,
          deviceInfo,
          totalDevices: room.devices.size,
        });

        // Clean up empty rooms after 1 hour
        if (room.devices.size === 0) {
          setTimeout(() => {
            const currentRoom = rooms.get(roomCode);
            if (currentRoom && currentRoom.devices.size === 0) {
              rooms.delete(roomCode);
              console.log(
                `[${new Date().toISOString()}] Empty room deleted: ${roomCode}`
              );
            }
          }, 60 * 60 * 1000);
        }

        console.log(
          `[${new Date().toISOString()}] Device left room ${roomCode}: ${
            deviceInfo?.name || socket.id
          }`
        );
      }

      deviceToRoom.delete(socket.id);
    }

    console.log(
      `[${new Date().toISOString()}] Device disconnected: ${socket.id}`
    );
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🔄 ClipSync Server v1.0.0                              ║
║                                                           ║
║   Server running on port ${PORT}                            ║
║   WebSocket endpoint: ws://localhost:${PORT}                ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export { app, io, server };
