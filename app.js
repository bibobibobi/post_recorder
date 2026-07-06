// ================= 全域變數與 WebSocket 初始化 =================
let currentGroupId = null;

// 🌟 新增：UI 狀態記憶區 (用來記住目前展開的分類與標籤)
let openCategoryName = null;
let activeFilterSubId = 'all';

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

// 1. 載入使用者的群組清單
async function loadMyGroups() {
    const username = localStorage.getItem('saved_username');
    if (!username) return;

    try {
        // 🌟 修正：改用相對路徑
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

        // 🌟 關鍵邏輯：
        // 1. 如果已經有 currentGroupId (例如從外部分享載入時已設定)，就保持它
        // 2. 如果沒有，才去選第一個群組
        if (currentGroupId) {
            select.value = currentGroupId;
            socket.emit('join_workspace', { group_id: currentGroupId });
        } else if (groups.length > 0) {
            currentGroupId = groups[0].id;
            select.value = currentGroupId;
            socket.emit('join_workspace', { group_id: currentGroupId });
        }

        updateInviteButtonVisibility();
    } catch (error) {
        console.error('載入群組失敗:', error);
    }
}

// 2. 切換群組
function switchGroup(groupId) {
    // 🌟 清空 UI 記憶：因為切換群組了，舊的分類不存在，必須強制收合
    openCategoryName = null;
    activeFilterSubId = 'all';

    if (currentGroupId) {
        socket.emit('leave_workspace', { group_id: currentGroupId });
    }

    currentGroupId = groupId;

    // 🌟 核心修正：強制同步主畫面的下拉選單，讓顯示的文字與實際內容保持一致！
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
    if (currentGroupId) {
        socket.emit('leave_workspace', { group_id: currentGroupId });
    }

    // 🌟 清空 UI 記憶：因為登出了，徹底洗掉記憶
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
                    cardsHtml += generateLinkCard(link, null, 'none');
                });
            }

            if (validSubs.length > 0) {
                validSubs.forEach(sub => {
                    hasAnyLink = true;
                    sub.links.forEach(link => {
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
        // 🌟 核心修正：加上 referrerpolicy="no-referrer" 與 onerror 自動降級保護
        // 1. referrerpolicy="no-referrer" 可以破解各大社群媒體的圖片防盜鏈
        // 2. onerror="..." 確保如果對方伺服器真的徹底封鎖，至少會優雅地換成 🔗 符號，絕對不顯示難看的破圖字樣
        imageHtml = `<img src="${link.image_url}" alt="preview" class="card-thumbnail" referrerpolicy="no-referrer" onerror="this.onerror=null; this.outerHTML='<div class=\\\'card-thumbnail fallback-thumbnail\\\'>🔗</div>';">`;
    } else {
        imageHtml = `<div class="card-thumbnail fallback-thumbnail">🔗</div>`;
    }

    const tagsHtml = (link.tags && link.tags.length > 0)
        ? link.tags.map(t => `<span style="display: inline-flex; align-items: center; font-size: 12px; line-height: 1.4; background-color: #f2f2f7; color: #636366; padding: 0px 6px; border-radius: 4px; font-weight: 500; white-space: nowrap; flex-shrink: 0;">#${t}</span>`).join('')
        : '';

    return `
    <div class="swipe-container filterable-card" data-sub-id="${subId}" data-tags="${(link.tags || []).join(' ')}">
        <a href="${link.url}" target="_blank" class="swipe-content link-card memo-style-card">
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
            <button onclick="deleteLink(${link.id}, this)">刪除</button>
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

    // 🌟 1. 先把原本輸入框裡已經有的標題記下來（例如從書籤小工具帶來的完美標題！）
    const existingTitle = titleInput.value.trim();

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

            if (data.title) {
                // 🌟 2. 核心防護罩：判斷後端抓回來的標題是不是「失敗/錯誤提示」
                const isErrorTitle = data.title.includes('無法') || data.title.includes('失敗') || data.title.includes('請手動');

                if (existingTitle && isErrorTitle) {
                    // 情況 A：我們原本就已經有從書籤抓來的標題，且後端被阻擋傳回錯誤。
                    // 👉 堅持「保留原本的好標題」，千萬不被錯誤訊息洗掉！
                    titleInput.value = existingTitle;
                } else if (!isErrorTitle) {
                    // 情況 B：如果後端順利抓到正常的標題，才進行更新
                    titleInput.value = data.title;
                } else if (!existingTitle && isErrorTitle) {
                    // 情況 C：如果原本欄位是空的（使用者手動貼網址），且後端真的抓不到，才顯示錯誤提示
                    titleInput.value = data.title;
                }
                toggleClearBtn();
            }

            // 縮圖部分不管標題如何，照樣嘗試存入
            currentPreviewImage = data.image || '';
        }
    } catch (error) {
        console.error("解析失敗：", error);
        // 萬一網路斷線或連線出錯，確保原本的好標題還在
        if (existingTitle) titleInput.value = existingTitle;
    } finally {
        titleInput.placeholder = originalPlaceholder;
        if (submitBtn) {
            submitBtn.textContent = originalBtnText;
            submitBtn.style.opacity = '1';
            submitBtn.disabled = false;
        }
    }
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

async function refreshCategorySelects(autoSelectCatId = null, autoSelectSubId = null) {
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
            handleCategoryChange(autoSelectSubId);
        }
    } catch (error) {
        catSelect.innerHTML = '<option value="" disabled>載入失敗</option>';
    }
}

async function handleCategoryChange(autoSelectSubId = null) {
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

    if (autoSelectSubId) {
        subSelect.value = autoSelectSubId;
    }
}

async function handleSubcategoryChange() {
    const catSelect = document.getElementById('new-category-select');
    const subSelect = document.getElementById('new-subcategory-select');

    if (subSelect.value === "ADD_NEW_SUB") {
        subSelect.value = "DIRECT";
        const name = prompt("請輸入新的「小分類」名稱：");
        if (!name) return;

        const catId = catSelect.value;
        // 🌟 修正：改用相對路徑
        const res = await fetch(`/api/categories/${catId}/subcategories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
        });
        const data = await res.json();

        if (res.ok) {
            await refreshCategorySelects(catId, data.id);
            fetchAndRenderApp();
        }
    }

    try {
        // 抓取目前選中的小分類 ID
        const subSelect = document.getElementById('new-subcategory-select');
        const selectedSubId = subSelect.value;

        // 🌟 修正：改用相對路徑，向後端 API 請求該分類的熱門標籤
        const response = await fetch(`/api/get_tags?subcategory_id=${selectedSubId}`);
        currentAvailableTags = await response.json();
    } catch (error) {
        console.error("載入推薦標籤失敗:", error);
        currentAvailableTags = []; // 遇到錯誤時保持空陣列，避免畫面崩潰
    }

    // 清空上次選的紀錄，重置為收合狀態
    selectedTags = [];
    isTagsExpanded = false;

    // 顯示區塊並渲染
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
        // 🌟 修正：改用相對路徑
        const response = await fetch('/api/links', {
            method: 'POST',
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
            // 🌟 自動切換展開剛剛新增的大分類與標籤，讓視覺停留在對的地方
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
            alert('新增失敗，請檢查網路連線。');
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
                    other.style.scrollBehavior = 'smooth';
                    other.scrollLeft = 0;

                    setTimeout(() => {
                        other.style.scrollSnapType = 'x mandatory';
                    }, 300);
                }
            });
        };

        slider.addEventListener('mousedown', (e) => {
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

        if (slider.scrollLeft > 40) {
            slider.scrollLeft = 80;
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

// ================= 標籤系統管理 =================
let currentAvailableTags = []; // 目前後端傳回來的這個分類的所有標籤
let selectedTags = [];         // 使用者目前點擊選中的標籤
let isTagsExpanded = false;    // 記錄目前是否為「展開」狀態

// 1. 渲染標籤畫面的核心函式
function renderTagChips() {
    const container = document.getElementById('tags-container');
    if (!container) return;
    container.innerHTML = '';

    // 決定要顯示幾筆：如果沒展開且總數超過 4 筆，就只切出前 4 筆；否則全顯
    const limit = (!isTagsExpanded && currentAvailableTags.length > 4) ? 4 : currentAvailableTags.length;
    const tagsToShow = currentAvailableTags.slice(0, limit);

    // 產生一般標籤按鈕
    tagsToShow.forEach(tag => {
        const chip = document.createElement('div');
        chip.className = `tag-chip ${selectedTags.includes(tag) ? 'active' : ''}`;
        chip.textContent = tag;
        chip.onclick = () => toggleTagSelection(tag);
        container.appendChild(chip);
    });

    // 產生 [⋯ 更多 / 收起] 按鈕
    if (currentAvailableTags.length > 4) {
        const moreBtn = document.createElement('div');
        moreBtn.className = 'tag-chip action-btn';
        moreBtn.textContent = isTagsExpanded ? '收起' : `⋯ 更多 (${currentAvailableTags.length - 4})`;
        moreBtn.onclick = () => {
            isTagsExpanded = !isTagsExpanded;
            renderTagChips(); // 重新渲染畫面
        };
        container.appendChild(moreBtn);
    }

    // 產生 [+ 新增] 按鈕 (讓使用者隨時可以自己打字建新標籤)
    const addBtn = document.createElement('div');
    addBtn.className = 'tag-chip action-btn';
    addBtn.textContent = '+ 新增';
    addBtn.onclick = handleAddNewTagInline;
    container.appendChild(addBtn);
}

// 2. 處理點擊選取/取消選取
function toggleTagSelection(tag) {
    if (selectedTags.includes(tag)) {
        // 如果已經選了，就移出陣列 (取消選取)
        selectedTags = selectedTags.filter(t => t !== tag);
    } else {
        // 如果還沒選，就加進陣列
        selectedTags.push(tag);
    }
    renderTagChips(); // 重新渲染以更新藍色高亮狀態
}

// 3. 處理現場打字新增標籤
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