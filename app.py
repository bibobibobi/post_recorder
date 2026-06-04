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
    subcategories = db.relationship('Subcategory', backref='category', lazy=True)

class Subcategory(db.Model):
    __tablename__ = 'subcategories'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    category_id = db.Column(db.Integer, db.ForeignKey('categories.id'), nullable=False)
    links = db.relationship('Link', backref='subcategory', lazy=True)

class Link(db.Model):
    __tablename__ = 'links'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    url = db.Column(db.Text, nullable=False)
    source = db.Column(db.String(50)) # 例如: threads.net, instagram.com
    image_url = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    subcategory_id = db.Column(db.Integer, db.ForeignKey('subcategories.id'), nullable=False)

# ================= API 路由設計 =================

# ================= 登入與註冊系統 =================

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

# 1. 取得所有分類與連結 (供前端網頁顯示)
@app.route('/api/categories', methods=['GET'])
def get_categories():
    categories = Category.query.all()
    result = []
    for cat in categories:
        cat_data = {
            "id": cat.id,
            "categoryName": cat.name,
            "subcategories": []
        }
        for sub in cat.subcategories:
            sub_data = {
                "id": sub.id,
                "name": sub.name,
                "links": []
            }
            for link in sub.links:
                sub_data["links"].append({
                    "id": link.id,
                    "title": link.title,
                    "url": link.url,
                    "source": link.source,
                    "imageUrl": link.image_url or "https://via.placeholder.com/48"
                })
            cat_data["subcategories"].append(sub_data)
        result.append(cat_data)
    
    return jsonify(result), 200

# 2. 新增連結 (供 iOS 捷徑打 API 存入)
@app.route('/api/links', methods=['POST'])
def add_link():
    data = request.get_json()
    
    # 基礎驗證
    if not data or not 'url' in data or not 'subcategory_id' in data:
        return jsonify({"error": "Missing required fields"}), 400

    new_link = Link(
        title=data.get('title', '未命名連結'),
        url=data['url'],
        source=data.get('source', 'Unknown'),
        image_url=data.get('image_url', ''),
        subcategory_id=data['subcategory_id']
    )
    
    db.session.add(new_link)
    db.session.commit()
    
    return jsonify({"message": "Link added successfully", "id": new_link.id}), 201

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

# 初始化資料庫 (僅第一次執行時需要)
@app.route("/api/init-db", methods=['GET'])
def init_db():
    db.create_all()

    return {"message": "Database initialized successfully"}, 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002)