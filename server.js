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
    console.log(`\n====================`);
    console.log(`CODE: ${code}`);
    console.log(`Email: ${email}`);
    console.log(`====================\n`);
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
        console.log(`New user: ${user.name} (${user.id})`);
    }
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
    res.json({ success: true, user });
});

app.get('/api/users', (req, res) => res.json(users));

app.get('/api/users/find/:userId', (req, res) => {
    const user = users.find(u => u.id === parseInt(req.params.userId));
    if (!user) return res.status(404).json({ error: 'User not found' });
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
            name: other ? other.name : 'Chat',
            avatar: other ? other.avatar : null,
            last_message: lastMsg ? (lastMsg.deleted ? 'Message deleted' : lastMsg.text) : 'No messages',
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
    else res.status(404).json({ error: 'Not found' });
});

app.post('/api/messages/delete', (req, res) => {
    const { message_id } = req.body;
    const msg = messages.find(m => m.id === message_id);
    if (msg) { msg.deleted = true; msg.text = 'Message deleted'; res.json({ success: true }); }
    else res.status(404).json({ error: 'Not found' });
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
    if (participants[0] === participants[1]) return res.status(400).json({ error: 'Cannot chat with yourself' });
    const chat = { id: chats.length + 1, name: name || null, participants, created_at: new Date().toISOString() };
    chats.push(chat);
    res.json({ success: true, chat });
});

app.get('/api/status', (req, res) => res.json({ status: 'online', users: users.length }));

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>AntiBlock</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:-apple-system,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;padding:20px}
        body.dark{background:linear-gradient(135deg,#1a1a2e,#16213e)}
        .container{max-width:500px;margin:0 auto;background:white;border-radius:25px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,0.3)}
        body.dark .container{background:#1e1e2e;color:#fff}
        .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
        h1{font-size:24px;color:#333}
        body.dark h1{color:#fff}
        .menu-btn{background:#f0f0f0;border:none;font-size:28px;cursor:pointer;width:44px;height:44px;border-radius:12px}
        body.dark .menu-btn{background:#2d2d3a;color:#fff}
        .menu-btn.hidden{display:none}
        .sidebar{position:fixed;top:0;left:-280px;width:280px;height:100%;background:white;transition:left 0.3s;z-index:1000;padding:20px;box-shadow:2px 0 10px rgba(0,0,0,0.1)}
        body.dark .sidebar{background:#1e1e2e;color:#fff}
        .sidebar.open{left:0}
        .sidebar-header{display:flex;justify-content:space-between;margin-bottom:20px;padding-bottom:15px;border-bottom:1px solid #e0e0e0}
        .close-btn{background:none;border:none;font-size:24px;cursor:pointer}
        .sidebar h3{margin:15px 0 10px;color:#666}
        .sidebar-item{padding:12px;margin:8px 0;background:#f5f5f5;border-radius:12px;cursor:pointer;text-align:center}
        body.dark .sidebar-item{background:#2d2d3a}
        .sidebar-item:hover{background:#e0e0e0}
        .theme-btn{width:48%;padding:10px;margin:5px 1%;background:#f0f0f0;border:none;border-radius:10px;cursor:pointer}
        .theme-btn.active{background:#667eea;color:white}
        .overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:999;display:none}
        .overlay.show{display:block}
        input,button,textarea{width:100%;padding:12px;margin:8px 0;border:2px solid #e0e0e0;border-radius:12px;font-size:16px}
        body.dark input,body.dark textarea{background:#2d2d3a;border-color:#3d3d4a;color:#fff}
        button{background:linear-gradient(135deg,#667eea,#764ba2);color:white;border:none;cursor:pointer;font-weight:bold}
        button.secondary{background:#999}
        .message{padding:10px;margin:10px 0;border-radius:10px;text-align:center}
        .success{background:#d4edda;color:#155724}
        .error{background:#f8d7da;color:#721c24}
        .info{background:#e3f2fd;color:#1976d2}
        .hidden{display:none}
        .step{background:#f8f9fa;padding:20px;border-radius:16px;margin:15px 0}
        body.dark .step{background:#2d2d3a}
        .chat-item{padding:12px;margin:8px 0;background:#f8f9fa;border-radius:12px;cursor:pointer;display:flex;align-items:center;gap:12px}
        body.dark .chat-item{background:#2d2d3a}
        .chat-avatar{width:50px;height:50px;border-radius:50%;object-fit:cover;background:#667eea;display:flex;align-items:center;justify-content:center;font-size:20px;color:white}
        .chat-info{flex:1}
        .chat-name{font-weight:bold}
        .chat-last{font-size:12px;color:#666;margin-top:4px}
        .unread{background:#667eea;color:white;border-radius:20px;padding:2px 10px;font-size:12px;float:right}
        .profile-avatar{width:100px;height:100px;border-radius:50%;object-fit:cover;margin:0 auto;display:block;cursor:pointer;border:3px solid #667eea}
        .message-bubble{padding:10px 14px;margin:8px;border-radius:18px;max-width:80%;word-wrap:break-word;position:relative}
        .sent{background:linear-gradient(135deg,#667eea,#764ba2);color:white;margin-left:auto;text-align:right}
        .received{background:#f0f0f0;color:#333;margin-right:auto}
        body.dark .received{background:#2d2d3a;color:#fff}
        .timestamp{font-size:10px;margin-top:4px;display:inline-block}
        .checkmark{display:inline-block;margin-left:6px;font-size:11px}
        .message-menu{position:absolute;right:5px;top:5px;background:rgba(0,0,0,0.5);border-radius:10px;padding:2px 6px;cursor:pointer;display:none;font-size:12px}
        .message-bubble:hover .message-menu{display:block}
        .search-result{background:#e9ecef;padding:12px;border-radius:12px;margin-top:12px;cursor:pointer}
        .user-id-badge{font-family:monospace;background:#667eea20;display:inline-block;padding:4px 12px;border-radius:20px;margin-top:8px}
        .messages-container{min-height:350px;max-height:400px;overflow-y:auto;padding:10px;background:#fafafa;border-radius:16px;margin:10px 0}
        body.dark .messages-container{background:#252536}
        .input-group{display:flex;gap:10px;margin-top:10px}
        .input-group input{flex:1;margin:0}
        .input-group button{width:auto;padding:12px 20px;margin:0}
        .chat-header{display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:10px}
        .chat-user{display:flex;align-items:center;gap:10px}
        .delete-chat-btn{background:#dc3545;width:auto;padding:8px 12px;font-size:12px;margin:0}
    </style>
</head>
<body>
<div class="overlay" id="overlay" onclick="closeSidebar()"></div>
<div class="sidebar" id="sidebar">
    <div class="sidebar-header"><h3>Settings</h3><button class="close-btn" onclick="closeSidebar()">✕</button></div>
    <div class="sidebar-item" onclick="openProfileEditor()">Edit Profile</div>
    <h3>Theme</h3>
    <div><button class="theme-btn" id="themeLight" onclick="setTheme('light')">Light</button><button class="theme-btn" id="themeDark" onclick="setTheme('dark')">Dark</button></div>
    <h3>Find User</h3>
    <input type="text" id="sidebarSearchId" placeholder="9-digit ID" maxlength="9" />
    <button onclick="sidebarSearchUser()">Search</button>
    <div id="sidebarSearchResult"></div>
    <hr style="margin:15px 0">
    <div class="sidebar-item" onclick="showMyId()">My ID</div>
    <div class="sidebar-item" onclick="logout()">Logout</div>
</div>

<div class="container">
    <div class="header">
        <button class="menu-btn hidden" id="menuBtn" onclick="openSidebar()">☰</button>
        <h1>AntiBlock</h1>
        <div style="width:44px"></div>
    </div>
    
    <div id="step1"><div class="step"><p>Enter your email</p><input type="email" id="emailInput" placeholder="example@mail.com" /><button onclick="sendCode()">Get Code</button></div></div>
    <div id="step2" class="hidden"><div class="step"><p>Enter verification code</p><div class="message info" id="emailDisplay"></div><input type="text" id="codeInput" placeholder="6-digit code" maxlength="6" /><button onclick="verifyCode()">Login</button><button onclick="backToStep1()" class="secondary">Back</button></div></div>
    <div id="mainScreen" class="hidden"><div id="userInfo" onclick="openProfileEditor()" style="cursor:pointer;text-align:center;padding:15px;background:#f5f5f5;border-radius:16px;margin-bottom:15px"></div><h3>Chats</h3><div id="chatsList"></div></div>
    <div id="profileEditor" class="hidden"><button onclick="closeProfileEditor()" class="secondary" style="margin-bottom:15px">Back</button><div style="text-align:center"><img id="profileAvatar" class="profile-avatar" onclick="document.getElementById('avatarInput').click()" /><input type="file" id="avatarInput" accept="image/*" style="display:none" onchange="previewAvatar(this)" /><input type="text" id="profileName" placeholder="Name" /><textarea id="profileBio" placeholder="About" rows="3"></textarea><button onclick="saveProfile()">Save</button><button onclick="deleteAvatar()" class="secondary">Delete Photo</button></div></div>
    <div id="chatScreen" class="hidden"><div class="chat-header"><button onclick="backToMain()" class="secondary" style="width:auto;padding:8px 12px">Back</button><div class="chat-user"><img id="chatAvatar" style="width:40px;height:40px;border-radius:50%;object-fit:cover"><h3 id="chatTitle" style="margin:0"></h3></div><button onclick="deleteCurrentChat()" class="delete-chat-btn">Delete</button></div><div id="messagesList" class="messages-container"></div><div class="input-group"><input type="text" id="messageInput" placeholder="Message..." /><button onclick="sendMessage()">Send</button></div></div>
    <div id="status"></div>
</div>

<script>
let currentUser=null,currentChat=null,pendingEmail=null,msgInterval=null,currentTheme='light',avatarBase64=null;const API=window.location.origin+'/api';
function setTheme(t){currentTheme=t;document.body.classList.toggle('dark',t==='dark');localStorage.setItem('theme',t);document.getElementById('themeLight').classList.toggle('active',t==='light');document.getElementById('themeDark').classList.toggle('active',t==='dark');}
function updateUserInfo(){const av=currentUser.avatar?'<img src="'+currentUser.avatar+'" style="width:60px;height:60px;border-radius:50%;object-fit:cover;">':'<div style="width:60px;height:60px;border-radius:50%;background:#667eea;display:inline-flex;align-items:center;justify-content:center;font-size:30px;">👤</div>';document.getElementById('userInfo').innerHTML=av+'<div><strong>'+currentUser.name+'</strong></div><div>'+(currentUser.bio||'')+'</div><div class="user-id-badge">ID: '+currentUser.id+'</div>';}
function openProfileEditor(){document.getElementById('mainScreen').classList.add('hidden');document.getElementById('profileEditor').classList.remove('hidden');document.getElementById('profileName').value=currentUser.name||'';document.getElementById('profileBio').value=currentUser.bio||'';document.getElementById('profileAvatar').src=currentUser.avatar||'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%23667eea"/%3E%3Ctext x="50" y="67" text-anchor="middle" fill="white" font-size="40"%3E👤%3C/text%3E%3C/svg%3E';}
function closeProfileEditor(){document.getElementById('profileEditor').classList.add('hidden');document.getElementById('mainScreen').classList.remove('hidden');loadChats();}
function previewAvatar(i){if(i.files&&i.files[0]){const r=new FileReader();r.onload=e=>{avatarBase64=e.target.result;document.getElementById('profileAvatar').src=avatarBase64;};r.readAsDataURL(i.files[0]);}}
async function saveProfile(){const data={userId:currentUser.id,name:document.getElementById('profileName').value,bio:document.getElementById('profileBio').value};if(avatarBase64)data.avatar=avatarBase64;try{const r=await fetch(API+'/users/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const d=await r.json();if(d.success){currentUser=d.user;updateUserInfo();showStatus('Saved','success');avatarBase64=null;closeProfileEditor();}}catch(e){showStatus('Error','error');}}
async function deleteAvatar(){try{const r=await fetch(API+'/users/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:currentUser.id,avatar:'delete'})});const d=await r.json();if(d.success){currentUser=d.user;updateUserInfo();showStatus('Photo deleted','success');}}catch(e){showStatus('Error','error');}}
function openSidebar(){document.getElementById('sidebar').classList.add('open');document.getElementById('overlay').classList.add('show');}
function closeSidebar(){document.getElementById('sidebar').classList.remove('open');document.getElementById('overlay').classList.remove('show');}
async function sidebarSearchUser(){const id=document.getElementById('sidebarSearchId').value;if(!id)return showStatus('Enter ID','error');try{const r=await fetch(API+'/users/find/'+id);const d=await r.json();if(d.success){if(d.user.id===currentUser.id){showStatus('Cannot chat with yourself','error');return;}document.getElementById('sidebarSearchResult').innerHTML='<div class="search-result" onclick="startChatWithUser('+d.user.id+')"><strong>'+d.user.name+'</strong><br>'+d.user.email+'<br>ID: '+d.user.id+'</div>';showStatus('User found!','success');closeSidebar();}else{showStatus('User not found','error');}}catch(e){showStatus('Error','error');}}
function showMyId(){alert('Your ID: '+currentUser.id);closeSidebar();}
async function startChatWithUser(uid){try{const r=await fetch(API+'/chats/'+currentUser.id);const chats=await r.json();const ur=await fetch(API+'/users/find/'+uid);const ud=await ur.json();let ex=chats.find(c=>c.name===ud.user.name);if(ex)openChat(ex);else{const cr=await fetch(API+'/chats/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({participants:[currentUser.id,uid],name:ud.user.name})});const cd=await cr.json();if(cd.success)openChat(cd.chat);}document.getElementById('sidebarSearchResult').innerHTML='';document.getElementById('sidebarSearchId').value='';}catch(e){console.error(e);}}
async function sendCode(){const email=document.getElementById('emailInput').value;if(!email)return showStatus('Enter email','error');showStatus('Sending...','info');try{const r=await fetch(API+'/auth/send-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});const d=await r.json();if(d.success){pendingEmail=email;document.getElementById('step1').classList.add('hidden');document.getElementById('step2').classList.remove('hidden');document.getElementById('emailDisplay').innerHTML='Code sent to <strong>'+email+'</strong>';showStatus('Check server console for code','success');}else{showStatus(d.error,'error');}}catch(e){showStatus('Error: '+e.message,'error');}}
async function verifyCode(){const code=document.getElementById('codeInput').value;if(!code)return showStatus('Enter code','error');try{const r=await fetch(API+'/auth/verify-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:pendingEmail,code})});const d=await r.json();if(d.success){currentUser=d.user;document.getElementById('step2').classList.add('hidden');document.getElementById('mainScreen').classList.remove('hidden');document.getElementById('menuBtn').classList.remove('hidden');updateUserInfo();loadChats();showStatus('Welcome, '+currentUser.name+'!','success');const st=localStorage.getItem('theme');if(st)setTheme(st);}else{showStatus(d.error,'error');}}catch(e){showStatus('Error: '+e.message,'error');}}
async function loadChats(){try{const r=await fetch(API+'/chats/'+currentUser.id);const chats=await r.json();const c=document.getElementById('chatsList');c.innerHTML='';if(chats.length===0){c.innerHTML='<div style="text-align:center;padding:30px;color:#999">No chats<br><small>Click menu and find user by ID</small></div>';return;}chats.forEach(chat=>{const div=document.createElement('div');div.className='chat-item';div.onclick=()=>openChat(chat);const av=chat.avatar?'<img src="'+chat.avatar+'" class="chat-avatar" style="width:50px;height:50px;border-radius:50%;object-fit:cover">':'<div class="chat-avatar">👤</div>';div.innerHTML=av+'<div class="chat-info"><div class="chat-name">'+chat.name+(chat.unread_count>0?'<span class="unread">'+chat.unread_count+'</span>':'')+'</div><div class="chat-last">'+chat.last_message+'</div></div>';c.appendChild(div);});}catch(e){console.error(e);}}
async function openChat(chat){currentChat=chat;document.getElementById('mainScreen').classList.add('hidden');document.getElementById('chatScreen').classList.remove('hidden');document.getElementById('chatTitle').innerHTML=chat.name;if(chat.avatar){document.getElementById('chatAvatar').src=chat.avatar;document.getElementById('chatAvatar').style.display='block';}else{document.getElementById('chatAvatar').style.display='none';}await fetch(API+'/messages/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat.id,user_id:currentUser.id})});loadMessages();if(msgInterval)clearInterval(msgInterval);msgInterval=setInterval(loadMessages,3000);}
async function loadMessages(){if(!currentChat)return;try{const r=await fetch(API+'/messages/'+currentChat.id);const msgs=await r.json();const container=document.getElementById('messagesList');const wasBottom=container.scrollHeight-container.scrollTop<=container.clientHeight+50;container.innerHTML='';msgs.forEach(msg=>{const div=document.createElement('div');div.className='message-bubble '+(msg.sender_id===currentUser.id?'sent':'received');const check=msg.sender_id===currentUser.id?(msg.is_read?'<span class="checkmark">✓✓</span>':'<span class="checkmark">✓</span>'):'';const editBadge=msg.is_edited?'<span style="font-size:10px;opacity:0.7;"> (edited)</span>':'';div.innerHTML='<div>'+msg.text+editBadge+'</div><div><span class="timestamp">'+new Date(msg.created_at).toLocaleTimeString()+'</span>'+check+'</div>';if(msg.sender_id===currentUser.id){const menu=document.createElement('div');menu.className='message-menu';menu.innerHTML='⋯';menu.onclick=(e)=>{e.stopPropagation();const act=confirm('Edit? OK - edit, Cancel - delete');if(act){const nt=prompt('New text:',msg.text);if(nt&&nt!==msg.text)editMessage(msg.id,nt);}else{if(confirm('Delete message?'))deleteMessage(msg.id);}};div.appendChild(menu);}container.appendChild(div);});if(wasBottom)container.scrollTop=container.scrollHeight;}catch(e){console.error(e);}}
async function editMessage(id,txt){try{await fetch(API+'/messages/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message_id:id,new_text:txt})});loadMessages();}catch(e){showStatus('Error','error');}}
async function deleteMessage(id){try{await fetch(API+'/messages/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message_id:id})});loadMessages();}catch(e){showStatus('Error','error');}}
async function deleteCurrentChat(){if(confirm('Delete this chat?')){try{await fetch(API+'/chats/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:currentChat.id})});showStatus('Chat deleted','success');backToMain();}catch(e){showStatus('Error','error');}}}
async function sendMessage(){const txt=document.getElementById('messageInput').value;if(!txt||!currentChat)return;try{await fetch(API+'/messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:currentChat.id,sender_id:currentUser.id,text:txt})});document.getElementById('messageInput').value='';loadMessages();}catch(e){console.error(e);}}
function backToMain(){if(msgInterval)clearInterval(msgInterval);document.getElementById('chatScreen').classList.add('hidden');document.getElementById('mainScreen').classList.remove('hidden');loadChats();}
function backToStep1(){document.getElementById('step2').classList.add('hidden');document.getElementById('step1').classList.remove('hidden');document.getElementById('codeInput').value='';pendingEmail=null;}
function logout(){if(msgInterval)clearInterval(msgInterval);currentUser=null;document.getElementById('mainScreen').classList.add('hidden');document.getElementById('step1').classList.remove('hidden');document.getElementById('menuBtn').classList.add('hidden');closeSidebar();showStatus('Logged out','success');}
function showStatus(msg,type){const d=document.getElementById('status');d.innerHTML=msg;d.className='message '+type;setTimeout(()=>{d.innerHTML='';d.className='';},3000);}
document.getElementById('codeInput').addEventListener('keypress',e=>{if(e.key==='Enter')verifyCode();});
document.getElementById('messageInput').addEventListener('keypress',e=>{if(e.key==='Enter')sendMessage();});
document.getElementById('emailInput').addEventListener('keypress',e=>{if(e.key==='Enter')sendCode();});
document.getElementById('sidebarSearchId').addEventListener('keypress',e=>{if(e.key==='Enter')sidebarSearchUser();});
</script>
</body>
</html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
