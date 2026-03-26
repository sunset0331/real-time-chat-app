import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import './App.css'

const socket = io('http://localhost:4000', {
  autoConnect: false,
})

function App() {
  const [username, setUsername] = useState('')
  const [room, setRoom] = useState('general')
  const [isJoined, setIsJoined] = useState(false)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState([])
  const [users, setUsers] = useState([])
  const [connectionStatus, setConnectionStatus] = useState('disconnected')
  const messageListRef = useRef(null)

  const roomTitle = useMemo(() => room.trim() || 'general', [room])

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

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('receive_message', onReceiveMessage)
    socket.on('room_history', onRoomHistory)
    socket.on('user_list', onUserList)

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('receive_message', onReceiveMessage)
      socket.off('room_history', onRoomHistory)
      socket.off('user_list', onUserList)
    }
  }, [])

  useEffect(() => {
    if (!messageListRef.current) {
      return
    }

    messageListRef.current.scrollTop = messageListRef.current.scrollHeight
  }, [messages])

  const joinRoom = (event) => {
    event.preventDefault()
    if (!username.trim() || !room.trim()) {
      return
    }

    if (!socket.connected) {
      socket.connect()
    }

    setMessages([])
    socket.emit('join_room', { username: username.trim(), room: room.trim() })
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
        <div className={`status ${connectionStatus}`}>{connectionStatus}</div>
      </header>

      {!isJoined ? (
        <section className="join-panel">
          <h2>Join a room</h2>
          <form onSubmit={joinRoom} className="join-form">
            <label>
              Username
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="e.g. utkarsh"
                maxLength={24}
              />
            </label>
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
