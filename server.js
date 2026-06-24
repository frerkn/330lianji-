// ==================== EPhone 联机聊天服务器 ====================

const http = require('http');
const WebSocket = require('ws');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const MAX_USERS = 200;

// ==================== VAPID 配置 ====================

webpush.setVapidDetails(
    'mailto:ephone@example.com',
    'BH4dX1067UK8522hm5HOw2-nJxXX_VCf6zrareTxfbyD-plfKXp2ycL1I-qfXN4URQrUU2TcJZQZHL0XX74DeNo',
    '5-I-zLfgTB6FGHRZxbdFnDYCM4cPoxZmpYM5LzdejVg'
);

// 订阅数据文件路径
const SUBSCRIPTIONS_FILE = path.join(__dirname, 'subscriptions.json');
const GROUPS_FILE = path.join(__dirname, 'groups.json');

// 加载订阅数据
function loadSubscriptions() {
    try {
        if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
            const data = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('[错误] 加载订阅数据失败:', error);
    }
    return {};
}

// 保存订阅数据
function saveSubscriptions(subscriptions) {
    try {
        fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('[错误] 保存订阅数据失败:', error);
        return false;
    }
}

// 加载群聊数据
function loadGroups() {
    try {
        if (fs.existsSync(GROUPS_FILE)) {
            const data = fs.readFileSync(GROUPS_FILE, 'utf8');
            const groupsArray = JSON.parse(data);
            const groupsMap = new Map();
            groupsArray.forEach(group => {
                groupsMap.set(group.groupId, group);
            });
            console.log(`[群聊] 已加载 ${groupsMap.size} 个群聊数据`);
            return groupsMap;
        }
    } catch (error) {
        console.error('[错误] 加载群聊数据失败:', error);
    }
    return new Map();
}

// 保存群聊数据
function saveGroups() {
    try {
        const groupsArray = Array.from(groups.values());
        fs.writeFileSync(GROUPS_FILE, JSON.stringify(groupsArray, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('[错误] 保存群聊数据失败:', error);
        return false;
    }
}

// 全局订阅数据
let subscriptions = loadSubscriptions();

// 在线用户 Map: userId -> { ws, nickname, avatar }
const onlineUsers = new Map();

// 群聊数据 Map: groupId -> { groupName, members, owner, history }
const groups = loadGroups();

// ==================== HTTP 服务器 ====================

const server = http.createServer((req, res) => {
    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 处理 OPTIONS 预检请求
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // 路由处理
    if (req.method === 'GET' && req.url === '/api/vapid-public-key') {
        // 返回 VAPID 公钥
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            publicKey: 'BH4dX1067UK8522hm5HOw2-nJxXX_VCf6zrareTxfbyD-plfKXp2ycL1I-qfXN4URQrUU2TcJZQZHL0XX74DeNo'
        }));
        return;
    }

    if (req.method === 'POST' && req.url === '/api/save-subscription') {
        // 保存订阅信息
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const { userId, subscription } = JSON.parse(body);
                if (!userId || !subscription) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: '缺少必要参数' }));
                    return;
                }
                subscriptions[userId] = subscription;
                const saved = saveSubscriptions(subscriptions);
                if (saved) {
                    console.log(`[推送订阅] 用户 ${userId} 的订阅已保存`);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: '保存失败' }));
                }
            } catch (error) {
                console.error('[错误] 保存订阅失败:', error);
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: '请求格式错误' }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/push') {
        // 发送推送通知
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            try {
                const { userId, title, body: messageBody } = JSON.parse(body);
                if (!userId || !title || !messageBody) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: '缺少必要参数' }));
                    return;
                }
                const subscription = subscriptions[userId];
                if (!subscription) {
                    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: '未找到该用户的订阅' }));
                    return;
                }

                const payload = JSON.stringify({ title, body: messageBody });
                try {
                    await webpush.sendNotification(subscription, payload);
                    console.log(`[推送成功] 已向用户 ${userId} 发送通知: ${title}`);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: true }));
                } catch (pushError) {
                    console.error(`[推送失败] 用户 ${userId}:`, pushError);
                    // 如果订阅失效，删除它
                    if (pushError.statusCode === 410) {
                        delete subscriptions[userId];
                        saveSubscriptions(subscriptions);
                        console.log(`[推送订阅] 用户 ${userId} 的订阅已失效，已删除`);
                    }
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: '推送失败', details: pushError.message }));
                }
            } catch (error) {
                console.error('[错误] 推送请求处理失败:', error);
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: '请求格式错误' }));
            }
        });
        return;
    }

    // 默认响应
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('EPhone 联机服务器运行中');
});

// ==================== WebSocket 服务器 ====================

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    let currentUserId = null;
    let heartbeatTimeout = null;
    let pingInterval = null;

    // 启动心跳检测：每30秒发送ping
    const startHeartbeat = () => {
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
                // 设置60秒超时，如果没收到pong就断开
                if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
                heartbeatTimeout = setTimeout(() => {
                    console.log(`[心跳超时] 用户 ${currentUserId} 60秒未响应，断开连接`);
                    ws.terminate();
                }, 60000);
            }
        }, 30000);
    };

    // 收到pong后清除超时
    const resetHeartbeat = () => {
        if (heartbeatTimeout) {
            clearTimeout(heartbeatTimeout);
            heartbeatTimeout = null;
        }
    };

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw);

            switch (data.type) {
                case 'register': {
                    const { userId, nickname, avatar } = data;
                    if (!userId || !nickname) {
                        sendToClient(ws, { type: 'register_error', error: '缺少必要参数' });
                        return;
                    }
                    if (onlineUsers.size >= MAX_USERS && !onlineUsers.has(userId)) {
                        sendToClient(ws, { type: 'register_error', error: '服务器已满' });
                        return;
                    }
                    currentUserId = userId;
                    onlineUsers.set(userId, { ws, nickname, avatar });
                    sendToClient(ws, { type: 'register_success' });
                    console.log(`[注册] ${nickname} (${userId}) 已上线，当前在线: ${onlineUsers.size}`);
                    startHeartbeat();
                    break;
                }

                case 'pong': {
                    resetHeartbeat();
                    break;
                }

                case 'heartbeat': {
                    sendToClient(ws, { type: 'heartbeat_ack' });
                    break;
                }

                case 'search_user': {
                    const target = onlineUsers.get(data.searchId);
                    if (target) {
                        sendToClient(ws, {
                            type: 'search_result',
                            found: true,
                            user: { userId: data.searchId, nickname: target.nickname, avatar: target.avatar }
                        });
                    } else {
                        sendToClient(ws, { type: 'search_result', found: false });
                    }
                    break;
                }

                case 'friend_request': {
                    const targetUser = onlineUsers.get(data.toUserId);
                    if (targetUser) {
                        sendToClient(targetUser.ws, {
                            type: 'friend_request',
                            fromUserId: data.fromUserId,
                            fromNickname: data.fromNickname,
                            fromAvatar: data.fromAvatar
                        });
                    }
                    break;
                }

                case 'accept_friend_request': {
                    const requester = onlineUsers.get(data.fromUserId);
                    if (requester) {
                        sendToClient(requester.ws, {
                            type: 'friend_request_accepted',
                            fromUserId: data.toUserId,
                            fromNickname: data.toNickname,
                            fromAvatar: data.toAvatar
                        });
                    }
                    break;
                }

                case 'reject_friend_request': {
                    const requester = onlineUsers.get(data.fromUserId);
                    if (requester) {
                        sendToClient(requester.ws, { type: 'friend_request_rejected' });
                    }
                    break;
                }

                case 'send_message': {
                    const recipient = onlineUsers.get(data.toUserId);
                    if (recipient) {
                        sendToClient(recipient.ws, {
                            type: 'receive_message',
                            fromUserId: data.fromUserId,
                            message: data.message,
                            timestamp: data.timestamp
                        });
                    }
                    break;
                }

                case 'create_group': {
                    // 通知所有群成员（除了创建者）
                    const members = data.members || [];
                    const groupId = data.groupId;

                    console.log(`[群聊] 创建群聊请求: ${data.groupName}, 成员:`, members.map(m => m.userId));

                    // 保存群聊数据到服务器
                    groups.set(groupId, {
                        groupId: groupId,
                        groupName: data.groupName,
                        members: members,
                        owner: data.creatorId,
                        timestamp: Date.now(),
                        history: []
                    });
                    saveGroups();

                    members.forEach(member => {
                        if (member.userId !== data.creatorId) {
                            const memberUser = onlineUsers.get(member.userId);
                            console.log(`[群聊] 通知成员 ${member.userId}: ${memberUser ? '在线' : '不在线'}`);
                            if (memberUser) {
                                sendToClient(memberUser.ws, {
                                    type: 'receive_group_created',
                                    groupId: groupId,
                                    groupName: data.groupName,
                                    members: members,
                                    creatorId: data.creatorId,
                                    owner: data.creatorId,
                                    timestamp: Date.now()
                                });
                            }
                        }
                    });
                    console.log(`[群聊] ${data.creatorId} 创建了群聊 ${data.groupName} (${members.length}人)`);
                    break;
                }

                case 'send_group_message': {
                    // 转发群消息给所有群成员（除了发送者）
                    const groupId = data.groupId;
                    const groupData = groups.get(groupId);
                    const groupMembers = data.members || [];

                    // 保存消息到群聊历史，带 created_at 字段
                    const serverCreatedAt = Date.now(); // 服务器接收时间
                    if (groupData) {
                        if (!groupData.history) {
                            groupData.history = [];
                        }
                        const messageRecord = {
                            fromUserId: data.fromUserId,
                            fromNickname: data.fromNickname,
                            fromAvatar: data.fromAvatar,
                            message: data.message,
                            timestamp: data.timestamp,
                            created_at: serverCreatedAt,
                            messageId: data.messageId,
                            clientMessageId: data.clientMessageId,
                            isAiCharacter: data.isAiCharacter || false
                        };
                        groupData.history.push(messageRecord);

                        // 限制历史记录数量，避免内存溢出
                        if (groupData.history.length > 1000) {
                            groupData.history = groupData.history.slice(-1000);
                        }

                        // 持久化到文件
                        saveGroups();
                    }

                    groupMembers.forEach(memberId => {
                        if (memberId !== data.fromUserId) {
                            const memberUser = onlineUsers.get(memberId);
                            if (memberUser) {
                                sendToClient(memberUser.ws, {
                                    type: 'receive_group_message',
                                    groupId: groupId,
                                    fromUserId: data.fromUserId,
                                    fromNickname: data.fromNickname,
                                    fromAvatar: data.fromAvatar,
                                    message: data.message,
                                    timestamp: data.timestamp,
                                    created_at: serverCreatedAt, // 广播时带上 created_at
                                    messageId: data.messageId,
                                    clientMessageId: data.clientMessageId,
                                    isAiCharacter: data.isAiCharacter || false
                                });
                            }
                        }
                    });
                    break;
                }

                case 'ai_character_join': {
                    // 通知群成员有AI角色加入
                    const joinMembers = data.members || [];
                    joinMembers.forEach(memberId => {
                        if (memberId !== currentUserId) {
                            const memberUser = onlineUsers.get(memberId);
                            if (memberUser) {
                                sendToClient(memberUser.ws, {
                                    type: 'ai_character_join',
                                    groupId: data.groupId,
                                    character: data.character
                                });
                            }
                        }
                    });
                    console.log(`[AI角色] ${data.character.originalName} 加入群聊 ${data.groupId}`);
                    break;
                }

                case 'ai_character_leave': {
                    // 通知群成员AI角色离开
                    const leaveMembers = data.members || [];
                    leaveMembers.forEach(memberId => {
                        if (memberId !== currentUserId) {
                            const memberUser = onlineUsers.get(memberId);
                            if (memberUser) {
                                sendToClient(memberUser.ws, {
                                    type: 'ai_character_leave',
                                    groupId: data.groupId,
                                    characterId: data.characterId,
                                    characterName: data.characterName
                                });
                            }
                        }
                    });
                    console.log(`[AI角色] ${data.characterName} 离开群聊 ${data.groupId}`);
                    break;
                }

                case 'get_my_groups': {
                    // 返回当前用户参与的所有群聊
                    const myGroups = [];
                    groups.forEach((groupData, groupId) => {
                        // 检查当前用户是否在群成员中
                        const isMember = groupData.members.some(m => m.userId === currentUserId);
                        if (isMember) {
                            myGroups.push({
                                id: groupId,
                                name: groupData.groupName,
                                members: groupData.members,
                                owner: groupData.owner,
                                timestamp: groupData.timestamp || Date.now(),
                                history: groupData.history || []
                            });
                        }
                    });
                    sendToClient(ws, { type: 'my_groups', groups: myGroups });
                    console.log(`[群聊] 用户 ${currentUserId} 请求群列表，返回 ${myGroups.length} 个群`);
                    break;
                }

                case 'get_group_history': {
                    // 返回指定群聊的历史消息，按 created_at 升序排序
                    const groupId = data.groupId;
                    const groupData = groups.get(groupId);
                    if (!groupData) {
                        sendToClient(ws, {
                            type: 'group_error',
                            error: '群聊不存在',
                            groupId: groupId
                        });
                        break;
                    }
                    // 检查用户是否是群成员
                    const isMember = groupData.members.some(m => m.userId === currentUserId);
                    if (!isMember) {
                        sendToClient(ws, {
                            type: 'group_error',
                            error: '你不是该群成员',
                            groupId: groupId
                        });
                        break;
                    }

                    // 确保所有消息都有 created_at 字段，没有的用 timestamp 补充
                    const messages = (groupData.history || []).map(msg => {
                        if (!msg.created_at) {
                            msg.created_at = msg.timestamp || Date.now();
                        }
                        return msg;
                    });

                    // 按 created_at 升序排序
                    messages.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

                    sendToClient(ws, {
                        type: 'group_history',
                        groupId: groupId,
                        messages: messages
                    });
                    console.log(`[群聊] 用户 ${currentUserId} 请求群 ${groupId} 历史，返回 ${messages.length} 条消息`);
                    break;
                }

                case 'add_group_members': {
                    // 群主拉人入群
                    const groupId = data.groupId;
                    const newMembers = data.newMembers || [];
                    const groupData = groups.get(groupId);

                    if (!groupData) {
                        sendToClient(ws, { type: 'group_error', error: '群聊不存在' });
                        break;
                    }
                    if (groupData.owner !== currentUserId) {
                        sendToClient(ws, { type: 'group_error', error: '只有群主可以拉人入群' });
                        break;
                    }

                    // 添加新成员到群聊
                    newMembers.forEach(newMember => {
                        const exists = groupData.members.some(m => m.userId === newMember.userId);
                        if (!exists) {
                            groupData.members.push(newMember);
                        }
                    });

                    // 持久化
                    saveGroups();

                    // 通知所有群成员（包括新成员）："你被加入/拉入了群 xxx"
                    groupData.members.forEach(member => {
                        const memberUser = onlineUsers.get(member.userId);
                        if (memberUser) {
                            sendToClient(memberUser.ws, {
                                type: 'group_members_added',
                                groupId: groupId,
                                groupName: groupData.groupName,
                                members: groupData.members,
                                owner: groupData.owner,
                                addedMembers: newMembers,
                                operatorNickname: data.operatorNickname,
                                timestamp: Date.now()
                            });
                        }
                    });
                    console.log(`[群聊] ${currentUserId} 拉 ${newMembers.length} 人入群 ${groupId}`);
                    break;
                }

                case 'remove_group_member': {
                    // 群主移除成员
                    const groupId = data.groupId;
                    const memberUserId = data.memberUserId;
                    const groupData = groups.get(groupId);

                    if (!groupData) {
                        sendToClient(ws, { type: 'group_error', error: '群聊不存在' });
                        break;
                    }
                    if (groupData.owner !== currentUserId) {
                        sendToClient(ws, { type: 'group_error', error: '只有群主可以移除成员' });
                        break;
                    }

                    // 移除成员
                    groupData.members = groupData.members.filter(m => m.userId !== memberUserId);

                    // 持久化
                    saveGroups();

                    // 通知被移除的用户："你被移出了群 xxx"
                    const removedUser = onlineUsers.get(memberUserId);
                    if (removedUser) {
                        sendToClient(removedUser.ws, {
                            type: 'member_removed',
                            groupId: groupId,
                            groupName: groupData.groupName,
                            memberUserId: memberUserId,
                            members: groupData.members,
                            owner: groupData.owner
                        });
                    }

                    // 通知剩余群成员
                    groupData.members.forEach(member => {
                        const memberUser = onlineUsers.get(member.userId);
                        if (memberUser) {
                            sendToClient(memberUser.ws, {
                                type: 'member_removed',
                                groupId: groupId,
                                groupName: groupData.groupName,
                                memberUserId: memberUserId,
                                members: groupData.members,
                                owner: groupData.owner
                            });
                        }
                    });
                    console.log(`[群聊] ${currentUserId} 移除成员 ${memberUserId} 出群 ${groupId}`);
                    break;
                }

                default:
                    console.warn('[警告] 未知消息类型:', data.type);
            }
        } catch (error) {
            console.error('[错误] 处理消息失败:', error);
        }
    });

    ws.on('close', () => {
        // 清理心跳定时器
        if (pingInterval) clearInterval(pingInterval);
        if (heartbeatTimeout) clearTimeout(heartbeatTimeout);

        // 清理用户状态
        if (currentUserId) {
            const user = onlineUsers.get(currentUserId);
            if (user) {
                console.log(`[离线] ${user.nickname} (${currentUserId}) 已下线`);
            }
            onlineUsers.delete(currentUserId);
        }
    });

    ws.on('error', (error) => {
        console.error('[WebSocket错误]', error.message);
    });
});

// ==================== 工具函数 ====================

/**
 * 安全地发送消息给客户端
 */
function sendToClient(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(data));
        } catch (error) {
            console.error('[错误] 发送消息失败:', error);
        }
    }
}

/**
 * 广播消息给所有在线用户（保留接口，暂未使用）
 */
function broadcast(data, excludeUserId = null) {
    const message = JSON.stringify(data);
    onlineUsers.forEach((user, userId) => {
        if (userId !== excludeUserId && user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(message);
        }
    });
}

// ==================== 服务器启动 ====================

server.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(60));
    console.log('                  ✅ 服务器启动成功！                   ');
    console.log('='.repeat(60));
    console.log(`📡 WebSocket端口: ${PORT}`);
    console.log(`🌐 HTTP访问: http://localhost:${PORT}`);
    console.log(`⏰ 启动时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
    console.log(`👥 最大用户数: ${MAX_USERS}`);
    console.log('='.repeat(60));
    console.log('');
    console.log('💡 提示:');
    console.log('  - 使用 Ctrl+C 停止服务器');
    console.log('  - 使用 PM2 可以让服务器持续运行');
    console.log('  - 确保防火墙已开放端口 ' + PORT);
    console.log('');
});

// ==================== 定时任务 ====================

// 每30秒显示一次在线用户数
setInterval(() => {
    const timestamp = new Date().toLocaleTimeString('zh-CN');
    console.log(`[${timestamp}] 当前在线用户: ${onlineUsers.size}`);
}, 30000);

// 每5分钟清理断开的连接
setInterval(() => {
    let cleaned = 0;
    onlineUsers.forEach((user, userId) => {
        if (user.ws.readyState !== WebSocket.OPEN) {
            onlineUsers.delete(userId);
            cleaned++;
        }
    });
    if (cleaned > 0) {
        console.log(`[清理] 清理了 ${cleaned} 个断开的连接`);
    }
}, 5 * 60 * 1000);

// ==================== 优雅关闭 ====================

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
    console.log('\n');
    console.log('='.repeat(60));
    console.log('正在关闭服务器...');

    // 通知所有客户端
    onlineUsers.forEach((user) => {
        sendToClient(user.ws, {
            type: 'server_shutdown',
            message: '服务器正在维护，请稍后重新连接'
        });
        user.ws.close();
    });

    // 关闭WebSocket服务器
    wss.close(() => {
        console.log('WebSocket服务器已关闭');

        // 关闭HTTP服务器
        server.close(() => {
            console.log('HTTP服务器已关闭');
            console.log('服务器已安全关闭');
            console.log('='.repeat(60));
            process.exit(0);
        });
    });

    // 强制关闭超时
    setTimeout(() => {
        console.error('强制关闭服务器');
        process.exit(1);
    }, 10000);
}

// ==================== 错误处理 ====================

process.on('uncaughtException', (error) => {
    console.error('[严重错误] 未捕获的异常:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('[警告] 未处理的Promise拒绝:', reason);
});

// ==================== 服务器信息 ====================

console.log('服务器配置:');
console.log(`  Node.js版本: ${process.version}`);
console.log(`  操作系统: ${process.platform}`);
console.log(`  进程ID: ${process.pid}`);
console.log('');
