const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const DATA_FILE = 'antiblock_data.json';

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (e) {}
    return { users: [], messages: [], chats: [], nextId: 1 };
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ users, messages, chats, nextId: nextMessageId }, null, 2));
        console.log('💾 Saved');
    } catch (e) {}
}

let { users, messages, chats, nextId: nextMessageId } = loadData();
let codes = {};
let onlineUsers = new Set();

setInterval(saveData, 10000);

const emailConfig = {
    service: 'gmail',
    auth: {
        user: 'antiblock.messenger@gmail.com',
        pass: 'gxkx ogpu olfa tqtn'
    }
};

const transporter = nodemailer.createTransport(emailConfig);

async function sendCodeEmail(email, code) {
    try {
        await transporter.sendMail({
            from: `"AntiBlock" <${emailConfig.auth.user}>`,
            to: email,
            subject: 'AntiBlock - Your Code',
            html: `<div style="font-family:Arial;padding:20px"><h2 style="color:#667eea">AntiBlock</h2><p>Your code:</p><div style="font-size:48px;font-weight:bold;background:#f5f5f5;padding:20px;text-align:center">${code}</div><p>Valid 10 min</p></div>`
        });
        console.log(`✓ Email to ${email}`);
        return true;
    } catch (e) {
        console.log(`✗ Email error: ${e.message}`);
        return false;
    }
}

function generateId() {
    return Math.floor(100000000 + Math.random() * 900000000);
}

app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000);
    codes[email] = { code, expires: Date.now() + 600000 };
    const sent = await sendCodeEmail(email, code);
    if (!sent) console.log(`\n===== CODE: ${code} for ${email} =====\n`);
    res.json({ success: true });
});

app.post('/api/auth/verify-code', (req, res) => {
    const { email, code } = req.body;
    const stored = codes[email];
    if (!stored || stored.code != code || Date.now() > stored.expires) {
        return res.status(400).json({ error: 'Invalid code' });
    }
    delete codes[email];
    let user = users.find(u => u.email === email);
    if (!user) {
        user = { id: generateId(), email, name: email.split('@')[0], avatar: null, bio: '', created_at: new Date() };
        users.push(user);
        saveData();
        console.log(`✨ New user: ${user.name} (${user.id})`);
    }
    onlineUsers.add(user.id);
    res.json({ success: true, user });
});

app.post('/api/users/update', (req, res) => {
    const { userId, name, bio, avatar } = req.body;
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (name) user.name = name;
    if (bio !== undefined) user.bio = bio;
    if (avatar === 'delete') user.avatar = null;
    else if (avatar && avatar.startsWith('data:image')) user.avatar = avatar;
    saveData();
    res.json({ success: true, user });
});

app.get('/api/users', (req, res) => res.json(users.map(u => ({ ...u, online: onlineUsers.has(u.id) }))));

app.get('/api/users/find/:userId', (req, res) => {
    const user = users.find(u => u.id === parseInt(req.params.userId));
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, user: { ...user, online: onlineUsers.has(user.id) } });
});

app.get('/api/chats/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    const userChats = chats.filter(c => c.participants && c.participants.includes(userId));
    const result = userChats.map(chat => {
        const chatMessages = messages.filter(m => m.chat_id === chat.id);
        const lastMsg = chatMessages[chatMessages.length - 1];
        const unread = chatMessages.filter(m => m.sender_id !== userId && !m.is_read).length;
        const otherId = chat.participants.find(p => p !== userId);
        const other = users.find(u => u.id === otherId);
        return {
            id: chat.id,
            name: other ? other.name : 'Chat',
            avatar: other ? other.avatar : null,
            last_message: lastMsg ? (lastMsg.deleted ? 'Message deleted' : lastMsg.text) : 'No messages',
            unread_count: unread
        };
    });
    res.json(result);
});

app.get('/api/messages/:chatId', (req, res) => {
    const msgs = messages.filter(m => m.chat_id === parseInt(req.params.chatId) && !m.deleted).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    res.json(msgs);
});

app.post('/api/messages/send', (req, res) => {
    const { chat_id, sender_id, text } = req.body;
    const msg = {
        id: nextMessageId++,
        chat_id, sender_id, text,
        created_at: new Date().toISOString(),
        is_read: false, is_edited: false, deleted: false
    };
    messages.push(msg);
    saveData();
    res.json({ success: true, message: msg });
});

app.post('/api/messages/edit', (req, res) => {
    const msg = messages.find(m => m.id === req.body.message_id);
    if (msg) { msg.text = req.body.new_text; msg.is_edited = true; saveData(); res.json({ success: true }); }
    else res.status(404).json({ error: 'Not found' });
});

app.post('/api/messages/delete', (req, res) => {
    const msg = messages.find(m => m.id === req.body.message_id);
    if (msg) { msg.deleted = true; msg.text = 'Message deleted'; saveData(); res.json({ success: true }); }
    else res.status(404).json({ error: 'Not found' });
});

app.post('/api/chats/delete', (req, res) => {
    chats = chats.filter(c => c.id !== req.body.chat_id);
    messages = messages.filter(m => m.chat_id !== req.body.chat_id);
    saveData();
    res.json({ success: true });
});

app.post('/api/messages/read', (req, res) => {
    messages.forEach(msg => {
        if (msg.chat_id === req.body.chat_id && msg.sender_id !== req.body.user_id && !msg.is_read) {
            msg.is_read = true;
        }
    });
    saveData();
    res.json({ success: true });
});

app.post('/api/chats/create', (req, res) => {
    const { participants, name } = req.body;
    if (participants[0] === participants[1]) return res.status(400).json({ error: 'Cannot chat with yourself' });
    const chat = { id: chats.length + 1, name: name || null, participants, created_at: new Date().toISOString() };
    chats.push(chat);
    saveData();
    res.json({ success: true, chat });
});

app.get('/api/status', (req, res) => res.json({ status: 'online', users: users.length, online: onlineUsers.size }));

// ==================== HTML ====================
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>AntiBlock</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 500px;
            margin: 0 auto;
            background: white;
            border-radius: 25px;
            padding: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.1);
        }
        h1 { text-align: center; color: #333; margin-bottom: 20px; }
        input, button {
            width: 100%;
            padding: 14px;
            margin: 8px 0;
            border: 2px solid #e0e0e0;
            border-radius: 12px;
            font-size: 16px;
        }
        button {
            background: #667eea;
            color: white;
            border: none;
            cursor: pointer;
            font-weight: bold;
        }
        button.secondary { background: #999; }
        .message {
            padding: 12px;
            margin: 12px 0;
            border-radius: 12px;
            text-align: center;
        }
        .success { background: #d4edda; color: #155724; }
        .error { background: #f8d7da; color: #721c24; }
        .info { background: #e3f2fd; color: #1976d2; }
        .hidden { display: none; }
        .step { background: #f8f9fa; padding: 20px; border-radius: 16px; margin: 15px 0; }
        .chat-item {
            padding: 15px;
            margin: 8px 0;
            background: #f8f9fa;
            border-radius: 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .chat-avatar {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: #667eea;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            color: white;
        }
        .chat-info { flex: 1; }
        .chat-name { font-weight: bold; }
        .chat-last { font-size: 12px; color: #666; margin-top: 4px; }
        .unread {
            background: #667eea;
            color: white;
            border-radius: 20px;
            padding: 2px 10px;
            font-size: 12px;
            float: right;
        }
        .message-bubble {
            padding: 10px 14px;
            margin: 8px;
            border-radius: 18px;
            max-width: 80%;
            word-wrap: break-word;
        }
        .sent {
            background: #667eea;
            color: white;
            margin-left: auto;
            text-align: right;
        }
        .received {
            background: #f0f0f0;
            color: #333;
            margin-right: auto;
        }
        .timestamp { font-size: 10px; margin-top: 4px; opacity: 0.7; }
        .checkmark { display: inline-block; margin-left: 6px; font-size: 11px; }
        .message-menu {
            position: absolute;
            right: 5px;
            top: 5px;
            background: rgba(0,0,0,0.5);
            border-radius: 10px;
            padding: 2px 6px;
            cursor: pointer;
            display: none;
            font-size: 12px;
        }
        .message-bubble:hover .message-menu { display: block; }
        .profile-avatar {
            width: 100px;
            height: 100px;
            border-radius: 50%;
            object-fit: cover;
            margin: 0 auto;
            display: block;
            cursor: pointer;
            border: 3px solid #667eea;
        }
        .user-id-badge {
            font-family: monospace;
            background: #e8e8e8;
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            margin-top: 8px;
        }
        .messages-container {
            min-height: 350px;
            max-height: 400px;
            overflow-y: auto;
            padding: 10px;
            background: #fafafa;
            border-radius: 16px;
            margin: 10px 0;
        }
        .input-group {
            display: flex;
            gap: 10px;
            margin-top: 10px;
        }
        .input-group input { flex: 1; margin: 0; }
        .input-group button { width: auto; padding: 12px 20px; margin: 0; }
        .chat-header {
            display: flex;
            align-items: center;
            gap: 10px;
            justify-content: space-between;
            margin-bottom: 10px;
        }
        .delete-chat-btn { background: #dc3545; width: auto; padding: 8px 12px; font-size: 12px; margin: 0; }
    </style>
</head>
<body>
<div class="container">
    <div class="header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h1>AntiBlock</h1>
        <div style="width:44px"></div>
    </div>
    
    <!-- LOGIN SCREEN -->
    <div id="loginScreen">
        <div class="step">
            <p>Enter your email</p>
            <input type="email" id="email" placeholder="Email" />
            <button onclick="sendCode()">Get Code</button>
        </div>
    </div>
    
    <!-- CODE SCREEN -->
    <div id="codeScreen" class="hidden">
        <div class="step">
            <p>Enter verification code</p>
            <div class="message info" id="emailDisplay"></div>
            <input type="text" id="code" placeholder="6-digit code" maxlength="6" />
            <button onclick="verifyCode()">Login</button>
            <button onclick="backToLogin()" class="secondary">Back</button>
        </div>
    </div>
    
    <!-- MAIN SCREEN -->
    <div id="mainScreen" class="hidden">
        <div id="userInfo" style="padding:15px;background:#f5f5f5;border-radius:16px;margin-bottom:15px;text-align:center"></div>
        <h3>Chats</h3>
        <div id="chatsList"></div>
        <button onclick="logout()" style="margin-top:15px;background:#999">Logout</button>
    </div>
    
    <!-- CHAT SCREEN -->
    <div id="chatScreen" class="hidden">
        <button onclick="backToMain()" class="secondary" style="margin-bottom:10px">← Back</button>
        <h3 id="chatTitle"></h3>
        <div id="messagesList" class="messages-container"></div>
        <div class="input-group">
            <input type="text" id="messageInput" placeholder="Message..." />
            <button onclick="sendMessage()">Send</button>
        </div>
    </div>
    
    <div id="status"></div>
</div>

<script>
let currentUser = null;
let currentChat = null;
let pendingEmail = null;
let msgInterval = null;
const API = window.location.origin + '/api';

async function sendCode() {
    const email = document.getElementById('email').value;
    if (!email) return showStatus('Enter email', 'error');
    showStatus('Sending...', 'info');
    try {
        const res = await fetch(API + '/auth/send-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.success) {
            pendingEmail = email;
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('codeScreen').classList.remove('hidden');
            document.getElementById('emailDisplay').innerHTML = 'Code sent to <strong>' + email + '</strong>';
            showStatus('Check your email or server console!', 'success');
        } else {
            showStatus(data.error, 'error');
        }
    } catch(e) {
        showStatus('Error: ' + e.message, 'error');
    }
}

async function verifyCode() {
    const code = document.getElementById('code').value;
    if (!code) return showStatus('Enter code', 'error');
    try {
        const res = await fetch(API + '/auth/verify-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: pendingEmail, code })
        });
        const data = await res.json();
        if (data.success) {
            currentUser = data.user;
            document.getElementById('codeScreen').classList.add('hidden');
            document.getElementById('mainScreen').classList.remove('hidden');
            updateUserInfo();
            loadChats();
            showStatus('Welcome, ' + currentUser.name + '!', 'success');
            document.getElementById('code').value = '';
        } else {
            showStatus(data.error, 'error');
        }
    } catch(e) {
        showStatus('Error: ' + e.message, 'error');
    }
}

function updateUserInfo() {
    const av = currentUser.avatar ? '<img src="'+currentUser.avatar+'" style="width:60px;height:60px;border-radius:50%;object-fit:cover;margin-bottom:10px;">' : '<div style="width:60px;height:60px;border-radius:50%;background:#667eea;display:inline-flex;align-items:center;justify-content:center;font-size:30px;margin-bottom:10px;">👤</div>';
    document.getElementById('userInfo').innerHTML = av + '<div><strong>' + currentUser.name + '</strong></div><div class="user-id-badge">ID: ' + currentUser.id + '</div>';
}

async function loadChats() {
    try {
        const res = await fetch(API + '/chats/' + currentUser.id);
        const chats = await res.json();
        const container = document.getElementById('chatsList');
        container.innerHTML = '';
        if (chats.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:30px;color:#999">No chats<br><small>Find users in settings</small></div>';
            return;
        }
        chats.forEach(chat => {
            const div = document.createElement('div');
            div.className = 'chat-item';
            div.onclick = () => openChat(chat);
            const av = chat.avatar ? '<img src="'+chat.avatar+'" class="chat-avatar" style="width:50px;height:50px;border-radius:50%;object-fit:cover">' : '<div class="chat-avatar">👤</div>';
            div.innerHTML = av + '<div class="chat-info"><div class="chat-name">' + chat.name + (chat.unread_count > 0 ? '<span class="unread">' + chat.unread_count + '</span>' : '') + '</div><div class="chat-last">' + chat.last_message + '</div></div>';
            container.appendChild(div);
        });
    } catch(e) { console.error(e); }
}

async function openChat(chat) {
    currentChat = chat;
    document.getElementById('mainScreen').classList.add('hidden');
    document.getElementById('chatScreen').classList.remove('hidden');
    document.getElementById('chatTitle').innerHTML = chat.name;
    await fetch(API + '/messages/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat.id, user_id: currentUser.id })
    });
    loadMessages();
    if (msgInterval) clearInterval(msgInterval);
    msgInterval = setInterval(loadMessages, 3000);
}

async function loadMessages() {
    if (!currentChat) return;
    try {
        const res = await fetch(API + '/messages/' + currentChat.id);
        const msgs = await res.json();
        const container = document.getElementById('messagesList');
        const wasBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
        container.innerHTML = '';
        msgs.forEach(msg => {
            const div = document.createElement('div');
            div.className = 'message-bubble ' + (msg.sender_id === currentUser.id ? 'sent' : 'received');
            const check = msg.sender_id === currentUser.id ? (msg.is_read ? '<span class="checkmark">✓✓</span>' : '<span class="checkmark">✓</span>') : '';
            const editBadge = msg.is_edited ? '<span style="font-size:10px;"> (edited)</span>' : '';
            div.innerHTML = '<div>' + msg.text + editBadge + '</div><div><span class="timestamp">' + new Date(msg.created_at).toLocaleTimeString() + '</span>' + check + '</div>';
            if (msg.sender_id === currentUser.id) {
                const menu = document.createElement('div');
                menu.className = 'message-menu';
                menu.innerHTML = '⋯';
                menu.onclick = (e) => {
                    e.stopPropagation();
                    const act = confirm('Edit? OK - edit, Cancel - delete');
                    if (act) {
                        const nt = prompt('New text:', msg.text);
                        if (nt && nt !== msg.text) editMessage(msg.id, nt);
                    } else {
                        if (confirm('Delete message?')) deleteMessage(msg.id);
                    }
                };
                div.appendChild(menu);
            }
            container.appendChild(div);
        });
        if (wasBottom) container.scrollTop = container.scrollHeight;
    } catch(e) { console.error(e); }
}

async function editMessage(id, txt) {
    try {
        await fetch(API + '/messages/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message_id: id, new_text: txt }) });
        loadMessages();
    } catch(e) { showStatus('Error', 'error'); }
}

async function deleteMessage(id) {
    try {
        await fetch(API + '/messages/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message_id: id }) });
        loadMessages();
    } catch(e) { showStatus('Error', 'error'); }
}

async function deleteCurrentChat() {
    if (confirm('Delete this chat?')) {
        try {
            await fetch(API + '/chats/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: currentChat.id }) });
            showStatus('Chat deleted', 'success');
            backToMain();
        } catch(e) { showStatus('Error', 'error'); }
    }
}

async function sendMessage() {
    const txt = document.getElementById('messageInput').value;
    if (!txt || !currentChat) return;
    try {
        await fetch(API + '/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: currentChat.id, sender_id: currentUser.id, text: txt }) });
        document.getElementById('messageInput').value = '';
        loadMessages();
    } catch(e) { console.error(e); }
}

function backToMain() {
    if (msgInterval) clearInterval(msgInterval);
    document.getElementById('chatScreen').classList.add('hidden');
    document.getElementById('mainScreen').classList.remove('hidden');
    loadChats();
}

function backToLogin() {
    document.getElementById('codeScreen').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('code').value = '';
    pendingEmail = null;
}

function logout() {
    if (msgInterval) clearInterval(msgInterval);
    currentUser = null;
    document.getElementById('mainScreen').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('email').value = '';
    showStatus('Logged out', 'success');
}

function showStatus(msg, type) {
    const d = document.getElementById('status');
    d.innerHTML = msg;
    d.className = 'message ' + type;
    setTimeout(() => { d.innerHTML = ''; d.className = ''; }, 3000);
}

document.getElementById('code').addEventListener('keypress', e => { if (e.key === 'Enter') verifyCode(); });
document.getElementById('messageInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });
document.getElementById('email').addEventListener('keypress', e => { if (e.key === 'Enter') sendCode(); });
</script>
</body>
</html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AntiBlock running on port ${PORT}`));
