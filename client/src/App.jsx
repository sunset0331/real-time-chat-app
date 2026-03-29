import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import './App.css'

const API_BASE_URL = 'http://localhost:4000'
const TOKEN_STORAGE_KEY = 'chat_jwt_token'

const socket = io('http://localhost:4000', {
  autoConnect: false,
})

function App() {
  const [authMode, setAuthMode] = useState('login')
  const [authUsername, setAuthUsername] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [token, setToken] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [room, setRoom] = useState('general')
  const [isJoined, setIsJoined] = useState(false)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState([])
  const [users, setUsers] = useState([])
  const [connectionStatus, setConnectionStatus] = useState('disconnected')
  const messageListRef = useRef(null)

  const roomTitle = useMemo(() => room.trim() || 'general', [room])

  useEffect(() => {
    const restoreSession = async () => {
      const savedToken = localStorage.getItem(TOKEN_STORAGE_KEY)
      if (!savedToken) {
        return
      }

      try {
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
          headers: {
            Authorization: `Bearer ${savedToken}`,
          },
        })

        if (!response.ok) {
          localStorage.removeItem(TOKEN_STORAGE_KEY)
          return
        }

        const data = await response.json()
        setToken(savedToken)
        setCurrentUser(data.user)
      } catch {
        localStorage.removeItem(TOKEN_STORAGE_KEY)
      }
    }

    restoreSession()
  }, [])

  useEffect(() => {
    const onConnect = () => setConnectionStatus('connected')
    const onDisconnect = () => setConnectionStatus('disconnected')
    const onReceiveMessage = (incoming) => {
      setMessages((prev) => [...prev, incoming])
    }
    const onRoomHistory = (history) => {
      setMessages(history)
    }
    const onUserList = (nextUsers) => {
      setUsers(nextUsers)
    }
    const onConnectError = () => {
      setConnectionStatus('disconnected')
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('receive_message', onReceiveMessage)
    socket.on('room_history', onRoomHistory)
    socket.on('user_list', onUserList)
    socket.on('connect_error', onConnectError)

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('receive_message', onReceiveMessage)
      socket.off('room_history', onRoomHistory)
      socket.off('user_list', onUserList)
      socket.off('connect_error', onConnectError)
    }
  }, [])

  useEffect(() => {
    if (!messageListRef.current) {
      return
    }

    messageListRef.current.scrollTop = messageListRef.current.scrollHeight
  }, [messages])

  const handleAuthSubmit = async (event) => {
    event.preventDefault()

    const username = authUsername.trim()
    if (!username || !authPassword) {
      setAuthError('Username and password are required')
      return
    }

    setAuthLoading(true)
    setAuthError('')

    try {
      const endpoint = authMode === 'login' ? 'login' : 'register'
      const response = await fetch(`${API_BASE_URL}/auth/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          password: authPassword,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setAuthError(data.error || 'Authentication failed')
        return
      }

      localStorage.setItem(TOKEN_STORAGE_KEY, data.token)
      setToken(data.token)
      setCurrentUser(data.user)
      setAuthPassword('')
    } catch {
      setAuthError('Failed to reach server')
    } finally {
      setAuthLoading(false)
    }
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    setToken('')
    setCurrentUser(null)
    setIsJoined(false)
    setMessages([])
    setUsers([])
    setConnectionStatus('disconnected')
    if (socket.connected) {
      socket.disconnect()
    }
  }

  const joinRoom = (event) => {
    event.preventDefault()
    if (!token || !room.trim()) {
      return
    }

    socket.auth = { token }

    if (!socket.connected) {
      socket.connect()
    }

    setMessages([])
    socket.emit('join_room', { room: room.trim() })
    setIsJoined(true)
  }

  const sendMessage = (event) => {
    event.preventDefault()
    if (!message.trim() || !isJoined) {
      return
    }

    socket.emit('send_message', {
      room: room.trim(),
      message: message.trim(),
    })
    setMessage('')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Realtime Chat</h1>
        <div className="topbar-actions">
          <div className={`status ${connectionStatus}`}>{connectionStatus}</div>
          {currentUser ? (
            <button type="button" className="secondary-btn" onClick={logout}>
              Logout
            </button>
          ) : null}
        </div>
      </header>

      {!currentUser ? (
        <section className="join-panel">
          <h2>{authMode === 'login' ? 'Login' : 'Create account'}</h2>
          <form onSubmit={handleAuthSubmit} className="join-form">
            <label>
              Username
              <input
                value={authUsername}
                onChange={(event) => setAuthUsername(event.target.value)}
                placeholder="e.g. utkarsh"
                maxLength={24}
              />
            </label>
            <label>
              Password
              <input
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder="At least 6 characters"
                maxLength={128}
                type="password"
              />
            </label>
            {authError ? <p className="error-text">{authError}</p> : null}
            <button type="submit" disabled={authLoading}>
              {authLoading
                ? 'Please wait...'
                : authMode === 'login'
                  ? 'Login'
                  : 'Register'}
            </button>
          </form>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              setAuthMode((prev) => (prev === 'login' ? 'register' : 'login'))
              setAuthError('')
            }}
          >
            {authMode === 'login'
              ? 'Need an account? Register'
              : 'Already registered? Login'}
          </button>
        </section>
      ) : !isJoined ? (
        <section className="join-panel">
          <h2>Join a room</h2>
          <p className="session-meta">Logged in as {currentUser.displayName}</p>
          <form onSubmit={joinRoom} className="join-form">
            <label>
              Room name
              <input
                value={room}
                onChange={(event) => setRoom(event.target.value)}
                placeholder="general"
                maxLength={30}
              />
            </label>
            <button type="submit">Enter Chat</button>
          </form>
        </section>
      ) : (
        <section className="chat-layout">
          <aside className="room-info">
            <h2>Room</h2>
            <p className="room-name">#{roomTitle}</p>
            <p className="session-meta">You: {currentUser.displayName}</p>
            <h3>Online ({users.length})</h3>
            <ul>
              {users.map((user) => (
                <li key={user.socketId}>{user.username}</li>
              ))}
            </ul>
          </aside>

          <main className="chat-panel">
            <div ref={messageListRef} className="messages">
              {messages.length === 0 ? (
                <p className="empty">No messages yet. Say hello.</p>
              ) : (
                messages.map((chatMsg) => (
                  <article
                    key={chatMsg.id}
                    className={chatMsg.type === 'system' ? 'msg system' : 'msg'}
                  >
                    <div className="meta">
                      <strong>{chatMsg.username}</strong>
                      <span>{new Date(chatMsg.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <p>{chatMsg.message}</p>
                  </article>
                ))
              )}
            </div>

            <form className="composer" onSubmit={sendMessage}>
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Type a message"
                maxLength={500}
              />
              <button type="submit">Send</button>
            </form>
          </main>
        </section>
      )}
    </div>
  )
}

export default App
