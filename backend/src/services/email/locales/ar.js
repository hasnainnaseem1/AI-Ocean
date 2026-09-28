/**
 * Arabic (ar) email templates.
 *
 * Same two RTL adjustments as the Urdu pack: table value cells are
 * `text-align: left` (the "end" edge once the layout sets `direction: rtl`), and
 * accent bars use `border-right` instead of `border-left`. Email clients do not
 * understand logical properties, so these have to be physical and per-language.
 *
 * Digits stay Latin (0-9) by design — the same decision the app makes, so that
 * amounts, IDs and endpoints read consistently everywhere.
 *
 * Every `{{variable}}` name is untranslated; `_interpolate` matches on the
 * English name.
 */
module.exports = {
  verification: {
    subject: 'تأكيد بريدك الإلكتروني – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">تأكيد عنوان بريدك الإلكتروني</h2>
      <p>مرحباً {{userName}}،</p>
      <p>شكراً لتسجيلك في <strong>{{siteName}}</strong>! اضغط على الزر أدناه لتأكيد عنوان بريدك الإلكتروني وتفعيل حسابك.</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{verificationLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          تأكيد البريد الإلكتروني
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">أو انسخ هذا الرابط والصقه في متصفحك:</p>
      <p style="color: {{primaryColor}}; font-size: 13px; word-break: break-all; direction: ltr; text-align: left;">{{verificationLink}}</p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        تنتهي صلاحية هذا الرابط خلال 24 ساعة. إذا لم تقم بإنشاء حساب، يمكنك تجاهل هذه الرسالة بأمان.
      </p>
    `,
  },
  welcome: {
    subject: 'مرحباً بك في {{siteName}}!',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">أهلاً بك، {{userName}}! 🎉</h2>
      <p>تم إنشاء حسابك على <strong>{{siteName}}</strong> وتأكيده بنجاح.</p>
      <p>إليك ما يمكنك فعله الآن:</p>
      <ul style="line-height: 2; color: #374151;">
        <li>استكشف لوحة التحكم والأدوات</li>
        <li>اشحن رصيدك لتشغيل نموذج</li>
        <li>تصفح كتالوج النماذج المتاحة</li>
      </ul>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{loginLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          الذهاب إلى لوحة التحكم
        </a>
      </div>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        وصلتك هذه الرسالة لأنك سجّلت في {{siteName}}.
      </p>
    `,
  },
  passwordReset: {
    subject: 'إعادة تعيين كلمة المرور – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">إعادة تعيين كلمة المرور</h2>
      <p>مرحباً {{userName}}،</p>
      <p>تلقينا طلباً لإعادة تعيين كلمة مرور حسابك على <strong>{{siteName}}</strong>.</p>
      <p>اضغط على الزر أدناه لاختيار كلمة مرور جديدة. تنتهي صلاحية هذا الرابط خلال <strong>ساعة واحدة</strong>.</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{resetLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          إعادة تعيين كلمة المرور
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">أو انسخ هذا الرابط والصقه في متصفحك:</p>
      <p style="color: {{primaryColor}}; font-size: 13px; word-break: break-all; direction: ltr; text-align: left;">{{resetLink}}</p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذه الرسالة بأمان. لن تتغير كلمة المرور.
      </p>
    `,
  },

  deploymentApproved: {
    subject: 'جارٍ تجهيز نشر {{modelName}} – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">تمت الموافقة على النشر</h2>
      <p>مرحباً {{userName}}،</p>
      <p>خبر سار — تمت الموافقة على طلبك لـ <strong>{{modelName}}</strong> وبدأ فريقنا في تجهيزه.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">النشر</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{deploymentName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">النموذج</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{modelName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">العتاد</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{tierName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">السعر</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{currency}} {{pricePerHour}}/ساعة</td></tr>
      </table>

      <p>سنرسل لك رسالة أخرى فور تشغيل نقطة الوصول الخاصة بك. لا تبدأ الفوترة إلا عند تشغيل النشر فعلياً.</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{deploymentUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          عرض النشر
        </a>
      </div>
    `,
  },

  deploymentReady: {
    subject: '{{modelName}} يعمل الآن – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">نموذجك جاهز 🚀</h2>
      <p>مرحباً {{userName}}،</p>
      <p><strong>{{deploymentName}}</strong> يعمل الآن وجاهز لاستقبال الطلبات.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">النموذج</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{modelName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">العتاد</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{tierName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">نقطة الوصول</td><td style="padding: 6px 12px; text-align: left; font-weight: 600; word-break: break-all; direction: ltr;">{{endpointUrl}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">السعر</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{currency}} {{pricePerHour}}/ساعة</td></tr>
      </table>

      <p style="color: #b45309; background: #fffbeb; border-right: 3px solid #f59e0b; padding: 12px 16px; border-radius: 6px; font-size: 14px;">
        لدواعٍ أمنية، مفتاح API غير مُضمَّن في هذه الرسالة. افتح النشر في لوحة التحكم لنسخه.
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{deploymentUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          الحصول على مفتاح API
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        بدأت الفوترة بالساعة عند تشغيل النشر. يمكنك إيقافه مؤقتاً أو نهائياً في أي وقت من لوحة التحكم لإيقاف الرسوم.
      </p>
    `,
  },

  deploymentRejected: {
    subject: 'بخصوص طلبك لـ {{modelName}} – {{siteName}}',
    body: `
      <h2 style="color: #ff4d4f; margin: 0 0 16px;">لم نتمكن من المتابعة في هذا الطلب</h2>
      <p>مرحباً {{userName}}،</p>
      <p>للأسف لم نتمكن من تجهيز <strong>{{deploymentName}}</strong> ({{modelName}}) في الوقت الحالي.</p>

      <p style="background: #fff1f0; border-right: 3px solid #ff4d4f; padding: 12px 16px; border-radius: 6px; color: #a8071a;">
        <strong>السبب:</strong> {{rejectionReason}}
      </p>

      <p>لم يتم خصم أي مبلغ مقابل هذا الطلب. إذا أردت مساعدتنا في إيجاد إعداد مناسب، رُد على هذه الرسالة أو تواصل معنا على {{supportEmail}}.</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{catalogUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          تصفح النماذج
        </a>
      </div>
    `,
  },

  deploymentSuspended: {
    subject: 'تم إيقاف النشر مؤقتاً – نفد الرصيد – {{siteName}}',
    body: `
      <h2 style="color: #faad14; margin: 0 0 16px;">تم إيقاف النشر مؤقتاً</h2>
      <p>مرحباً {{userName}}،</p>
      <p>أوقفنا <strong>{{deploymentName}}</strong> ({{modelName}}) مؤقتاً لأن رصيدك نفد. إعداداتك وبياناتك محفوظة — بمجرد شحن الرصيد يمكنك استئنافه.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">الرصيد الحالي</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{currency}} {{balance}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">السعر</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{currency}} {{pricePerHour}}/ساعة</td></tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          إضافة رصيد
        </a>
      </div>
    `,
  },

  creditTopUp: {
    subject: 'تمت إضافة رصيد – {{currency}} {{amount}} – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">تمت إضافة رصيدك</h2>
      <p>مرحباً {{userName}}،</p>
      <p>أضفنا <strong>{{currency}} {{amount}}</strong> إلى حسابك.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">المبلغ المضاف</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{currency}} {{amount}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">الرصيد الجديد</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{currency}} {{balance}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">التاريخ</td><td style="padding: 6px 12px; text-align: left; font-weight: 600;">{{paymentDate}}</td></tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          عرض المحفظة
        </a>
      </div>
    `,
  },

  lowBalance: {
    subject: 'رصيدك منخفض – {{siteName}}',
    body: `
      <h2 style="color: #faad14; margin: 0 0 16px;">رصيدك على وشك النفاد</h2>
      <p>مرحباً {{userName}}،</p>
      <p>رصيدك الحالي هو <strong>{{currency}} {{balance}}</strong>. وبمعدل استهلاكك الحالي {{currency}} {{burnRatePerDay}} يومياً، يكفي ذلك نحو <strong>{{runwayDays}} يوم</strong>.</p>
      <p>اشحن رصيدك الآن لتستمر عمليات النشر دون انقطاع — فهي تتوقف تلقائياً عند نفاد الرصيد.</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          إضافة رصيد
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        يمكنك تفعيل الشحن التلقائي من إعدادات المحفظة حتى لا يتكرر هذا.
      </p>
    `,
  },

  teamNotification: {
    subject: '{{title}} · {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">{{title}}</h2>
      <p>مرحبًا {{name}}،</p>
      <p>{{message}}</p>
      {{actionBlock}}
      <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
        وصلتك هذه الرسالة بسبب عضويتك في فريق على {{siteName}}.
      </p>
    `,
  },
  teamInvite: {
    subject: 'دعاك {{inviterName}} للانضمام إلى {{teamName}} على {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">انضم إلى {{teamName}}</h2>
      <p>مرحبًا،</p>
      <p>دعاك <strong>{{inviterName}}</strong> للانضمام إلى <strong>{{teamName}}</strong> على {{siteName}} بدور <strong>{{roleName}}</strong>.</p>
      <p>اقبل الدعوة بالحساب المرتبط بهذا البريد الإلكتروني. إن لم يكن لديك حساب بعد، يمكنك إنشاؤه من صفحة الدعوة.</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{acceptUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          قبول الدعوة
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">تنتهي صلاحية هذه الدعوة خلال {{expiresDays}} يوم. إن لم تكن تتوقعها فيمكنك تجاهل هذه الرسالة.</p>
    `,
  },
  teamRoles: {
    owner: 'المالك',
    admin: 'مسؤول',
    billing: 'الفوترة',
    developer: 'مطوّر',
    viewer: 'مشاهد',
  },
  layout: {
    rights: '&copy; {{year}} {{siteName}}. جميع الحقوق محفوظة.',
    needHelp: 'تحتاج مساعدة؟',
    logoAlt: '{{siteName}}',
  },
};
