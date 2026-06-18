# 🟢 WhatsApp Webhook Server

خادم Webhook آمن وجاهز للإنتاج لـ WhatsApp Business API.

---

## ⚡ التشغيل السريع

### 1. تثبيت المتطلبات
```bash
npm install
```

### 2. إعداد المتغيرات البيئية
```bash
cp .env.example .env
```
ثم افتح ملف `.env` وأدخل قيمك:

| المتغير | من أين تحصل عليه |
|---|---|
| `VERIFY_TOKEN` | اختره أنت بحرية |
| `APP_SECRET` | Meta Developers → إعدادات التطبيق → الأساسية |
| `WHATSAPP_TOKEN` | لوحة التحكم → رمز وصول دائم |
| `PHONE_NUMBER_ID` | لوحة التحكم → إعداد واجهة API |

### 3. تشغيل الخادم
```bash
# تشغيل عادي
npm start

# تشغيل مع إعادة تحميل تلقائي (للتطوير)
npm run dev
```

---

## 🌐 النشر على الإنترنت

### خيار A: Railway (مجاني وسريع)
1. اذهب إلى [railway.app](https://railway.app)
2. اربط مستودع GitHub
3. أضف المتغيرات البيئية من لوحة Railway
4. ستحصل على رابط مثل: `https://xxx.railway.app`

### خيار B: Render (مجاني)
1. اذهب إلى [render.com](https://render.com)
2. New → Web Service → ربط GitHub
3. أضف المتغيرات البيئية
4. ستحصل على رابط مثل: `https://xxx.onrender.com`

### خيار C: الاختبار المحلي بـ ngrok
```bash
# تثبيت ngrok
npm install -g ngrok

# في terminal أول
npm start

# في terminal ثانٍ
ngrok http 3000
```
ستحصل على رابط مثل: `https://abc123.ngrok.io`

---

## ⚙️ ربط Webhook في Meta

1. افتح [لوحة Meta Developers](https://developers.facebook.com)
2. تطبيقك → **التكوين**
3. في حقل **عنوان URL للاستدعاء**: أدخل `https://YOUR_URL/webhook`
4. في حقل **تحقق من الرمز**: أدخل قيمة `VERIFY_TOKEN` من ملف `.env`
5. اضغط **تحقق وحفظ**
6. فعّل الاشتراك في: `messages`

---

## 🔒 ميزات الأمان

- ✅ التحقق من توقيع Meta (HMAC SHA-256)
- ✅ Rate limiting (100 طلب/دقيقة لكل IP)
- ✅ Security headers (XSS, Clickjacking)
- ✅ تسجيل كامل للأحداث في ملفات يومية
- ✅ معالجة الأخطاء بشكل آمن

---

## 📡 نقاط النهاية (Endpoints)

| المسار | الطريقة | الوصف |
|---|---|---|
| `/webhook` | GET | التحقق من Webhook |
| `/webhook` | POST | استقبال الرسائل والأحداث |
| `/health` | GET | فحص حالة الخادم |

---

## 📂 هيكل المشروع

```
whatsapp-webhook/
├── src/
│   └── server.js      # الخادم الرئيسي
├── logs/              # ملفات السجل (تُنشأ تلقائياً)
├── .env.example       # نموذج المتغيرات البيئية
├── .env               # متغيراتك (لا ترفعه لـ GitHub)
├── .gitignore
└── package.json
```
