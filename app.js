// ================= 全域變數與 WebSocket 初始化 =================
let currentGroupId = null;

// 記住目前正在編輯的連結 ID (編輯模式)
let editingLinkId = null;

// UI 狀態記憶區 (用來記住目前展開的分類與標籤)
let openCategoryName = null;
let activeFilterSubId = 'all';

// 批量選取狀態
let isBatchMode = false;

// 打開收音機，連線到後端電台
const socket = io();

// 設定頻道監聽器。當聽到 'workspace_updated' 廣播時，自動重整畫面
socket.on('workspace_updated', () => {
    console.log("📡 收到即時更新廣播！正在自動重整畫面...");
    if (typeof fetchAndRenderApp === 'function') {
        fetchAndRenderApp();
    }
});

// 透過邀請碼加入群組的函式
async function joinGroupByToken(token) {
    const username = localStorage.getItem('saved_username');
    if (!username) {
        alert('請先登入或註冊！登入後再點擊一次邀請連結即可加入。');
        return;
    }

    try {
        // 🌟 修正：改用相對路徑
        const response = await fetch('/api/groups/join', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Username': username
            },
            body: JSON.stringify({ token: token })
        });

        const data = await response.json();
        if (response.ok) {
            alert(data.message);
            window.history.replaceState({}, document.title, window.location.pathname);
            await loadMyGroups();
            fetchAndRenderApp();
        } else {
            alert(data.error);
        }
    } catch (error) {
        console.error('加入群組失敗:', error);
    }
}

// ================= 群組與協作功能 =================

// 1. 載入使用者的群組清單 (加入了記憶讀取與防呆驗證)
async function loadMyGroups() {
    const username = localStorage.getItem('saved_username');
    if (!username) return;

    try {
        const response = await fetch('/api/my_groups', {
            headers: { 'X-Username': username }
        });
        const groups = await response.json();

        const select = document.getElementById('group-select');
        if (!select) return;
        select.innerHTML = '';

        groups.forEach(group => {
            const option = document.createElement('option');
            option.value = group.id;
            option.textContent = group.name;
            option.dataset.isPersonal = group.is_personal;
            option.dataset.role = group.role;
            select.appendChild(option);
        });

        // 🌟 核心記憶邏輯升級：
        if (currentGroupId) {
            // 情況 A：如果記憶體已經有指定群組 (例如剛建立新群組)，保持它
            select.value = currentGroupId;
            socket.emit('join_workspace', { group_id: currentGroupId });
        } else if (groups.length > 0) {
            // 情況 B：剛打開網頁，去 localStorage 尋找「上一次使用的群組 ID」
            const savedGroupId = localStorage.getItem('last_used_group_id');

            // 防呆驗證：檢查記憶中的 ID 是否真的還存在於目前的群組清單中
            const targetGroup = groups.find(g => String(g.id) === String(savedGroupId));

            if (targetGroup) {
                currentGroupId = targetGroup.id; // 找到了！優先載入上一次的群組
            } else {
                currentGroupId = groups[0].id;   // 沒記憶或群組已被刪除，才退回預設第一個
            }

            select.value = currentGroupId;
            socket.emit('join_workspace', { group_id: currentGroupId });
            localStorage.setItem('last_used_group_id', currentGroupId); // 順手更新記憶
        }

        updateInviteButtonVisibility();
    } catch (error) {
        console.error('載入群組失敗:', error);
    }
}

// 2. 切換群組 (加入了寫入記憶邏輯)
function switchGroup(groupId) {
    openCategoryName = null;
    activeFilterSubId = 'all';

    if (currentGroupId) {
        socket.emit('leave_workspace', { group_id: currentGroupId });
    }

    currentGroupId = groupId;

    // 🌟 核心寫入：只要有切換群組，立刻記到瀏覽器的永久記憶體裡！
    localStorage.setItem('last_used_group_id', groupId);

    const mainSelect = document.getElementById('group-select');
    if (mainSelect) {
        mainSelect.value = currentGroupId;
    }

    if (currentGroupId) {
        socket.emit('join_workspace', { group_id: currentGroupId });
    }

    updateInviteButtonVisibility();

    if (typeof fetchAndRenderApp === 'function') {
        fetchAndRenderApp();
    }
}

// 輔助函式：判斷要不要顯示「產生邀請連結」按鈕
function updateInviteButtonVisibility() {
    const select = document.getElementById('group-select');
    if (!select || select.options.length === 0) return;

    const selectedOption = select.options[select.selectedIndex];
    const btnInvite = document.getElementById('btn-invite');

    if (!selectedOption || !btnInvite) return;

    const isPersonal = selectedOption.dataset.isPersonal === 'true';
    const role = selectedOption.dataset.role;

    if (!isPersonal && role === 'owner') {
        btnInvite.style.display = 'flex';
    } else {
        btnInvite.style.display = 'none';
    }
}

// 3. 建立新群組
async function createNewGroup() {
    const groupName = prompt('請輸入新群組的名稱 (例如：期末報告專案)：');
    if (!groupName) return;

    const username = localStorage.getItem('saved_username');
    try {
        // 🌟 修正：改用相對路徑
        const response = await fetch('/api/groups', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Username': username
            },
            body: JSON.stringify({ name: groupName })
        });

        const data = await response.json();
        if (response.ok) {
            alert('群組建立成功！');
            currentGroupId = data.group_id;
            await loadMyGroups();
            switchGroup(currentGroupId);
        } else {
            alert(data.error);
        }
    } catch (error) {
        console.error('建立群組失敗:', error);
    }
}

// 4. 產生邀請連結
async function generateInviteLink() {
    const username = localStorage.getItem('saved_username');
    if (!currentGroupId) return;

    try {
        // 🌟 修正：改用相對路徑
        const response = await fetch(`/api/groups/${currentGroupId}/invite`, {
            method: 'POST',
            headers: { 'X-Username': username }
        });

        const data = await response.json();
        if (response.ok) {
            const inviteUrl = `${window.location.origin}${window.location.pathname}?token=${data.invite_token}`;

            navigator.clipboard.writeText(inviteUrl).then(() => {
                alert(`✅ 邀請連結已複製到剪貼簿！\n\n您可以直接貼上傳給朋友了：\n${inviteUrl}`);
            }).catch(err => {
                prompt('請手動複製以下邀請連結：', inviteUrl);
            });
        } else {
            alert(data.error || '產生邀請連結失敗');
        }
    } catch (error) {
        console.error('產生邀請失敗:', error);
    }
}

// ================= 全域 API 攔截器 (自動夾帶通行證) =================
const originalFetch = window.fetch;
window.fetch = async function (resource, config) {
    // 🌟 修正：簡化攔截器，因為已經全部改為相對路徑，不需要再替換 IP 了
    if (typeof resource === 'string' && (resource.includes('/api/login') || resource.includes('/api/register'))) {
        return originalFetch(resource, config);
    }

    if (!config) config = {};
    if (!config.headers) config.headers = {};

    const username = localStorage.getItem('saved_username');
    if (username) {
        config.headers['X-Username'] = username;
    }

    if (currentGroupId) {
        config.headers['X-Group-Id'] = currentGroupId;
    }

    return originalFetch(resource, config);
};

// ================= 登入與畫面切換邏輯 =================

let isLoginMode = true;

function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    const inviteInput = document.getElementById('invite-code-input');
    const submitBtn = document.getElementById('submit-btn');
    const modeText = document.getElementById('mode-text');
    const modeLink = document.getElementById('mode-link');
    const formTitle = document.getElementById('form-title');
    const messageEl = document.getElementById('login-message');

    messageEl.textContent = '';
    document.getElementById('password-input').value = '';
    inviteInput.value = '';

    if (isLoginMode) {
        formTitle.textContent = "私人連結收藏庫";
        inviteInput.style.display = 'none';
        submitBtn.textContent = '登入';
        modeText.textContent = '還沒有帳號嗎？';
        modeLink.textContent = '點此註冊';
    } else {
        formTitle.textContent = "建立帳號";
        inviteInput.style.display = 'block';
        submitBtn.textContent = '註冊';
        modeText.textContent = '已經有帳號了？';
        modeLink.textContent = '返回登入';
    }
}

async function handleSubmit() {
    const username = document.getElementById('username-input').value;
    const password = document.getElementById('password-input').value;
    const inviteCode = document.getElementById('invite-code-input').value;
    const messageEl = document.getElementById('login-message');

    if (!username || !password) {
        messageEl.textContent = "帳號密碼不能為空喔！";
        return;
    }

    if (!isLoginMode && !inviteCode) {
        messageEl.textContent = "註冊需要輸入通關密語！";
        return;
    }

    messageEl.textContent = isLoginMode ? "登入中..." : "註冊中...";

    const endpoint = isLoginMode ? '/api/login' : '/api/register';
    const payload = isLoginMode ? { username, password } : { username, password, invite_code: inviteCode };

    try {
        // 🌟 修正：改用相對路徑，拔除 http://127.0.0.1:5002
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (response.ok) {
            if (isLoginMode) {
                localStorage.setItem('saved_username', result.username);
                showAppView(result.username);

                // 🌟 新增：登入成功後，檢查有沒有剛剛被卡在門外的分享網址
                if (pendingSharedUrl) {
                    // 等待一小段時間讓主畫面準備好，再彈出新增視窗
                    setTimeout(() => triggerAutoAddModal(pendingSharedUrl, pendingSharedTitle), 500);
                }
            } else {
                alert("🎉 帳號建立成功！請使用新帳號登入。");
                toggleAuthMode();
                document.getElementById('password-input').value = '';
            }
        } else {
            messageEl.textContent = result.error || "發生未知錯誤";
        }
    } catch (error) {
        console.error("連線錯誤：", error);
        messageEl.textContent = "無法連線到伺服器，請確認 Flask 已啟動。";
    }
}

function handleLogout() {
    localStorage.removeItem('saved_username');
    localStorage.removeItem('last_used_group_id'); // 🌟 登出時，順手清空上一次使用的群組記憶

    if (currentGroupId) {
        socket.emit('leave_workspace', { group_id: currentGroupId });
    }

    openCategoryName = null;
    activeFilterSubId = 'all';
    currentGroupId = null;

    document.getElementById('main-app-section').style.display = 'none';
    document.getElementById('login-section').style.display = 'flex';
    document.getElementById('username-input').value = '';
    document.getElementById('password-input').value = '';
    document.getElementById('invite-code-input').value = '';
    document.getElementById('login-message').textContent = '';
    document.getElementById('app-content').innerHTML = '';

    if (!isLoginMode) {
        toggleAuthMode();
    }
}

async function showAppView(username) {
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('main-app-section').style.display = 'block';

    document.getElementById('user-display-name').textContent = username;

    await loadMyGroups();
    fetchAndRenderApp();
}

// ================= 抓取與渲染首頁 (手風琴 + 標籤篩選版) =================
// ================= 處理分類、標題、標籤與來源的超級搜尋 =================
function handleCategorySearch() {
    const keyword = document.getElementById('category-search-input').value.toLowerCase().trim();
    const headers = document.querySelectorAll('.accordion-header');

    headers.forEach(header => {
        const titleText = header.textContent.toLowerCase();
        const content = header.nextElementSibling;
        const arrow = header.querySelector('.arrow-icon');
        const catName = header.querySelector('span').innerText;

        if (!content) return;

        // 🌟 1. 重置卡片與小分類按鈕狀態
        const cards = content.querySelectorAll('.filterable-card');
        cards.forEach(card => card.style.display = 'flex');

        const chips = content.querySelectorAll('.filter-chip');
        chips.forEach(chip => {
            chip.classList.remove('active');
            if (chip.textContent.trim() === '全部') {
                chip.classList.add('active');
            }
        });

        // 🌟 2. 如果搜尋框已被清空：完美還原成使用者「搜尋前」的手風琴開合狀態！
        if (!keyword) {
            header.style.display = 'flex';
            // 比對記憶：如果是使用者原本打開的資料夾，就保持展開；其餘乖乖收合
            if (catName === openCategoryName) {
                content.style.display = 'block';
                if (arrow) arrow.style.transform = 'rotate(180deg)';
            } else {
                content.style.display = 'none';
                if (arrow) arrow.style.transform = 'rotate(0deg)';
            }
            return;
        }

        // 🌟 3. 開始關鍵字比對
        const isCatNameMatch = titleText.includes(keyword);

        let isSubNameMatch = false;
        chips.forEach(chip => {
            if (chip.textContent.toLowerCase().includes(keyword)) {
                isSubNameMatch = true;
            }
        });

        let hasCardMatch = false;
        cards.forEach(card => {
            const cardTitle = card.querySelector('.card-title')?.textContent.toLowerCase() || '';
            const cardSource = card.querySelector('.card-source')?.textContent.toLowerCase() || '';
            const cardTags = card.getAttribute('data-tags')?.toLowerCase() || '';

            if (isCatNameMatch || isSubNameMatch || cardTitle.includes(keyword) || cardSource.includes(keyword) || cardTags.includes(keyword)) {
                card.style.display = 'flex';
                if (!isCatNameMatch && !isSubNameMatch) {
                    hasCardMatch = true;
                }
            } else {
                card.style.display = 'none';
            }
        });

        // 🌟 4. 決定大分類與其身體的顯示與收合
        if (isCatNameMatch || isSubNameMatch || hasCardMatch) {
            header.style.display = 'flex';
            content.style.display = 'block';
            if (arrow) arrow.style.transform = 'rotate(180deg)';
        } else {
            header.style.display = 'none';
            // 🛑 核心修復：當標題隱藏時，身體 (包含裡面的小分類標籤) 必須強制一起隱藏！絕對不留幽靈！
            content.style.display = 'none';
        }
    });
}

// ================= 控制搜尋列展開/收合 =================
function toggleSearchBar() {
    const container = document.getElementById('search-bar-container');
    const input = document.getElementById('category-search-input');

    if (container.style.display === 'none' || container.style.display === '') {
        // 展開搜尋框
        container.style.display = 'block';
        input.focus(); // 貼心設計：展開後自動讓游標閃爍，可以直接打字
    } else {
        // 收合搜尋框
        container.style.display = 'none';
        input.value = ''; // 關閉時順便清空輸入的字
        handleCategorySearch(); // 觸發一次空白搜尋，讓所有分類恢復顯示
    }
}

// ================= 抓取與渲染首頁 =================
async function fetchAndRenderApp() {
    const appContent = document.getElementById('app-content');
    appContent.innerHTML = '<p style="text-align: center; margin-top: 50px; color: #8e8e93;">正在載入你的珍藏...</p>';

    try {
        const response = await fetch('/api/categories');
        const categories = await response.json();

        if (categories.length === 0) {
            appContent.innerHTML = `
                <div style="text-align: center; margin-top: 80px; color: #8e8e93;">
                    <div style="font-size: 48px; margin-bottom: 16px;">🗂️</div>
                    <h3>目前還沒有任何收藏</h3>
                    <p style="margin-top: 8px;">點擊右上角的「新增」來加入你的第一個連結吧！</p>
                </div>`;
            return;
        }

        let htmlContent = '';

        categories.forEach(cat => {
            const catName = cat.name || cat.categoryName || "未命名大分類";

            // 🌟 UI升級：拔除 Emoji，改用高質感 SVG 資料夾圖示
            htmlContent += `
                <button class="accordion-header" onclick="toggleAccordion(this)">
                    <span style="display: flex; align-items: center; gap: 10px;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8e8e93" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                        </svg>
                        ${catName}
                    </span>
                    <span class="arrow-icon">▼</span>
                </button>
                <div class="accordion-content" style="padding-left: 0; padding-right: 0;">
            `;

            let hasAnyLink = false;
            let chipsHtml = '';
            let cardsHtml = '';

            const validSubs = cat.subcategories ? cat.subcategories.filter(sub => sub.links && sub.links.length > 0) : [];

            if (validSubs.length > 0) {
                chipsHtml += `<div class="filter-chips-container">`;
                chipsHtml += `<div class="filter-chip active" onclick="filterLinks(this, 'all')">全部</div>`;

                if (cat.links && cat.links.length > 0) {
                    chipsHtml += `<div class="filter-chip" onclick="filterLinks(this, 'none')">📌 直屬連結</div>`;
                }

                validSubs.forEach(sub => {
                    chipsHtml += `<div class="filter-chip" onclick="filterLinks(this, '${sub.id}')">${sub.name}</div>`;
                });
                chipsHtml += `</div>`;
            }

            if (cat.links && cat.links.length > 0) {
                hasAnyLink = true;
                cat.links.forEach(link => {
                    link.category_id = cat.id; // 🌟 核心修復：確保直屬連結也有 category_id，避免後續篩選出錯
                    cardsHtml += generateLinkCard(link, null, 'none');
                });
            }

            if (validSubs.length > 0) {
                validSubs.forEach(sub => {
                    hasAnyLink = true;
                    sub.links.forEach(link => {
                        link.category_id = cat.id;
                        link.subcategory_id = sub.id;
                        cardsHtml += generateLinkCard(link, sub.name, sub.id);
                    });
                });
            }

            if (hasAnyLink) {
                htmlContent += chipsHtml + `<div class="category-cards-wrapper">` + cardsHtml + `</div>`;
            } else {
                htmlContent += `<p style="color: #8e8e93; font-size: 14px; text-align: center; margin: 10px 0;">此分類尚無內容</p>`;
            }

            htmlContent += `</div>`;
        });

        // 🌟 UI升級：在外層包一個 div，給予頂部 16px 的舒適留白，底部也多留一點空間防擋
        appContent.innerHTML = `<div style="padding-top: 16px; padding-bottom: 40px;">${htmlContent}</div>`;

        // 記憶狀態還原邏輯 (保持不變)
        if (openCategoryName) {
            const allHeaders = document.querySelectorAll('.accordion-header');
            allHeaders.forEach(header => {
                const currentCatName = header.querySelector('span').innerText.trim();
                if (currentCatName === openCategoryName.trim()) {
                    const content = header.nextElementSibling;
                    const arrow = header.querySelector('.arrow-icon');
                    content.style.display = 'block';
                    arrow.style.transform = 'rotate(180deg)';

                    if (activeFilterSubId !== 'all') {
                        const chips = content.querySelectorAll('.filter-chip');
                        let chipFound = false;
                        chips.forEach(chip => {
                            if (chip.getAttribute('onclick').includes(`'${activeFilterSubId}'`)) {
                                chipFound = true;
                                filterLinks(chip, activeFilterSubId);
                            }
                        });
                        if (!chipFound) activeFilterSubId = 'all';
                    }
                }
            });
        }

        enableDragScroll();

    } catch (error) {
        console.error("載入失敗：", error);
        appContent.innerHTML = '<p style="text-align: center; color: #FF3B30;">連線異常，請檢查伺服器！</p>';
    }
}

function generateLinkCard(link, subName, subId) {
    let imageHtml = '';
    if (link.image_url) {
        imageHtml = `<img src="${link.image_url}" alt="preview" class="card-thumbnail" referrerpolicy="no-referrer" onerror="this.onerror=null; this.outerHTML='<div class=\\\'card-thumbnail fallback-thumbnail\\\'>🔗</div>';">`;
    } else {
        imageHtml = `<div class="card-thumbnail fallback-thumbnail">🔗</div>`;
    }

    const tagsHtml = (link.tags && link.tags.length > 0)
        ? link.tags.map(t => `<span style="display: inline-flex; align-items: center; font-size: 12px; line-height: 1.4; background-color: #f2f2f7; color: #636366; padding: 0px 6px; border-radius: 4px; font-weight: 500; white-space: nowrap; flex-shrink: 0;">#${t}</span>`).join('')
        : '';

    // 🌟 將該貼文完整資料打包，準備傳給編輯視窗
    const encodedLink = encodeURIComponent(JSON.stringify(link)).replace(/'/g, "%27");

    return `
    <div class="swipe-container filterable-card" data-sub-id="${subId}" data-tags="${(link.tags || []).join(' ')}">
        <!-- 批量模式的勾選框 -->
        <div class="batch-checkbox" onclick="toggleBatchSelect(${link.id}, this)">
            <div class="batch-circle">
                <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </div>
        </div>
        <a href="${link.url}" target="_blank" class="swipe-content link-card memo-style-card" onclick="if(isBatchMode) { event.preventDefault(); toggleBatchSelect(${link.id}, this.previousElementSibling); }">
            <div class="card-text-area">
                <div class="card-title">${link.title}</div>
                
                <div style="display: flex; align-items: center; gap: 6px; margin-top: 6px; overflow: hidden; width: 100%;">
                    <div class="card-source" style="margin: 0; font-size: 12px; line-height: 1.4; color: #8e8e93; white-space: nowrap; flex-shrink: 0; display: inline-flex; align-items: center;">${link.source}</div>
                    ${tagsHtml}
                </div>
            </div>
            <div class="card-image-area">
                ${imageHtml}
            </div>
        </a>
        <div class="swipe-actions">
            <button class="action-btn edit-btn" onclick="openEditModal('${encodedLink}')">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                </svg>
            </button>
            <button class="action-btn delete-btn" onclick="deleteLink(${link.id}, this)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        </div>
    </div>`;
}

function filterLinks(clickedChip, targetSubId) {
    // 🌟 更新大腦記憶：記住目前點擊的標籤
    activeFilterSubId = targetSubId;

    const container = clickedChip.parentElement;
    container.querySelectorAll('.filter-chip').forEach(chip => chip.classList.remove('active'));
    clickedChip.classList.add('active');

    const wrapper = container.nextElementSibling;
    const cards = wrapper.querySelectorAll('.filterable-card');

    cards.forEach(card => {
        card.scrollLeft = 0;
        if (targetSubId === 'all') {
            card.style.display = 'flex';
        } else {
            if (card.getAttribute('data-sub-id') === String(targetSubId)) {
                card.style.display = 'flex';
            } else {
                card.style.display = 'none';
            }
        }
    });
}

function toggleAccordion(clickedHeader) {
    const content = clickedHeader.nextElementSibling;
    const arrow = clickedHeader.querySelector('.arrow-icon');
    const catName = clickedHeader.querySelector('span').innerText;

    resetAllSwipes();

    const allHeaders = document.querySelectorAll('.accordion-header');
    allHeaders.forEach(header => {
        if (header !== clickedHeader) {
            header.nextElementSibling.style.display = 'none';
            header.querySelector('.arrow-icon').style.transform = 'rotate(0deg)';
        }
    });

    if (content.style.display === 'block') {
        content.style.display = 'none';
        arrow.style.transform = 'rotate(0deg)';
        // 🌟 更新大腦記憶：收合時清空記憶
        openCategoryName = null;
    } else {
        content.style.display = 'block';
        arrow.style.transform = 'rotate(180deg)';
        // 🌟 更新大腦記憶：展開時記住分類名稱
        openCategoryName = catName;
        // 切換分類時，把標籤預設歸零，避免視覺錯亂
        activeFilterSubId = 'all';
    }
}


// ================= 新增連結功能 (自動解析版) =================

let cachedCategoriesData = [];
let currentPreviewImage = '';

// ================= 自動辨識社群平台 =================
function autoDetectPlatform(url) {
    const sourceSelect = document.getElementById('new-source');
    if (!sourceSelect || !url) return;

    try {
        // 利用瀏覽器內建的 URL 物件解析網域，並轉為小寫避免大小寫錯誤
        const hostname = new URL(url).hostname.toLowerCase();

        if (hostname.includes('threads.net') || hostname.includes('threads.com')) {
            sourceSelect.value = 'Threads';
        } else if (hostname.includes('instagram.com')) {
            sourceSelect.value = 'Instagram';
        } else if (hostname.includes('facebook.com')) {
            sourceSelect.value = 'Facebook';
        } else {
            sourceSelect.value = '其他';
        }
    } catch (error) {
        // 若輸入的不是標準網址（例如還在打字），就不做任何動作
    }
}

async function fetchUrlPreview() {
    const urlInput = document.getElementById('new-url').value;
    const titleInput = document.getElementById('new-title');
    const submitBtn = document.querySelector('#add-link-form button[type="submit"]');

    if (!urlInput || !urlInput.startsWith('http')) return;

    const originalPlaceholder = titleInput.placeholder;
    const originalBtnText = submitBtn ? submitBtn.textContent : '儲存連結';

    // 🌟 1. 先把原本已經在手上的標題「和圖片」記下來！（防洗掉護盾）
    const existingTitle = titleInput.value.trim();
    const existingImage = currentPreviewImage; // 這裡可能已經是書籤順手牽羊抓來的好圖片！

    titleInput.placeholder = "🔄 正在解析網址...";
    if (submitBtn) {
        submitBtn.textContent = "⏳ 抓取縮圖中...";
        submitBtn.style.opacity = '0.7';
        submitBtn.disabled = true;
    }

    try {
        const response = await fetch(`/api/preview?url=${encodeURIComponent(urlInput)}`);

        if (response.ok) {
            const data = await response.json();

            // --- [保護標題] ---
            if (data.title) {
                const isErrorTitle = data.title.includes('無法') || data.title.includes('失敗') || data.title.includes('請手動');
                if (existingTitle && isErrorTitle) {
                    titleInput.value = existingTitle;
                } else if (!isErrorTitle) {
                    titleInput.value = data.title;
                } else if (!existingTitle && isErrorTitle) {
                    titleInput.value = data.title;
                }
                toggleClearBtn();
            }

            // --- [保護圖片 (🌟核心修改)] ---
            // 如果後端有順利抓到新圖片，就用後端的；
            // 如果後端沒抓到 (傳回空值)，但我們手上「本來就有」從書籤抓來的圖片，就堅持用原本的！
            if (data.image && data.image.trim() !== '') {
                currentPreviewImage = data.image;
            } else if (existingImage && existingImage.trim() !== '') {
                currentPreviewImage = existingImage;
            } else {
                currentPreviewImage = '';
            }
        }
    } catch (error) {
        console.error("解析失敗：", error);
        if (existingTitle) titleInput.value = existingTitle;
        if (existingImage) currentPreviewImage = existingImage;
    } finally {
        titleInput.placeholder = originalPlaceholder;
        if (submitBtn) {
            submitBtn.textContent = originalBtnText;
            submitBtn.style.opacity = '1';
            submitBtn.disabled = false;
        }
    }
}

// 🌟 點擊左滑的「編輯」按鈕時觸發
async function openEditModal(encodedLink) {
    const link = JSON.parse(decodeURIComponent(encodedLink));
    editingLinkId = link.id; // 讓系統知道現在是編輯模式
    currentPreviewImage = link.image_url || '';

    // 1. 打開表單並隱藏右下角懸浮按鈕
    document.getElementById('add-modal').style.display = 'flex';
    const fab = document.querySelector('[onclick*="openAddModal"]');
    if (fab) fab.style.display = 'none';

    // 2. 更改按鈕文字與標題
    const submitBtn = document.querySelector('#add-link-form button[type="submit"]');
    if (submitBtn) submitBtn.textContent = '儲存變更';
    const modalTitle = document.querySelector('#add-modal h3');
    if (modalTitle) modalTitle.textContent = '編輯收藏';

    // 3. 填入基本欄位
    document.getElementById('new-url').value = link.url || '';
    document.getElementById('new-title').value = link.title || '';
    document.getElementById('new-source').value = link.source || '其他';
    toggleClearBtn();

    // 4. 同步群組
    const mainSelect = document.getElementById('group-select');
    const modalSelect = document.getElementById('modal-group-select');
    if (mainSelect && modalSelect) {
        modalSelect.innerHTML = mainSelect.innerHTML;
        modalSelect.value = currentGroupId;
    }

    // 🌟 核心：把原本複雜的判斷收攏，直接將「大分類、小分類、標籤」一條龍傳遞下去！
    // 並且強制把 tags 裡面的東西通通變成字串，防止數字 1 遇到字串 "1" 辨識失敗
    const tagsToSelect = Array.isArray(link.tags) ? link.tags.map(String) : [];
    await refreshCategorySelects(link.category_id, link.subcategory_id, tagsToSelect);
}

async function openAddModal() {
    document.getElementById('add-modal').style.display = 'flex';
    document.getElementById('add-link-form').reset();
    currentPreviewImage = '';

    // 🌟 修正：打開視窗時，暫時隱藏右下角的 + 號懸浮按鈕
    const fab = document.querySelector('[onclick*="openAddModal"]');
    if (fab) fab.style.display = 'none';

    const tagsSection = document.getElementById('tags-section');
    if (tagsSection) tagsSection.style.display = 'none';
    selectedTags = [];
    isTagsExpanded = false;

    // 🌟 新增邏輯：複製首頁的群組清單到新增視窗中，並預設選中當前群組
    const mainSelect = document.getElementById('group-select');
    const modalSelect = document.getElementById('modal-group-select');
    if (mainSelect && modalSelect) {
        modalSelect.innerHTML = mainSelect.innerHTML;
        modalSelect.value = currentGroupId;
    }

    await refreshCategorySelects();
}

// 🌟 處理「在新增視窗中」臨時切換群組的動作
async function handleModalGroupChange() {
    const modalSelect = document.getElementById('modal-group-select');
    const newGroupId = modalSelect.value;

    if (newGroupId !== currentGroupId) {
        // 1. 執行全域的群組切換 (這會一併把新選擇寫入長期記憶)
        switchGroup(newGroupId);

        // 2. 最重要的一步：群組換了，下方的「大分類」選單必須重新載入！
        await refreshCategorySelects();
    }
}

async function refreshCategorySelects(autoSelectCatId = null, autoSelectSubId = null, autoSelectTags = null) {
    const catSelect = document.getElementById('new-category-select');
    const subSelect = document.getElementById('new-subcategory-select');

    catSelect.innerHTML = '<option value="" disabled selected>載入中...</option>';
    subSelect.style.display = 'none';
    subSelect.innerHTML = '';

    try {
        // 🌟 修正：改用相對路徑
        const response = await fetch('/api/categories');
        cachedCategoriesData = await response.json();

        catSelect.innerHTML = '<option value="" disabled selected>選擇大分類</option>';
        cachedCategoriesData.forEach(cat => {
            const catName = cat.name || cat.categoryName;
            catSelect.innerHTML += `<option value="${cat.id}">📁 ${catName}</option>`;
        });

        catSelect.innerHTML += `<option value="ADD_NEW_CAT" style="color: #007AFF; font-weight: bold;">新增大分類...</option>`;

        if (autoSelectCatId) {
            catSelect.value = autoSelectCatId;
            await handleCategoryChange(autoSelectSubId, autoSelectTags);
        }
    } catch (error) {
        catSelect.innerHTML = '<option value="" disabled>載入失敗</option>';
    }
}

async function handleCategoryChange(autoSelectSubId = null, autoSelectTags = null) {
    const catSelect = document.getElementById('new-category-select');
    const subSelect = document.getElementById('new-subcategory-select');
    const catId = catSelect.value;

    const tagsSection = document.getElementById('tags-section');
    if (tagsSection) tagsSection.style.display = 'none';
    selectedTags = [];

    if (catId === "ADD_NEW_CAT") {
        catSelect.value = "";
        // 隱藏小分類，直到大分類建立完成
        subSelect.style.display = 'none';
        const name = prompt("請輸入新的「大分類」名稱：");
        if (!name) return;

        // 🌟 修正：改用相對路徑
        const res = await fetch('/api/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
        });
        const data = await res.json();

        if (res.ok) {
            await refreshCategorySelects(data.id);
            fetchAndRenderApp();
        }
        return;
    }

    const selectedCat = cachedCategoriesData.find(c => c.id == catId);
    if (!selectedCat) {
        subSelect.style.display = 'none';
        return;
    }

    // 🌟 核心魔法：大分類選擇成功，把小分類選單顯示出來！
    subSelect.style.display = 'block';
    const catName = selectedCat.name || selectedCat.categoryName;
    subSelect.innerHTML = `<option value="DIRECT" selected>📥 直接儲存在「${catName}」</option>`;

    if (selectedCat.subcategories && selectedCat.subcategories.length > 0) {
        selectedCat.subcategories.forEach(sub => {
            subSelect.innerHTML += `<option value="${sub.id}">↳ ${sub.name}</option>`;
        });
    }

    subSelect.innerHTML += `<option value="ADD_NEW_SUB" style="color: #007AFF; font-weight: bold;">➕ 新增小分類...</option>`;

    // 🌟 讓小分類與標籤順利接力往下傳
    if (autoSelectSubId) {
        subSelect.value = autoSelectSubId;
        await handleSubcategoryChange(autoSelectTags);
    } else if (autoSelectTags && Array.isArray(autoSelectTags)) {
        // 若該筆資料沒有小分類(DIRECT)，雖然隱藏標籤庫，但必須把標籤先偷偷記在記憶體中
        selectedTags = autoSelectTags.map(String);
    }
}

// 處理小分類切換與載入推薦標籤 (免疫快取升級版)
async function handleSubcategoryChange(preSelectedTags = null) {
    const catSelect = document.getElementById('new-category-select');
    const subSelect = document.getElementById('new-subcategory-select');

    if (subSelect.value === "ADD_NEW_SUB") {
        subSelect.value = "DIRECT";
        const name = prompt("請輸入新的「小分類」名稱：");
        if (!name) return;

        const catId = catSelect.value;
        const res = await fetch(`/api/categories/${catId}/subcategories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
        });
        const data = await res.json();

        if (res.ok) {
            await refreshCategorySelects(catId, data.id);
            if (typeof fetchAndRenderApp === 'function') fetchAndRenderApp();
        }
        return;
    }

    const selectedSubId = subSelect.value;

    // 防呆檢查：過濾掉 HTML 傳進來的滑鼠點擊事件 (Event Object)
    const isArray = Array.isArray(preSelectedTags);

    if (selectedSubId === "DIRECT" || selectedSubId === "") {
        document.getElementById('tags-section').style.display = 'none';
        selectedTags = isArray ? preSelectedTags.map(String) : [];
        return;
    }

    try {
        const response = await fetch(`/api/get_tags?subcategory_id=${selectedSubId}&_t=${Date.now()}`);
        currentAvailableTags = await response.json();
    } catch (error) {
        console.error("載入推薦標籤失敗:", error);
        currentAvailableTags = [];
    }

    // 🌟 終極防護：確保轉型為字串，並精準賦值
    selectedTags = isArray ? preSelectedTags.map(String) : [];

    if (isArray) {
        selectedTags.forEach(tag => {
            if (!currentAvailableTags.includes(tag)) {
                currentAvailableTags.unshift(tag);
            }
        });
    }

    isTagsExpanded = false;
    document.getElementById('tags-section').style.display = 'block';
    renderTagChips();
}

function closeAddModal() {
    document.getElementById('add-modal').style.display = 'none';
    document.getElementById('add-link-form').reset();

    // 🌟 修正：關閉視窗時，讓右下角的 + 號懸浮按鈕恢復顯示
    const fab = document.querySelector('[onclick*="openAddModal"]');
    if (fab) fab.style.display = '';

    const tagsSection = document.getElementById('tags-section');
    if (tagsSection) tagsSection.style.display = 'none';
    selectedTags = [];

    editingLinkId = null; // 重置編輯模式
}

async function submitNewLink(event) {
    event.preventDefault();

    const title = document.getElementById('new-title').value;
    const url = document.getElementById('new-url').value;
    const source = document.getElementById('new-source').value || '未提供';

    const catSelect = document.getElementById('new-category-select');
    const subSelect = document.getElementById('new-subcategory-select');

    if (!catSelect.value || catSelect.value === "ADD_NEW_CAT") {
        return alert('請先選擇一個大分類！');
    }

    const categoryId = parseInt(catSelect.value);
    let subcategoryId = null;

    if (subSelect.value !== "DIRECT" && subSelect.value !== "ADD_NEW_SUB" && subSelect.value !== "") {
        subcategoryId = parseInt(subSelect.value);
    }

    try {
        // 🌟 聰明切換：根據記憶體決定是 新增(POST) 還是 更新(PUT)
        const method = editingLinkId ? 'PUT' : 'POST';
        const endpoint = editingLinkId ? `/api/links/${editingLinkId}` : '/api/links';

        const response = await fetch(endpoint, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: title,
                url: url,
                source: source,
                image_url: currentPreviewImage,
                category_id: categoryId,
                subcategory_id: subcategoryId,
                tags: selectedTags
            })
        });

        if (response.ok) {
            const selectedCatName = catSelect.options[catSelect.selectedIndex].text.replace('📁 ', '');
            openCategoryName = `📁 ${selectedCatName}`;
            if (subcategoryId) {
                activeFilterSubId = String(subcategoryId);
            } else {
                activeFilterSubId = 'none';
            }

            closeAddModal();
            fetchAndRenderApp();
        } else {
            alert('儲存失敗，請檢查網路連線。');
        }
    } catch (error) {
        alert('連線錯誤，請確認 Flask 伺服器是否運作中。');
    }
}

// ================= 刪除連結功能 =================
async function deleteLink(linkId, btnElement) {
    if (!confirm("確定要刪除這個收藏嗎？")) return;

    try {
        // 🌟 修正：改用相對路徑
        const response = await fetch(`/api/links/${linkId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            const card = btnElement.closest('.swipe-container');

            card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            card.style.opacity = '0';
            card.style.transform = 'translateX(-30px)';

            setTimeout(() => {
                card.remove();
            }, 300);
        } else {
            const res = await response.json();
            alert("刪除失敗：" + (res.error || "未知錯誤"));
        }
    } catch (error) {
        console.error("刪除發生錯誤：", error);
        alert("連線異常，請確認伺服器是否運作中。");
    }
}

// ================= 讓電腦滑鼠也能「拖曳滑動」 =================
function enableDragScroll() {
    const sliders = document.querySelectorAll('.swipe-container');

    sliders.forEach(slider => {
        let isDown = false;
        let startX;
        let scrollLeft;
        let isDragging = false;

        const closeOtherSliders = () => {
            sliders.forEach(other => {
                if (other !== slider && other.scrollLeft > 0) {
                    other.style.scrollSnapType = 'none';
                    other.style.scrollBehavior = 'smooth';
                    other.scrollLeft = 0;

                    setTimeout(() => {
                        other.style.scrollSnapType = 'x mandatory';
                    }, 300);
                }
            });
        };

        slider.addEventListener('mousedown', (e) => {
            if (isBatchMode) return;
            closeOtherSliders();
            isDown = true;
            isDragging = false;
            slider.style.scrollSnapType = 'none';
            slider.style.scrollBehavior = 'auto';
            startX = e.pageX - slider.offsetLeft;
            slider.scrollLeft;
            scrollLeft = slider.scrollLeft;
        });

        slider.addEventListener('touchstart', () => {
            if (isBatchMode) return;
            closeOtherSliders();
        }, { passive: true });

        slider.addEventListener('mouseleave', () => {
            if (isDown) smoothSnap(slider);
            isDown = false;
        });

        slider.addEventListener('mouseup', () => {
            if (isDown) smoothSnap(slider);
            isDown = false;
        });

        slider.addEventListener('mousemove', (e) => {
            if (isBatchMode) return;
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - slider.offsetLeft;
            const walk = (x - startX);
            if (Math.abs(walk) > 5) {
                isDragging = true;
            }
            slider.scrollLeft = scrollLeft - walk;
        });

        const link = slider.querySelector('a.swipe-content');
        if (link) {
            link.addEventListener('click', (e) => {
                if (isDragging) {
                    e.preventDefault();
                }
            });
        }
    });

    function smoothSnap(slider) {
        slider.style.scrollBehavior = 'smooth';

        if (slider.scrollLeft > 35) {
            slider.scrollLeft = 140;
        } else {
            slider.scrollLeft = 0;
        }

        setTimeout(() => {
            slider.style.scrollSnapType = 'x mandatory';
        }, 300);
    }
}

function resetAllSwipes() {
    const sliders = document.querySelectorAll('.swipe-container');
    sliders.forEach(slider => {
        if (slider.scrollLeft > 0) {
            slider.style.scrollSnapType = 'none';
            slider.style.scrollBehavior = 'auto';
            slider.scrollLeft = 0;

            setTimeout(() => {
                slider.style.scrollBehavior = 'smooth';
            }, 50);
        }
    });
}

// ================= 分類管理系統 =================

async function openCategoryModal() {
    document.getElementById('category-modal').style.display = 'flex';

    // 🌟 修正：打開分類管理時，一樣暫時隱藏 + 號懸浮按鈕
    const fab = document.querySelector('[onclick*="openAddModal"]');
    if (fab) fab.style.display = 'none';

    await renderCategoryEditList();
}

function closeCategoryModal() {
    document.getElementById('category-modal').style.display = 'none';

    // 🌟 修正：關閉分類管理時，讓 + 號懸浮按鈕恢復顯示
    const fab = document.querySelector('[onclick*="openAddModal"]');
    if (fab) fab.style.display = '';

    fetchAndRenderApp();
}

async function renderCategoryEditList() {
    const listContainer = document.getElementById('category-edit-list');
    listContainer.innerHTML = '<p style="text-align: center;">載入中...</p>';

    try {
        const response = await fetch('/api/categories');
        const categories = await response.json();

        if (categories.length === 0) {
            listContainer.innerHTML = '<p style="text-align: center; color: #8e8e93;">目前沒有任何分類</p>';
            return;
        }

        let html = '';
        categories.forEach(cat => {
            const catName = cat.name || cat.categoryName || "未命名大分類";

            html += `
            <div style="background: #ffffff; border: 1px solid #e5e5ea; padding: 12px 14px; border-radius: 12px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
                
                <!-- 大分類頂部 -->
                <div class="edit-list-item" style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid #f2f2f7;">
                    <div class="edit-item-name" style="font-size: 16px; font-weight: 600; color: #1c1c1e; display: flex; align-items: center; gap: 8px;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#007AFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                        </svg>
                        <span>${catName}</span>
                    </div>
                    <!-- 加上 flex-shrink: 0 與 white-space: nowrap 防擠壓 -->
                    <div class="action-btns" style="display: flex; gap: 12px; flex-shrink: 0; white-space: nowrap;">
                        <span onclick="renameItem('category', ${cat.id}, '${cat.name}')" style="color: #007AFF; font-size: 14px; cursor: pointer;">編輯</span>
                        <span onclick="deleteCategoryItem('category', ${cat.id})" style="color: #FF3B30; font-size: 14px; cursor: pointer;">刪除</span>
                    </div>
                </div>

                <!-- 小分類列表 -->
                <div class="sub-edit-list" style="padding-top: 8px;">
            `;

            if (cat.subcategories && cat.subcategories.length > 0) {
                cat.subcategories.forEach(sub => {
                    // 縮減左側縮排至 12px，釋放手機橫向寬度
                    html += `
                    <div class="sub-edit-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0 8px 12px;">
                        <div class="sub-item-name" style="color: #48484a; font-size: 14px; display: flex; align-items: center; gap: 8px;">
                            <span style="width: 5px; height: 5px; background: #c7c7cc; border-radius: 50%; flex-shrink: 0;"></span>
                            <span>${sub.name}</span>
                        </div>
                        <div class="action-btns" style="display: flex; gap: 12px; flex-shrink: 0; white-space: nowrap;">
                            <span onclick="renameItem('subcategory', ${sub.id}, '${sub.name}')" style="color: #007AFF; font-size: 14px; cursor: pointer;">編輯</span>
                            <span onclick="deleteCategoryItem('subcategory', ${sub.id})" style="color: #FF3B30; font-size: 14px; cursor: pointer;">刪除</span>
                        </div>
                    </div>
                    `;
                });
            }

            // 新增小分類的輸入框區域：縮減左側縮排至 12px，並對按鈕加上防換行保護
            html += `
                    <div style="margin-top: 12px; display: flex; gap: 8px; padding-left: 12px;">
                        <input type="text" id="new-sub-input-${cat.id}" placeholder="新增小分類..." style="flex: 1; min-width: 0; padding: 8px 10px; border-radius: 8px; border: 1px solid #e5e5ea; font-size: 14px; background: #fafafa; outline: none;">
                        <button onclick="submitNewSubcategory(${cat.id})" style="background: #f2f2f7; color: #007AFF; font-weight: 600; border: none; border-radius: 8px; padding: 0 12px; font-size: 14px; cursor: pointer; white-space: nowrap; flex-shrink: 0;">+ 加入</button>
                    </div>
                </div>
            </div>
            `;
        });

        listContainer.innerHTML = html;

    } catch (error) {
        console.error("載入分類失敗：", error);
        listContainer.innerHTML = '<p style="color: red; text-align: center;">載入失敗</p>';
    }
}

async function submitNewCategory() {
    const inputEl = document.getElementById('new-category-input');
    const name = inputEl.value.trim();
    if (!name) return alert("請輸入名稱");

    // 🌟 修正：改用相對路徑
    await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name })
    });
    inputEl.value = '';
    renderCategoryEditList();
}

async function submitNewSubcategory(categoryId) {
    const inputEl = document.getElementById(`new-sub-input-${categoryId}`);
    const name = inputEl.value.trim();
    if (!name) return alert("請輸入名稱");

    // 🌟 修正：改用相對路徑
    await fetch(`/api/categories/${categoryId}/subcategories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name })
    });
    renderCategoryEditList();
}

async function renameItem(type, id, oldName) {
    const newName = prompt("請輸入新的名稱：", oldName);
    if (!newName || newName === oldName) return;

    // 🌟 修正：改用相對路徑
    await fetch('/api/rename', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id, new_name: newName })
    });
    renderCategoryEditList();
}

async function deleteCategoryItem(type, id) {
    const msg = type === 'category' ? "⚠️ 警告：這將會刪除該分類下的「所有小分類與連結」！確定嗎？" : "確定要刪除這個小分類嗎？";
    if (!confirm(msg)) return;

    // 🌟 修正：改用相對路徑
    await fetch('/api/delete_category', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id })
    });

    // 如果刪除的是大分類，清空記憶以防系統去找不存在的標籤
    if (type === 'category') {
        openCategoryName = null;
        activeFilterSubId = 'all';
    }

    renderCategoryEditList();
}

// ================= 側邊選單開關控制 =================
function toggleSideMenu() {
    const menu = document.getElementById('side-menu');
    const overlay = document.getElementById('menu-overlay');

    if (menu && overlay) {
        // toggle 代表：有這個 class 就拔掉，沒有就加上去
        menu.classList.toggle('active');
        overlay.classList.toggle('active');
    }
}

// ================= 系統初始化大腦 (攔截邀請碼、登入、手機分享) =================

// 🌟 全域變數：用來暫存捷徑分享過來的網址，讓它能跨越登入畫面存活
let pendingSharedUrl = null;
let pendingSharedTitle = null;

window.addEventListener('DOMContentLoaded', async () => {
    // 1. 綁定「手動輸入/貼上網址」時的自動辨識事件
    const urlField = document.getElementById('new-url');
    if (urlField) {
        urlField.addEventListener('input', (e) => autoDetectPlatform(e.target.value));
        urlField.addEventListener('blur', fetchUrlPreview);
    }

    // 2. 解析目前網址的參數
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    // 如果有邀請碼，優先執行加入群組邏輯
    if (token) {
        joinGroupByToken(token);
        return;
    }

    // 3. 攔截手機捷徑或 PWA 分享過來的資料
    const sharedTitle = urlParams.get('title');
    const sharedText = urlParams.get('text');
    const sharedUrl = urlParams.get('url');

    let targetUrl = sharedUrl;
    if (!targetUrl && sharedText) {
        const urlMatch = sharedText.match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
            targetUrl = urlMatch[0];
        }
    }

    // 如果真的有收到分享的網址，先把它存起來，並清理網址列
    if (targetUrl) {
        pendingSharedUrl = targetUrl;
        pendingSharedTitle = sharedTitle;
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // 4. 檢查登入狀態並進行後端驗證
    const savedUser = localStorage.getItem('saved_username');
    if (savedUser) {
        try {
            // 🌟 修正：改用相對路徑，拿著記憶中的帳號向後端發送驗證請求
            const response = await fetch('/api/auth/verify');

            if (response.ok) {
                // 🌟 後端驗證成功，絲滑通關顯示主畫面
                await showAppView(savedUser);

                // 如果剛剛有攔截到分享的網址，立刻自動彈出新增視窗
                if (pendingSharedUrl) {
                    triggerAutoAddModal(pendingSharedUrl, pendingSharedTitle);
                }
            } else {
                // 🛑 驗證失敗 (例如帳號被刪除或造假)，清除無效記憶，留在登入畫面
                console.warn("登入狀態已失效，請重新登入");
                localStorage.removeItem('saved_username');
            }
        } catch (error) {
            console.error("驗證伺服器連線失敗：", error);
            // 如果只是網路不穩連不上，為了使用者體驗，暫時先讓他看到主畫面
            await showAppView(savedUser);
        }
    }
});

async function triggerAutoAddModal(url, title) {
    await openAddModal(); // 這裡面已經幫忙處理好群組選單拷貝了

    const urlInput = document.getElementById('new-url');
    const titleInput = document.getElementById('new-title');

    if (urlInput) urlInput.value = url;
    if (titleInput && title) titleInput.value = title;

    const urlParams = new URLSearchParams(window.location.search);
    const imgParam = urlParams.get('img');
    if (imgParam) {
        currentPreviewImage = imgParam;
    }

    autoDetectPlatform(url);
    fetchUrlPreview();

    // 填寫完畢後清空暫存，避免重複觸發
    pendingSharedUrl = null;
    pendingSharedTitle = null;
}

// 顯示/隱藏標題的清除按鈕
function toggleClearBtn() {
    const titleInput = document.getElementById('new-title');
    const clearBtn = document.getElementById('clear-title-btn');
    if (titleInput && clearBtn) {
        // 如果有文字就顯示 (flex)，沒文字就隱藏 (none)
        clearBtn.style.display = titleInput.value.length > 0 ? 'flex' : 'none';
    }
}

// 點擊叉叉時：清除內容並重新對焦
function clearTitleInput() {
    const titleInput = document.getElementById('new-title');
    titleInput.value = '';
    toggleClearBtn(); // 清除後隱藏按鈕
    titleInput.focus(); // 🌟 貼心設計：讓手機小鍵盤自動彈出，準備輸入
}

// ================= 標籤系統管理 (增強長按與右鍵編輯功能) =================
let currentAvailableTags = []; // 目前後端傳回來的這個分類的所有標籤
let selectedTags = [];         // 使用者目前點擊選中的標籤
let isTagsExpanded = false;    // 記錄目前是否為「展開」狀態

// 1. 渲染標籤畫面的核心函式
function renderTagChips() {
    const container = document.getElementById('tags-container');
    if (!container) return;
    container.innerHTML = '';

    const limit = (!isTagsExpanded && currentAvailableTags.length > 4) ? 4 : currentAvailableTags.length;
    const tagsToShow = currentAvailableTags.slice(0, limit);

    tagsToShow.forEach(tag => {
        const chip = document.createElement('div');
        chip.className = `tag-chip ${selectedTags.includes(tag) ? 'active' : ''}`;
        chip.textContent = tag;

        // 加上 CSS 防護，避免長按時手機選取文字
        chip.style.userSelect = 'none';
        chip.style.webkitUserSelect = 'none';

        let pressTimer = null;
        let isLongPress = false;

        // 【手機觸控】長按 0.6 秒觸發
        chip.addEventListener('touchstart', (e) => {
            isLongPress = false;
            pressTimer = setTimeout(() => {
                isLongPress = true;
                showTagActionMenu(tag); // 🌟 達到 0.6 秒，彈出專屬管理選單！
            }, 600);
        }, { passive: true });

        chip.addEventListener('touchend', () => clearTimeout(pressTimer));
        chip.addEventListener('touchmove', () => clearTimeout(pressTimer));

        // 【電腦滑鼠】右鍵點擊立即觸發
        chip.addEventListener('contextmenu', (e) => {
            e.preventDefault(); // 🌟 成功攔截！阻止 Chrome 系統右鍵選單跳出來！
            showTagActionMenu(tag);
        });

        // 【一般點擊】
        chip.onclick = (e) => {
            if (isLongPress) {
                e.preventDefault();
                return;
            }
            toggleTagSelection(tag);
        };

        container.appendChild(chip);
    });

    if (currentAvailableTags.length > 4) {
        const moreBtn = document.createElement('div');
        moreBtn.className = 'tag-chip action-btn';
        moreBtn.textContent = isTagsExpanded ? '收起' : `⋯ 更多 (${currentAvailableTags.length - 4})`;
        moreBtn.onclick = () => {
            isTagsExpanded = !isTagsExpanded;
            renderTagChips();
        };
        container.appendChild(moreBtn);
    }

    const addBtn = document.createElement('div');
    addBtn.className = 'tag-chip action-btn';
    addBtn.textContent = '+ 新增';
    addBtn.onclick = handleAddNewTagInline;
    container.appendChild(addBtn);
}

// 全新升級：簡約現代感、去除 emoji 的「標籤管理小彈窗」
function showTagActionMenu(targetTag) {
    // 先移除畫面上有可能殘留的舊選單
    let oldModal = document.getElementById('tag-action-modal');
    if (oldModal) oldModal.remove();

    // 建立半透明背景與置中卡片 (加入毛玻璃模糊效果提升質感)
    const modal = document.createElement('div');
    modal.id = 'tag-action-modal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0, 0, 0, 0.35); backdrop-filter: blur(4px);
        display: flex; justify-content: center; align-items: center; z-index: 99999;
    `;

    modal.innerHTML = `
        <div style="background: #ffffff; padding: 22px 20px 16px 20px; border-radius: 16px; width: 80%; max-width: 280px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.15); border: 1px solid rgba(0,0,0,0.05);">
            <div style="font-size: 15px; font-weight: 600; color: #1c1c1e; margin-bottom: 18px; letter-spacing: 0.3px;">
                #${targetTag}
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <button id="btn-rename-tag" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: #f2f2f7; color: #007AFF; border: none; padding: 12px; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                    </svg>
                    <span>重新命名</span>
                </button>
                <button id="btn-delete-tag" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: #fff0f0; color: #FF3B30; border: none; padding: 12px; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 6h18"></path>
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                    </svg>
                    <span>永久刪除</span>
                </button>
                <button id="btn-cancel-tag" style="background: transparent; color: #8e8e93; border: none; padding: 10px; border-radius: 10px; font-size: 14px; cursor: pointer; margin-top: 2px;">取消</button>
            </div>
        </div>
    `;

    // 點擊半透明背景也可以直接安全關閉
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);

    // 綁定三個按鈕的安全事件
    document.getElementById('btn-cancel-tag').onclick = () => modal.remove();

    document.getElementById('btn-rename-tag').onclick = async () => {
        modal.remove();
        await executeRenameTag(targetTag);
    };

    document.getElementById('btn-delete-tag').onclick = async () => {
        modal.remove();
        await executeDeleteTag(targetTag);
    };
}

// 執行重新命名 (防假警報升級版)
async function executeRenameTag(targetTag) {
    const newName = prompt(`請輸入「#${targetTag}」的新名稱：`, targetTag);
    if (!newName || newName.trim() === '' || newName.trim() === targetTag) return;

    const cleanNewName = newName.trim();
    try {
        const res = await fetch('/api/tags', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_name: targetTag, new_name: cleanNewName })
        });

        // 🌟 防呆防護罩：安全解析 JSON，避免因為回應格式細節觸發當機
        let data = {};
        try {
            data = await res.json();
        } catch (e) {
            console.warn("回傳內容非標準 JSON，但不影響主要功能", e);
        }

        if (res.ok) {
            // 成功：更新記憶體並重繪畫面
            currentAvailableTags = currentAvailableTags.map(t => t === targetTag ? cleanNewName : t);
            selectedTags = selectedTags.map(t => t === targetTag ? cleanNewName : t);
            renderTagChips();
            if (typeof fetchAndRenderApp === 'function') fetchAndRenderApp();
        } else {
            alert('修改失敗：' + (data.error || `伺服器狀態碼 ${res.status}`));
        }
    } catch (error) {
        console.error("重新命名發生例外錯誤：", error);
        // 🌟 真實顯影：如果真的出錯，顯示真實錯誤原因，不再盲目報連線失敗
        alert(`執行時發生例外：${error.message || error}`);
    }
}

// 執行刪除 (防假警報升級版)
async function executeDeleteTag(targetTag) {
    if (!confirm(`⚠️ 確定要永久刪除「#${targetTag}」嗎？\n\n這會從所有收藏卡片上移除這個標籤！`)) return;

    try {
        const res = await fetch('/api/tags', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag_name: targetTag })
        });

        let data = {};
        try {
            data = await res.json();
        } catch (e) {
            console.warn("回傳內容非標準 JSON，但不影響主要功能", e);
        }

        if (res.ok) {
            currentAvailableTags = currentAvailableTags.filter(t => t !== targetTag);
            selectedTags = selectedTags.filter(t => t !== targetTag);
            renderTagChips();
            if (typeof fetchAndRenderApp === 'function') fetchAndRenderApp();
        } else {
            alert('刪除失敗：' + (data.error || `伺服器狀態碼 ${res.status}`));
        }
    } catch (error) {
        console.error("刪除標籤發生例外錯誤：", error);
        alert(`執行時發生例外：${error.message || error}`);
    }
}

// 標籤選取功能
function toggleTagSelection(tag) {
    if (selectedTags.includes(tag)) {
        // 如果已經選了，就移出陣列 (取消選取)
        selectedTags = selectedTags.filter(t => t !== tag);
    } else {
        // 如果還沒選，就加進陣列 (變成選中)
        selectedTags.push(tag);
    }
    renderTagChips(); // 重新渲染畫面以更新藍色外觀
}

// 直接在標籤區塊內新增標籤，無需跳出彈窗
function handleAddNewTagInline() {
    const newTag = prompt('請輸入新標籤名稱：');
    if (newTag && newTag.trim() !== '') {
        const cleanTag = newTag.trim();
        // 如果標籤庫還沒有這個字，加到最前面
        if (!currentAvailableTags.includes(cleanTag)) {
            currentAvailableTags.unshift(cleanTag);
        }
        // 自動幫使用者預設選中這個新打的標籤
        if (!selectedTags.includes(cleanTag)) {
            selectedTags.push(cleanTag);
        }
        renderTagChips();
    }
}

// ================= 批量管理系統 (Batch Mode) =================
let selectedBatchLinks = []; // 記憶勾選了哪些 ID

function toggleBatchMode() {
    isBatchMode = !isBatchMode;
    const body = document.body;

    if (isBatchMode) {
        const sliders = document.querySelectorAll('.swipe-container');
        sliders.forEach(slider => {
            slider.style.scrollSnapType = 'none';
            slider.style.scrollBehavior = 'auto'; // 設定 auto 代表「瞬間移動」，不播滑動動畫
            slider.scrollLeft = 0;
        });

        body.classList.add('batch-mode-active');
        selectedBatchLinks = []; // 清空選取狀態
        updateBatchToolbar();

        // 隱藏右下角新增按鈕
        const fab = document.querySelector('[onclick*="openAddModal"]');
        if (fab) fab.style.display = 'none';
    } else {
        body.classList.remove('batch-mode-active');
        selectedBatchLinks = [];

        // 拔除所有卡片的發亮狀態
        document.querySelectorAll('.batch-checkbox.selected').forEach(el => el.classList.remove('selected'));

        // 恢復新增按鈕
        const fab = document.querySelector('[onclick*="openAddModal"]');
        if (fab) fab.style.display = '';

        setTimeout(() => {
            const sliders = document.querySelectorAll('.swipe-container');
            sliders.forEach(slider => {
                slider.style.scrollSnapType = 'x mandatory';
                slider.style.scrollBehavior = 'smooth';
            });
        }, 100);
    }
}

// 點擊勾選框或卡片時觸發
function toggleBatchSelect(linkId, element) {
    if (!isBatchMode) return;

    const index = selectedBatchLinks.indexOf(linkId);
    if (index > -1) {
        selectedBatchLinks.splice(index, 1);
        element.classList.remove('selected');
    } else {
        selectedBatchLinks.push(linkId);
        element.classList.add('selected');
    }
    updateBatchToolbar();
}

// 更新底部工具列數字與按鈕狀態
function updateBatchToolbar() {
    const countText = document.getElementById('batch-count-text');
    if (countText) {
        countText.textContent = `已選取 ${selectedBatchLinks.length} 項`;
    }

    const moveBtn = document.getElementById('batch-move-btn');
    const delBtn = document.getElementById('batch-delete-btn');

    // 如果沒選半個，按鈕變灰且不可按
    if (selectedBatchLinks.length > 0) {
        moveBtn.style.opacity = '1';
        delBtn.style.opacity = '1';
        moveBtn.style.pointerEvents = 'auto';
        delBtn.style.pointerEvents = 'auto';
    } else {
        moveBtn.style.opacity = '0.4';
        delBtn.style.opacity = '0.4';
        moveBtn.style.pointerEvents = 'none';
        delBtn.style.pointerEvents = 'none';
    }
}

// ================= 🌟 新增：執行批量刪除 =================
async function executeBatchDelete() {
    // 防呆：如果沒選半個就不動作
    if (selectedBatchLinks.length === 0) return;

    // 再次確認，避免誤觸
    if (!confirm(`⚠️ 確定要永久刪除這 ${selectedBatchLinks.length} 個收藏嗎？\n此動作無法復原！`)) {
        return;
    }

    try {
        const response = await fetch('/api/links/batch', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            // 將我們記憶體中的 ID 陣列打包送出
            body: JSON.stringify({ link_ids: selectedBatchLinks })
        });

        if (response.ok) {
            // 刪除成功：退出批量模式，這會自動幫我們把畫面恢復原狀
            toggleBatchMode();
            // 雖然有 WebSocket 廣播，但為了確保本地端立刻反應，直接手動重繪一次
            if (typeof fetchAndRenderApp === 'function') fetchAndRenderApp();
        } else {
            const data = await response.json();
            alert("刪除失敗：" + (data.error || "未知錯誤"));
        }
    } catch (error) {
        console.error("批量刪除發生錯誤：", error);
        alert("連線異常，請確認伺服器是否運作中。");
    }
}

// ================= 🌟 新增：批量搬移邏輯 =================

// 1. 打開搬移視窗並載入選單
async function openBatchMoveModal() {
    if (selectedBatchLinks.length === 0) return;

    document.getElementById('batch-move-modal').style.display = 'flex';
    const catSelect = document.getElementById('batch-move-category');
    const subSelect = document.getElementById('batch-move-subcategory');

    catSelect.innerHTML = '<option value="" disabled selected>選擇目標大分類...</option>';
    subSelect.style.display = 'none';
    subSelect.innerHTML = '';

    try {
        const response = await fetch('/api/categories');
        const categories = await response.json();

        categories.forEach(cat => {
            const catName = cat.name || cat.categoryName;
            catSelect.innerHTML += `<option value="${cat.id}">${catName}</option>`;
        });
    } catch (error) {
        console.error("載入分類失敗:", error);
    }
}

// 2. 關閉搬移視窗
function closeBatchMoveModal() {
    document.getElementById('batch-move-modal').style.display = 'none';
}

// 3. 連動小分類的切換
async function handleBatchMoveCategoryChange() {
    const catId = document.getElementById('batch-move-category').value;
    const subSelect = document.getElementById('batch-move-subcategory');

    try {
        const response = await fetch('/api/categories');
        const categories = await response.json();
        const selectedCat = categories.find(c => c.id == catId);

        if (selectedCat) {
            subSelect.style.display = 'block';
            const catName = selectedCat.name || selectedCat.categoryName;
            subSelect.innerHTML = `<option value="DIRECT" selected>直接儲存在「${catName}」</option>`;

            if (selectedCat.subcategories && selectedCat.subcategories.length > 0) {
                selectedCat.subcategories.forEach(sub => {
                    subSelect.innerHTML += `<option value="${sub.id}">↳ ${sub.name}</option>`;
                });
            }
        }
    } catch (error) {
        console.error("載入分類失敗:", error);
    }
}

// 4. 點擊確認：發送 API 執行搬移
async function executeBatchMove() {
    const catSelect = document.getElementById('batch-move-category');
    const subSelect = document.getElementById('batch-move-subcategory');

    if (!catSelect.value) {
        return alert("請選擇要搬移到哪一個大分類！");
    }

    const categoryId = parseInt(catSelect.value);
    let subcategoryId = null;

    if (subSelect.value !== "DIRECT" && subSelect.value !== "") {
        subcategoryId = parseInt(subSelect.value);
    }

    try {
        const response = await fetch('/api/links/batch/move', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                link_ids: selectedBatchLinks,
                category_id: categoryId,
                subcategory_id: subcategoryId
            })
        });

        if (response.ok) {
            closeBatchMoveModal();
            toggleBatchMode(); // 🌟 優雅退場：搬完直接退出批量模式，恢復原狀
            if (typeof fetchAndRenderApp === 'function') fetchAndRenderApp();
        } else {
            const data = await response.json();
            alert("搬移失敗：" + (data.error || "未知錯誤"));
        }
    } catch (error) {
        console.error("批量搬移發生錯誤：", error);
        alert("連線異常，請確認伺服器是否運作中。");
    }
}