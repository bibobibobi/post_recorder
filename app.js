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


// 負責從後端 API 抓取資料並渲染到畫面上
async function fetchAndRenderApp() {
    const container = document.getElementById('app-content');

    // 1. 顯示載入中的提示 (在資料還沒回來前，讓使用者知道程式正在努力中)
    container.innerHTML = '<p>資料載入中...</p>';

    try {
        // 2. 向 Flask API 發送 GET 請求
        const response = await fetch('http://127.0.0.1:5002/api/categories');

        if (!response.ok) {
            throw new Error(`伺服器錯誤！狀態碼：${response.status}`);
        }

        // 3. 將回傳的結果解析為 JSON 物件陣列
        const categoriesData = await response.json();
        console.log("🎉 成功從後端取得資料：", categoriesData);

        let htmlContent = '';

        // 4. 開始組裝 HTML (因為後端通常會回傳多個大分類，所以最外層多加了一層迴圈)
        categoriesData.forEach(category => {
            // 這裡假設 Flask 回傳的欄位名稱是 name，如果有出入可自行修改
            htmlContent += `<h1 class="category-title">${category.name}</h1>`;

            // 檢查這個大分類有沒有小分類 (防呆機制)
            if (category.subcategories && category.subcategories.length > 0) {
                category.subcategories.forEach(sub => {
                    htmlContent += `<h2 class="subcategory-title">${sub.name}</h2>`;

                    // 檢查這個小分類有沒有連結 (防呆機制)
                    if (sub.links && sub.links.length > 0) {
                        sub.links.forEach(link => {
                            // Python 後端通常習慣用底線命名 (image_url)，JS 習慣用駝峰 (imageUrl)
                            // 這裡做個雙重相容，並加上預設圖片的防護
                            const imageUrl = link.image_url || link.imageUrl || "https://via.placeholder.com/48";

                            htmlContent += `
                                <div class="link-card">
                                    <div class="card-info">
                                        <div class="card-title">${link.title}</div>
                                        <div class="card-source">${link.source}</div>
                                    </div>
                                    <img src="${imageUrl}" alt="預覽圖" class="card-image">
                                </div>
                            `;
                        });
                    } else {
                        htmlContent += `<p style="color: #999; font-size: 0.9em; margin-left: 10px;">目前尚無連結</p>`;
                    }
                });
            }
        });

        // 5. 注入到 HTML 中
        // 如果資料庫完全沒資料，給予友善提示
        if (htmlContent === '') {
            container.innerHTML = '<p>目前資料庫沒有任何分類喔！</p>';
        } else {
            container.innerHTML = htmlContent;
        }

    } catch (error) {
        // 如果 Flask 沒開，或是網路斷線，就會跑到這裡
        console.error("抓取資料失敗 😢：", error);
        container.innerHTML = `<p style="color: red;">載入失敗，請確認 Flask 伺服器是否已啟動。</p>`;
    }
}

// 網頁載入完成後，自動執行抓取與渲染函式
document.addEventListener('DOMContentLoaded', fetchAndRenderApp);