const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, timestamp: new Date().toISOString() });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const roomUsers = new Map();
const roomMessages = new Map();

const getUsersInRoom = (room) => {
  return Array.from(roomUsers.get(room) || []).map((user) => ({
    socketId: user.socketId,
    username: user.username,
  }));
};

const addMessageToRoom = (room, message) => {
  const existing = roomMessages.get(room) || [];
  existing.push(message);
  roomMessages.set(room, existing.slice(-100));
};

io.on('connection', (socket) => {
  socket.on('join_room', ({ room, username }) => {
    if (!room || !username) {
      return;
    }

    const roomName = room.trim();
    const safeUsername = username.trim().slice(0, 24);

    socket.join(roomName);
    socket.data.room = roomName;
    socket.data.username = safeUsername;

    const users = roomUsers.get(roomName) || new Set();
    users.add({ socketId: socket.id, username: safeUsername });
    roomUsers.set(roomName, users);

    socket.emit('room_history', roomMessages.get(roomName) || []);
    io.to(roomName).emit('user_list', getUsersInRoom(roomName));

    socket.to(roomName).emit('receive_message', {
      id: `system-${Date.now()}`,
      room: roomName,
      username: 'system',
      message: `${safeUsername} joined the room`,
      createdAt: new Date().toISOString(),
      type: 'system',
    });
  });

  socket.on('send_message', ({ room, message }) => {
    if (!room || !message || !socket.data.username) {
      return;
    }

    const payload = {
      id: `${socket.id}-${Date.now()}`,
      room,
      username: socket.data.username,
      message: String(message).slice(0, 500),
      createdAt: new Date().toISOString(),
      type: 'user',
    };

    addMessageToRoom(room, payload);
    io.to(room).emit('receive_message', payload);
  });

  socket.on('disconnect', () => {
    const { room, username } = socket.data;
    if (!room || !username) {
      return;
    }

    const currentUsers = roomUsers.get(room) || new Set();
    const nextUsers = new Set(
      Array.from(currentUsers).filter((user) => user.socketId !== socket.id),
    );

    if (nextUsers.size === 0) {
      roomUsers.delete(room);
    } else {
      roomUsers.set(room, nextUsers);
    }

    io.to(room).emit('user_list', getUsersInRoom(room));
    socket.to(room).emit('receive_message', {
      id: `system-${Date.now()}`,
      room,
      username: 'system',
      message: `${username} left the room`,
      createdAt: new Date().toISOString(),
      type: 'system',
    });
  });
});

httpServer.listen(PORT, () => {
  console.log(`Chat server listening on http://localhost:${PORT}`);
});
