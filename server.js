const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const DATA_FILE = 'antiblock_data.json';
const SESSIONS_FILE = 'sessions.json';
const UPLOADS_DIR = './uploads';

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (e) {}
    return { users: [], messages: [], chats: [], stickers: [], nextId: 1, backups: [] };
}

function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function saveSessions() {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
    } catch (e) {}
}

let { users, messages, chats, stickers, nextId: nextMessageId, backups } = loadData();
let sessions = loadSessions();
let codes = {};
let onlineUsers = new Set();
let typingStatus = {};

setInterval(saveData, 10000);
setInterval(() => {
    const now = Date.now();
    for (let [token, data] of Object.entries(sessions)) {
        if (now - data.lastActive > 30 * 60 * 1000) delete sessions[token];
    }
    saveSessions();
}, 60000);

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ users, messages, chats, stickers, nextId: nextMessageId, backups }, null, 2));
        console.log('💾 Saved');
    } catch (e) {}
}

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
            html: `<div style="font-family:Arial;padding:20px;max-width:500px;margin:0 auto;border:1px solid #eee;border-radius:16px">
                        <h2 style="color:#667eea">AntiBlock</h2>
                        <p>Your verification code:</p>
                        <div style="font-size:48px;font-weight:bold;background:#f5f5f5;padding:20px;text-align:center;border-radius:12px;letter-spacing:8px">${code}</div>
                        <p>Valid for 10 minutes.</p>
                        <hr><small>AntiBlock Messenger</small>
                    </div>`
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

function getClientIp(req) {
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
}

function encrypt(text, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key.padEnd(32, '0')), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text, key) {
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedText = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key.padEnd(32, '0')), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
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
    const ip = getClientIp(req);
    const stored = codes[email];
    if (!stored || stored.code != code || Date.now() > stored.expires) {
        return res.status(400).json({ error: 'Invalid code' });
    }
    delete codes[email];
    let user = users.find(u => u.email === email);
    if (!user) {
        user = { id: generateId(), email, name: email.split('@')[0], avatar: null, bio: '', created_at: new Date(), encryptionKey: crypto.randomBytes(16).toString('hex') };
        users.push(user);
        saveData();
        console.log(`✨ New user: ${user.name} (${user.id})`);
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions[token] = {
        userId: user.id,
        email: user.email,
        ip: ip,
        createdAt: Date.now(),
        lastActive: Date.now()
    };
    saveSessions();
    onlineUsers.add(user.id);
    res.json({ success: true, user, token });
});

app.post('/api/auth/check-session', (req, res) => {
    const { token } = req.body;
    const ip = getClientIp(req);
    const session = sessions[token];
    if (!session) return res.json({ valid: false });
    if (session.ip !== ip) return res.json({ valid: false, ipChanged: true });
    if (Date.now() - session.lastActive > 30 * 60 * 1000) {
        delete sessions[token];
        saveSessions();
        return res.json({ valid: false, expired: true });
    }
    session.lastActive = Date.now();
    saveSessions();
    const user = users.find(u => u.id === session.userId);
    res.json({ valid: true, user });
});

app.post('/api/auth/logout', (req, res) => {
    const { token } = req.body;
    const session = sessions[token];
    if (session) {
        onlineUsers.delete(session.userId);
        delete sessions[token];
        saveSessions();
    }
    res.json({ success: true });
});

app.post('/api/users/update', (req, res) => {
    const { userId, name, bio, avatar } = req.body;
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (name) user.name = name;
    if (bio !== undefined) user.bio = bio;
    if (avatar === 'delete') user.avatar = null;
    else if (avatar && avatar.startsWith('data:image')) {
        const filename = `avatar_${userId}_${Date.now()}.jpg`;
        const filepath = path.join(UPLOADS_DIR, filename);
        const base64 = avatar.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(filepath, Buffer.from(base64, 'base64'));
        user.avatar = `/uploads/${filename}`;
    }
    saveData();
    res.json({ success: true, user });
});

app.post('/api/users/qr', (req, res) => {
    const { userId } = req.body;
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const qrData = JSON.stringify({ id: user.id, name: user.name, email: user.email });
    res.json({ success: true, qr: Buffer.from(qrData).toString('base64') });
});

app.post('/api/users/scan-qr', (req, res) => {
    const { qr, userId } = req.body;
    try {
        const data = JSON.parse(Buffer.from(qr, 'base64').toString());
        const targetUser = users.find(u => u.id === data.id);
        if (!targetUser) return res.status(404).json({ error: 'User not found' });
        let existingChat = chats.find(c => 
            c.type === 'private' && 
            c.participants.includes(userId) && 
            c.participants.includes(targetUser.id)
        );
        if (!existingChat) {
            existingChat = {
                id: chats.length + 1,
                type: 'private',
                participants: [userId, targetUser.id],
                created_at: new Date().toISOString()
            };
            chats.push(existingChat);
            saveData();
        }
        res.json({ success: true, user: targetUser, chat: existingChat });
    } catch(e) {
        res.status(400).json({ error: 'Invalid QR code' });
    }
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
    if (status && Date.now() - status.timestamp < 3000) {
        res.json({ is_typing: status.is_typing });
    } else {
        res.json({ is_typing: false });
    }
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
            unread_count: unread,
            participants: chat.participants
        };
    });
    res.json(result);
});

app.get('/api/messages/:chatId', (req, res) => {
    const msgs = messages.filter(m => m.chat_id === parseInt(req.params.chatId) && !m.deleted)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    res.json(msgs);
});

app.post('/api/messages/send', (req, res) => {
    const { chat_id, sender_id, text, type, media_url, reply_to, voice_url } = req.body;
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
    const { message_id, user_id, emoji } = req.body;
    const msg = messages.find(m => m.id === message_id);
    if (msg) {
        const existing = msg.reactions.find(r => r.user_id === user_id);
        if (existing) existing.emoji = emoji;
        else msg.reactions.push({ user_id, emoji });
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
        if (msg.chat_id === req.body.chat_id && msg.sender_id !== req.body.user_id && !msg.is_read) {
            msg.is_read = true;
        }
    });
    saveData();
    res.json({ success: true });
});

app.post('/api/chats/create', (req, res) => {
    const { participants, name, type } = req.body;
    if (participants.length < 2) return res.status(400).json({ error: 'Need at least 2 participants' });
    if (participants.length === 2 && participants[0] === participants[1]) {
        return res.status(400).json({ error: 'Cannot chat with yourself' });
    }
    const chat = {
        id: chats.length + 1,
        name: name || null,
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
    const { chat_id, user_id } = req.body;
    const chat = chats.find(c => c.id === chat_id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    if (!chat.participants.includes(user_id)) {
        chat.participants.push(user_id);
        saveData();
        res.json({ success: true });
    } else {
        res.json({ success: true, already: true });
    }
});

app.post('/api/chats/remove-participant', (req, res) => {
    const { chat_id, user_id } = req.body;
    const chat = chats.find(c => c.id === chat_id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    chat.participants = chat.participants.filter(p => p !== user_id);
    if (chat.participants.length < 2) {
        chats = chats.filter(c => c.id !== chat_id);
        messages = messages.filter(m => m.chat_id !== chat_id);
    }
    saveData();
    res.json({ success: true });
});

app.post('/api/chats/update-avatar', (req, res) => {
    const { chat_id, avatar } = req.body;
    const chat = chats.find(c => c.id === chat_id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    if (avatar === 'delete') chat.avatar = null;
    else if (avatar && avatar.startsWith('data:image')) {
        const filename = `chat_${chat_id}_${Date.now()}.jpg`;
        const filepath = path.join(UPLOADS_DIR, filename);
        const base64 = avatar.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(filepath, Buffer.from(base64, 'base64'));
        chat.avatar = `/uploads/${filename}`;
        saveData();
    }
    res.json({ success: true, chat });
});

app.post('/api/stickers/add', (req, res) => {
    const { name, image, user_id } = req.body;
    if (image && image.startsWith('data:image')) {
        const filename = `sticker_${Date.now()}.png`;
        const filepath = path.join(UPLOADS_DIR, filename);
        const base64 = image.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(filepath, Buffer.from(base64, 'base64'));
        const sticker = { id: stickers.length + 1, name, url: `/uploads/${filename}`, user_id };
        stickers.push(sticker);
        saveData();
        res.json({ success: true, sticker });
    } else res.status(400).json({ error: 'Invalid image' });
});

app.get('/api/stickers', (req, res) => res.json(stickers));

app.post('/api/upload/media', (req, res) => {
    const { file, type } = req.body;
    if (file && file.startsWith('data:')) {
        const ext = type === 'image' ? 'jpg' : type === 'video' ? 'mp4' : 'webm';
        const filename = `media_${Date.now()}.${ext}`;
        const filepath = path.join(UPLOADS_DIR, filename);
        const base64 = file.replace(/^data:.*;base64,/, '');
        fs.writeFileSync(filepath, Buffer.from(base64, 'base64'));
        res.json({ success: true, url: `/uploads/${filename}` });
    } else res.status(400).json({ error: 'Invalid file' });
});

app.post('/api/backup/create', (req, res) => {
    const { user_id } = req.body;
    const user = users.find(u => u.id === user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const userMessages = messages.filter(m => {
        const chat = chats.find(c => c.id === m.chat_id);
        return chat && chat.participants.includes(user_id);
    });
    const backup = {
        id: backups.length + 1,
        user_id,
        created_at: new Date().toISOString(),
        data: encrypt(JSON.stringify(userMessages), user.encryptionKey)
    };
    backups.push(backup);
    saveData();
    res.json({ success: true, backup_id: backup.id });
});

app.post('/api/backup/restore', (req, res) => {
    const { user_id, backup_id } = req.body;
    const user = users.find(u => u.id === user_id);
    const backup = backups.find(b => b.id === backup_id && b.user_id === user_id);
    if (!user || !backup) return res.status(404).json({ error: 'Backup not found' });
    try {
        const restoredMessages = JSON.parse(decrypt(backup.data, user.encryptionKey));
        for (const msg of restoredMessages) {
            if (!messages.find(m => m.id === msg.id)) {
                messages.push(msg);
            }
        }
        saveData();
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: 'Failed to restore' });
    }
});

app.get('/api/backup/list/:userId', (req, res) => {
    const userBackups = backups.filter(b => b.user_id === parseInt(req.params.userId));
    res.json(userBackups.map(b => ({ id: b.id, created_at: b.created_at })));
});

app.get('/api/status', (req, res) => res.json({ 
    status: 'online', 
    users: users.length, 
    online: onlineUsers.size,
    messages: messages.length,
    chats: chats.length,
    stickers: stickers.length
}));

// ==================== HTML ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);

fs.writeFileSync(path.join(publicDir, 'index.html'), `<!DOCTYPE html>
<html>
<head><title>AntiBlock</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f5f5f5;min-height:100vh}body.dark{background:#1a1a2e}.container{max-width:95%;margin:0 auto;background:white;min-height:100vh}body.dark .container{background:#1e1e2e}.header{display:flex;justify-content:space-between;align-items:center;padding:16px;background:white;border-bottom:1px solid #eee}body.dark .header{background:#1e1e2e;border-bottom-color:#333}h1{font-size:24px;color:#333}body.dark h1{color:#fff}.menu-btn{background:#f0f0f0;border:none;font-size:24px;cursor:pointer;width:44px;height:44px;border-radius:12px}body.dark .menu-btn{background:#2d2d3a;color:#fff}.menu-btn.hidden{display:none}.sidebar{position:fixed;top:0;left:-100%;width:100%;height:100%;background:white;transition:left 0.3s;z-index:1000;overflow-y:auto}body.dark .sidebar{background:#1e1e2e}.sidebar.open{left:0}.sidebar-header{display:flex;justify-content:space-between;padding:20px;border-bottom:1px solid #eee}.close-btn{background:none;border:none;font-size:28px;cursor:pointer}.sidebar-content{padding:20px}.sidebar-item{padding:14px;margin:8px 0;background:#f5f5f5;border-radius:14px;cursor:pointer;text-align:center}body.dark .sidebar-item{background:#2d2d3a;color:#fff}.theme-btn{width:48%;padding:12px;margin:5px 1%;background:#f0f0f0;border:none;border-radius:12px;cursor:pointer}.theme-btn.active{background:#667eea;color:white}.overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:999;display:none}.overlay.show{display:block}input,button,textarea{width:100%;padding:14px;margin:8px 0;border:1px solid #ddd;border-radius:14px;font-size:16px}body.dark input,body.dark textarea{background:#2d2d3a;border-color:#3d3d4a;color:#fff}button{background:#667eea;color:white;border:none;cursor:pointer;font-weight:600}button.secondary{background:#e0e0e0;color:#333}.message{padding:12px;margin:12px 0;border-radius:14px;text-align:center}.success{background:#e8f5e9;color:#2e7d32}.error{background:#ffebee;color:#c62828}.info{background:#e3f2fd;color:#1976d2}.hidden{display:none}.tabs{display:flex;gap:12px;margin:16px}.tab-btn{flex:1;background:#f0f0f0;color:#666;margin:0}.tab-btn.active{background:#667eea;color:white}.step{background:#fafafa;padding:24px;border-radius:20px;margin:16px}body.dark .step{background:#2d2d3a}.step p{margin-bottom:16px;color:#666}.chat-item{padding:14px;margin:8px 12px;background:#f8f8f8;border-radius:16px;cursor:pointer;display:flex;align-items:center;gap:14px}body.dark .chat-item{background:#2d2d3a}.chat-avatar{width:52px;height:52px;border-radius:50%;object-fit:cover;background:#667eea;display:flex;align-items:center;justify-content:center}.chat-info{flex:1}.chat-name{font-weight:600;color:#333}body.dark .chat-name{color:#fff}.chat-last{font-size:12px;color:#888;margin-top:4px}.unread{background:#667eea;color:white;border-radius:20px;padding:2px 10px;font-size:12px}.profile-avatar{width:100px;height:100px;border-radius:50%;object-fit:cover;margin:0 auto;display:block;cursor:pointer;border:3px solid #667eea}.message-bubble{padding:10px 14px;margin:8px;border-radius:20px;max-width:80%;word-wrap:break-word;position:relative}.sent{background:#667eea;color:white;margin-left:auto;text-align:right}.received{background:#f0f0f0;color:#333;margin-right:auto}body.dark .received{background:#2d2d3a;color:#fff}.timestamp{font-size:10px;margin-top:4px;display:inline-block}.checkmark{display:inline-block;margin-left:6px;font-size:11px}.message-menu{position:absolute;right:8px;top:8px;background:rgba(0,0,0,0.4);border-radius:12px;padding:2px 8px;cursor:pointer;display:none}.message-bubble:hover .message-menu{display:block}.search-result{background:#f5f5f5;padding:14px;border-radius:14px;margin-top:12px;cursor:pointer}.user-id-badge{font-family:monospace;background:#e8e8e8;display:inline-block;padding:4px 12px;border-radius:20px;margin-top:8px}.messages-container{min-height:400px;max-height:65vh;overflow-y:auto;padding:12px;background:#fafafa}body.dark .messages-container{background:#252536}.input-group{display:flex;gap:10px;padding:12px;background:white;border-top:1px solid #eee}body.dark .input-group{background:#1e1e2e}.input-group input{flex:1;margin:0}.input-group button{width:auto;padding:14px 20px;margin:0}.chat-header{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:12px 16px;background:white;border-bottom:1px solid #eee}body.dark .chat-header{background:#1e1e2e}.chat-user{display:flex;align-items:center;gap:12px}.chat-user img{width:44px;height:44px;border-radius:50%}.delete-chat-btn{background:#dc3545;width:auto;padding:8px 16px;font-size:13px;margin:0}.typing-indicator{font-size:12px;color:#888;padding:4px 16px;font-style:italic}.online-dot{width:10px;height:10px;border-radius:50%;background:#4caf50;display:inline-block;margin-left:6px}.reactions{display:flex;gap:4px;margin-top:4px}.reaction{background:#eee;border-radius:12px;padding:2px 6px;font-size:12px;cursor:pointer}.media-message{max-width:200px;border-radius:12px;cursor:pointer}.voice-message{background:#e0e0e0;border-radius:20px;padding:8px 12px;display:inline-flex;align-items:center;gap:8px}
</style></head>
<body><div class="overlay" id="overlay" onclick="closeSidebar()"></div><div class="sidebar" id="sidebar"><div class="sidebar-header"><h3>Settings</h3><button class="close-btn" onclick="closeSidebar()">✕</button></div><div class="sidebar-content"><div class="sidebar-item" onclick="openProfileEditor()">✏️ Edit Profile</div><div class="sidebar-item" onclick="openCreateGroup()">👥 Create Group</div><div class="sidebar-item" onclick="showQR()">📱 My QR</div><div class="sidebar-item" onclick="scanQR()">📷 Scan QR</div><div class="sidebar-item" onclick="createBackup()">💾 Backup</div><h3>Theme</h3><div><button class="theme-btn" id="themeLight" onclick="setTheme('light')">Light</button><button class="theme-btn" id="themeDark" onclick="setTheme('dark')">Dark</button></div><h3>Find User</h3><input type="text" id="sidebarSearchId" placeholder="9-digit ID" maxlength="9" /><button onclick="sidebarSearchUser()">🔍 Search</button><div id="sidebarSearchResult"></div><hr><div class="sidebar-item" onclick="showMyId()">🆔 My ID</div><div class="sidebar-item" onclick="logout()">🚪 Logout</div></div></div><div class="container"><div class="header"><button class="menu-btn hidden" id="menuBtn" onclick="openSidebar()">☰</button><h1>AntiBlock</h1><div style="width:44px"></div></div><div id="authScreen"><div class="tabs"><button class="tab-btn active" onclick="switchAuthTab('login')">Login</button><button class="tab-btn" onclick="switchAuthTab('register')">Register</button></div><div id="loginPanel"><div class="step"><p>Enter your email</p><input type="email" id="loginEmail" placeholder="Email" /><button onclick="sendLoginCode()">Get Code</button></div></div><div id="registerPanel" class="hidden"><div class="step"><p>Create new account</p><input type="text" id="regName" placeholder="Your name" /><input type="email" id="regEmail" placeholder="Email" /><button onclick="sendRegisterCode()">Register</button></div></div></div><div id="codeScreen" class="hidden"><div class="step"><p>Enter verification code</p><div class="message info" id="codeEmailDisplay"></div><input type="text" id="codeInput" placeholder="6-digit code" maxlength="6" /><button onclick="submitCode()">Verify</button><button onclick="backToAuth()" class="secondary">Back</button></div></div><div id="mainScreen" class="hidden"><div id="userInfo" onclick="openProfileEditor()" style="text-align:center;padding:16px;background:#f5f5f5;margin:12px;border-radius:20px;cursor:pointer"></div><h3 style="margin:0 16px">Chats</h3><div id="chatsList"></div></div><div id="profileEditor" class="hidden"><div style="padding:16px"><button onclick="closeProfileEditor()" class="secondary">← Back</button><div><img id="profileAvatar" class="profile-avatar" onclick="document.getElementById('avatarInput').click()" /><div style="text-align:center;margin-top:-30px;margin-left:60px;background:#667eea;width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:white" onclick="document.getElementById('avatarInput').click()">📷</div><input type="file" id="avatarInput" accept="image/*" style="display:none" onchange="previewAvatar(this)" /></div><input type="text" id="profileName" placeholder="Name" /><textarea id="profileBio" placeholder="About you" rows="3"></textarea><button onclick="saveProfile()">Save</button><button onclick="deleteAvatar()" class="secondary">Delete Photo</button></div></div><div id="groupEditor" class="hidden"><div style="padding:16px"><button onclick="closeGroupEditor()" class="secondary">← Back</button><div><img id="groupAvatar" class="profile-avatar" onclick="document.getElementById('groupAvatarInput').click()" /><div style="text-align:center;margin-top:-30px;margin-left:60px;background:#667eea;width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:white" onclick="document.getElementById('groupAvatarInput').click()">📷</div><input type="file" id="groupAvatarInput" accept="image/*" style="display:none" onchange="previewGroupAvatar(this)" /></div><input type="text" id="groupName" placeholder="Group name" /><input type="text" id="groupParticipants" placeholder="User IDs (comma separated)" /><button onclick="createGroup()">Create Group</button></div></div><div id="chatScreen" class="hidden"><div class="chat-header"><button onclick="backToMain()" class="secondary" style="width:auto;padding:8px 12px">←</button><div class="chat-user"><img id="chatAvatar" /><h3 id="chatTitle"></h3><span id="onlineDot" class="online-dot hidden"></span></div><button onclick="deleteCurrentChat()" class="delete-chat-btn">Delete</button></div><div id="typingIndicator" class="typing-indicator hidden"></div><div id="messagesList" class="messages-container"></div><div class="input-group"><input type="text" id="messageInput" placeholder="Message..." /><button onclick="sendMessage()">Send</button></div></div><div id="status" style="padding:12px;text-align:center;font-size:12px"></div></div><script>
let currentUser=null,currentChat=null,pendingEmail=null,pendingAction=null,pendingName=null;
let msgInterval=null,typingInterval=null,currentTheme='light',avatarBase64=null,groupAvatarBase64=null;
let currentToken=null;const API=window.location.origin+'/api';
const savedToken=localStorage.getItem('token');
if(savedToken){fetch(API+'/auth/check-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:savedToken})}).then(r=>r.json()).then(data=>{if(data.valid&&data.user){currentUser=data.user;currentToken=savedToken;document.getElementById('authScreen').classList.add('hidden');document.getElementById('mainScreen').classList.remove('hidden');document.getElementById('menuBtn').classList.remove('hidden');updateUserInfo();loadChats();const st=localStorage.getItem('theme');if(st)setTheme(st);}});}
function switchAuthTab(tab){if(tab==='login'){document.getElementById('loginPanel').classList.remove('hidden');document.getElementById('registerPanel').classList.add('hidden');document.querySelectorAll('.tab-btn')[0].classList.add('active');document.querySelectorAll('.tab-btn')[1].classList.remove('active');}else{document.getElementById('loginPanel').classList.add('hidden');document.getElementById('registerPanel').classList.remove('hidden');document.querySelectorAll('.tab-btn')[0].classList.remove('active');document.querySelectorAll('.tab-btn')[1].classList.add('active');}}
function setTheme(t){currentTheme=t;if(t==='dark')document.body.classList.add('dark');else document.body.classList.remove('dark');localStorage.setItem('theme',t);document.getElementById('themeLight').classList.toggle('active',t==='light');document.getElementById('themeDark').classList.toggle('active',t==='dark');}
function updateUserInfo(){const av=currentUser.avatar?'<img src="'+currentUser.avatar+'" style="width:70px;height:70px;border-radius:50%;object-fit:cover;margin-bottom:10px;">':'<div style="width:70px;height:70px;border-radius:50%;background:#667eea;display:inline-flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:10px;">👤</div>';document.getElementById('userInfo').innerHTML=av+'<div><strong>'+currentUser.name+'</strong></div><div class="bio-text">'+(currentUser.bio||'')+'</div><div class="user-id-badge">ID: '+currentUser.id+'</div>';}
function openProfileEditor(){document.getElementById('mainScreen').classList.add('hidden');document.getElementById('profileEditor').classList.remove('hidden');document.getElementById('profileName').value=currentUser.name||'';document.getElementById('profileBio').value=currentUser.bio||'';document.getElementById('profileAvatar').src=currentUser.avatar||'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%23667eea"/%3E%3Ctext x="50" y="67" text-anchor="middle" fill="white" font-size="40"%3E👤%3C/text%3E%3C/svg%3E';}
function closeProfileEditor(){document.getElementById('profileEditor').classList.add('hidden');document.getElementById('mainScreen').classList.remove('hidden');loadChats();}
function openCreateGroup(){document.getElementById('mainScreen').classList.add('hidden');document.getElementById('groupEditor').classList.remove('hidden');groupAvatarBase64=null;document.getElementById('groupAvatar').src='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%23667eea"/%3E%3Ctext x="50" y="67" text-anchor="middle" fill="white" font-size="40"%3E👥%3C/text%3E%3C/svg%3E';}
function closeGroupEditor(){document.getElementById('groupEditor').classList.add('hidden');document.getElementById('mainScreen').classList.remove('hidden');loadChats();}
function previewAvatar(input){if(input.files&&input.files[0]){const r=new FileReader();r.onload=e=>{avatarBase64=e.target.result;document.getElementById('profileAvatar').src=avatarBase64;};r.readAsDataURL(input.files[0]);}}
function previewGroupAvatar(input){if(input.files&&input.files[0]){const r=new FileReader();r.onload=e=>{groupAvatarBase64=e.target.result;document.getElementById('groupAvatar').src=groupAvatarBase64;};r.readAsDataURL(input.files[0]);}}
async function createGroup(){const name=document.getElementById('groupName').value;const participantsStr=document.getElementById('groupParticipants').value;if(!name){showStatus('Enter group name','error');return;}const ids=participantsStr.split(',').map(p=>parseInt(p.trim())).filter(p=>!isNaN(p));ids.push(currentUser.id);const unique=[...new Set(ids)];try{const res=await fetch(API+'/chats/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({participants:unique,name:name,type:'group'})});const d=await res.json();if(d.success){if(groupAvatarBase64){await fetch(API+'/chats/update-avatar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:d.chat.id,avatar:groupAvatarBase64})});}showStatus('Group created!','success');closeGroupEditor();}}catch(e){showStatus('Error','error');}}
async function saveProfile(){const data={userId:currentUser.id,name:document.getElementById('profileName').value,bio:document.getElementById('profileBio').value};if(avatarBase64)data.avatar=avatarBase64;try{const r=await fetch(API+'/users/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const d=await r.json();if(d.success){currentUser=d.user;updateUserInfo();showStatus('Saved!','success');avatarBase64=null;closeProfileEditor();}}catch(e){showStatus('Error','error');}}
async function deleteAvatar(){try{const r=await fetch(API+'/users/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:currentUser.id,avatar:'delete'})});const d=await r.json();if(d.success){currentUser=d.user;updateUserInfo();showStatus('Photo deleted','success');}}catch(e){showStatus('Error','error');}}
function openSidebar(){document.getElementById('sidebar').classList.add('open');document.getElementById('overlay').classList.add('show');}
function closeSidebar(){document.getElementById('sidebar').classList.remove('open');document.getElementById('overlay').classList.remove('show');}
async function sidebarSearchUser(){const id=document.getElementById('sidebarSearchId').value;if(!id)return showStatus('Enter ID','error');try{const r=await fetch(API+'/users/find/'+id);const d=await r.json();if(d.success){if(d.user.id===currentUser.id){showStatus('Cannot chat with yourself','error');return;}document.getElementById('sidebarSearchResult').innerHTML='<div class="search-result" onclick="startChatWithUser('+d.user.id+')"><strong>'+d.user.name+'</strong><br>'+d.user.email+'<br>ID: '+d.user.id+'</div>';showStatus('User found!','success');closeSidebar();}else{showStatus('User not found','error');}}catch(e){showStatus('Error','error');}}
function showMyId(){alert('Your ID: '+currentUser.id);closeSidebar();}
async function showQR(){try{const r=await fetch(API+'/users/qr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:currentUser.id})});const d=await r.json();if(d.success){alert('Your QR code (share this):\\n\\n'+d.qr);}}catch(e){showStatus('Error','error');}}
async function scanQR(){const qr=prompt('Paste QR code:');if(qr){try{const r=await fetch(API+'/users/scan-qr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({qr:qr,userId:currentUser.id})});const d=await r.json();if(d.success){showStatus('User '+d.user.name+' added!','success');loadChats();}else{showStatus('Invalid QR','error');}}catch(e){showStatus('Error','error');}}}
async function createBackup(){try{const r=await fetch(API+'/backup/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:currentUser.id})});const d=await r.json();if(d.success){showStatus('Backup created! ID: '+d.backup_id,'success');}}catch(e){showStatus('Error','error');}}
async function startChatWithUser(uid){try{const r=await fetch(API+'/chats/'+currentUser.id);const chats=await r.json();const ur=await fetch(API+'/users/find/'+uid);const ud=await ur.json();let ex=chats.find(c=>c.type!=='group'&&c.name===ud.user.name);if(ex)openChat(ex);else{const cr=await fetch(API+'/chats/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({participants:[currentUser.id,uid],name:ud.user.name,type:'private'})});const cd=await cr.json();if(cd.success)openChat(cd.chat);}document.getElementById('sidebarSearchResult').innerHTML='';document.getElementById('sidebarSearchId').value='';}catch(e){console.error(e);}}
async function sendLoginCode(){const email=document.getElementById('loginEmail').value;if(!email)return showStatus('Enter email','error');pendingEmail=email;pendingAction='login';await sendCode(email);}
async function sendRegisterCode(){const name=document.getElementById('regName').value;const email=document.getElementById('regEmail').value;if(!name||!email)return showStatus('Fill all fields','error');pendingName=name;pendingEmail=email;pendingAction='register';await sendCode(email);}
async function sendCode(email){showStatus('Sending...','info');try{const r=await fetch(API+'/auth/send-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});const d=await r.json();if(d.success){document.getElementById('authScreen').classList.add('hidden');document.getElementById('codeScreen').classList.remove('hidden');document.getElementById('codeEmailDisplay').innerHTML='Code sent to <strong>'+email+'</strong>';showStatus('Check your email!','success');}}catch(e){showStatus('Error: '+e.message,'error');}}
async function submitCode(){const code=document.getElementById('codeInput').value;if(!code)return showStatus('Enter code','error');try{const r=await fetch(API+'/auth/verify-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:pendingEmail,code})});const d=await r.json();if(d.success){if(pendingAction==='register'&&pendingName){d.user.name=pendingName;await fetch(API+'/users/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:d.user.id,name:pendingName})});d.user.name=pendingName;}currentUser=d.user;currentToken=d.token;localStorage.setItem('token',d.token);document.getElementById('codeScreen').classList.add('hidden');document.getElementById('mainScreen').classList.remove('hidden');document.getElementById('menuBtn').classList.remove('hidden');updateUserInfo();loadChats();showStatus('Welcome, '+currentUser.name+'!','success');const st=localStorage.getItem('theme');if(st)setTheme(st);document.getElementById('codeInput').value='';}else{showStatus(d.error,'error');}}catch(e){showStatus('Error: '+e.message,'error');}}
function backToAuth(){document.getElementById('codeScreen').classList.add('hidden');document.getElementById('authScreen').classList.remove('hidden');document.getElementById('codeInput').value='';pendingEmail=null;}
async function loadChats(){try{const r=await fetch(API+'/chats/'+currentUser.id);const chats=await r.json();const c=document.getElementById('chatsList');c.innerHTML='';if(chats.length===0){c.innerHTML='<div style="text-align:center;padding:40px;color:#888">No chats<br><small>Click menu and find user by ID or create group</small></div>';return;}chats.forEach(chat=>{const div=document.createElement('div');div.className='chat-item';div.onclick=()=>openChat(chat);const av=chat.avatar?'<img src="'+chat.avatar+'" class="chat-avatar" style="width:52px;height:52px;border-radius:50%;object-fit:cover">':'<div class="chat-avatar">'+(chat.type==='group'?'👥':'👤')+'</div>';div.innerHTML=av+'<div class="chat-info"><div class="chat-name">'+chat.name+(chat.unread_count>0?'<span class="unread">'+chat.unread_count+'</span>':'')+'</div><div class="chat-last">'+chat.last_message+'</div></div>';c.appendChild(div);});}catch(e){console.error(e);}}
async function openChat(chat){currentChat=chat;document.getElementById('mainScreen').classList.add('hidden');document.getElementById('chatScreen').classList.remove('hidden');document.getElementById('chatTitle').innerHTML=chat.name;if(chat.avatar){document.getElementById('chatAvatar').src=chat.avatar;document.getElementById('chatAvatar').style.display='block';}else{document.getElementById('chatAvatar').style.display='none';}if(chat.type==='private'){const otherId=chat.participants.find(p=>p!==currentUser.id);const ur=await fetch(API+'/users/find/'+otherId);const ud=await ur.json();if(ud.success&&ud.user.online)document.getElementById('onlineDot').classList.remove('hidden');else document.getElementById('onlineDot').classList.add('hidden');}else{document.getElementById('onlineDot').classList.add('hidden');}await fetch(API+'/messages/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat.id,user_id:currentUser.id})});loadMessages();if(msgInterval)clearInterval(msgInterval);msgInterval=setInterval(loadMessages,3000);if(typingInterval)clearInterval(typingInterval);typingInterval=setInterval(()=>checkTyping(),2000);}
async function checkTyping(){if(!currentChat)return;try{const r=await fetch(API+'/chats/typing/'+currentChat.id+'/'+currentUser.id);const d=await r.json();if(d.is_typing){document.getElementById('typingIndicator').innerHTML='Typing...';document.getElementById('typingIndicator').classList.remove('hidden');}else{document.getElementById('typingIndicator').classList.add('hidden');}}catch(e){}}
let typingTimeout;function sendTyping(){if(!currentChat)return;fetch(API+'/chats/typing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:currentChat.id,user_id:currentUser.id,is_typing:true})});if(typingTimeout)clearTimeout(typingTimeout);typingTimeout=setTimeout(()=>{fetch(API+'/chats/typing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:currentChat.id,user_id:currentUser.id,is_typing:false})});},2000);}
async function loadMessages(){if(!currentChat)return;try{const r=await fetch(API+'/messages/'+currentChat.id);const msgs=await r.json();const container=document.getElementById('messagesList');const wasBottom=container.scrollHeight-container.scrollTop<=container.clientHeight+50;container.innerHTML='';msgs.forEach(msg=>{const div=document.createElement('div');div.className='message-bubble '+(msg.sender_id===currentUser.id?'sent':'received');const check=msg.sender_id===currentUser.id?(msg.is_read?'<span class="checkmark">✓✓</span>':'<span class="checkmark">✓</span>'):'';const editBadge=msg.is_edited?'<span style="font-size:10px;"> (edited)</span>':'';let content='';if(msg.type==='image'&&msg.media_url){content='<img src="'+msg.media_url+'" class="media-message" onclick="window.open(this.src)">';}else if(msg.type==='video'&&msg.media_url){content='<video src="'+msg.media_url+'" controls style="max-width:200px;border-radius:12px"></video>';}else if(msg.type==='voice'&&msg.voice_url){content='<audio controls src="'+msg.voice_url+'" style="max-width:200px"></audio>';}else{content=msg.text;}let reactionsHtml='';if(msg.reactions&&msg.reactions.length>0){reactionsHtml='<div class="reactions">';msg.reactions.forEach(r=>{reactionsHtml+='<span class="reaction" onclick="addReaction('+msg.id+')">'+r.emoji+'</span>';});reactionsHtml+='</div>';}div.innerHTML='<div>'+content+editBadge+'</div><div><span class="timestamp">'+new Date(msg.created_at).toLocaleTimeString()+'</span>'+check+'</div>'+reactionsHtml;if(msg.sender_id===currentUser.id){const menu=document.createElement('div');menu.className='message-menu';menu.innerHTML='⋯';menu.onclick=(e)=>{e.stopPropagation();const act=confirm('Edit? OK - edit, Cancel - delete');if(act){const nt=prompt('New text:',msg.text);if(nt&&nt!==msg.text)editMessage(msg.id,nt);}else{if(confirm('Delete message?'))deleteMessage(msg.id);}};div.appendChild(menu);}container.appendChild(div);});if(wasBottom)container.scrollTop=container.scrollHeight;}catch(e){console.error(e);}}
async function editMessage(id,txt){try{await fetch(API+'/messages/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message_id:id,new_text:txt})});loadMessages();}catch(e){showStatus('Error','error');}}
async function deleteMessage(id){try{await fetch(API+'/messages/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message_id:id})});loadMessages();}catch(e){showStatus('Error','error');}}
async function deleteCurrentChat(){if(confirm('Delete this chat? All messages will be lost.')){try{await fetch(API+'/chats/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:currentChat.id})});showStatus('Chat deleted','success');backToMain();}catch(e){showStatus('Error','error');}}}
async function sendMessage(){const txt=document.getElementById('messageInput').value;if(!txt||!currentChat)return;try{await fetch(API+'/messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:currentChat.id,sender_id:currentUser.id,text:txt,type:'text'})});document.getElementById('messageInput').value='';sendTyping();loadMessages();}catch(e){console.error(e);}}
function backToMain(){if(msgInterval)clearInterval(msgInterval);if(typingInterval)clearInterval(typingInterval);document.getElementById('chatScreen').classList.add('hidden');document.getElementById('mainScreen').classList.remove('hidden');loadChats();}
function logout(){if(currentToken){fetch(API+'/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:currentToken})});}if(msgInterval)clearInterval(msgInterval);if(typingInterval)clearInterval(typingInterval);currentUser=null;currentToken=null;localStorage.removeItem('token');document.getElementById('mainScreen').classList.add('hidden');document.getElementById('authScreen').classList.remove('hidden');document.getElementById('menuBtn').classList.add('hidden');closeSidebar();showStatus('Logged out','success');}
function showStatus(msg,type){const d=document.getElementById('status');d.innerHTML=msg;d.className='message '+type;setTimeout(()=>{d.innerHTML='';d.className='';},3000);}
document.getElementById('codeInput').addEventListener('keypress',e=>{if(e.key==='Enter')submitCode();});
document.getElementById('messageInput').addEventListener('keypress',e=>{if(e.key==='Enter')sendMessage();});
document.getElementById('messageInput').addEventListener('input',()=>sendTyping());
</script></body></html>`);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AntiBlock running on port ${PORT}`));
