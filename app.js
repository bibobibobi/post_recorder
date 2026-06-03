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