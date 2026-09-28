/**
 * Urdu (ur) email templates.
 *
 * Har `{{variable}}` hubahu English pack jaisa hai — `_interpolate` inhi naamon
 * ko dhoondta hai, to inka tarjuma karne se value khali reh jati hai.
 *
 * RTL ke liye do cheezein jaan-boojh kar badli gayi hain:
 *  - table ke value cells `text-align: left` hain (English mein `right`). Layout
 *    content cell par `direction: rtl` lagta hai, to cell ka "end" ab baayein
 *    hai — `right` chhorne se value apne hi column ke ghalat kinare par chipak
 *    jati.
 *  - accent bar `border-left` ki jagah `border-right` hai, taake wo paragraph ke
 *    shuru waale kinare par rahe.
 * Logical properties (`border-inline-start`) yahan mumkin nahi — email clients
 * unhe support nahi karte, isliye physical values per-language likhi jati hain.
 *
 * Digits Latin (0-9) hi rehte hain, bilkul app ki tarah.
 */
module.exports = {
  verification: {
    subject: 'اپنے ای میل کی تصدیق کریں – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">اپنے ای میل ایڈریس کی تصدیق کریں</h2>
      <p>سلام {{userName}}،</p>
      <p><strong>{{siteName}}</strong> پر سائن اپ کرنے کا شکریہ! اپنا ای میل ایڈریس تصدیق کرنے اور اکاؤنٹ فعال کرنے کے لیے نیچے دیے گئے بٹن پر کلک کریں۔</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{verificationLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          ای میل ایڈریس کی تصدیق کریں
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">یا یہ لنک کاپی کر کے اپنے براؤزر میں کھولیں:</p>
      <p style="color: {{primaryColor}}; font-size: 13px; word-break: break-all; direction: ltr; text-align: left;">{{verificationLink}}</p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        یہ لنک 24 گھنٹے بعد ختم ہو جائے گا۔ اگر آپ نے اکاؤنٹ نہیں بنایا تو اس ای میل کو نظر انداز کر دیں۔
      </p>
    `,
  },
  welcome: {
    subject: '{{siteName}} میں خوش آمدید!',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">خوش آمدید، {{userName}}! 🎉</h2>
      <p><strong>{{siteName}}</strong> پر آپ کا اکاؤنٹ بن گیا ہے اور اس کی تصدیق مکمل ہو چکی ہے۔</p>
      <p>اب آپ یہ کر سکتے ہیں:</p>
      <ul style="line-height: 2; color: #374151;">
        <li>اپنا ڈیش بورڈ اور ٹولز دیکھیں</li>
        <li>ماڈل چلانے کے لیے اپنا کریڈٹ بیلنس ٹاپ اپ کریں</li>
        <li>دستیاب ماڈلز کے لیے کیٹلاگ دیکھیں</li>
      </ul>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{loginLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          ڈیش بورڈ پر جائیں
        </a>
      </div>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        آپ کو یہ ای میل اس لیے موصول ہوئی کیونکہ آپ نے {{siteName}} پر سائن اپ کیا ہے۔
      </p>
    `,
  },
  passwordReset: {
    subject: 'اپنا پاس ورڈ ری سیٹ کریں – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">اپنا پاس ورڈ ری سیٹ کریں</h2>
      <p>سلام {{userName}}،</p>
      <p>ہمیں آپ کے <strong>{{siteName}}</strong> اکاؤنٹ کا پاس ورڈ ری سیٹ کرنے کی درخواست موصول ہوئی ہے۔</p>
      <p>نیا پاس ورڈ منتخب کرنے کے لیے نیچے دیے گئے بٹن پر کلک کریں۔ یہ لنک <strong>1 گھنٹے</strong> بعد ختم ہو جائے گا۔</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{resetLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          پاس ورڈ ری سیٹ کریں
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">یا یہ لنک کاپی کر کے اپنے براؤزر میں کھولیں:</p>
      <p style="color: {{primaryColor}}; font-size: 13px; word-break: break-all; direction: ltr; text-align: left;">{{resetLink}}</p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        اگر آپ نے پاس ورڈ ری سیٹ کی درخواست نہیں کی تو اس ای میل کو نظر انداز کر دیں۔ آپ کا پاس ورڈ تبدیل نہیں ہوگا۔
      </p>
    `,
  },

  deploymentApproved: {
    subject: 'آپ کی {{modelName}} ڈیپلائمنٹ تیار کی جا رہی ہے – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">آپ کی ڈیپلائمنٹ منظور ہو گئی ہے</h2>
      <p>سلام {{userName}}،</p>
      <p>اچھی خبر — <strong>{{modelName}}</strong> کے لیے آپ کی درخواست منظور ہو گئی ہے اور ہماری ٹیم نے اسے تیار کرنا شروع کر دیا ہے۔</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">ڈیپلائمنٹ</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{deploymentName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">ماڈل</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{modelName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">ہارڈویئر</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{tierName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">ریٹ</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{currency}} {{pricePerHour}}/گھنٹہ</td></tr>
      </table>

      <p>جیسے ہی آپ کا اینڈ پوائنٹ لائیو ہوگا، ہم آپ کو دوبارہ ای میل کریں گے۔ بلنگ صرف اسی وقت شروع ہوتی ہے جب ڈیپلائمنٹ چل رہی ہو۔</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{deploymentUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          ڈیپلائمنٹ دیکھیں
        </a>
      </div>
    `,
  },

  deploymentReady: {
    subject: '{{modelName}} لائیو ہو گیا – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">آپ کا ماڈل تیار ہے 🚀</h2>
      <p>سلام {{userName}}،</p>
      <p><strong>{{deploymentName}}</strong> اب چل رہا ہے اور درخواستیں قبول کرنے کے لیے تیار ہے۔</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">ماڈل</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{modelName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">ہارڈویئر</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{tierName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">اینڈ پوائنٹ</td><td style="padding: 6px 12px; text-align: left; font-weight: 600; word-break: break-all; direction: ltr;">{{endpointUrl}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">ریٹ</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{currency}} {{pricePerHour}}/گھنٹہ</td></tr>
      </table>

      <p style="color: #b45309; background: #fffbeb; border-right: 3px solid #f59e0b; padding: 12px 16px; border-radius: 6px; font-size: 14px;">
        سیکیورٹی کی وجہ سے آپ کی API key اس ای میل میں شامل نہیں ہے۔ اسے کاپی کرنے کے لیے ڈیش بورڈ میں اپنی ڈیپلائمنٹ کھولیں۔
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{deploymentUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          API key حاصل کریں
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        ڈیپلائمنٹ لائیو ہوتے ہی فی گھنٹہ بلنگ شروع ہو گئی ہے۔ چارجز روکنے کے لیے آپ اسے کسی بھی وقت ڈیش بورڈ سے روک یا بند کر سکتے ہیں۔
      </p>
    `,
  },

  deploymentRejected: {
    subject: 'آپ کی {{modelName}} درخواست کے بارے میں – {{siteName}}',
    body: `
      <h2 style="color: #ff4d4f; margin: 0 0 16px;">ہم یہ درخواست آگے نہیں بڑھا سکے</h2>
      <p>سلام {{userName}}،</p>
      <p>افسوس کے ساتھ، ہم اس وقت <strong>{{deploymentName}}</strong> ({{modelName}}) تیار نہیں کر سکے۔</p>

      <p style="background: #fff1f0; border-right: 3px solid #ff4d4f; padding: 12px 16px; border-radius: 6px; color: #a8071a;">
        <strong>وجہ:</strong> {{rejectionReason}}
      </p>

      <p>اس درخواست کے لیے آپ سے کوئی رقم نہیں لی گئی۔ اگر آپ چاہتے ہیں کہ ہم کوئی ایسی کنفیگریشن تلاش کرنے میں مدد کریں جو چل سکے، تو اس ای میل کا جواب دیں یا {{supportEmail}} پر ہم سے رابطہ کریں۔</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{catalogUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          ماڈلز دیکھیں
        </a>
      </div>
    `,
  },

  deploymentSuspended: {
    subject: 'ڈیپلائمنٹ روک دی گئی – کریڈٹ ختم – {{siteName}}',
    body: `
      <h2 style="color: #faad14; margin: 0 0 16px;">آپ کی ڈیپلائمنٹ روک دی گئی ہے</h2>
      <p>سلام {{userName}}،</p>
      <p>ہم نے <strong>{{deploymentName}}</strong> ({{modelName}}) اس لیے روک دی ہے کیونکہ آپ کا کریڈٹ بیلنس ختم ہو گیا۔ آپ کی کنفیگریشن اور ڈیٹا محفوظ ہے — ٹاپ اپ کرنے پر آپ اسے دوبارہ چلا سکیں گے۔</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">موجودہ بیلنس</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{currency}} {{balance}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">ریٹ</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{currency}} {{pricePerHour}}/گھنٹہ</td></tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          کریڈٹ شامل کریں
        </a>
      </div>
    `,
  },

  creditTopUp: {
    subject: 'کریڈٹ شامل ہو گیا – {{currency}} {{amount}} – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">آپ کا کریڈٹ شامل کر دیا گیا ہے</h2>
      <p>سلام {{userName}}،</p>
      <p>ہم نے آپ کے اکاؤنٹ میں <strong>{{currency}} {{amount}}</strong> شامل کر دیے ہیں۔</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">شامل کی گئی رقم</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{currency}} {{amount}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">نیا بیلنس</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{currency}} {{balance}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">تاریخ</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{paymentDate}}</td></tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          والٹ دیکھیں
        </a>
      </div>
    `,
  },

  lowBalance: {
    subject: 'کریڈٹ بیلنس کم ہے – {{siteName}}',
    body: `
      <h2 style="color: #faad14; margin: 0 0 16px;">آپ کا بیلنس کم ہوتا جا رہا ہے</h2>
      <p>سلام {{userName}}،</p>
      <p>آپ کا کریڈٹ بیلنس <strong>{{currency}} {{balance}}</strong> ہے۔ آپ کے موجودہ استعمال {{currency}} {{burnRatePerDay}} فی دن کے حساب سے یہ تقریباً <strong>{{runwayDays}} دن</strong> چلے گا۔</p>
      <p>اپنی ڈیپلائمنٹس بغیر رکاوٹ چلانے کے لیے ابھی ٹاپ اپ کریں — بیلنس ختم ہونے پر وہ خود بخود روک دی جاتی ہیں۔</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          کریڈٹ شامل کریں
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        آپ اپنی والٹ سیٹنگز میں آٹو ٹاپ اپ آن کر سکتے ہیں تاکہ ایسا دوبارہ نہ ہو۔
      </p>
    `,
  },

  teamNotification: {
    subject: '{{title}} · {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">{{title}}</h2>
      <p>السلام علیکم {{name}}،</p>
      <p>{{message}}</p>
      {{actionBlock}}
      <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
        یہ پیغام آپ کو {{siteName}} پر ایک تنظیم کی رکنیت کی وجہ سے موصول ہوا ہے۔
      </p>
    `,
  },
  teamInvite: {
    subject: '{{inviterName}} نے آپ کو {{siteName}} پر {{teamName}} میں مدعو کیا ہے',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">{{teamName}} میں شامل ہوں</h2>
      <p>سلام،</p>
      <p><strong>{{inviterName}}</strong> نے آپ کو {{siteName}} پر <strong>{{teamName}}</strong> میں بطور <strong>{{roleName}}</strong> شامل ہونے کی دعوت دی ہے۔</p>
      <p>اسی ای میل ایڈریس والے اکاؤنٹ سے قبول کریں۔ اگر ابھی اکاؤنٹ نہیں ہے تو دعوت والے صفحے سے بنا سکتے ہیں۔</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{acceptUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          دعوت قبول کریں
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">یہ دعوت {{expiresDays}} دن میں ختم ہو جائے گی۔ اگر آپ کو اس کی توقع نہیں تھی تو یہ ای میل نظر انداز کر دیں۔</p>
    `,
  },
  teamRoles: {
    owner: 'مالک',
    admin: 'ایڈمن',
    billing: 'بلنگ',
    developer: 'ڈیولپر',
    viewer: 'ناظر',
  },
  layout: {
    rights: '&copy; {{year}} {{siteName}}۔ جملہ حقوق محفوظ ہیں۔',
    needHelp: 'مدد چاہیے؟',
    logoAlt: '{{siteName}}',
  },
};
