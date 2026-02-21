document.addEventListener('DOMContentLoaded', () => {
    // --- UI 元素获取 ---
    const timeDisplay = document.getElementById('current-time');
    const weatherDisplay = document.getElementById('current-weather');
    const statusBar = document.getElementById('status-bar');
    const roomBg = document.getElementById('room-bg');

    const characterContainer = document.getElementById('character-container');
    const thoughtBubble = document.getElementById('thought-bubble');
    const surpriseItem = document.getElementById('surprise-item');

    // 聊天 (全局弹窗版 - 外出专用)
    const chatBtn = document.getElementById('chat-btn');
    const chatModal = document.getElementById('chat-modal');
    const closeChatBtn = document.getElementById('close-chat-btn');
    const chatInput = document.getElementById('chat-input');
    const sendMsgBtn = document.getElementById('send-msg-btn');
    const chatMessages = document.getElementById('chat-messages');
    const chatStatusIndicator = document.getElementById('chat-status-indicator');

    // 在家当面聊天
    const homeChatArea = document.getElementById('home-chat-area');
    const homeChatInput = document.getElementById('home-chat-input');
    const homeSendBtn = document.getElementById('home-send-btn');
    const chatBubble = document.getElementById('chat-bubble');

    // 惊喜
    const surpriseModal = document.getElementById('surprise-modal');
    const surpriseText = document.getElementById('surprise-text');
    const closeSurpriseBtn = document.getElementById('close-surprise-btn');

    // 设置与调试
    const settingsBtn = document.getElementById('settings-btn');
    const devBtn = document.getElementById('dev-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    const settingsLoading = document.getElementById('settings-loading');

    const debugPanel = document.getElementById('debug-panel');
    const closeDebugBtn = document.getElementById('close-debug-btn');
    const dbgTime = document.getElementById('dbg-time');
    const dbgDay = document.getElementById('dbg-day'); // 新增的周几调试显示
    const dbgState = document.getElementById('dbg-state');
    const dbgActivity = document.getElementById('dbg-activity');
    const dbgSchedule = document.getElementById('dbg-schedule');
    const dbgLogs = document.getElementById('dbg-logs');
    const charStatusText = document.getElementById('char-status-text');

    // 时间控制与同步
    const speedBtn = document.getElementById('speed-btn');
    const syncTimeBtn = document.getElementById('sync-time-btn');

    // --- 状态与上下文 ---
    let simulatedDay = 5; // 默认周五开始
    let simulatedHour = 10;
    let simulatedMinute = 0;

    let personaName = "保镖小哥";
    let personaPrompt = document.getElementById('persona-prompt').value;

    let schedule = null; // 由 DeepSeek 生成的作息
    let characterState = 'idle';
    let currentActivity = '发呆';
    let currentReplyDelay = [5, 15]; // 目前状态下的回复延迟区间

    let chatHistory = [];
    let isChatOpen = false;
    let isFetchingAI = false; // 是否有一趟请求在处理（替代原来的 isWaitingReply）
    let activeRandomEvent = null; // 当前突发事件状态

    // 默认测试流速，每1秒(现实)跳动 600秒(10分钟虚拟)，即 600x
    let timeScaleObj = { label: "⏱️ 600x (测试)", stepMinutes: 10, intervalMs: 1000 };
    // 定义几种流速预设: 1x, 5x, 60x, 600x
    const speedPresets = [
        { label: "⏱️ 1x (现实)", stepMinutes: 1, intervalMs: 60000 },
        { label: "⏱️ 5x (5倍速)", stepMinutes: 1, intervalMs: 12000 },
        { label: "⏱️ 60x (1秒1分)", stepMinutes: 1, intervalMs: 1000 },
        { label: "⏱️ 600x (测试)", stepMinutes: 10, intervalMs: 1000 }
    ];
    let currentSpeedIndex = 3; // 默认测试速
    let timeTicker = null;

    // --- 系统初始化 ---
    updateEnvTime();

    // 默认触发一次作息生成 (生成期间强制在画面中心展示人物，避免黑屏错觉)
    applyCharacterVisual('pos-center', false);
    generateSchedule();

    function startTimeTicker() {
        if (timeTicker) clearInterval(timeTicker);
        timeTicker = setInterval(() => {
            simulatedMinute += timeScaleObj.stepMinutes;
            if (simulatedMinute >= 60) {
                simulatedMinute = simulatedMinute % 60;
                simulatedHour = (simulatedHour + 1) % 24;
                if (simulatedHour === 0 && simulatedMinute === 0) {
                    simulatedDay = simulatedDay === 7 ? 1 : simulatedDay + 1;
                }
            }
            updateEnvTime();
            if (schedule) parseScheduleAndSetState();
        }, timeScaleObj.intervalMs);
    }

    // 启动时间系统
    startTimeTicker();

    // 绑定速率切换
    speedBtn.addEventListener('click', () => {
        currentSpeedIndex = (currentSpeedIndex + 1) % speedPresets.length;
        timeScaleObj = speedPresets[currentSpeedIndex];
        speedBtn.innerText = timeScaleObj.label;
        startTimeTicker();

        updateEnvTime();
    });

    // 绑定一键同步现实时间
    syncTimeBtn.addEventListener('click', () => {
        const now = new Date();
        simulatedDay = now.getDay() === 0 ? 7 : now.getDay();
        simulatedHour = now.getHours();
        simulatedMinute = now.getMinutes();

        // 自动切回1倍速现实流速
        currentSpeedIndex = 0;
        timeScaleObj = speedPresets[currentSpeedIndex];
        speedBtn.innerText = timeScaleObj.label;

        startTimeTicker();
        updateEnvTime();
        if (schedule) parseScheduleAndSetState();
    });

    // --- Debug Log 注入器 ---
    function appendDebugLog(type, input, output) {
        const div = document.createElement('div');
        div.className = 'log-entry';
        const now = new Date();
        const tStr = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
        div.innerHTML = `
            <div class="log-time">[${tStr}] <span class="log-type">${type}</span></div>
            <div class="log-content"><strong>IN:</strong> ${typeof input === 'object' ? JSON.stringify(input, null, 2) : input}</div>
            <div class="log-content"><strong>OUT:</strong> ${typeof output === 'object' ? JSON.stringify(output, null, 2) : output}</div>
        `;
        dbgLogs.prepend(div);
    }

    // --- API 调用方法 ---
    async function generateSchedule() {
        settingsLoading.classList.remove('hidden');
        saveSettingsBtn.disabled = true;

        try {
            const reqBody = { name: personaName, persona: personaPrompt };
            const res = await fetch('/api/generate_schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody)
            });
            schedule = await res.json();
            appendDebugLog('GenerateSchedule', reqBody, schedule);
            dbgSchedule.innerText = JSON.stringify(schedule, null, 2);
            // 这里加入 2 秒延迟再应用由于作息计算可能导致的“外出消失”，让你至少能看他一眼
            setTimeout(() => parseScheduleAndSetState(), 2000);
        } catch (e) {
            console.error(e);
            alert("生成作息失败，请查看控制台并确保后端配置正确。");
        } finally {
            settingsLoading.classList.add('hidden');
            saveSettingsBtn.disabled = false;
            settingsModal.classList.add('hidden');
        }
    }

    async function fetchChatReply(userMessage) {
        // 带上防幻觉的强制日期
        const dayStr = ['一', '二', '三', '四', '五', '六', '日'][simulatedDay - 1];
        const timeStr = `${String(simulatedHour).padStart(2, '0')}:${String(simulatedMinute).padStart(2, '0')}`;
        const timeInfo = `今天是虚拟时间 星期${dayStr} 的 ${timeStr}。你正在 ${currentActivity} (${characterState === 'home' ? '在家里' : '在外面'})。`;

        try {
            const reqBody = {
                name: personaName,
                persona: personaPrompt,
                time_info: timeInfo,
                user_message: userMessage,
                history: chatHistory.slice(-5)
            };
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody)
            });
            const data = await res.json();
            appendDebugLog('Chat', reqBody, data);
            return data.messages || [{ content: data.reply || "（网络连接断开了...）", delay_seconds: 0 }];
        } catch (e) {
            console.error(e);
            return [{ content: "(信号不好，消息没有发出去...)", delay_seconds: 0 }];
        }
    }

    async function fetchSurpriseMessage() {
        const timeStr = `${String(simulatedHour).padStart(2, '0')}:${String(simulatedMinute).padStart(2, '0')}`;
        try {
            const reqBody = {
                name: personaName,
                persona: personaPrompt,
                time_info: `目前是 ${timeStr}。`
            };
            const res = await fetch('/api/surprise', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody)
            });
            const data = await res.json();
            appendDebugLog('Surprise', reqBody, data);
            return data.surprise;
        } catch (e) {
            return "桌上放着一盒你爱吃的点心。";
        }
    }

    // --- 核心方法：状态解析 ---
    function parseScheduleAndSetState() {
        if (!schedule) return;

        // 检查活跃的随机事件是否过期
        if (activeRandomEvent) {
            const currentTotalMin = simulatedDay * 24 * 60 + simulatedHour * 60 + Math.floor(simulatedMinute);
            if (currentTotalMin >= activeRandomEvent.expireTotalMin) {
                // 已过期，退回常规状态
                activeRandomEvent = null;
            } else {
                // 维持随机事件状态
                characterState = activeRandomEvent.location === 'out' ? 'away' : 'home';
                currentActivity = activeRandomEvent.activity;
                currentReplyDelay = activeRandomEvent.reply_delay || [5, 15];

                if (characterState === 'home') {
                    thoughtBubble.innerText = "💭 " + currentActivity;
                    charStatusText.innerText = "🏠 " + currentActivity;
                    applyCharacterVisual('pos-center', false);
                } else {
                    applyCharacterVisual('pos-away', true);
                    charStatusText.innerText = "🚶 突发：" + currentActivity;
                }
                updateUIBasedOnState();
                updateDebugPanel();
                return;
            }
        }

        let isSleeping = false;
        if (schedule.sleep) {
            const start = schedule.sleep[0];
            const end = schedule.sleep[1];
            if (start > end) { // 跨天
                if (simulatedHour >= start || simulatedHour < end) isSleeping = true;
            } else {
                if (simulatedHour >= start && simulatedHour < end) isSleeping = true;
            }
        }

        // 解析 V0.3 的 routine
        let activeRoutine = null;
        if (schedule.routine && Array.isArray(schedule.routine)) {
            for (let r of schedule.routine) {
                if (r.days && r.days.includes(simulatedDay)) {
                    // 判断小时是否命中该 rutine 的工作时间
                    if (simulatedHour >= r.start && simulatedHour < r.end) {
                        activeRoutine = r;
                        break;
                    }
                }
            }
        }

        // 决定大状态
        if (isSleeping) {
            characterState = 'sleeping';
            currentActivity = '正在睡觉';
            currentReplyDelay = [30, 240]; // 睡觉回信极慢
            applyCharacterVisual('pos-right', false);
            thoughtBubble.innerText = "💤 Zzz...";
            charStatusText.innerText = "💤 正在睡觉";
        } else if (activeRoutine && activeRoutine.location === 'out') {
            characterState = 'away';
            currentActivity = activeRoutine.activity || '外出不在家';
            currentReplyDelay = activeRoutine.reply_delay || [5, 30];

            applyCharacterVisual('pos-away', true); // 外出直接消失
            charStatusText.innerText = "🚶 外出：" + currentActivity;
        } else {
            characterState = 'home';
            currentReplyDelay = [0, 1]; // 在家基本秒回

            let acts = schedule.home_activities || ["宅家"];
            let actIndex = simulatedHour % acts.length;
            currentActivity = acts[actIndex];

            thoughtBubble.innerText = "💭 " + currentActivity;
            charStatusText.innerText = "🏠 " + currentActivity;

            const poses = ['pos-center', 'pos-left', 'pos-right'];
            applyCharacterVisual(poses[actIndex % poses.length], false);
        }

        updateUIBasedOnState();
        updateDebugPanel();

        // 随机事件触发逻辑 (每逢整点 15% 概率，且当前没有活跃的随机事件)
        if (simulatedMinute === 0 && !activeRandomEvent && Math.random() < 0.15) {
            triggerRandomEvent();
        }
    }

    async function triggerRandomEvent() {
        const dayStr = ['一', '二', '三', '四', '五', '六', '日'][simulatedDay - 1];
        const timeStr = `${String(simulatedHour).padStart(2, '0')}:${String(simulatedMinute).padStart(2, '0')}`;
        const timeInfo = `今天是虚拟时间 星期${dayStr} 的 ${timeStr}。你本来正在 ${currentActivity} (${characterState === 'home' ? '在家里' : '在外面'})。`;

        try {
            const reqBody = { name: personaName, persona: personaPrompt, time_info: timeInfo };
            const res = await fetch('/api/random_event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody)
            });
            const eventData = await res.json();
            appendDebugLog('RandomEvent', reqBody, eventData);

            const durationArr = parseInt(eventData.duration) || 30;
            const currentTotalMin = simulatedDay * 24 * 60 + simulatedHour * 60 + Math.floor(simulatedMinute);

            activeRandomEvent = {
                activity: eventData.activity || '突发事件',
                location: eventData.location === 'out' ? 'out' : 'home',
                reply_delay: eventData.reply_delay || [5, 15],
                expireTotalMin: currentTotalMin + durationArr
            };

            // 生成后立即刷新状态，应用随机事件
            parseScheduleAndSetState();
        } catch (e) { console.error(e); }
    }

    function updateUIBasedOnState() {
        if (characterState === 'home' || characterState === 'sleeping') {
            chatBtn.classList.add('hidden');
            homeChatArea.classList.remove('hidden');
        } else {
            homeChatArea.classList.add('hidden');
            chatBtn.classList.remove('hidden');
            // 关闭在家的气泡（如果有）
            chatBubble.classList.add('hidden');
        }
    }

    function applyCharacterVisual(posClass, hide) {
        // 先清理旧的位置类
        characterContainer.classList.remove('pos-center', 'pos-left', 'pos-right', 'pos-away');
        characterContainer.classList.add(posClass);
        if (hide) thoughtBubble.classList.add('hidden');
        else thoughtBubble.classList.remove('hidden');
    }

    function updateEnvTime() {
        const timeStr = `${String(simulatedHour).padStart(2, '0')}:${String(simulatedMinute).padStart(2, '0')}`;
        timeDisplay.innerText = `周${['一', '二', '三', '四', '五', '六', '日'][simulatedDay - 1]} ` + timeStr;
        dbgTime.innerText = timeStr;
        dbgDay.innerText = simulatedDay;

        if (simulatedHour >= 6 && simulatedHour < 18) {
            roomBg.style.backgroundImage = "url('assets/day.png')";
            weatherDisplay.innerText = '☀️';
            statusBar.className = 'day-mode';
        } else {
            roomBg.style.backgroundImage = "url('assets/night.png')";
            weatherDisplay.innerText = '🌙';
            statusBar.className = 'night-mode';
        }
    }

    function updateDebugPanel() {
        dbgState.innerText = characterState;
        dbgActivity.innerText = currentActivity;
    }

    // --- 面板交互部分 ---
    settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
    closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

    saveSettingsBtn.addEventListener('click', () => {
        personaName = document.getElementById('persona-name').value.trim() || "保镖小哥";
        personaPrompt = document.getElementById('persona-prompt').value.trim();
        document.getElementById('chat-title').innerText = `📱 和 ${personaName} 的聊天`;
        generateSchedule();

        // 塞一条系统提示进入聊天历史
        chatMessages.innerHTML = '';
        chatHistory = [];
        const sysDiv = document.createElement('div');
        sysDiv.className = `message system-message`;
        sysDiv.innerHTML = `<div class="content">【系统】已重新连接到 ${personaName} 的通讯终端</div>`;
        chatMessages.appendChild(sysDiv);
    });

    devBtn.addEventListener('click', () => debugPanel.classList.remove('hidden'));
    closeDebugBtn.addEventListener('click', () => debugPanel.classList.add('hidden'));

    surpriseItem.addEventListener('click', async () => {
        surpriseItem.classList.add('hidden');
        surpriseText.innerText = '正在拆开便签...';
        surpriseModal.classList.remove('hidden');

        const txt = await fetchSurpriseMessage();
        surpriseText.innerText = `"${txt}"`;
    });
    closeSurpriseBtn.addEventListener('click', () => surpriseModal.classList.add('hidden'));

    // --- 聊天系统 ---
    // 1. 在家当面说话
    homeSendBtn.addEventListener('click', sendHomeMessage);
    homeChatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendHomeMessage(); });

    async function sendHomeMessage() {
        const text = homeChatInput.value.trim();
        if (!text) return;
        homeChatInput.value = '';

        chatHistory.push({ role: "user", content: text });

        if (isFetchingAI) return;
        isFetchingAI = true;

        chatBubble.innerText = "...";
        chatBubble.classList.remove('hidden');
        thoughtBubble.classList.add('hidden'); // 说话时隐藏发呆气泡

        const messagesArr = await fetchChatReply("");

        for (let i = 0; i < messagesArr.length; i++) {
            let msg = messagesArr[i];

            // 如果不是第一条，或者是强制了思考时间的，显示点点点等一下
            if (msg.delay_seconds > 0 || i > 0) {
                chatBubble.innerText = "...";
                await new Promise(r => setTimeout(r, Math.max(1, msg.delay_seconds) * 1000));
            }

            chatBubble.innerText = msg.content;
            chatHistory.push({ role: "assistant", content: msg.content });

            // 停顿一会再发下一条（模拟阅读这段话需要的时间）
            if (i < messagesArr.length - 1) {
                await new Promise(r => setTimeout(r, 1500 + msg.content.length * 100));
            }
        }

        // 最后一条结束后，过几秒收起气泡
        setTimeout(() => {
            if (!isFetchingAI) {
                chatBubble.classList.add('hidden');
                if (characterState === 'home') thoughtBubble.classList.remove('hidden');
            }
        }, 8000);

        isFetchingAI = false;
    }

    // 2. 微信系统(含延迟等待和连发回信)
    chatBtn.addEventListener('click', () => {
        chatModal.classList.remove('hidden');
        isChatOpen = true;
        chatInput.disabled = false;
        chatInput.focus();
    });
    closeChatBtn.addEventListener('click', () => { chatModal.classList.add('hidden'); isChatOpen = false; });
    sendMsgBtn.addEventListener('click', sendWechatMessage);
    chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendWechatMessage(); });

    async function sendWechatMessage() {
        const text = chatInput.value.trim();
        if (!text) return;

        appendMessage(text, 'user');
        chatInput.value = '';
        chatHistory.push({ role: "user", content: text });
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // V0.4：如果不限制输入框，且当前正在获取回复，只把新话追加进历史并退出
        if (isFetchingAI) return;
        isFetchingAI = true;

        // 计算当前活动所需的回复延迟时长（现实毫秒数）
        let delayMin = currentReplyDelay[0] + Math.random() * (currentReplyDelay[1] - currentReplyDelay[0]);
        let realMsPerVirtualMin = timeScaleObj.intervalMs / timeScaleObj.stepMinutes;
        let finalWaitMs = delayMin * realMsPerVirtualMin;

        finalWaitMs += 1500;

        // V0.4：段落式输入反馈算法。若预估等待时间超长，则前期保持静默
        if (finalWaitMs > 30000) {
            chatStatusIndicator.classList.add('hidden');
            await new Promise(r => setTimeout(r, Math.max(0, finalWaitMs - 15000)));
            chatStatusIndicator.innerText = " (对方正在输入...)";
            chatStatusIndicator.classList.remove('hidden');
            await new Promise(r => setTimeout(r, 15000));
        } else {
            chatStatusIndicator.innerText = " (对方正在输入...)";
            chatStatusIndicator.classList.remove('hidden');
            await new Promise(r => setTimeout(r, finalWaitMs));
        }

        // 传空字符串让后端读取最新的、饱含多次连发的全部历史上下文
        const messagesArr = await fetchChatReply("");

        // 连发机制出列，一条一条吐出 JSON 返回的数组
        for (let i = 0; i < messagesArr.length; i++) {
            let msg = messagesArr[i];
            if (msg.delay_seconds > 0) {
                // 等待下一条连发的期间，要亮起正在输入
                chatStatusIndicator.innerText = " (对方正在输入...)";
                chatStatusIndicator.classList.remove('hidden');
                await new Promise(r => setTimeout(r, msg.delay_seconds * 1000));
            }
            chatStatusIndicator.classList.add('hidden');

            chatHistory.push({ role: "assistant", content: msg.content });
            appendMessage(msg.content, 'ai');

            // 呼吸灯提示外在的玩家
            if (!isChatOpen) {
                chatBtn.innerText = "💬 (新消息)";
                setTimeout(() => { if (!isChatOpen) chatBtn.innerText = "💬 微信"; }, 3000);
            }

            // 对于中间连发的消息稍微再等一等让人看清
            if (i < messagesArr.length - 1 && msg.delay_seconds <= 0) {
                await new Promise(r => setTimeout(r, 800));
            }
        }

        isFetchingAI = false;
    }

    function appendMessage(text, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}-message`;
        const avatarStr = sender === 'user' ? '🟢' : '🔵';
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        msgDiv.innerHTML = `<span class="avatar">${avatarStr}</span><div class="content">${text}<br><span class="time">${timeStr}</span></div>`;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
});
