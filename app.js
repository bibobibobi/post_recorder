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
        const response = await fetch('http://127.0.0.1:5002/api/groups/join', {
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
        const response = await fetch('http://127.0.0.1:5002/api/my_groups', {
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
        btnInvite.style.display = 'inline-block';
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
        const response = await fetch('http://127.0.0.1:5002/api/groups', {
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
        const response = await fetch(`http://127.0.0.1:5002/api/groups/${currentGroupId}/invite`, {
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
    // 核心邏輯：動態將固定的 localhost 網址替換為目前瀏覽器的實際網域，自動適應本地端與雲端環境
    if (typeof resource === 'string' && resource.includes('127.0.0.1:5002')) {
        resource = resource.replace('http://127.0.0.1:5002', window.location.origin);
    }

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
        const response = await fetch(`http://127.0.0.1:5002${endpoint}`, {
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
// 處理分類搜尋與過濾
function handleCategorySearch() {
    // 1. 取得使用者輸入的文字，並轉成小寫以忽略大小寫差異
    const keyword = document.getElementById('category-search-input').value.toLowerCase();

    // 2. 抓出畫面上所有的手風琴標題 (大分類)
    const headers = document.querySelectorAll('.accordion-header');

    headers.forEach(header => {
        // 抓取該分類的純文字名稱
        const titleText = header.textContent.toLowerCase();

        // 找到緊跟在 header 後面的內容區塊 (小分類與卡片)
        const content = header.nextElementSibling;

        // 3. 比對邏輯
        if (titleText.includes(keyword)) {
            // 如果名稱包含關鍵字，就顯示大分類
            header.style.display = 'flex';
        } else {
            // 如果名稱沒有包含關鍵字，就把大分類隱藏
            header.style.display = 'none';
            // 同時確保它裡面的內容也是收合隱藏的狀態
            if (content && content.classList.contains('accordion-content')) {
                content.style.display = 'none';
            }
        }
    });
}

async function fetchAndRenderApp() {
    const appContent = document.getElementById('app-content');
    appContent.innerHTML = '<p style="text-align: center; margin-top: 50px; color: #8e8e93;">正在載入你的珍藏...</p>';

    try {
        const response = await fetch('http://127.0.0.1:5002/api/categories');
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

            htmlContent += `
                <button class="accordion-header" onclick="toggleAccordion(this)">
                    <span>📁 ${catName}</span>
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

        appContent.innerHTML = htmlContent;

        // 🌟 核心魔法：畫面重新產生後，自動恢復使用者的展開與標籤狀態
        if (openCategoryName) {
            const allHeaders = document.querySelectorAll('.accordion-header');
            allHeaders.forEach(header => {
                const currentCatName = header.querySelector('span').innerText;
                if (currentCatName === openCategoryName) {
                    const content = header.nextElementSibling;
                    const arrow = header.querySelector('.arrow-icon');

                    // 自動展開對應的分類
                    content.style.display = 'block';
                    arrow.style.transform = 'rotate(180deg)';

                    // 如果使用者之前有選擇特定標籤，自動幫他點擊該標籤
                    if (activeFilterSubId !== 'all') {
                        const chips = content.querySelectorAll('.filter-chip');
                        let chipFound = false;
                        chips.forEach(chip => {
                            // 比對 onclick 事件裡面的參數
                            if (chip.getAttribute('onclick').includes(`'${activeFilterSubId}'`)) {
                                chipFound = true;
                                filterLinks(chip, activeFilterSubId);
                            }
                        });
                        // 如果因為小分類被刪除等原因找不到該標籤了，就退回 'all'
                        if (!chipFound) {
                            activeFilterSubId = 'all';
                        }
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
        imageHtml = `<img src="${link.image_url}" alt="preview" class="card-thumbnail">`;
    } else {
        imageHtml = `<div class="card-thumbnail fallback-thumbnail">🔗</div>`;
    }

    return `
    <div class="swipe-container filterable-card" data-sub-id="${subId}">
        <a href="${link.url}" target="_blank" class="swipe-content link-card memo-style-card">
            <div class="card-text-area">
                <div class="card-title">${link.title}</div>
                <div class="card-source">${link.source}</div>
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

    if (!urlInput || !urlInput.startsWith('http')) return;

    const originalPlaceholder = titleInput.placeholder;
    titleInput.placeholder = "🔄 正在自動解析網址...";

    try {
        // 🌟 修改：改為 GET 請求，並將網址透過 Query 參數串接，使用 encodeURIComponent 進行安全編碼
        const response = await fetch(`http://127.0.0.1:5002/api/preview?url=${encodeURIComponent(urlInput)}`);

        if (response.ok) {
            const data = await response.json();

            // 如果後端有成功回傳標題，更新前端輸入框的值
            if (data.title) {
                titleInput.value = data.title;
            }

            // 將後端抓到的縮圖網址，存入你原本就宣告好的全域變數中
            currentPreviewImage = data.image || '';
        }
    } catch (error) {
        console.error("解析失敗：", error);
    } finally {
        titleInput.placeholder = originalPlaceholder;
    }
}

async function openAddModal() {
    document.getElementById('add-modal').style.display = 'flex';
    document.getElementById('add-link-form').reset();
    currentPreviewImage = '';

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
        const response = await fetch('http://127.0.0.1:5002/api/categories');
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

    if (catId === "ADD_NEW_CAT") {
        catSelect.value = "";
        // 隱藏小分類，直到大分類建立完成
        subSelect.style.display = 'none';
        const name = prompt("請輸入新的「大分類」名稱：");
        if (!name) return;

        const res = await fetch('http://127.0.0.1:5002/api/categories', {
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
        const res = await fetch(`http://127.0.0.1:5002/api/categories/${catId}/subcategories`, {
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
}

function closeAddModal() {
    document.getElementById('add-modal').style.display = 'none';
    document.getElementById('add-link-form').reset();
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
        const response = await fetch('http://127.0.0.1:5002/api/links', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: title,
                url: url,
                source: source,
                image_url: currentPreviewImage,
                category_id: categoryId,
                subcategory_id: subcategoryId
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
        const response = await fetch(`http://127.0.0.1:5002/api/links/${linkId}`, {
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
    await renderCategoryEditList();
}

function closeCategoryModal() {
    document.getElementById('category-modal').style.display = 'none';
    fetchAndRenderApp();
}

async function renderCategoryEditList() {
    const listContainer = document.getElementById('category-edit-list');
    listContainer.innerHTML = '<p style="text-align: center;">載入中...</p>';

    try {
        const response = await fetch('http://127.0.0.1:5002/api/categories');
        const categories = await response.json();

        if (categories.length === 0) {
            listContainer.innerHTML = '<p style="text-align: center; color: #8e8e93;">目前沒有任何分類</p>';
            return;
        }

        let html = '';
        categories.forEach(cat => {
            const catName = cat.name || cat.categoryName || "未命名大分類";

            html += `
            <div style="background: #f9f9f9; padding: 10px 15px; border-radius: 12px; margin-bottom: 15px;">
                <div class="edit-list-item">
                    <div class="edit-item-name">📁 ${catName}</div>
                    <div class="action-btns">
                        <button class="edit-action-btn" onclick="renameItem('category', ${cat.id}, '${cat.name}')">重新命名</button>
                        <button class="delete-action-btn" onclick="deleteCategoryItem('category', ${cat.id})">刪除</button>
                    </div>
                </div>
                <div class="sub-edit-list">
            `;

            if (cat.subcategories && cat.subcategories.length > 0) {
                cat.subcategories.forEach(sub => {
                    html += `
                    <div class="sub-edit-item">
                        <div class="sub-item-name">↳ ${sub.name}</div>
                        <div class="action-btns">
                            <button class="edit-action-btn" onclick="renameItem('subcategory', ${sub.id}, '${sub.name}')">修改</button>
                            <button class="delete-action-btn" onclick="deleteCategoryItem('subcategory', ${sub.id})">刪除</button>
                        </div>
                    </div>
                    `;
                });
            }

            html += `
                    <div style="margin-top: 10px; display: flex; gap: 8px;">
                        <input type="text" id="new-sub-input-${cat.id}" placeholder="新增小分類..." style="flex: 1; padding: 8px; border-radius: 6px; border: 1px solid #ddd;">
                        <button onclick="submitNewSubcategory(${cat.id})" style="background: #34C759; color: white; border: none; border-radius: 6px; padding: 0 12px;">+ 加入</button>
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

    await fetch('http://127.0.0.1:5002/api/categories', {
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

    await fetch(`http://127.0.0.1:5002/api/categories/${categoryId}/subcategories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name })
    });
    renderCategoryEditList();
}

async function renameItem(type, id, oldName) {
    const newName = prompt("請輸入新的名稱：", oldName);
    if (!newName || newName === oldName) return;

    await fetch('http://127.0.0.1:5002/api/rename', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id, new_name: newName })
    });
    renderCategoryEditList();
}

async function deleteCategoryItem(type, id) {
    const msg = type === 'category' ? "⚠️ 警告：這將會刪除該分類下的「所有小分類與連結」！確定嗎？" : "確定要刪除這個小分類嗎？";
    if (!confirm(msg)) return;

    await fetch('http://127.0.0.1:5002/api/delete_category', {
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
            // 拿著記憶中的帳號，向後端發送驗證請求
            const response = await fetch('http://127.0.0.1:5002/api/auth/verify');

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

    autoDetectPlatform(url);
    fetchUrlPreview();

    // 填寫完畢後清空暫存，避免重複觸發
    pendingSharedUrl = null;
    pendingSharedTitle = null;
}