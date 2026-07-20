import time
# 直接從你的主程式匯入需要的工具與模型，避免重複寫程式碼
from app import app, db, Link, backup_image_to_firebase

def run_migration():
    # 必須在 Flask 的應用程式環境下執行，才能連線到 PostgreSQL
    with app.app_context():
        print("開始掃描需要轉移的舊圖片...")
        
        # 篩選條件：有圖片網址，且該網址不是 Firebase 的永久網址
        links_to_update = Link.query.filter(
            Link.image_url != '',
            Link.image_url.is_not(None),
            ~Link.image_url.like('%firebasestorage.googleapis.com%')
        ).all()

        total_links = len(links_to_update)
        if total_links == 0:
            print("沒有找到需要轉移的舊圖片，資料庫已經是最新狀態！")
            return

        print(f"總共找到 {total_links} 筆需要轉移的資料。開始執行搬運作業...\n")

        success_count = 0
        for index, link in enumerate(links_to_update, 1):
            print(f"[{index}/{total_links}] 正在處理: {link.title}")
            
            # 呼叫 app.py 裡面的搬運工函式
            new_url = backup_image_to_firebase(link.image_url)
            
            # 如果回傳的新網址與舊網址不同，代表成功上傳並取得了永久網址
            if new_url and new_url != link.image_url:
                link.image_url = new_url
                success_count += 1
                print(" -> 更新成功！")
            else:
                print(" -> 處理失敗或維持原樣。")
            
            # 安全機制：每次發送下載請求後強制暫停 2 秒，避免伺服器 IP 被 IG/Threads 封鎖
            time.sleep(2)

        # 迴圈結束後，將所有變更一次性寫入 PostgreSQL 儲存
        db.session.commit()
        print(f"\n轉移作業結束！成功更新了 {success_count} 張圖片的網址。")

if __name__ == '__main__':
    run_migration()