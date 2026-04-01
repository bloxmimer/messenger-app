const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

let users = [];
let codes = {};
let messages = [];
let chats = [];

function generateId() {
    return Math.floor(100000000 + Math.random() * 900000000);
}

app.post('/api/auth/send-code', (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000);
    codes[email] = { code, expires: Date.now() + 600000 };
    console.log(`\n╔════════════════════════════╗`);
    console.log(`║ КОД: ${code}`);
    console.log(`║ Email: ${email}`);
    console.log(`╚════════════════════════════╝\n`);
    res.json({ success: true });
});

app.post('/api/auth/verify-code', (req, res) => {
    const { email, code } = req.body;
    const stored = codes[email];
    if (!stored || stored.code != code || Date.now() > stored.expires) {
        return res.status(400).json({ error: 'Неверный код' });
    }
    delete codes[email];
    let user = users.find(u => u.email === email);
    if (!user) {
        user = { id: generateId(), email, name: email.split('@')[0], avatar: null, bio: '', created_at: new Date() };
        users.push(user);
        console.log(`✨ Новый пользователь: ${user.name} (${user.id})`);
    }
    res.json({ success: true, user });
});

app.post('/api/users/update', (req, res) => {
    const { userId, name, bio, avatar } = req.body;
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'Не найден' });
    if (name) user.name = name;
    if (bio !== undefined) user.bio = bio;
    if (avatar === 'delete') user.avatar = null;
    else if (avatar && avatar.startsWith('data:image')) user.avatar = avatar;
    res.json({ success: true, user });
});

app.get('/api/users', (req, res) => res.json(users));

app.get('/api/users/find/:userId', (req, res) => {
    const user = users.find(u => u.id === parseInt(req.params.userId));
    if (!user) return res.status(404).json({ error: 'Не найден' });
    res.json({ success: true, user });
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
            name: other ? other.name : 'Чат',
            avatar: other ? other.avatar : null,
            last_message: lastMsg ? (lastMsg.deleted ? 'Сообщение удалено' : lastMsg.text) : 'Нет сообщений',
            unread_count: unread
        };
    });
    res.json(result);
});

app.get('/api/messages/:chatId', (req, res) => {
    const chatId = parseInt(req.params.chatId);
    const msgs = messages.filter(m => m.chat_id === chatId && !m.deleted).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    res.json(msgs);
});

app.post('/api/messages/send', (req, res) => {
    const { chat_id, sender_id, text } = req.body;
    const msg = {
        id: messages.length + 1,
        chat_id,
        sender_id,
        text,
        created_at: new Date().toISOString(),
        is_read: false,
        is_edited: false,
        deleted: false
    };
    messages.push(msg);
    res.json({ success: true, message: msg });
});

app.post('/api/messages/edit', (req, res) => {
    const { message_id, new_text } = req.body;
    const msg = messages.find(m => m.id === message_id);
    if (msg) { msg.text = new_text; msg.is_edited = true; res.json({ success: true }); }
    else res.status(404).json({ error: 'Не найдено' });
});

app.post('/api/messages/delete', (req, res) => {
    const { message_id } = req.body;
    const msg = messages.find(m => m.id === message_id);
    if (msg) { msg.deleted = true; msg.text = 'Сообщение удалено'; res.json({ success: true }); }
    else res.status(404).json({ error: 'Не найдено' });
});

app.post('/api/chats/delete', (req, res) => {
    const { chat_id } = req.body;
    chats = chats.filter(c => c.id !== chat_id);
    messages = messages.filter(m => m.chat_id !== chat_id);
    res.json({ success: true });
});

app.post('/api/messages/read', (req, res) => {
    const { chat_id, user_id } = req.body;
    messages.forEach(msg => {
        if (msg.chat_id === chat_id && msg.sender_id !== user_id && !msg.is_read) msg.is_read = true;
    });
    res.json({ success: true });
});

app.post('/api/chats/create', (req, res) => {
    const { participants, name } = req.body;
    if (participants[0] === participants[1]) return res.status(400).json({ error: 'Нельзя чат с собой' });
    const chat = { id: chats.length + 1, name: name || null, participants, created_at: new Date().toISOString() };
    chats.push(chat);
    res.json({ success: true, chat });
});

app.get('/api/status', (req, res) => res.json({ status: 'online', users: users.length }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
