// ================= 全域 API 攔截器 (自動夾帶通行證) =================
const originalFetch = window.fetch;
window.fetch = async function (resource, config) {
    // 1. 如果是登入或註冊 API，不需要通行證，直接放行
    if (typeof resource === 'string' && (resource.includes('/api/login') || resource.includes('/api/register'))) {
        return originalFetch(resource, config);
    }

    // 2. 其他所有的 API 請求，都在背景偷偷塞入 X-Username 標頭
    if (!config) config = {};
    if (!config.headers) config.headers = {};

    const username = localStorage.getItem('saved_username');
    if (username) {
        config.headers['X-Username'] = username;
    }

    return originalFetch(resource, config);
};

// ================= 登入與畫面切換邏輯 =================

// 1. 處理登入請求
// 記錄目前的模式 (true = 登入模式, false = 註冊模式)
let isLoginMode = true;

// 切換登入與註冊模式的畫面
function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    const inviteInput = document.getElementById('invite-code-input');
    const submitBtn = document.getElementById('submit-btn');
    const modeText = document.getElementById('mode-text');
    const modeLink = document.getElementById('mode-link');
    const formTitle = document.getElementById('form-title');
    const messageEl = document.getElementById('login-message');

    // 清空錯誤訊息
    messageEl.textContent = '';
    document.getElementById('password-input').value = '';
    inviteInput.value = '';

    if (isLoginMode) {
        // 切換回登入畫面
        formTitle.textContent = "私人連結收藏庫";
        inviteInput.style.display = 'none';
        submitBtn.textContent = '登入';
        modeText.textContent = '還沒有帳號嗎？';
        modeLink.textContent = '點此註冊';
    } else {
        // 切換到註冊畫面
        formTitle.textContent = "建立帳號";
        inviteInput.style.display = 'block';
        submitBtn.textContent = '註冊';
        modeText.textContent = '已經有帳號了？';
        modeLink.textContent = '返回登入';
    }
}

// 處理送出按鈕 (整合登入與註冊 API)
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

    // 根據目前模式，決定要打哪一支 API 以及要傳送什麼資料
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
                // 登入成功：存入通行證並切換畫面
                localStorage.setItem('saved_username', result.username);
                showAppView(result.username);
            } else {
                // 註冊成功：提示使用者，並自動切換回登入模式
                alert("🎉 帳號建立成功！請使用新帳號登入。");
                toggleAuthMode();
                document.getElementById('password-input').value = ''; // 清空密碼框確保安全
            }
        } else {
            // 失敗 (可能是密碼錯，或是通關密語錯)
            messageEl.textContent = result.error || "發生未知錯誤";
        }
    } catch (error) {
        console.error("連線錯誤：", error);
        messageEl.textContent = "無法連線到伺服器，請確認 Flask 已啟動。";
    }
}

// 2. 處理登出請求
function handleLogout() {
    // 清除通行證
    localStorage.removeItem('saved_username');
    // 把畫面切回登入頁
    document.getElementById('main-app-section').style.display = 'none';
    document.getElementById('login-section').style.display = 'flex';
    // 清空輸入框
    document.getElementById('username-input').value = '';
    document.getElementById('password-input').value = '';
    document.getElementById('invite-code-input').value = '';
    document.getElementById('login-message').textContent = '';
    document.getElementById('app-content').innerHTML = '';

    if (!isLoginMode) {
        toggleAuthMode(); // 如果當前在註冊模式，登出時自動切回登入模式
    }
}

// 3. 控制畫面切換，並啟動抓取資料
function showAppView(username) {
    // 隱藏登入區塊，顯示主程式區塊
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('main-app-section').style.display = 'block';

    // 顯示使用者名稱
    document.getElementById('user-display-name').textContent = username;

    fetchAndRenderApp();
}

// ================= 初始化檢查 =================

// 網頁一載入時，先檢查有沒有通行證
document.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('saved_username');

    if (savedUser) {
        // 如果有通行證，直接跳過登入畫面進到主程式
        showAppView(savedUser);
    } else {
        // 如果沒有，就乖乖停在登入畫面 (預設狀態，不需要特別動作)
    }
});


// ================= 抓取與渲染首頁 (手風琴 + 標籤篩選版) =================
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

            // 1. 生成大分類的手風琴按鈕
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

            // 抓出有包含連結的小分類
            const validSubs = cat.subcategories ? cat.subcategories.filter(sub => sub.links && sub.links.length > 0) : [];

            // 2. 如果有小分類，就生成頂部的「橫向滑動篩選列」
            if (validSubs.length > 0) {
                chipsHtml += `<div class="filter-chips-container">`;
                chipsHtml += `<div class="filter-chip active" onclick="filterLinks(this, 'all')">全部</div>`; // 預設全部

                // 如果大分類自己也有直接的連結，加一個直屬標籤
                if (cat.links && cat.links.length > 0) {
                    chipsHtml += `<div class="filter-chip" onclick="filterLinks(this, 'none')">📌 直屬連結</div>`;
                }

                // 列出所有小分類標籤
                validSubs.forEach(sub => {
                    chipsHtml += `<div class="filter-chip" onclick="filterLinks(this, '${sub.id}')">${sub.name}</div>`;
                });
                chipsHtml += `</div>`;
            }

            // 3. 畫出「直接屬於大分類」的連結 (標記 subId 為 'none')
            if (cat.links && cat.links.length > 0) {
                hasAnyLink = true;
                cat.links.forEach(link => {
                    cardsHtml += generateLinkCard(link, null, 'none');
                });
            }

            // 4. 畫出「屬於小分類」的連結 (標記真實的 subId)
            if (validSubs.length > 0) {
                validSubs.forEach(sub => {
                    hasAnyLink = true;
                    sub.links.forEach(link => {
                        cardsHtml += generateLinkCard(link, sub.name, sub.id);
                    });
                });
            }

            // 5. 組合篩選列與卡片
            if (hasAnyLink) {
                htmlContent += chipsHtml + `<div class="category-cards-wrapper">` + cardsHtml + `</div>`;
            } else {
                htmlContent += `<p style="color: #8e8e93; font-size: 14px; text-align: center; margin: 10px 0;">此分類尚無內容</p>`;
            }

            htmlContent += `</div>`; // 結束 accordion-content
        });

        appContent.innerHTML = htmlContent;
        enableDragScroll(); // 確保重新綁定左滑刪除功能

    } catch (error) {
        console.error("載入失敗：", error);
        appContent.innerHTML = '<p style="text-align: center; color: #FF3B30;">連線異常，請檢查伺服器！</p>';
    }
}

// 產生單一連結卡片的輔助函式 (iOS 備忘錄風格)
function generateLinkCard(link, subName, subId) {
    // 判斷是否有抓到圖片，若無則顯示預設的灰色方塊
    let imageHtml = '';
    if (link.image_url) {
        imageHtml = `<img src="${link.image_url}" alt="preview" class="card-thumbnail">`;
    } else {
        // 沒有圖片時的預設圖示 (顯示一個灰底加上連結符號)
        imageHtml = `<div class="card-thumbnail fallback-thumbnail">🔗</div>`;
    }

    return `
    <div class="swipe-container filterable-card" data-sub-id="${subId}">
        <!-- 把整張卡片變成一個超連結 <a> 標籤 -->
        <a href="${link.url}" target="_blank" class="swipe-content link-card memo-style-card">
            
            <!-- 左側：文字區塊 -->
            <div class="card-text-area">
                <div class="card-title">${link.title}</div>
                <div class="card-source">${link.source}</div>
            </div>
            
            <!-- 右側：縮圖區塊 -->
            <div class="card-image-area">
                ${imageHtml}
            </div>
            
        </a>
        
        <div class="swipe-actions">
            <button onclick="deleteLink(${link.id}, this)">刪除</button>
        </div>
    </div>`;
}

// ================= 標籤篩選邏輯 =================
function filterLinks(clickedChip, targetSubId) {
    // 1. 切換標籤的視覺狀態 (反白目前點擊的標籤)
    const container = clickedChip.parentElement;
    container.querySelectorAll('.filter-chip').forEach(chip => chip.classList.remove('active'));
    clickedChip.classList.add('active');

    // 2. 找到同一層級下方的卡片容器，對卡片進行過濾
    const wrapper = container.nextElementSibling;
    const cards = wrapper.querySelectorAll('.filterable-card');

    cards.forEach(card => {
        card.scrollLeft = 0; // 每次切換篩選都把卡片滾回最左邊，避免誤觸刪除
        // 如果點擊「全部」，就全部顯示 (swipe-container 預設是 flex)
        if (targetSubId === 'all') {
            card.style.display = 'flex';
        } else {
            // 比對卡片身上的 data-sub-id 是否符合點擊的標籤
            if (card.getAttribute('data-sub-id') === String(targetSubId)) {
                card.style.display = 'flex';
            } else {
                card.style.display = 'none'; // 不符合的瞬間隱藏
            }
        }
    });
}

// 手風琴的開關邏輯 (含自動收合其他分類)
function toggleAccordion(clickedHeader) {
    const content = clickedHeader.nextElementSibling;
    const arrow = clickedHeader.querySelector('.arrow-icon');

    // 步驟 1：把其他打開的都關起來 (自動收合功能)
    const allHeaders = document.querySelectorAll('.accordion-header');
    allHeaders.forEach(header => {
        if (header !== clickedHeader) {
            header.nextElementSibling.style.display = 'none';
            header.querySelector('.arrow-icon').style.transform = 'rotate(0deg)';
        }
    });

    // 步驟 2：切換目前點擊的這個分類
    if (content.style.display === 'block') {
        content.style.display = 'none';
        arrow.style.transform = 'rotate(0deg)';
    } else {
        content.style.display = 'block';
        arrow.style.transform = 'rotate(180deg)';
    }
}


// ================= 新增連結功能 (自動解析版) =================

// 用來暫存從後端抓回來的大分類資料，避免一直重複發送請求
let cachedCategoriesData = [];
// 🌟 新增：用來暫存剛抓到的預覽圖片網址
let currentPreviewImage = '';

// 🌟 核心魔法：自動抓取網址預覽
async function fetchUrlPreview() {
    const urlInput = document.getElementById('new-url').value;
    const titleInput = document.getElementById('new-title');

    // 如果沒有輸入內容，或是開頭不是 http，就不浪費時間解析
    if (!urlInput || !urlInput.startsWith('http')) return;

    // 提示使用者正在處理中，營造流暢感
    const originalPlaceholder = titleInput.placeholder;
    titleInput.placeholder = "🔄 正在自動解析網址...";

    try {
        // 呼叫我們剛寫好的爬蟲 API
        const response = await fetch('http://127.0.0.1:5002/api/fetch-preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: urlInput })
        });

        if (response.ok) {
            const data = await response.json();

            // 溫柔設計：只有在使用者「還沒手動打標題」的時候，才幫他自動填寫
            if (data.title && !titleInput.value) {
                titleInput.value = data.title;
            }

            // 將圖片網址偷偷存在背景，等等按「新增」時一起打包送給資料庫
            currentPreviewImage = data.image || '';
        }
    } catch (error) {
        console.error("解析失敗：", error);
    } finally {
        titleInput.placeholder = originalPlaceholder; // 恢復原本的 placeholder
    }
}

// 🌟 綁定事件：當網頁載入完成後，讓網址輸入框擁有「失去焦點即解析」的能力
document.addEventListener('DOMContentLoaded', () => {
    const urlField = document.getElementById('new-url');
    if (urlField) {
        urlField.addEventListener('blur', fetchUrlPreview);
    }
});

// 1. 打開視窗並重置選單
async function openAddModal() {
    document.getElementById('add-modal').style.display = 'flex';
    document.getElementById('add-link-form').reset();
    currentPreviewImage = ''; // 🌟 每次打開都要清空上一次的圖片紀錄
    await refreshCategorySelects();
}

// 2. 向後端抓資料，並渲染大分類選單 (支援自動選取特定 ID)
async function refreshCategorySelects(autoSelectCatId = null, autoSelectSubId = null) {
    const catSelect = document.getElementById('new-category-select');
    const subSelect = document.getElementById('new-subcategory-select');

    catSelect.innerHTML = '<option value="" disabled selected>載入中...</option>';
    subSelect.innerHTML = '<option value="" disabled selected>請先選擇大分類</option>';
    subSelect.disabled = true;

    try {
        const response = await fetch('http://127.0.0.1:5002/api/categories');
        cachedCategoriesData = await response.json();

        catSelect.innerHTML = '<option value="" disabled selected>1. 選擇大分類</option>';
        cachedCategoriesData.forEach(cat => {
            const catName = cat.name || cat.categoryName;
            catSelect.innerHTML += `<option value="${cat.id}">📁 ${catName}</option>`;
        });

        // 🌟 魔法按鈕：放在選單最下方
        catSelect.innerHTML += `<option value="ADD_NEW_CAT" style="color: #007AFF; font-weight: bold;">新增大分類...</option>`;

        // 如果有指定要自動選取剛建立的大分類
        if (autoSelectCatId) {
            catSelect.value = autoSelectCatId;
            handleCategoryChange(autoSelectSubId);
        }
    } catch (error) {
        catSelect.innerHTML = '<option value="" disabled>載入失敗</option>';
    }
}

// 3. 當「大分類」被改變時觸發
async function handleCategoryChange(autoSelectSubId = null) {
    const catSelect = document.getElementById('new-category-select');
    const subSelect = document.getElementById('new-subcategory-select');
    const catId = catSelect.value;

    // 如果使用者點擊了「新增大分類...」
    if (catId === "ADD_NEW_CAT") {
        catSelect.value = ""; // 先把選單退回空白狀態
        const name = prompt("請輸入新的「大分類」名稱：");
        if (!name) return;

        // 呼叫 API 在背景建立大分類
        const res = await fetch('http://127.0.0.1:5002/api/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
        });
        const data = await res.json();

        if (res.ok) {
            // 建立成功後，重新抓資料，並自動幫使用者選好剛剛建的那一個！
            await refreshCategorySelects(data.id);
            fetchAndRenderApp(); // 順便更新首頁背景
        }
        return;
    }

    // 正常選擇大分類 ➡️ 展開對應的小分類選單
    const selectedCat = cachedCategoriesData.find(c => c.id == catId);
    if (!selectedCat) return;

    subSelect.disabled = false;
    const catName = selectedCat.name || selectedCat.categoryName;
    subSelect.innerHTML = `<option value="DIRECT">直接儲存在「${catName}」</option>`;

    if (selectedCat.subcategories && selectedCat.subcategories.length > 0) {
        selectedCat.subcategories.forEach(sub => {
            subSelect.innerHTML += `<option value="${sub.id}">↳ ${sub.name}</option>`;
        });
    }

    // 🌟 魔法按鈕：新增小分類
    subSelect.innerHTML += `<option value="ADD_NEW_SUB" style="color: #007AFF; font-weight: bold;">新增小分類...</option>`;

    if (autoSelectSubId) {
        subSelect.value = autoSelectSubId;
    }
}

// 4. 當「小分類」被改變時觸發
async function handleSubcategoryChange() {
    const catSelect = document.getElementById('new-category-select');
    const subSelect = document.getElementById('new-subcategory-select');

    // 如果使用者點擊了「新增小分類...」
    if (subSelect.value === "ADD_NEW_SUB") {
        subSelect.value = "DIRECT"; // 先退回直接放入
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
            // 建立成功，刷新並自動選好剛剛建的小分類！
            await refreshCategorySelects(catId, data.id);
            fetchAndRenderApp();
        }
    }
}

// 2. 關閉視窗並清空輸入框
function closeAddModal() {
    document.getElementById('add-modal').style.display = 'none';
    document.getElementById('add-link-form').reset();
}

// 5. 解析最終選擇並送出到後端
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

    // 只要不是 DIRECT (直接放入) 或 ADD_NEW_SUB，就代表選了一個真實的小分類 ID
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
                image_url: currentPreviewImage, // 🌟 關鍵發送：把剛才存起來的圖片網址一起送出去
                category_id: categoryId,
                subcategory_id: subcategoryId
            })
        });

        if (response.ok) {
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
// 🌟 接收按鈕元素，用動畫方式移除，不再重整頁面
async function deleteLink(linkId, btnElement) {
    // 加入原生確認視窗，避免誤觸
    if (!confirm("確定要刪除這個收藏嗎？")) return;

    try {
        const response = await fetch(`http://127.0.0.1:5002/api/links/${linkId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            // 找到該按鈕所在的整張卡片外層容器
            const card = btnElement.closest('.swipe-container');

            // 加上過場動畫，平滑縮小、淡出
            card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            card.style.opacity = '0';
            card.style.transform = 'translateX(-30px)';

            // 等待動畫跑完後再從 DOM 中移除
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

        const closeOtherSliders = () => {
            sliders.forEach(other => {
                // 如果是別人，而且它的 scrollLeft 大於 0 (代表被拉開了)
                if (other !== slider && other.scrollLeft > 0) {
                    other.style.scrollBehavior = 'smooth'; // 開啟平滑動畫
                    other.scrollLeft = 0; // 強制縮回去

                    // 等待 300 毫秒動畫跑完，再把原生的吸附功能加回來
                    setTimeout(() => {
                        other.style.scrollSnapType = 'x mandatory';
                    }, 300);
                }
            });
        };

        slider.addEventListener('mousedown', (e) => {
            closeOtherSliders(); // 開始拖曳前先關掉其他可能打開的滑動選單
            isDown = true;
            slider.style.scrollSnapType = 'none'; // 拖曳時暫時關閉 scroll-snap，手感更跟手
            slider.style.scrollBehavior = 'auto'; // 拖曳時暫時關閉平滑滾動，手感更跟手
            startX = e.pageX - slider.offsetLeft;
            scrollLeft = slider.scrollLeft;
        });

        slider.addEventListener('touchstart', () => {
            closeOtherSliders();
        }, { passive: true });

        slider.addEventListener('mouseleave', () => {
            if (isDown) smoothSnap(slider); // 如果滑鼠離開容器，且正在拖曳，則啟動平滑吸附
            isDown = false;
        });

        slider.addEventListener('mouseup', () => {
            if (isDown) smoothSnap(slider); // 如果滑鼠離開容器，且正在拖曳，則啟動平滑吸附
            isDown = false;
        });

        slider.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault(); // 阻止預設的文字選取行為
            const x = e.pageX - slider.offsetLeft;
            const walk = (x - startX);
            slider.scrollLeft = scrollLeft - walk;
        });
    });

    // 負責處理「放開滑鼠後」的動畫邏輯
    function smoothSnap(slider) {
        slider.style.scrollBehavior = 'smooth'; // 開啟平滑滾動模式

        // 如果使用者往左滑超過 40px (按鈕寬度的一半)，就自動滑開到底
        if (slider.scrollLeft > 40) {
            slider.scrollLeft = 80;
        } else {
            // 否則就自動縮回去
            slider.scrollLeft = 0;
        }

        // 等 300 毫秒動畫跑完後，再把原生的吸附功能加回來 (防呆)
        setTimeout(() => {
            slider.style.scrollSnapType = 'x mandatory';
        }, 300);
    }
}

// ================= 分類管理系統 =================

// 1. 打開管理視窗並載入資料
async function openCategoryModal() {
    document.getElementById('category-modal').style.display = 'flex';
    await renderCategoryEditList();
}

function closeCategoryModal() {
    document.getElementById('category-modal').style.display = 'none';
    // 關閉時順便重整主畫面的資料，確保最新
    fetchAndRenderApp();
}

// 2. 渲染管理清單
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

            // 在每個小分類清單的最下方，加上「新增小分類」的快速按鈕
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

// 3. 呼叫 API：新增大分類
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
    renderCategoryEditList(); // 重新整理清單
}

// 4. 呼叫 API：新增小分類
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

// 5. 呼叫 API：重新命名 (利用原生 prompt 對話框最輕量)
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

// 6. 呼叫 API：刪除分類
async function deleteCategoryItem(type, id) {
    const msg = type === 'category' ? "⚠️ 警告：這將會刪除該分類下的「所有小分類與連結」！確定嗎？" : "確定要刪除這個小分類嗎？";
    if (!confirm(msg)) return;

    await fetch('http://127.0.0.1:5002/api/delete_category', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id })
    });
    renderCategoryEditList();
}