import eventlet
eventlet.monkey_patch()
import time
import os
import requests
import uuid
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm.attributes import flag_modified

# 🌟 新增：引入 WebSocket 相關套件
from flask_socketio import SocketIO, emit, join_room, leave_room

load_dotenv()

app = Flask(__name__)
CORS(app)

# 🌟 新增：初始化 SocketIO 廣播站台 (允許所有來源連線)
socketio = SocketIO(app, cors_allowed_origins="*")

app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.json.ensure_ascii = False

db = SQLAlchemy(app)

@app.context_processor
def inject_version():
    def get_version(filename):
        # 將 app.static_folder 改為 app.root_path，直接在專案根目錄找檔案
        file_path = os.path.join(app.root_path, filename)
        return int(os.path.getmtime(file_path)) if os.path.exists(file_path) else 0
    
    return dict(get_version=get_version)

# ================= 資料庫模型設計 (群組協作版) =================

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    
    groups = db.relationship('UserGroup', backref='user', cascade='all, delete-orphan')

class Group(db.Model):
    __tablename__ = 'groups'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    is_personal = db.Column(db.Boolean, default=True, nullable=False)
    invite_token = db.Column(db.String(100), unique=True, nullable=True)
    members = db.relationship('UserGroup', backref='group', cascade='all, delete-orphan')
    categories = db.relationship('Category', backref='group', cascade='all, delete-orphan')

class UserGroup(db.Model):
    __tablename__ = 'user_groups'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    group_id = db.Column(db.Integer, db.ForeignKey('groups.id'), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='member')

    __table_args__ = (db.UniqueConstraint('user_id', 'group_id', name='_user_group_uc'),)

class Category(db.Model):
    __tablename__ = 'categories'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    
    group_id = db.Column(db.Integer, db.ForeignKey('groups.id'), nullable=False)
    
    subcategories = db.relationship('Subcategory', backref='category', lazy=True, cascade="all, delete-orphan")
    links = db.relationship('Link', backref='category', cascade='all, delete-orphan')

class Subcategory(db.Model):
    __tablename__ = 'subcategories'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    category_id = db.Column(db.Integer, db.ForeignKey('categories.id'), nullable=False)

class Link(db.Model):
    __tablename__ = 'links'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(100), nullable=False)
    url = db.Column(db.Text, nullable=False)
    source = db.Column(db.String(50))
    image_url = db.Column(db.Text, nullable=True) 
    category_id = db.Column(db.Integer, db.ForeignKey('categories.id'), nullable=False)
    subcategory_id = db.Column(db.Integer, db.ForeignKey('subcategories.id'), nullable=True)
    tags = db.Column(ARRAY(db.String), default=[])

# ================= 輔助函式：身份驗證 =================

def get_current_user():
    username = request.headers.get('X-Username')
    if not username:
        return None
    return User.query.filter_by(username=username).first()

def get_personal_group_id(user):
    user_group = UserGroup.query.join(Group).filter(
        UserGroup.user_id == user.id,
        Group.is_personal == True
    ).first()
    return user_group.group_id if user_group else None

def get_requested_group_id(user):
    group_id_str = request.headers.get('X-Group-Id')
    if group_id_str:
        group_id = int(group_id_str)
        user_group = UserGroup.query.filter_by(user_id=user.id, group_id=group_id).first()
        if user_group:
            return group_id
        else:
            return None
    return get_personal_group_id(user)


# ================= WebSocket 廣播電台頻道管理 =================
# 🌟 新增：處理前端加入與離開房間的邏輯

@socketio.on('join_workspace')
def handle_join_workspace(data):
    """當使用者在前端切換群組時，將他加入專屬的廣播房間"""
    group_id = data.get('group_id')
    if group_id:
        room_name = f"group_{group_id}"
        join_room(room_name)

@socketio.on('leave_workspace')
def handle_leave_workspace(data):
    """當使用者離開群組時，將他移出房間"""
    group_id = data.get('group_id')
    if group_id:
        room_name = f"group_{group_id}"
        leave_room(room_name)


# ================= API 路由設計 =================

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    if not username or not password:
        return jsonify({"error": "請填寫帳號與密碼"}), 400

    existing_user = User.query.filter_by(username=username).first()
    if existing_user:
        return jsonify({"error": "這個帳號已經被註冊過了"}), 400

    try:
        new_user = User(username=username, password_hash=generate_password_hash(password))
        db.session.add(new_user)
        db.session.flush() 

        personal_group = Group(name=f"{username} 的私人空間", is_personal=True)
        db.session.add(personal_group)
        db.session.flush() 

        user_group = UserGroup(user_id=new_user.id, group_id=personal_group.id, role='owner')
        db.session.add(user_group)

        db.session.commit()
        return jsonify({"message": "註冊成功！"}), 201

    except Exception as e:
        db.session.rollback() 
        return jsonify({"error": "註冊失敗，請稍後再試"}), 500

@app.route('/api/auth/verify', methods=['GET'])
def verify_auth():
    # 我們的全域攔截器會自動把帳號放在 X-Username 標頭裡傳過來
    username = request.headers.get('X-Username')
    
    if not username:
        return jsonify({"error": "未提供驗證身分"}), 401
        
    # 去資料庫確認這個帳號是否真的存在
    user = User.query.filter_by(username=username).first()
    
    if user:
        return jsonify({"message": "驗證成功", "username": username}), 200
    else:
        return jsonify({"error": "帳號失效或不存在，請重新登入"}), 401

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(username=data.get('username')).first()

    if user and check_password_hash(user.password_hash, data.get('password')):
        return {"message": "登入成功！", "username": user.username}, 200
    else:
        return {"error": "帳號或密碼錯誤"}, 401
    
@app.route('/api/preview', methods=['GET','POST'])
def preview_url():
    if request.method == 'GET':
        target_url = request.args.get('url')
    else:
        data = request.json or {}
        target_url = data.get('url')
    
    if not target_url:
        return jsonify({"error": "缺少網址"}), 400

    max_retries = 3  # 設定最多嘗試 3 次
    
    for attempt in range(max_retries):
        try:
            # 加入 timeout=8，避免 Microlink 卡死導致我們整個伺服器當機
            response = requests.get(f"https://api.microlink.io?url={target_url}", timeout=8)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'success':
                    # 1. 抓取資料
                    raw_title = data['data'].get('title', '未知網頁')
                    description = data['data'].get('description', '')
                    image_data = data['data'].get('image', {})
                    image_url = image_data.get('url', '') if image_data else ''

                    # 2. 清潔工：剪掉前面討厭的 0 或 0️⃣
                    clean_title = raw_title
                    if clean_title.startswith('0 '):
                        clean_title = clean_title[2:]
                    elif clean_title.startswith('0️⃣ '):
                        clean_title = clean_title[4:]

                    # 3. 移花接木術：如果是 Threads，就把描述當作真正的標題
                    if 'threads' in target_url.lower():
                        if description:
                            clean_title = description[:40] + "..." if len(description) > 40 else description

                    # 成功抓取，直接回傳結束迴圈！
                    return jsonify({"title": clean_title, "image": image_url}), 200
                    
        except Exception as e:
            print(f"Microlink 抓取失敗 (第 {attempt + 1} 次): {e}")
        
        # 如果走到這裡，代表上面失敗了。如果還沒到最後一次，就休息 0.8 秒再試
        if attempt < max_retries - 1:
            time.sleep(0.8)

    # 🌟 如果 3 次都失敗了，回傳一個優雅的「備用預設值」，不要讓前端壞掉
    return jsonify({
        "title": "無法抓取預覽，請手動輸入", 
        "image": ""
    }), 200

@app.route('/')
def home():
    return send_file('index.html')

@app.route('/<path:filename>')
def serve_static(filename):
    allowed_files = ['style.css', 'app.js', 'manifest.json', 'icon-192.png']
    if filename in allowed_files:
        return send_file(filename)
    return {"error": "找不到檔案或沒有讀取權限"}, 404

# ================= 群組與協作系統 API =================

@app.route('/api/my_groups', methods=['GET'])
def get_my_groups():
    user = get_current_user()
    if not user:
        return {"error": "未登入"}, 401

    user_groups = UserGroup.query.filter_by(user_id=user.id).all()
    
    result = []
    for ug in user_groups:
        group = ug.group
        result.append({
            "id": group.id,
            "name": group.name,
            "is_personal": group.is_personal,
            "role": ug.role
        })
    
    result.sort(key=lambda x: not x['is_personal'])
    return jsonify(result), 200

@app.route('/api/groups', methods=['POST'])
def create_group():
    user = get_current_user()
    if not user:
        return {"error": "未登入"}, 401

    data = request.json
    name = data.get('name')
    if not name:
        return {"error": "缺少群組名稱"}, 400

    try:
        new_group = Group(name=name, is_personal=False)
        db.session.add(new_group)
        db.session.flush() 

        user_group = UserGroup(user_id=user.id, group_id=new_group.id, role='owner')
        db.session.add(user_group)
        
        db.session.commit()
        return {"message": "群組建立成功", "group_id": new_group.id}, 201
    except Exception as e:
        db.session.rollback()
        return {"error": "群組建立失敗"}, 500

@app.route('/api/groups/<int:group_id>/invite', methods=['POST'])
def generate_invite(group_id):
    user = get_current_user()
    if not user:
        return {"error": "未登入"}, 401

    user_group = UserGroup.query.filter_by(user_id=user.id, group_id=group_id, role='owner').first()
    if not user_group:
        return {"error": "權限不足：只有管理員可以產生邀請連結"}, 403

    group = Group.query.get(group_id)
    if not group:
        return {"error": "找不到該群組"}, 404

    if not group.invite_token:
        group.invite_token = str(uuid.uuid4())
        db.session.commit()

    return {"invite_token": group.invite_token}, 200

@app.route('/api/groups/join', methods=['POST'])
def join_group():
    user = get_current_user()
    if not user:
        return {"error": "未登入"}, 401

    data = request.json
    token = data.get('token')
    if not token:
        return {"error": "缺少邀請碼"}, 400

    group = Group.query.filter_by(invite_token=token).first()
    if not group:
        return {"error": "無效的邀請連結"}, 404

    existing_member = UserGroup.query.filter_by(user_id=user.id, group_id=group.id).first()
    if existing_member:
        return {"message": "你已經在這個群組裡面了，不需重複加入"}, 200

    try:
        new_member = UserGroup(user_id=user.id, group_id=group.id, role='member')
        db.session.add(new_member)
        db.session.commit()
        return {"message": f"成功加入「{group.name}」群組！", "group_id": group.id}, 200
    except Exception as e:
        db.session.rollback()
        return {"error": "加入失敗，請稍後再試"}, 500

# ================= 網頁預覽抓取 API (爬蟲核心) =================
@app.route('/api/fetch-preview', methods=['POST'])
def fetch_preview():
    return {"title": "功能開發中", "image_url": ""}, 200


# 取得所有分類與連結
@app.route('/api/categories', methods=['GET'])
def get_categories():
    user = get_current_user()
    if not user:
        return {"error": "未登入或授權失敗"}, 401

    group_id = get_requested_group_id(user) 
    if not group_id:
        return {"error": "找不到指定的群組或權限不足"}, 403

    categories = Category.query.filter_by(group_id=group_id).all() 
    result = []
    
    for cat in categories:
        direct_links = Link.query.filter_by(category_id=cat.id, subcategory_id=None).all()
        
        cat_data = {
            "id": cat.id,
            "name": cat.name,
            "links": [{"id": l.id, "title": l.title, "url": l.url, "source": l.source, "image_url": l.image_url, 'tags': l.tags or []} for l in direct_links],
            "subcategories": []
        }
        
        for sub in cat.subcategories:
            sub_links = Link.query.filter_by(subcategory_id=sub.id).all()
            cat_data["subcategories"].append({
                "id": sub.id,
                "name": sub.name,
                "links": [{"id": l.id, "title": l.title, "url": l.url, "source": l.source, "image_url": l.image_url, 'tags': l.tags or []} for l in sub_links]
            })
            
        result.append(cat_data)
        
    return jsonify(result), 200

# 新增連結
@app.route('/api/links', methods=['POST'])
def add_link():
    user = get_current_user()
    if not user:
        return {"error": "未登入"}, 401

    data = request.json
    if not data or not data.get('url') or not data.get('category_id'):
        return {"error": "缺少必要欄位 (需包含 url 與 category_id)"}, 400
        
    group_id = get_requested_group_id(user)
    if not group_id:
        return {"error": "找不到指定的群組或權限不足"}, 403

    category = Category.query.filter_by(id=data['category_id'], group_id=group_id).first() 
    if not category:
        return {"error": "找不到大分類或權限不足"}, 403

    new_link = Link(
        title=data.get('title', '無標題'),
        url=data['url'],
        source=data.get('source', '未提供'),
        image_url=data.get('image_url', ''), 
        category_id=data['category_id'],
        subcategory_id=data.get('subcategory_id'),
        tags=data.get('tags', [])
    )
    db.session.add(new_link)
    db.session.commit()
    
    # 🌟 新增：廣播通知房間內的所有人更新畫面
    socketio.emit('workspace_updated', room=f"group_{group_id}")
    
    return {"message": "連結新增成功！"}, 201

# 熱門標籤排序
@app.route('/api/get_tags', methods=['GET'])
def get_tags():
    try:
        subcategory_id = request.args.get('subcategory_id')
        if not subcategory_id:
            return jsonify([]), 200

        # 邏輯說明：
        # unnest(tags) 會把資料庫裡原本陣列型態的標籤「攤平」成一行一行
        # 接著使用 COUNT(*) 計算每個標籤出現的次數，並依照使用頻率由高至低排序
        query = text("""
            SELECT tag, COUNT(*) as freq
            FROM links, unnest(tags) as tag
            WHERE subcategory_id = :sub_id
            GROUP BY tag
            ORDER BY freq DESC
            LIMIT 15;
        """)
        
        result = db.session.execute(query, {'sub_id': subcategory_id}).fetchall()
        
        # 將查詢結果轉換成單純的字串列表，例如：["唐吉訶德", "藥妝", "免稅"]
        hot_tags = [row[0] for row in result]
        
        return jsonify(hot_tags), 200

    except Exception as e:
        print(f"取得熱門標籤失敗: {e}")
        return jsonify([]), 500
    

# ================= 標籤管理 API (強制標記存檔版) =================

@app.route('/api/tags', methods=['PUT'])
def rename_tag():
    data = request.get_json()
    old_name = data.get('old_name')
    new_name = data.get('new_name')
    
    if not old_name or not new_name:
        return jsonify({"error": "標籤名稱不能為空"}), 400

    try:
        # 1. 抓取所有連結，在 Python 記憶體中極速過濾
        all_links = Link.query.all()
        links_to_update = [link for link in all_links if link.tags and old_name in link.tags]
        
        for link in links_to_update:
            # 2. 替換標籤名稱，並透過 dict.fromkeys 自動順序去重
            updated_tags = [new_name if t == old_name else t for t in link.tags]
            link.tags = list(dict.fromkeys(updated_tags))
            
            # 🌟 核心關鍵：強力強制標記！告訴 SQLAlchemy 這個 ARRAY 欄位已被更改，必須存檔！
            flag_modified(link, "tags")
            
        db.session.commit()
        return jsonify({"message": "標籤修改成功", "updated_count": len(links_to_update)}), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"修改標籤失敗: {str(e)}"}), 500


@app.route('/api/tags', methods=['DELETE'])
def delete_tag():
    data = request.get_json()
    tag_name = data.get('tag_name')
    
    if not tag_name:
        return jsonify({"error": "請指定要刪除的標籤"}), 400

    try:
        all_links = Link.query.all()
        links_to_update = [link for link in all_links if link.tags and tag_name in link.tags]
        
        for link in links_to_update:
            # 2. 移除目標標籤
            link.tags = [t for t in link.tags if t != tag_name]
            
            # 🌟 核心關鍵：強力強制標記！確保 PostgreSQL 確實刪除該陣列元素！
            flag_modified(link, "tags")
            
        db.session.commit()
        return jsonify({"message": "標籤刪除成功", "updated_count": len(links_to_update)}), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"刪除標籤失敗: {str(e)}"}), 500

# 刪除連結
@app.route('/api/links/<int:link_id>', methods=['DELETE'])
def delete_link(link_id):
    user = get_current_user()
    if not user:
        return {"error": "未登入"}, 401

    group_id = get_requested_group_id(user)
    if not group_id:
        return {"error": "找不到指定的群組或權限不足"}, 403

    link_to_delete = Link.query.get(link_id)
    
    if not link_to_delete or link_to_delete.category.group_id != group_id: 
        return {"error": "找不到該連結或權限不足"}, 404
        
    try:
        db.session.delete(link_to_delete)
        db.session.commit()
        
        # 🌟 新增：廣播通知
        socketio.emit('workspace_updated', room=f"group_{group_id}")
        
        return {"message": "刪除成功！"}, 200
    except Exception as e:
        db.session.rollback()
        return {"error": str(e)}, 500

# 新增大分類
@app.route('/api/categories', methods=['POST'])
def create_category():
    user = get_current_user()
    if not user:
        return {"error": "未登入"}, 401

    data = request.json
    if not data or not data.get('name'):
        return {"error": "缺少分類名稱"}, 400
    
    group_id = get_requested_group_id(user)
    if not group_id:
        return {"error": "找不到指定的群組或權限不足"}, 403

    new_cat = Category(name=data['name'], group_id=group_id) 
    db.session.add(new_cat)
    db.session.commit()
    
    # 🌟 新增：廣播通知
    socketio.emit('workspace_updated', room=f"group_{group_id}")
    
    return {"message": "分類建立成功", "id": new_cat.id}, 201

# 新增子分類
@app.route('/api/categories/<int:category_id>/subcategories', methods=['POST'])
def create_subcategory(category_id):
    user = get_current_user()
    if not user:
        return {"error": "未登入"}, 401

    data = request.json
    if not data or not data.get('name'):
        return {"error": "缺少子分類名稱"}, 400

    group_id = get_requested_group_id(user)
    if not group_id:
        return {"error": "找不到指定的群組或權限不足"}, 403

    category = Category.query.filter_by(id=category_id, group_id=group_id).first() 
    if not category:
        return {"error": "找不到該分類或權限不足"}, 404

    new_subcat = Subcategory(name=data['name'], category_id=category_id)
    db.session.add(new_subcat)
    db.session.commit()

    # 🌟 新增：廣播通知
    socketio.emit('workspace_updated', room=f"group_{group_id}")

    return {"message": "子分類建立成功", "id": new_subcat.id}, 201

# 更新分類名稱
@app.route('/api/rename', methods=['PUT'])
def rename_category():
    user = get_current_user()
    if not user:
        return {"error": "未登入"}, 401

    data = request.json
    item_type = data.get('type')
    item_id = data.get('id')
    new_name = data.get('new_name')

    if not all([item_type, item_id, new_name]):
        return {"error": "缺少必要欄位"}, 400

    group_id = get_requested_group_id(user)
    if not group_id:
        return {"error": "找不到指定的群組或權限不足"}, 403

    if item_type == 'category':
        item = Category.query.filter_by(id=item_id, group_id=group_id).first() 
    elif item_type == 'subcategory':
        item = Subcategory.query.get(item_id)
        if item and item.category.group_id != group_id: 
            return {"error": "權限不足"}, 403
    else:
        return {"error": "無效的項目類型"}, 400

    if not item:
        return {"error": "找不到該項目"}, 404

    item.name = new_name
    db.session.commit()

    # 🌟 新增：廣播通知
    socketio.emit('workspace_updated', room=f"group_{group_id}")

    return {"message": "名稱更新成功"}, 200

# 刪除分類
@app.route('/api/delete_category', methods=['DELETE'])
def delete_any_category():
    user = get_current_user()
    if not user:
        return {"error": "未登入"}, 401

    data = request.json
    item_type = data.get('type') 
    item_id = data.get('id')
    
    group_id = get_requested_group_id(user)
    if not group_id:
        return {"error": "找不到指定的群組或權限不足"}, 403

    if item_type == 'category':
        item = Category.query.filter_by(id=item_id, group_id=group_id).first() 
    else:
        item = Subcategory.query.get(item_id)
        if item and item.category.group_id != group_id: 
            return {"error": "權限不足"}, 403
            
        if item:
            links_to_keep = Link.query.filter_by(subcategory_id=item.id).all()
            for link in links_to_keep:
                link.subcategory_id = None 
    
    if not item:
        return {"error": "找不到該分類或權限不足"}, 404
        
    db.session.delete(item)
    db.session.commit()
    
    # 🌟 新增：廣播通知
    socketio.emit('workspace_updated', room=f"group_{group_id}")
    
    return {"message": "處理成功！"}


if __name__ == '__main__':
    # 🌟 修改：改用 socketio 的引擎啟動伺服器
    socketio.run(app, host='0.0.0.0', port=5002)