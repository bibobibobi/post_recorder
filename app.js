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
    document.getElementById('login-message').textContent = '';
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


// ================= 抓取與渲染資料 =================
async function fetchAndRenderApp() {
    const appContent = document.getElementById('app-content');

    // 1. 載入中的過場動畫 (提升 UX)
    appContent.innerHTML = '<p style="text-align: center; margin-top: 50px; color: #8e8e93;">正在載入你的珍藏...</p>';

    try {
        const response = await fetch('http://127.0.0.1:5002/api/categories');
        const data = await response.json();

        // 2. 防呆：確保拿到的是陣列 (避免後端格式改變導致 forEach 壞掉)
        const categories = Array.isArray(data) ? data : (data.categories || []);

        // 3. 空狀態提示 (Empty State)
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

        // 4. 開始組裝畫面 (層層防呆)
        categories.forEach(category => {
            const catName = category.name || category.categoryName || "未命名大分類";
            htmlContent += `<h1 class="category-title">${catName}</h1>`;

            if (category.subcategories && category.subcategories.length > 0) {
                category.subcategories.forEach(sub => {
                    const subName = sub.name || "未命名小分類";
                    htmlContent += `<h2 class="subcategory-title">${subName}</h2>`;

                    if (sub.links && sub.links.length > 0) {
                        sub.links.forEach(link => {
                            const linkTitle = link.title || "無標題";
                            const linkSource = link.source || "未提供";
                            const linkUrl = link.url || "#";
                            const linkId = link.id; // 確保有抓到資料庫裡的 ID

                            htmlContent += `
                            <div class="swipe-container">
                                
                                <div class="swipe-content link-card" style="margin-bottom: 0;">
                                    <div class="card-info">
                                        <div class="card-title">${linkTitle}</div>
                                        <div class="card-source">${linkSource}</div>
                                    </div>
                                    <a href="${linkUrl}" target="_blank" style="text-decoration: none;">
                                        <div class="card-image" style="display:flex; justify-content:center; align-items:center; background:#d1d1d6; color:#fff; font-size:12px; border-radius:8px;">前往</div>
                                    </a>
                                </div>

                                <div class="swipe-actions">
                                    <button onclick="deleteLink(${linkId})">刪除</button>
                                </div>
                                
                            </div>
                            `;
                        });
                    } else {
                        htmlContent += `<p style="color: #8e8e93; font-size: 14px; margin-bottom: 16px; margin-left: 10px;">這裡目前沒有連結喔</p>`;
                    }
                });
            } else {
                htmlContent += `<p style="color: #8e8e93; font-size: 14px; margin-bottom: 16px; margin-left: 10px;">此分類下尚無內容</p>`;
            }
        });

        // 5. 將最終結果印到畫面上
        appContent.innerHTML = htmlContent;

        enableDragScroll(); // 啟動拖曳滑動功能

    } catch (error) {
        // 6. 錯誤捕捉 (如果真的又壞了，至少會在畫面上告訴你，而不是白畫面)
        console.error("載入失敗：", error);
        appContent.innerHTML = '<p style="text-align: center; color: #FF3B30; margin-top: 50px;">連線異常，請打開 F12 檢查 Console 錯誤！</p>';
    }
}

// 網頁載入完成後，自動執行抓取與渲染函式
document.addEventListener('DOMContentLoaded', fetchAndRenderApp);

// ================= 新增連結功能 =================

// 1. 打開視窗並向後端抓取分類資料
async function openAddModal() {
    document.getElementById('add-modal').style.display = 'flex';
    const selectEl = document.getElementById('new-subcategory');
    selectEl.innerHTML = '<option value="" disabled selected>載入分類中...</option>';

    try {
        // 跟我們一開始寫的渲染邏輯一樣，去跟 Flask 拿分類清單
        const response = await fetch('http://127.0.0.1:5002/api/categories');
        const categoriesData = await response.json();

        selectEl.innerHTML = '<option value="" disabled selected>請選擇要放入的分類</option>';

        // 利用 optgroup 標籤，把小分類歸類在大分類底下
        categoriesData.forEach(category => {
            if (category.subcategories && category.subcategories.length > 0) {
                const optGroup = document.createElement('optgroup');
                optGroup.label = `📁 ${category.name}`;

                category.subcategories.forEach(sub => {
                    const option = document.createElement('option');
                    option.value = sub.id; // 資料庫需要的是小分類的 ID
                    option.textContent = sub.name;
                    optGroup.appendChild(option);
                });

                selectEl.appendChild(optGroup);
            }
        });
    } catch (error) {
        console.error("載入分類失敗：", error);
        selectEl.innerHTML = '<option value="" disabled>無法載入分類，請檢查連線</option>';
    }
}

// 2. 關閉視窗並清空輸入框
function closeAddModal() {
    document.getElementById('add-modal').style.display = 'none';
    document.getElementById('add-link-form').reset();
}

// 3. 處理表單送出
async function submitNewLink(event) {
    event.preventDefault(); // 阻擋 HTML 表單預設的重整網頁行為

    // 收集輸入框的值
    const title = document.getElementById('new-title').value;
    const url = document.getElementById('new-url').value;
    const source = document.getElementById('new-source').value || '未提供';
    const subcategoryId = document.getElementById('new-subcategory').value;

    if (!subcategoryId) {
        alert('請先選擇一個分類喔！');
        return;
    }

    try {
        const response = await fetch('http://127.0.0.1:5002/api/links', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: title,
                url: url,
                source: source,
                subcategory_id: parseInt(subcategoryId) // 轉成數字傳給後端
            })
        });

        if (response.ok) {
            // 新增成功：關閉視窗並重新抓取一次最新資料來更新畫面
            closeAddModal();
            fetchAndRenderApp();
        } else {
            const res = await response.json();
            alert('新增失敗：' + (res.error || '未知錯誤'));
        }
    } catch (error) {
        console.error("儲存失敗：", error);
        alert('連線錯誤，請確認 Flask 伺服器是否運作中。');
    }
}

// ================= 刪除連結功能 =================
async function deleteLink(linkId) {
    // 加入原生確認視窗，避免誤觸
    if (!confirm("確定要刪除這個收藏嗎？")) return;

    try {
        const response = await fetch(`http://127.0.0.1:5002/api/links/${linkId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            // 刪除成功後，自動重新抓取資料，畫面就會瞬間更新
            fetchAndRenderApp();
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

        slider.addEventListener('mousedown', (e) => {
            isDown = true;
            slider.style.scrollsnapType = 'none'; // 拖曳時暫時關閉 scroll-snap，手感更跟手
            slider.style.scrollBehavior = 'auto'; // 拖曳時暫時關閉平滑滾動，手感更跟手
            startX = e.pageX - slider.offsetLeft;
            scrollLeft = slider.scrollLeft;
        });

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