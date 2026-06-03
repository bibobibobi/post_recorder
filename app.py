import os
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from datetime import datetime

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

@app.route('/')
def home():
    return "Hello, this is the backend for the Link Management App!"

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

# 初始化資料庫 (僅第一次執行時需要)
@app.route("/api/init-db", methods=['GET'])
def init_db():
    db.create_all()

    return {"message": "Database initialized successfully"}, 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002)