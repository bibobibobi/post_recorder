import os
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

load_dotenv()

app = Flask(__name__)
CORS(app)

app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.json.ensure_ascii = False

db = SQLAlchemy(app)

# ================= 資料庫模型設計 =================

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    categories = db.relationship('Category', backref='owner', cascade='all, delete-orphan')

class Category(db.Model):
    __tablename__ = 'categories'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
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
    image_url = db.Column(db.String(500), nullable=True) # 🌟 儲存預覽圖片的網址
    category_id = db.Column(db.Integer, db.ForeignKey('categories.id'), nullable=False)
    subcategory_id = db.Column(db.Integer, db.ForeignKey('subcategories.id'), nullable=True)

# ================= 輔助函式：身份驗證 =================

def get_current_user():
    username = request.headers.get('X-Username')
    if not username:
        return None
    return User.query.filter_by(username=username).first()

# ================= API 路由設計 =================

# 登入與註冊系統

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    
    if data.get('invite_code') != os.getenv('INVITE_CODE'):
        return {"error": "註冊碼錯誤，拒絕註冊！"}, 403

    if User.query.filter_by(username=data.get('username')).first():
        return {"error": "這個帳號已經被註冊過囉！"}, 400

    hashed_password = generate_password_hash(data.get('password'))
    new_user = User(username=data.get('username'), password_hash=hashed_password)
    
    db.session.add(new_user)
    db.session.commit()
    
    return {"message": "帳號建立成功！"}, 201


@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(username=data.get('username')).first()

    if user and check_password_hash(user.password_hash, data.get('password')):
        return {
            "message": "登入成功！", 
            "username": user.username
        }, 200
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


# ================= 網頁預覽抓取 API (爬蟲核心) =================
@app.route('/api/fetch-preview', methods=['POST'])
def fetch_preview():
    user = get_current_user()
    if not user:
        return {"error": "未登入"}, 401

    data = request.json
    target_url = data.get('url')
    if not target_url:
        return {"error": "缺少網址"}, 400

    try:
        # 1. 偽裝成正常瀏覽器發送請求
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
        response = requests.get(target_url, headers=headers, timeout=5)
        response.encoding = 'utf-8' # 確保中文不變亂碼
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # 2. 尋找圖片 (優先找 og:image)
        image = ""
        og_image = soup.find("meta", property="og:image")
        if og_image and og_image.get("content"):
            image = og_image["content"]
            
        # 3. 尋找標題 (優先找 og:title，沒有再找 <title>)
        title = ""
        og_title = soup.find("meta", property="og:title")
        if og_title and og_title.get("content"):
            title = og_title["content"]
        elif soup.title and soup.title.string:
            title = soup.title.string.strip()
            
        return {"title": title, "image": image}, 200

    except Exception as e:
        print(f"抓取預覽失敗: {e}")
        # 如果抓取失敗 (例如網站阻擋爬蟲)，回傳空字串，讓使用者自己手填
        return {"title": "", "image": ""}, 200


# 取得所有分類與連結 (加入使用者過濾與圖片網址回傳)
@app.route('/api/categories', methods=['GET'])
def get_categories():
    user = get_current_user()
    if not user:
        return {"error": "未登入或授權失敗"}, 401

    categories = Category.query.filter_by(user_id=user.id).all()
    result = []
    
    for cat in categories:
        direct_links = Link.query.filter_by(category_id=cat.id, subcategory_id=None).all()
        
        cat_data = {
            "id": cat.id,
            "name": cat.name,
            # 🌟 補上 "image_url": l.image_url
            "links": [{"id": l.id, "title": l.title, "url": l.url, "source": l.source, "image_url": l.image_url} for l in direct_links],
            "subcategories": []
        }
        
        for sub in cat.subcategories:
            sub_links = Link.query.filter_by(subcategory_id=sub.id).all()
            cat_data["subcategories"].append({
                "id": sub.id,
                "name": sub.name,
                # 🌟 補上 "image_url": l.image_url
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
        
    category = Category.query.filter_by(id=data['category_id'], user_id=user.id).first()
    if not category:
        return {"error": "找不到大分類或權限不足"}, 403

    new_link = Link(
        title=data.get('title', '無標題'),
        url=data['url'],
        source=data.get('source', '未提供'),
        image_url=data.get('image_url', ''), # 🌟 儲存從前端傳來的圖片網址
        category_id=data['category_id'],
        subcategory_id=data.get('subcategory_id') 
    )
    db.session.add(new_link)
    db.session.commit()
    return {"message": "連結新增成功！"}, 201


# 刪除連結
@app.route('/api/links/<int:link_id>', methods=['DELETE'])
def delete_link(link_id):
    user = get_current_user()
    if not user:
        return {"error": "未登入"}, 401

    link_to_delete = Link.query.get(link_id)
    
    if not link_to_delete or link_to_delete.category.user_id != user.id:
        return {"error": "找不到該連結或權限不足"}, 404
        
    try:
        db.session.delete(link_to_delete)
        db.session.commit()
        return {"message": "刪除成功！"}, 200
    except Exception as e:
        db.session.rollback()
        return {"error": str(e)}, 500


# 分類管理系統

# 新增大分類
@app.route('/api/categories', methods=['POST'])
def create_category():
    user = get_current_user()
    if not user:
        return {"error": "未登入"}, 401

    data = request.json
    if not data or not data.get('name'):
        return {"error": "缺少分類名稱"}, 400
    
    new_cat = Category(name=data['name'], user_id=user.id)
    db.session.add(new_cat)
    db.session.commit()
    
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

    category = Category.query.filter_by(id=category_id, user_id=user.id).first()
    if not category:
        return {"error": "找不到該分類或權限不足"}, 404

    new_subcat = Subcategory(name=data['name'], category_id=category_id)
    db.session.add(new_subcat)
    db.session.commit()

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

    if item_type == 'category':
        item = Category.query.filter_by(id=item_id, user_id=user.id).first()
    elif item_type == 'subcategory':
        item = Subcategory.query.get(item_id)
        if item and item.category.user_id != user.id:
            return {"error": "權限不足"}, 403
    else:
        return {"error": "無效的項目類型"}, 400

    if not item:
        return {"error": "找不到該項目"}, 404

    item.name = new_name
    db.session.commit()

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
    
    if item_type == 'category':
        item = Category.query.filter_by(id=item_id, user_id=user.id).first()
    else:
        item = Subcategory.query.get(item_id)
        if item and item.category.user_id != user.id:
            return {"error": "權限不足"}, 403
            
        if item:
            links_to_keep = Link.query.filter_by(subcategory_id=item.id).all()
            for link in links_to_keep:
                link.subcategory_id = None 
    
    if not item:
        return {"error": "找不到該分類或權限不足"}, 404
        
    db.session.delete(item)
    db.session.commit()
    return {"message": "處理成功！"}


# 初始化資料庫 (僅第一次執行時需要)
@app.route("/api/init-db", methods=['GET'])
def init_db():
    db.create_all()
    return {"message": "Database initialized successfully"}, 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002)