require('dotenv').config();

const express = require('express');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { connectDb } = require('./db');
const Message = require('./models/Message');
const User = require('./models/User');
const { requireAuth, signToken, verifyToken } = require('./middleware/auth');

const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const sanitizeRoom = (room) => (room || 'general').trim().slice(0, 30) || 'general';
const sanitizeMessage = (message) => String(message || '').trim().slice(0, 500);

const toMessagePayload = (messageDoc) => ({
  id: messageDoc._id.toString(),
  room: messageDoc.room,
  username: messageDoc.username,
  message: messageDoc.message,
  createdAt: messageDoc.createdAt,
  type: messageDoc.type,
});

const toUserPayload = (userDoc) => ({
  id: userDoc._id.toString(),
  username: userDoc.username,
  displayName: userDoc.displayName,
});

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, timestamp: new Date().toISOString() });
});

app.post('/auth/register', async (req, res) => {
  try {
    const rawUsername = String(req.body.username || '').trim();
    const username = rawUsername.toLowerCase();
    const password = String(req.body.password || '');

    if (username.length < 3 || username.length > 24) {
      return res
        .status(400)
        .json({ error: 'Username must be 3-24 characters long' });
    }

    if (password.length < 6 || password.length > 128) {
      return res
        .status(400)
        .json({ error: 'Password must be 6-128 characters long' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(409).json({ error: 'Username is already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const createdUser = await User.create({
      username,
      displayName: rawUsername,
      passwordHash,
    });

    const token = signToken(createdUser);
    return res.status(201).json({
      token,
      user: toUserPayload(createdUser),
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ error: 'Failed to register user' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user);
    return res.status(200).json({
      token,
      user: toUserPayload(user),
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Failed to login' });
  }
});

app.get('/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.auth.sub).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json({ user: toUserPayload(user) });
  } catch (error) {
    console.error('Me endpoint error:', error);
    return res.status(500).json({ error: 'Failed to load current user' });
  }
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const roomUsers = new Map();

const getUsersInRoom = (room) => {
  return Array.from((roomUsers.get(room) || new Map()).values()).map((user) => ({
    socketId: user.socketId,
    username: user.username,
  }));
};

io.use((socket, next) => {
  try {
    const authHeader = socket.handshake.headers.authorization || '';
    const tokenFromHeader = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;
    const token = socket.handshake.auth?.token || tokenFromHeader;

    if (!token) {
      return next(new Error('Unauthorized'));
    }

    const auth = verifyToken(token);
    socket.data.auth = auth;
    return next();
  } catch {
    return next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  socket.on('join_room', async ({ room }) => {
    try {
      const authUser = socket.data.auth;
      if (!authUser?.sub) {
        return;
      }

      const roomName = sanitizeRoom(room);
      const safeUsername = String(authUser.displayName || authUser.username)
        .trim()
        .slice(0, 24);

      socket.join(roomName);
      socket.data.room = roomName;
      socket.data.username = safeUsername;
      socket.data.userId = authUser.sub;

      const users = roomUsers.get(roomName) || new Map();
      users.set(socket.id, { socketId: socket.id, username: safeUsername });
      roomUsers.set(roomName, users);

      const history = await Message.find({ room: roomName })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();

      socket.emit('room_history', history.reverse().map(toMessagePayload));
      io.to(roomName).emit('user_list', getUsersInRoom(roomName));

      socket.to(roomName).emit('receive_message', {
        id: `system-${Date.now()}`,
        room: roomName,
        username: 'system',
        message: `${safeUsername} joined the room`,
        createdAt: new Date().toISOString(),
        type: 'system',
      });
    } catch (error) {
      console.error('join_room error:', error);
    }
  });

  socket.on('send_message', async ({ room, message }) => {
    try {
      if (!room || !message || !socket.data.username || !socket.data.userId) {
        return;
      }

      const roomName = sanitizeRoom(room);
      const sanitizedMessage = sanitizeMessage(message);
      if (!sanitizedMessage) {
        return;
      }

      if (socket.data.room !== roomName) {
        return;
      }

      const savedMessage = await Message.create({
        room: roomName,
        userId: socket.data.userId,
        username: socket.data.username,
        message: sanitizedMessage,
        type: 'user',
      });

      const payload = toMessagePayload(savedMessage);

      io.to(roomName).emit('receive_message', payload);
    } catch (error) {
      console.error('send_message error:', error);
    }
  });

  socket.on('disconnect', () => {
    const { room, username } = socket.data;
    if (!room || !username) {
      return;
    }

    const currentUsers = roomUsers.get(room) || new Map();
    currentUsers.delete(socket.id);

    if (currentUsers.size === 0) {
      roomUsers.delete(room);
    } else {
      roomUsers.set(room, currentUsers);
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

const startServer = async () => {
  await connectDb();

  httpServer.listen(PORT, () => {
    console.log(`Chat server listening on http://localhost:${PORT}`);
  });
};

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
