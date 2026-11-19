# Post Recorder｜社群貼文收藏與管理系統

一個整合社群連結收藏、分類管理與多人協作的 Web 應用程式。使用者可以將 Instagram、Threads、Facebook 等平台的貼文連結集中保存，透過分類、子分類及標籤整理收藏內容，並支援群組共享與即時同步，讓個人收藏及團隊資料管理更加便利。

## 專案背景

在日常使用社群平台時，經常會遇到想保留的貼文，例如旅遊資訊、餐廳推薦、技術文章或生活靈感。

但當收藏內容逐漸增加，單純依賴社群平台內建的收藏功能，容易遇到分類不夠彈性、跨平台內容分散，以及難以快速搜尋的問題。

因此，我規劃並開發 Post Recorder，建立一個獨立的社群連結收藏空間，讓使用者能依照自己的需求建立分類、管理標籤，並透過群組功能與其他使用者共享收藏內容。

## 核心功能

- **社群連結收藏**：支援 Instagram、Threads、Facebook 等平台，集中保存貼文連結及預覽資訊。
- **分類與標籤管理**：提供多層級分類、自訂標籤及關鍵字搜尋，快速整理與查找收藏內容。
- **批次管理**：支援多筆收藏的批次刪除與分類搬移，提升資料整理效率。
- **群組協作**：提供個人與共享群組空間，透過邀請機制與角色管理共同收藏內容。
- **即時同步**：使用 Flask-SocketIO 廣播群組資料異動，讓成員即時取得最新內容。
- **外部服務整合**：串接 Microlink、RapidAPI 與 Firebase Storage，取得貼文預覽資訊並備份圖片。
- **行動裝置分享**：支援 Web Share Target，可從行動裝置分享選單直接將網址傳入收藏系統。

## 系統架構

本專案採用 Flask 作為後端服務，搭配原生 JavaScript 建立前端互動介面。

```text
                 使用者
                   │
                   ▼
           HTML / CSS / JavaScript
                   │
          ┌────────┴────────┐
          │                 │
          ▼                 ▼
       REST API         Socket.IO
          │                 │
          ▼                 ▼
       Flask          即時事件廣播
          │
    ┌─────┼──────────────┐
    │     │              │
    ▼     ▼              ▼
PostgreSQL Firebase   外部 API
 Database  Storage    Microlink
                      RapidAPI
```

### 技術架構

| 項目 | 使用技術 |
|---|---|
| 前端 | HTML、CSS、JavaScript |
| 後端 | Python、Flask |
| API 通訊 | REST API、JSON |
| 即時通訊 | Flask-SocketIO、WebSocket |
| 資料庫 | PostgreSQL |
| ORM | Flask-SQLAlchemy |
| 圖片儲存 | Firebase Storage |
| 網址預覽 | Microlink API |
| 社群資料擷取 | RapidAPI |
| 部署相關 | Gunicorn、Eventlet |

## 開發重點

### 1. 多層級資料分類設計

為了讓收藏資料能依照使用者需求彈性整理，設計大分類、子分類及收藏項目之間的關聯。

透過資料庫關聯管理分類與收藏內容，讓使用者能依照不同主題建立自己的收藏架構，而不受固定分類限制。

### 2. 多人共享與群組資料隔離

除了個人收藏空間，也設計群組協作機制。

透過 User、Group、UserGroup 等資料模型管理使用者與群組之間的關係，並在 API 操作時確認使用者是否具有指定群組的存取權限，讓不同群組的收藏資料能夠分開管理。

### 3. WebSocket 即時同步

在多人共享收藏資料的情境下，單純依賴使用者手動重新整理畫面，容易造成不同使用者看到的資料不一致。

因此使用 Flask-SocketIO 建立群組即時通訊機制，當資料異動時，後端會向對應群組廣播更新事件，讓其他使用者自動重新載入資料。

### 4. 非同步圖片備份

部分社群平台的圖片網址可能受到來源限制或時效影響，因此設計 Firebase Storage 圖片備份流程。

新增收藏時先儲存主要資料，再將圖片下載與上傳工作交由背景程序處理，避免圖片處理影響主要操作流程。

### 5. 外部 API 整合

整合 Microlink 與 RapidAPI，依照不同網址來源取得貼文預覽資訊。

針對 Instagram 設計專屬資料擷取流程，其他網址則透過 Microlink 取得標題、描述及圖片資訊，並在擷取失敗時提供備用顯示內容，維持新增收藏流程的可用性。

## 系統畫面

### 登入與帳號管理

<img alt="登入介面" src="https://github.com/user-attachments/assets/4e92a5b2-4088-4338-a9fa-1d07e0322a7c" width="250">


### 收藏管理首頁

<img alt="首頁" src="https://github.com/user-attachments/assets/c79f8679-d205-4578-b042-8195683563ea" width="250">

### 新增收藏與分類設定

<img alt="新增功能" src="https://github.com/user-attachments/assets/021c9f11-47ab-4052-95a1-426abf4e9a05" width="250">

### 分類與標籤管理

<img alt="分類管理" src="https://github.com/user-attachments/assets/1864b427-7f14-4145-aca9-20dfe634b3db" width="250">

### 群組協作與批次管理

<img alt="功能選單" src="https://github.com/user-attachments/assets/f029abbc-48b8-42fd-a34a-0435f3ebabda" width="250">
<img alt="批次功能" src="https://github.com/user-attachments/assets/6fa11eac-478e-4694-9dff-679f79d03a91" width="250">

## 本機執行

### 環境需求

- Python 3
- PostgreSQL
- Firebase 專案及 Storage
- Instagram RapidAPI Key（使用 Instagram 專屬擷取功能時）

### 取得專案

```bash
git clone https://github.com/bibobibobi/post_recorder.git
cd post_recorder
```

### 建立虛擬環境

```bash
python -m venv venv
```

啟用虛擬環境：

```bash
# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate
```

### 安裝依賴套件

```bash
pip install -r requirements.txt
```

### 設定環境變數

建立 `.env` 檔案：

```env
DATABASE_URL=postgresql://username:password@localhost:5432/post_recorder

FIREBASE_KEY_PATH=path/to/firebase-service-account.json

IG_RAPIDAPI_KEY=your_rapidapi_key
```

說明：

- `DATABASE_URL`：PostgreSQL 資料庫連線字串。
- `FIREBASE_KEY_PATH`：Firebase Service Account 金鑰檔案路徑。
- `IG_RAPIDAPI_KEY`：Instagram 貼文資料擷取所需的 RapidAPI 金鑰。

### 啟動應用程式

```bash
python app.py
```

預設啟動於：

```text
http://localhost:5002
```

> 注意：本機執行前仍須完成 PostgreSQL 資料表初始化，以及 Firebase Storage 權限設定。

## 專案開發方式

本專案由我負責產品需求規劃、功能拆解、開發方向及系統整合，並運用 AI 協助逐步實作與迭代。

從個人收藏管理出發，逐步擴充多層級分類、標籤搜尋、批次操作、群組共享及即時同步等功能，將原本單純的連結保存需求，發展成具備多人協作能力的資料管理系統。
