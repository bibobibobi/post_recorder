import eventlet
eventlet.monkey_patch()

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
    url = db.Column(db.String(500), nullable=False)
    source = db.Column(db.String(50))
    image_url = db.Column(db.String(500), nullable=True) 
    category_id = db.Column(db.Integer, db.ForeignKey('categories.id'), nullable=False)
    subcategory_id = db.Column(db.Integer, db.ForeignKey('subcategories.id'), nullable=True)

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

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(username=data.get('username')).first()

    if user and check_password_hash(user.password_hash, data.get('password')):
        return {"message": "登入成功！", "username": user.username}, 200
    else:
        return {"error": "帳號或密碼錯誤"}, 401

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
            "links": [{"id": l.id, "title": l.title, "url": l.url, "source": l.source, "image_url": l.image_url} for l in direct_links],
            "subcategories": []
        }
        
        for sub in cat.subcategories:
            sub_links = Link.query.filter_by(subcategory_id=sub.id).all()
            cat_data["subcategories"].append({
                "id": sub.id,
                "name": sub.name,
                "links": [{"id": l.id, "title": l.title, "url": l.url, "source": l.source, "image_url": l.image_url} for l in sub_links]
            })
            
        result.append(cat_data)
        
    return jsonify(result), 200

# 新增連結 API
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
        subcategory_id=data.get('subcategory_id') 
    )
    db.session.add(new_link)
    db.session.commit()
    
    # 🌟 新增：廣播通知房間內的所有人更新畫面
    socketio.emit('workspace_updated', room=f"group_{group_id}")
    
    return {"message": "連結新增成功！"}, 201

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