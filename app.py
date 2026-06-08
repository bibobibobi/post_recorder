import os
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

load_dotenv() # 載入 .env 檔案中的環境變數

app = Flask(__name__)
CORS(app) # 允許前端跨來源請求

app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# ================= 資料庫模型設計 =================

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)

class Category(db.Model):
    __tablename__ = 'categories'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
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
    
    # 必填：每個連結「一定」要屬於某個大分類
    category_id = db.Column(db.Integer, db.ForeignKey('categories.id'), nullable=False)
    
    # 選填 (nullable=True)：小分類變成可有可無的標籤
    subcategory_id = db.Column(db.Integer, db.ForeignKey('subcategories.id'), nullable=True)

# ================= API 路由設計 =================

# 登入與註冊系統

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    
    # 1. 檢查通關密語 (防護機制)
    if data.get('invite_code') != os.getenv('INVITE_CODE'):
        return {"error": "註冊碼錯誤，拒絕註冊！"}, 403

    # 2. 檢查帳號是否已經存在
    if User.query.filter_by(username=data.get('username')).first():
        return {"error": "這個帳號已經被註冊過囉！"}, 400

    # 3. 密碼加密並存入資料庫
    hashed_password = generate_password_hash(data.get('password'))
    new_user = User(username=data.get('username'), password_hash=hashed_password)
    
    db.session.add(new_user)
    db.session.commit()
    
    return {"message": "帳號建立成功！"}, 201


@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    
    # 1. 去資料庫尋找這個帳號
    user = User.query.filter_by(username=data.get('username')).first()

    # 2. 驗證帳號存在，且密碼的 Hash 吻合
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
    # 允許 Flask 順便提供同資料夾下的 css 和 js 檔案給網頁使用
    # ⚠️ 安全白名單：我們只允許讀取特定檔案，防止駭客讀取到你的 .env 密碼檔！
    allowed_files = ['style.css', 'app.js', 'manifest.json', 'icon-192.png']
    if filename in allowed_files:
        return send_file(filename)
    return {"error": "找不到檔案或沒有讀取權限"}, 404

# 取得所有分類與連結 (升級版)
@app.route('/api/categories', methods=['GET'])
def get_categories():
    categories = Category.query.all()
    result = []
    for cat in categories:
        # 1. 抓出「直接屬於大分類，且沒有小分類」的連結
        direct_links = Link.query.filter_by(category_id=cat.id, subcategory_id=None).all()
        
        cat_data = {
            "id": cat.id,
            "name": cat.name,
            # 把直接關聯的連結放進來
            "links": [{"id": l.id, "title": l.title, "url": l.url, "source": l.source} for l in direct_links],
            "subcategories": []
        }
        
        # 2. 抓出屬於小分類的連結
        for sub in cat.subcategories:
            sub_links = Link.query.filter_by(subcategory_id=sub.id).all()
            cat_data["subcategories"].append({
                "id": sub.id,
                "name": sub.name,
                "links": [{"id": l.id, "title": l.title, "url": l.url, "source": l.source} for l in sub_links]
            })
            
        result.append(cat_data)
        
    return jsonify(result), 200

# 新增連結 API (升級版)
@app.route('/api/links', methods=['POST'])
def add_link():
    data = request.json
    # 現在 category_id 是必填了
    if not data or not data.get('url') or not data.get('category_id'):
        return {"error": "缺少必要欄位 (需包含 url 與 category_id)"}, 400
        
    new_link = Link(
        title=data.get('title', '無標題'),
        url=data['url'],
        source=data.get('source', '未提供'),
        category_id=data['category_id'],
        # 如果前端沒有傳小分類，這裡就會是 None，完美符合我們的設計
        subcategory_id=data.get('subcategory_id') 
    )
    db.session.add(new_link)
    db.session.commit()
    return {"message": "連結新增成功！"}, 201

# 刪除連結
@app.route('/api/links/<int:link_id>', methods=['DELETE'])
def delete_link(link_id):
    # 利用傳入的 link_id 去資料庫尋找該筆資料 (假設你的資料表類別叫做 Link)
    link_to_delete = Link.query.get(link_id)
    
    if not link_to_delete:
        return {"error": "找不到該連結"}, 404
        
    try:
        db.session.delete(link_to_delete)
        db.session.commit()
        return {"message": "刪除成功！"}, 200
    except Exception as e:
        db.session.rollback() # 發生錯誤時退回，保護資料庫
        return {"error": str(e)}, 500

# 分類管理系統
    #新增大分類
@app.route('/api/categories', methods=['POST'])
def create_category():
    data = request.json
    if not data or not data.get('name'):
        return {"error": "缺少分類名稱"}, 400
    
    new_cat = Category(name=data['name'])
    db.session.add(new_cat)
    db.session.commit()
    
    return {"message": "分類建立成功", "id": new_cat.id}, 201

    #新增子分類
@app.route('/api/categories/<int:category_id>/subcategories', methods=['POST'])
def create_subcategory(category_id):
    data = request.json
    if not data or not data.get('name'):
        return {"error": "缺少子分類名稱"}, 400

    category = Category.query.get(category_id)
    if not category:
        return {"error": "找不到該分類"}, 404

    new_subcat = Subcategory(name=data['name'], category_id=category_id)
    db.session.add(new_subcat)
    db.session.commit()

    return {"message": "子分類建立成功", "id": new_subcat.id}, 201

    # 更新分類名稱
@app.route('/api/rename', methods=['PUT'])
def rename_category():
    data = request.json
    item_type = data.get('type') # 'category' 或 'subcategory'
    item_id = data.get('id')
    new_name = data.get('new_name')

    if not all([item_type, item_id, new_name]):
        return {"error": "缺少必要欄位"}, 400

    if item_type == 'category':
        item = Category.query.get(item_id)
    elif item_type == 'subcategory':
        item = Subcategory.query.get(item_id)
    else:
        return {"error": "無效的項目類型"}, 400

    if not item:
        return {"error": "找不到該項目"}, 404

    item.name = new_name
    db.session.commit()

    return {"message": "名稱更新成功"}, 200

# 刪除分類 API (升級刪除邏輯)
@app.route('/api/delete_category', methods=['DELETE'])
def delete_any_category():
    data = request.json
    item_type = data.get('type') 
    item_id = data.get('id')
    
    if item_type == 'category':
        item = Category.query.get(item_id)
    else:
        item = Subcategory.query.get(item_id)
        # 關鍵溫柔設計：刪除小分類時，把它底下的連結「釋放」回大分類
        if item:
            links_to_keep = Link.query.filter_by(subcategory_id=item.id).all()
            for link in links_to_keep:
                link.subcategory_id = None # 拔掉小分類標籤
    
    if not item:
        return {"error": "找不到該分類"}, 404
        
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