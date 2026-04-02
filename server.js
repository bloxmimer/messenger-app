const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static('./uploads'));

const DATA_FILE = 'antiblock_data.json';
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch(e) {}
    return { users: [], messages: [], chats: [], stickers: [], backups: [], nextId: 1 };
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users, messages, chats, stickers, backups, nextId: nextMessageId }, null, 2));
}

let { users, messages, chats, stickers, backups, nextId: nextMessageId } = loadData();
let codes = {};
let onlineUsers = new Set();
let typingStatus = {};

setInterval(saveData, 10000);
setInterval(() => {
    for (let [email, data] of Object.entries(codes)) {
        if (Date.now() > data.expires) delete codes[email];
    }
}, 60000);

const emailConfig = {
    service: 'gmail',
    auth: { user: 'antiblock.messenger@gmail.com', pass: 'gxkx ogpu olfa tqtn' }
};

const transporter = nodemailer.createTransport(emailConfig);

async function sendCodeEmail(email, code) {
    try {
        await transporter.sendMail({
            from: `"AntiBlock" <${emailConfig.auth.user}>`,
            to: email,
            subject: 'AntiBlock - Your Code',
            html: `<div style="font-family:Arial;padding:20px"><h2 style="color:#667eea">AntiBlock</h2><div style="font-size:48px;background:#f5f5f5;padding:20px;text-align:center">${code}</div><p>Valid 10 min</p></div>`
        });
        console.log(`✓ Email to ${email}`);
        return true;
    } catch(e) { console.log(`✗ Email error: ${e.message}`); return false; }
}

function generateId() { return Math.floor(100000000 + Math.random() * 900000000); }

app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000);
    codes[email] = { code, expires: Date.now() + 600000 };
    await sendCodeEmail(email, code);
    console.log(`\n===== CODE: ${code} for ${email} =====\n`);
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
        user = { id: generateId(), email, name: email.split('@')[0], avatar: null, bio: '', created_at: new Date(), encryptionKey: crypto.randomBytes(16).toString('hex'), theme: 'light', lang: 'ru' };
        users.push(user);
        console.log(`✨ New user: ${user.name} (${user.id})`);
    }
    onlineUsers.add(user.id);
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, secure: false, sameSite: 'lax' });
    res.json({ success: true, user, token });
});

app.post('/api/auth/check-session', (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.json({ valid: false });
    res.json({ valid: false });
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

app.post('/api/users/update', (req, res) => {
    const { userId, name, bio, avatar, theme, lang } = req.body;
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (name) user.name = name;
    if (bio !== undefined) user.bio = bio;
    if (theme) user.theme = theme;
    if (lang) user.lang = lang;
    if (avatar === 'delete') user.avatar = null;
    else if (avatar && avatar.startsWith('data:image')) {
        const filename = `avatar_${userId}_${Date.now()}.jpg`;
        fs.writeFileSync(`./uploads/${filename}`, Buffer.from(avatar.split(',')[1], 'base64'));
        user.avatar = `/uploads/${filename}`;
    }
    saveData();
    res.json({ success: true, user });
});

app.get('/api/users', (req, res) => res.json(users.map(u => ({ ...u, online: onlineUsers.has(u.id) }))));
app.get('/api/users/find/:userId', (req, res) => {
    const user = users.find(u => u.id === parseInt(req.params.userId));
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, user: { ...user, online: onlineUsers.has(user.id) } });
});

app.post('/api/chats/typing', (req, res) => {
    const { chat_id, user_id, is_typing } = req.body;
    typingStatus[`${chat_id}_${user_id}`] = { is_typing, timestamp: Date.now() };
    res.json({ success: true });
});
app.get('/api/chats/typing/:chatId/:userId', (req, res) => {
    const status = typingStatus[`${req.params.chatId}_${req.params.userId}`];
    if (status && Date.now() - status.timestamp < 3000) res.json({ is_typing: status.is_typing });
    else res.json({ is_typing: false });
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
            name: chat.type === 'group' ? chat.name : (other ? other.name : 'Chat'),
            avatar: chat.type === 'group' ? chat.avatar : (other ? other.avatar : null),
            type: chat.type || 'private',
            last_message: lastMsg ? (lastMsg.deleted ? 'Message deleted' : lastMsg.text) : 'No messages',
            unread_count: unread
        };
    });
    res.json(result);
});

app.get('/api/messages/:chatId', (req, res) => {
    const msgs = messages.filter(m => m.chat_id === parseInt(req.params.chatId) && !m.deleted)
        .sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    res.json(msgs);
});

app.post('/api/messages/send', (req, res) => {
    const { chat_id, sender_id, text, type, media_url, voice_url, reply_to } = req.body;
    const msg = {
        id: nextMessageId++,
        chat_id, sender_id,
        text: text || '',
        type: type || 'text',
        media_url: media_url || null,
        voice_url: voice_url || null,
        reply_to: reply_to || null,
        reactions: [],
        created_at: new Date().toISOString(),
        is_read: false, is_edited: false, deleted: false
    };
    messages.push(msg);
    saveData();
    res.json({ success: true, message: msg });
});

app.post('/api/messages/react', (req, res) => {
    const msg = messages.find(m => m.id === req.body.message_id);
    if (msg) {
        const existing = msg.reactions.find(r => r.user_id === req.body.user_id);
        if (existing) existing.emoji = req.body.emoji;
        else msg.reactions.push({ user_id: req.body.user_id, emoji: req.body.emoji });
        saveData();
        res.json({ success: true });
    } else res.status(404).json({ error: 'Not found' });
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
        if (msg.chat_id === req.body.chat_id && msg.sender_id !== req.body.user_id && !msg.is_read) msg.is_read = true;
    });
    saveData();
    res.json({ success: true });
});

app.post('/api/chats/create', (req, res) => {
    const { participants, name, type } = req.body;
    if (participants.length === 2 && participants[0] === participants[1]) {
        return res.status(400).json({ error: 'Cannot chat with yourself' });
    }
    const chat = {
        id: chats.length + 1,
        name: type === 'group' ? name : null,
        type: type || (participants.length === 2 ? 'private' : 'group'),
        participants,
        avatar: null,
        created_at: new Date().toISOString()
    };
    chats.push(chat);
    saveData();
    res.json({ success: true, chat });
});

app.post('/api/chats/add-participant', (req, res) => {
    const chat = chats.find(c => c.id === req.body.chat_id);
    if (chat && !chat.participants.includes(req.body.user_id)) {
        chat.participants.push(req.body.user_id);
        saveData();
        res.json({ success: true });
    } else res.json({ success: false });
});

app.post('/api/chats/update-avatar', (req, res) => {
    const chat = chats.find(c => c.id === req.body.chat_id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    if (req.body.avatar === 'delete') chat.avatar = null;
    else if (req.body.avatar && req.body.avatar.startsWith('data:image')) {
        const filename = `chat_${chat.id}_${Date.now()}.jpg`;
        fs.writeFileSync(`./uploads/${filename}`, Buffer.from(req.body.avatar.split(',')[1], 'base64'));
        chat.avatar = `/uploads/${filename}`;
        saveData();
    }
    res.json({ success: true, chat });
});

app.post('/api/stickers/add', (req, res) => {
    const { name, image, user_id } = req.body;
    if (image && image.startsWith('data:image')) {
        const filename = `sticker_${Date.now()}.png`;
        fs.writeFileSync(`./uploads/${filename}`, Buffer.from(image.split(',')[1], 'base64'));
        stickers.push({ id: stickers.length + 1, name, url: `/uploads/${filename}`, user_id });
        saveData();
        res.json({ success: true });
    } else res.status(400).json({ error: 'Invalid image' });
});
app.get('/api/stickers', (req, res) => res.json(stickers));

app.post('/api/upload/media', (req, res) => {
    const { file, type } = req.body;
    if (file && file.startsWith('data:')) {
        const ext = type === 'image' ? 'jpg' : type === 'video' ? 'mp4' : 'webm';
        const filename = `media_${Date.now()}.${ext}`;
        fs.writeFileSync(`./uploads/${filename}`, Buffer.from(file.split(',')[1], 'base64'));
        res.json({ success: true, url: `/uploads/${filename}` });
    } else res.status(400).json({ error: 'Invalid file' });
});

app.post('/api/users/qr', (req, res) => {
    const user = users.find(u => u.id === req.body.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, qr: Buffer.from(JSON.stringify({ id: user.id, name: user.name })).toString('base64') });
});

app.post('/api/users/scan-qr', (req, res) => {
    try {
        const data = JSON.parse(Buffer.from(req.body.qr, 'base64').toString());
        const targetUser = users.find(u => u.id === data.id);
        if (!targetUser) return res.status(404).json({ error: 'User not found' });
        let existingChat = chats.find(c => c.type === 'private' && c.participants.includes(req.body.userId) && c.participants.includes(targetUser.id));
        if (!existingChat) {
            existingChat = { id: chats.length + 1, type: 'private', participants: [req.body.userId, targetUser.id], created_at: new Date().toISOString() };
            chats.push(existingChat);
            saveData();
        }
        res.json({ success: true, user: targetUser, chat: existingChat });
    } catch(e) { res.status(400).json({ error: 'Invalid QR' }); }
});

app.post('/api/backup/create', (req, res) => {
    const user = users.find(u => u.id === req.body.user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const userMessages = messages.filter(m => {
        const chat = chats.find(c => c.id === m.chat_id);
        return chat && chat.participants.includes(user.id);
    });
    const backup = { id: backups.length + 1, user_id: user.id, created_at: new Date().toISOString(), data: JSON.stringify(userMessages) };
    backups.push(backup);
    saveData();
    res.json({ success: true, backup_id: backup.id });
});

app.get('/api/backup/list/:userId', (req, res) => {
    res.json(backups.filter(b => b.user_id === parseInt(req.params.userId)).map(b => ({ id: b.id, created_at: b.created_at })));
});

app.get('/api/status', (req, res) => res.json({ status: 'online', users: users.length, online: onlineUsers.size, messages: messages.length }));

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head><title>AntiBlock</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f5f5f5;padding:20px;transition:all 0.3s}body.dark{background:#1a1a2e}.container{max-width:500px;margin:0 auto;background:white;border-radius:25px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,0.1);transition:all 0.3s}body.dark .container{background:#1e1e2e}h1{text-align:center;margin-bottom:20px;color:#333}body.dark h1{color:#fff}input,button{width:100%;padding:14px;margin:8px 0;border:2px solid #e0e0e0;border-radius:12px;font-size:16px;transition:all 0.3s}body.dark input{background:#2d2d3a;border-color:#3d3d4a;color:#fff}button{background:#667eea;color:white;border:none;cursor:pointer;font-weight:bold}button.secondary{background:#999}.message{padding:12px;margin:12px 0;border-radius:12px;text-align:center}.success{background:#d4edda;color:#155724}.error{background:#f8d7da;color:#721c24}.info{background:#e3f2fd;color:#1976d2}body.dark .success{background:#1e3a2e;color:#8bc34a}body.dark .error{background:#3a1e1e;color:#ff6b6b}body.dark .info{background:#1e2a3a;color:#64b5f6}.hidden{display:none}.step{background:#f8f9fa;padding:20px;border-radius:16px;margin:15px 0}body.dark .step{background:#2d2d3a}.chat-item{padding:15px;margin:8px 0;background:#f8f9fa;border-radius:12px;cursor:pointer;display:flex;align-items:center;gap:12px;transition:all 0.2s}body.dark .chat-item{background:#2d2d3a}.chat-item:hover{transform:translateX(5px);background:#e9ecef}body.dark .chat-item:hover{background:#3d3d4a}.chat-avatar{width:50px;height:50px;border-radius:50%;background:#667eea;display:flex;align-items:center;justify-content:center;font-size:20px;color:white;object-fit:cover}.chat-info{flex:1}.chat-name{font-weight:bold;color:#333}body.dark .chat-name{color:#fff}.chat-last{font-size:12px;color:#666;margin-top:4px}body.dark .chat-last{color:#aaa}.unread{background:#667eea;color:white;border-radius:20px;padding:2px 10px;float:right}.message-bubble{padding:10px 14px;margin:8px;border-radius:18px;max-width:80%;word-wrap:break-word;position:relative}.sent{background:#667eea;color:white;margin-left:auto;text-align:right}.received{background:#f0f0f0;color:#333;margin-right:auto}body.dark .received{background:#2d2d3a;color:#fff}.timestamp{font-size:10px;margin-top:4px;display:inline-block}.checkmark{display:inline-block;margin-left:6px}.message-menu{position:absolute;right:5px;top:5px;background:rgba(0,0,0,0.5);border-radius:10px;padding:2px 6px;cursor:pointer;display:none;font-size:12px}.message-bubble:hover .message-menu{display:block}.profile-avatar{width:100px;height:100px;border-radius:50%;object-fit:cover;margin:0 auto;display:block;cursor:pointer;border:3px solid #667eea}.user-id-badge{font-family:monospace;background:#e8e8e8;display:inline-block;padding:4px 12px;border-radius:20px;margin-top:8px}body.dark .user-id-badge{background:#3d3d4a}.messages-container{min-height:350px;max-height:400px;overflow-y:auto;padding:10px;background:#fafafa;border-radius:16px;margin:10px 0}body.dark .messages-container{background:#252536}.input-group{display:flex;gap:10px;margin-top:10px}.input-group input{flex:1;margin:0}.input-group button{width:auto;padding:12px 20px;margin:0}.chat-header{display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:10px}.delete-chat-btn{background:#dc3545;width:auto;padding:8px 12px;margin:0}.reactions{display:flex;gap:4px;margin-top:4px}.reaction{background:#eee;border-radius:12px;padding:2px 6px;font-size:12px;cursor:pointer}body.dark .reaction{background:#3d3d4a}.menu-btn{background:#f0f0f0;border:none;font-size:24px;cursor:pointer;width:44px;height:44px;border-radius:12px}body.dark .menu-btn{background:#2d2d3a;color:#fff}.menu-btn.hidden{display:none}.sidebar{position:fixed;top:0;left:-100%;width:280px;height:100%;background:white;transition:left 0.3s;z-index:1000;padding:20px;box-shadow:2px 0 10px rgba(0,0,0,0.1)}body.dark .sidebar{background:#1e1e2e}.sidebar.open{left:0}.sidebar-header{display:flex;justify-content:space-between;margin-bottom:20px}.close-btn{background:none;border:none;font-size:24px;cursor:pointer}.sidebar-item{padding:12px;margin:8px 0;background:#f5f5f5;border-radius:12px;cursor:pointer;text-align:center}body.dark .sidebar-item{background:#2d2d3a}.sidebar-item:hover{background:#e0e0e0}body.dark .sidebar-item:hover{background:#3d3d4a}.overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:999;display:none}.overlay.show{display:block}.fab{position:fixed;bottom:30px;right:20px;width:56px;height:56px;background:#667eea;border-radius:50%;display:none;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.3);cursor:pointer;transition:all 0.2s;z-index:100;color:white;font-size:24px}.fab.show{display:flex}.fab:hover{transform:scale(1.05)}.fab-menu{position:fixed;bottom:100px;right:20px;background:white;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.15);overflow:hidden;z-index:99;transition:all 0.2s}body.dark .fab-menu{background:#1e1e2e}.fab-menu.hidden{display:none}.fab-item{padding:12px 20px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:background 0.2s}.fab-item:hover{background:#f0f0f0}body.dark .fab-item:hover{background:#2d2d3a}.fab-item span:first-child{font-size:20px}.theme-switch{display:flex;gap:10px;margin-top:10px}.theme-option{padding:8px;background:#f0f0f0;border-radius:8px;cursor:pointer;text-align:center;flex:1}body.dark .theme-option{background:#2d2d3a}.theme-option.active{background:#667eea;color:white}.lang-switch{display:flex;gap:10px;margin-top:10px}.lang-option{padding:8px;background:#f0f0f0;border-radius:8px;cursor:pointer;text-align:center;flex:1}body.dark .lang-option{background:#2d2d3a}.lang-option.active{background:#667eea;color:white}.modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center}.modal.hidden{display:none}.modal-content{background:white;border-radius:20px;padding:20px;width:300px;max-width:90%}body.dark .modal-content{background:#1e1e2e;color:#fff}.modal-content input{width:100%;margin:10px 0}</style></head>
<body><div class="overlay" id="overlay" onclick="closeSidebar()"></div><div class="sidebar" id="sidebar"><div class="sidebar-header"><h3>Settings</h3><button class="close-btn" onclick="closeSidebar()">✕</button></div><div class="sidebar-item" onclick="document.getElementById('avatarInput').click()">📷 Set Avatar</div><div class="sidebar-item" onclick="showQR()">📱 My QR</div><div class="sidebar-item" onclick="scanQR()">📷 Scan QR</div><div class="sidebar-item" onclick="backupChats()">💾 Backup</div><div class="sidebar-item" onclick="showMyId()">🆔 My ID</div><div class="sidebar-item" onclick="logout()">🚪 Logout</div><h3 style="margin-top:20px">Theme</h3><div class="theme-switch"><div class="theme-option" data-theme="light" onclick="setTheme('light')">Light</div><div class="theme-option" data-theme="dark" onclick="setTheme('dark')">Dark</div></div><h3 style="margin-top:15px">Language</h3><div class="lang-switch"><div class="lang-option" data-lang="ru" onclick="setLang('ru')">Русский</div><div class="lang-option" data-lang="en" onclick="setLang('en')">English</div></div><input type="file" id="avatarInput" accept="image/*" style="display:none" onchange="uploadAvatar(this)"></div><div class="fab" id="fab" onclick="toggleFabMenu()">✏️</div><div id="fabMenu" class="fab-menu hidden"><div class="fab-item" onclick="openCreateGroup()"><span>👥</span><span>Create Group</span></div><div class="fab-item" onclick="openFindUser()"><span>🔍</span><span>Find User</span></div><div class="fab-item" onclick="openSettings()"><span>⚙️</span><span>Settings</span></div></div><div class="container"><div class="header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px"><button class="menu-btn hidden" id="menuBtn" onclick="openSidebar()">☰</button><h1>AntiBlock</h1><div style="width:44px"></div></div><div id="loginScreen"><div class="step"><p id="enterEmailText">Enter your email</p><input type="email" id="email" placeholder="Email" /><button id="getCodeBtn" onclick="sendCode()">Get Code</button></div></div><div id="codeScreen" class="hidden"><div class="step"><p id="enterCodeText">Enter code</p><div class="message info" id="emailDisplay"></div><input type="text" id="code" placeholder="6-digit code" maxlength="6" /><button id="loginBtn" onclick="verifyCode()">Login</button><button onclick="backToLogin()" class="secondary">Back</button></div></div><div id="mainScreen" class="hidden"><div id="userInfo" style="padding:15px;background:#f5f5f5;border-radius:16px;margin-bottom:15px;text-align:center"></div><h3 id="chatsTitle">Chats</h3><div id="chatsList"></div></div><div id="chatScreen" class="hidden"><button onclick="backToMain()" class="secondary">← Back</button><h3 id="chatTitle"></h3><div id="messagesList" class="messages-container"></div><div class="input-group"><input type="text" id="messageInput" placeholder="Message..." /><button onclick="sendMessage()">Send</button></div></div><div id="status"></div></div><div id="groupModal" class="modal hidden"><div class="modal-content"><h3>Create Group</h3><input type="text" id="groupName" placeholder="Group name" /><input type="text" id="groupParticipants" placeholder="User IDs (comma separated)" /><button onclick="createGroup()">Create</button><button onclick="closeModal('groupModal')" class="secondary">Cancel</button></div></div><div id="findUserModal" class="modal hidden"><div class="modal-content"><h3>Find User</h3><input type="text" id="findUserId" placeholder="Enter user ID" /><button onclick="findAndStartChat()">Find</button><button onclick="closeModal('findUserModal')" class="secondary">Cancel</button></div></div><div id="settingsModal" class="modal hidden"><div class="modal-content"><h3>Settings</h3><div class="theme-switch"><div class="theme-option" data-theme="light" onclick="setTheme('light')">Light</div><div class="theme-option" data-theme="dark" onclick="setTheme('dark')">Dark</div></div><div class="lang-switch"><div class="lang-option" data-lang="ru" onclick="setLang('ru')">Русский</div><div class="lang-option" data-lang="en" onclick="setLang('en')">English</div></div><button onclick="closeModal('settingsModal')" class="secondary">Close</button></div></div><script>
let currentUser=null,currentChat=null,pendingEmail=null,msgInterval=null,currentToken=null;
const API=window.location.origin+'/api';
const translations={ru:{enterEmail:"Enter your email",getCode:"Get Code",enterCode:"Enter code",login:"Login",chats:"Chats",message:"Message...",send:"Send",back:"Back",logout:"Logout",settings:"Settings",theme:"Theme",language:"Language",light:"Light",dark:"Dark",russian:"Русский",english:"English"},en:{enterEmail:"Enter your email",getCode:"Get Code",enterCode:"Enter code",login:"Login",chats:"Chats",message:"Message...",send:"Send",back:"Back",logout:"Logout",settings:"Settings",theme:"Theme",language:"Language",light:"Light",dark:"Dark",russian:"Russian",english:"English"}};
let currentLang='ru';
function updateTexts(){if(document.getElementById('enterEmailText'))document.getElementById('enterEmailText').innerText=translations[currentLang].enterEmail;if(document.getElementById('getCodeBtn'))document.getElementById('getCodeBtn').innerText=translations[currentLang].getCode;if(document.getElementById('enterCodeText'))document.getElementById('enterCodeText').innerText=translations[currentLang].enterCode;if(document.getElementById('loginBtn'))document.getElementById('loginBtn').innerText=translations[currentLang].login;if(document.getElementById('chatsTitle'))document.getElementById('chatsTitle').innerText=translations[currentLang].chats;if(document.getElementById('messageInput'))document.getElementById('messageInput').placeholder=translations[currentLang].message;}
function setTheme(t){currentTheme=t;if(t==='dark')document.body.classList.add('dark');else document.body.classList.remove('dark');localStorage.setItem('theme',t);if(currentUser){fetch(API+'/users/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:currentUser.id,theme:t})});}document.querySelectorAll('.theme-option').forEach(opt=>{opt.classList.toggle('active',opt.getAttribute('data-theme')===t);});}
function setLang(l){currentLang=l;localStorage.setItem('lang',l);updateTexts();if(currentUser){fetch(API+'/users/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:currentUser.id,lang:l})});}document.querySelectorAll('.lang-option').forEach(opt=>{opt.classList.toggle('active',opt.getAttribute('data-lang')===l);});}
function toggleFabMenu(){document.getElementById('fabMenu').classList.toggle('hidden');}
function openCreateGroup(){toggleFabMenu();document.getElementById('groupModal').classList.remove('hidden');}
function openFindUser(){toggleFabMenu();document.getElementById('findUserModal').classList.remove('hidden');}
function openSettings(){toggleFabMenu();document.getElementById('settingsModal').classList.remove('hidden');}
function closeModal(id){document.getElementById(id).classList.add('hidden');}
async function createGroup(){const name=document.getElementById('groupName').value;const participantsStr=document.getElementById('groupParticipants').value;if(!name){showStatus('Enter group name','error');return;}const ids=participantsStr.split(',').map(p=>parseInt(p.trim())).filter(p=>!isNaN(p));ids.push(currentUser.id);const unique=[...new Set(ids)];try{const r=await fetch(API+'/chats/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({participants:unique,name:name,type:'group'})});const d=await r.json();if(d.success){showStatus('Group created!','success');loadChats();closeModal('groupModal');document.getElementById('groupName').value='';document.getElementById('groupParticipants').value='';}else{showStatus(d.error,'error');}}catch(e){showStatus('Error','error');}}
async function findAndStartChat(){const userId=document.getElementById('findUserId').value;if(!userId){showStatus('Enter user ID','error');return;}try{const r=await fetch(API+'/users/find/'+userId);const d=await r.json();if(d.success){if(d.user.id===currentUser.id){showStatus('Cannot chat with yourself','error');return;}const chatsRes=await fetch(API+'/chats/'+currentUser.id);const chats=await chatsRes.json();let existing=chats.find(c=>c.type!=='group'&&c.name===d.user.name);if(existing){openChat(existing);}else{const cr=await fetch(API+'/chats/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({participants:[currentUser.id,d.user.id],name:d.user.name,type:'private'})});const cd=await cr.json();if(cd.success)openChat(cd.chat);}closeModal('findUserModal');document.getElementById('findUserId').value='';}else{showStatus('User not found','error');}}catch(e){showStatus('Error','error');}}
async function sendCode(){const email=document.getElementById('email').value;if(!email)return showStatus('Enter email','error');showStatus('Sending...','info');try{const r=await fetch(API+'/auth/send-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});const d=await r.json();if(d.success){pendingEmail=email;document.getElementById('loginScreen').classList.add('hidden');document.getElementById('codeScreen').classList.remove('hidden');document.getElementById('emailDisplay').innerHTML='Code sent to <strong>'+email+'</strong>';showStatus('Check email or console!','success');}}catch(e){showStatus('Error','error');}}
async function verifyCode(){const code=document.getElementById('code').value;if(!code)return showStatus('Enter code','error');try{const r=await fetch(API+'/auth/verify-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:pendingEmail,code})});const d=await r.json();if(d.success){currentUser=d.user;currentToken=d.token;document.getElementById('codeScreen').classList.add('hidden');document.getElementById('mainScreen').classList.remove('hidden');document.getElementById('menuBtn').classList.remove('hidden');document.getElementById('fab').classList.add('show');updateUserInfo();loadChats();showStatus('Welcome, '+currentUser.name+'!','success');const savedTheme=localStorage.getItem('theme');const savedLang=localStorage.getItem('lang');if(savedTheme)setTheme(savedTheme);else setTheme('light');if(savedLang)setLang(savedLang);else setLang('ru');}else{showStatus(d.error,'error');}}catch(e){showStatus('Error','error');}}
function updateUserInfo(){const av=currentUser.avatar?'<img src="'+currentUser.avatar+'" style="width:60px;height:60px;border-radius:50%;object-fit:cover;margin-bottom:10px">':'<div style="width:60px;height:60px;border-radius:50%;background:#667eea;display:inline-flex;align-items:center;justify-content:center;font-size:30px;margin-bottom:10px">👤</div>';document.getElementById('userInfo').innerHTML=av+'<div><strong>'+currentUser.name+'</strong></div><div class="user-id-badge">ID: '+currentUser.id+'</div>';}
async function loadChats(){try{const r=await fetch(API+'/chats/'+currentUser.id);const chats=await r.json();const c=document.getElementById('chatsList');c.innerHTML='';if(chats.length===0){c.innerHTML='<div style="text-align:center;padding:30px;color:#999">No chats<br><small>Click ✏️ to create group or find user</small></div>';return;}chats.forEach(chat=>{const div=document.createElement('div');div.className='chat-item';div.onclick=()=>openChat(chat);const av=chat.avatar?'<img src="'+chat.avatar+'" class="chat-avatar" style="width:50px;height:50px;border-radius:50%;object-fit:cover">':'<div class="chat-avatar">'+(chat.type==='group'?'👥':'👤')+'</div>';div.innerHTML=av+'<div class="chat-info"><div class="chat-name">'+chat.name+(chat.unread_count>0?'<span class="unread">'+chat.unread_count+'</span>':'')+'</div><div class="chat-last">'+chat.last_message+'</div></div>';c.appendChild(div);});}catch(e){console.error(e);}}
async function openChat(chat){currentChat=chat;document.getElementById('mainScreen').classList.add('hidden');document.getElementById('chatScreen').classList.remove('hidden');document.getElementById('chatTitle').innerHTML=chat.name;await fetch(API+'/messages/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat.id,user_id:currentUser.id})});loadMessages();if(msgInterval)clearInterval(msgInterval);msgInterval=setInterval(loadMessages,3000);}
async function loadMessages(){if(!currentChat)return;try{const r=await fetch(API+'/messages/'+currentChat.id);const msgs=await r.json();const container=document.getElementById('messagesList');const wasBottom=container.scrollHeight-container.scrollTop<=container.clientHeight+50;container.innerHTML='';msgs.forEach(msg=>{const div=document.createElement('div');div.className='message-bubble '+(msg.sender_id===currentUser.id?'sent':'received');const check=msg.sender_id===currentUser.id?(msg.is_read?'<span class="checkmark">✓✓</span>':'<span class="checkmark">✓</span>'):'';const editBadge=msg.is_edited?'<span style="font-size:10px"> (edited)</span>':'';let content=msg.text;if(msg.type==='image'&&msg.media_url)content='<img src="'+msg.media_url+'" style="max-width:150px;border-radius:12px;cursor:pointer" onclick="window.open(this.src)">';if(msg.type==='video'&&msg.media_url)content='<video src="'+msg.media_url+'" controls style="max-width:150px;border-radius:12px"></video>';let reactionsHtml='';if(msg.reactions&&msg.reactions.length>0){reactionsHtml='<div class="reactions">';msg.reactions.forEach(r=>{reactionsHtml+='<span class="reaction" onclick="addReaction('+msg.id+',\''+r.emoji+'\')">'+r.emoji+'</span>';});reactionsHtml+='</div>';}div.innerHTML='<div>'+content+editBadge+'</div><div><span class="timestamp">'+new Date(msg.created_at).toLocaleTimeString()+'</span>'+check+'</div>'+reactionsHtml;if(msg.sender_id===currentUser.id){const menu=document.createElement('div');menu.className='message-menu';menu.innerHTML='⋯';menu.onclick=(e)=>{e.stopPropagation();const act=confirm('Edit? OK - edit, Cancel - delete');if(act){const nt=prompt('New text:',msg.text);if(nt&&nt!==msg.text)editMessage(msg.id,nt);}else{if(confirm('Delete message?'))deleteMessage(msg.id);}};div.appendChild(menu);}container.appendChild(div);});if(wasBottom)container.scrollTop=container.scrollHeight;}catch(e){console.error(e);}}
async function editMessage(id,txt){await fetch(API+'/messages/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message_id:id,new_text:txt})});loadMessages();}
async function deleteMessage(id){await fetch(API+'/messages/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message_id:id})});loadMessages();}
async function addReaction(id,emoji){await fetch(API+'/messages/react',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message_id:id,user_id:currentUser.id,emoji})});loadMessages();}
async function sendMessage(){const txt=document.getElementById('messageInput').value;if(!txt||!currentChat)return;await fetch(API+'/messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:currentChat.id,sender_id:currentUser.id,text:txt})});document.getElementById('messageInput').value='';loadMessages();}
function backToMain(){if(msgInterval)clearInterval(msgInterval);document.getElementById('chatScreen').classList.add('hidden');document.getElementById('mainScreen').classList.remove('hidden');loadChats();}
function backToLogin(){document.getElementById('codeScreen').classList.add('hidden');document.getElementById('loginScreen').classList.remove('hidden');document.getElementById('code').value='';}
function logout(){if(msgInterval)clearInterval(msgInterval);fetch(API+'/auth/logout',{method:'POST'});currentUser=null;document.getElementById('mainScreen').classList.add('hidden');document.getElementById('loginScreen').classList.remove('hidden');document.getElementById('menuBtn').classList.add('hidden');document.getElementById('fab').classList.remove('show');document.getElementById('email').value='';closeSidebar();showStatus('Logged out','success');}
function showStatus(msg,type){const d=document.getElementById('status');d.innerHTML=msg;d.className='message '+type;setTimeout(()=>{d.innerHTML='';},3000);}
function openSidebar(){document.getElementById('sidebar').classList.add('open');document.getElementById('overlay').classList.add('show');}
function closeSidebar(){document.getElementById('sidebar').classList.remove('open');document.getElementById('overlay').classList.remove('show');}
function showMyId(){alert('Your ID: '+currentUser.id);closeSidebar();}
function showQR(){fetch(API+'/users/qr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:currentUser.id})}).then(r=>r.json()).then(d=>{if(d.success)alert('Your QR:\\n'+d.qr);});}
function scanQR(){const qr=prompt('Paste QR:');if(qr){fetch(API+'/users/scan-qr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({qr:qr,userId:currentUser.id})}).then(r=>r.json()).then(d=>{if(d.success){showStatus('Added '+d.user.name,'success');loadChats();}else{showStatus('Invalid QR','error');}});}}
function backupChats(){fetch(API+'/backup/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:currentUser.id})}).then(r=>r.json()).then(d=>{if(d.success)showStatus('Backup created! ID: '+d.backup_id,'success');});}
function uploadAvatar(input){if(input.files&&input.files[0]){const reader=new FileReader();reader.onload=e=>{fetch(API+'/users/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:currentUser.id,avatar:e.target.result})}).then(r=>r.json()).then(d=>{if(d.success){currentUser=d.user;updateUserInfo();showStatus('Avatar updated!','success');}});};reader.readAsDataURL(input.files[0]);}}
document.getElementById('code').addEventListener('keypress',e=>{if(e.key==='Enter')verifyCode();});
document.getElementById('messageInput').addEventListener('keypress',e=>{if(e.key==='Enter')sendMessage();});
</script></body></html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AntiBlock running on port ${PORT}`));
