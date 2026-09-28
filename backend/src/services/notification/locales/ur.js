/**
 * Urdu (ur) notification copy.
 *
 * Every `{placeholder}` keeps its English name — `render()` matches on the name,
 * so translating it leaves the value out of the sentence.
 *
 * Three keys carry an empty `message` in the English catalogue because their
 * body is the operator's own text from the Admin Center. They are omitted here
 * entirely: the merge falls back per field, so their titles come from this file
 * and their bodies stay whatever the operator wrote.
 */
module.exports = {
  'deployment.movedToPrepaid': {
    title: 'ڈپلائمنٹ پری پیڈ پر منتقل',
    message: 'آپ کے اکاؤنٹ پر اب پے ایز یو گو دستیاب نہیں، اس لیے "{deploymentName}" اب آپ کے پری پیڈ بیلنس سے چلے گی۔ اب تک کا استعمال پے ایز یو گو کے طور پر بل ہو چکا ہے۔ اسے چلتا رکھنے کے لیے والٹ میں کریڈٹ رکھیں۔',
  },
  'team.spendLimitNear': {
    title: 'خرچ کی حد قریب ہے',
    message: '{memberName} نے {teamName} میں اپنی {currency} {limit} ماہانہ حد کا {percent}% استعمال کر لیا ہے۔',
  },
  'team.spendLimitReached': {
    title: 'خرچ کی حد پوری ہو گئی',
    message: '{memberName} نے {teamName} میں اپنی {currency} {limit} ماہانہ حد پوری کر لی ہے۔ اگلے مہینے یا حد بڑھانے تک وہ نئی ڈپلائمنٹس شروع نہیں کر سکتے۔',
  },
  'team.ownershipOffered': {
    title: 'آپ کو ملکیت کی پیشکش ہوئی ہے',
    message: '{fromName} نے آپ کو {teamName} کی ملکیت کی پیشکش کی ہے۔ قبول کریں تو اکاؤنٹ آپ کے ذمے آ جائے گا، انکار کریں تو انہی کے پاس رہے گا۔',
  },
  'team.ownershipAccepted': {
    title: 'ملکیت منتقل ہو گئی',
    message: 'اب {teamName} کے مالک {toName} ہیں۔ آپ اس کے ایڈمن ہیں۔',
  },
  'team.ownershipDeclined': {
    title: 'ملکیت سے انکار',
    message: '{toName} نے {teamName} کی ملکیت لینے سے انکار کر دیا۔ آپ ہی اس کے مالک ہیں۔',
  },
  'team.closed': {
    title: 'جس ٹیم میں آپ تھے وہ بند کر دی گئی',
    message: '{teamName} کو اس کے مالک نے بند کر دیا ہے۔ اب آپ کی اس تک رسائی نہیں رہی۔',
  },
  'team.domainJoined': {
    title: 'کوئی آپ کے ڈومین سے شامل ہوا',
    message: '{memberName} ({memberEmail}) خود بخود {teamName} میں شامل ہو گئے، کیونکہ آپ کا ڈومین اصول {domain} والے ہر شخص کو اجازت دیتا ہے۔',
  },
  'team.joinRequested': {
    title: 'کسی نے شامل ہونے کی درخواست دی',
    message: '{memberName} ({memberEmail}) نے {teamName} میں شامل ہونے کی درخواست دی ہے۔',
  },
  'team.joinApproved': {
    title: 'آپ شامل ہو گئے',
    message: '{teamName} میں شامل ہونے کی آپ کی درخواست منظور ہو گئی۔',
  },
  'team.joinDeclined': {
    title: 'آپ کی درخواست منظور نہیں ہوئی',
    message: '{teamName} میں شامل ہونے کی آپ کی درخواست منظور نہیں ہوئی۔',
  },
  'team.addedByAdmin': {
    title: 'آپ کو ایک تنظیم میں شامل کیا گیا',
    message: 'سپورٹ نے آپ کو {teamName} میں شامل کر دیا ہے۔',
  },
  'team.removedByAdmin': {
    title: 'آپ کو تنظیم سے نکال دیا گیا',
    message: 'اب {teamName} تک آپ کی رسائی نہیں رہی۔',
  },
  'deployment.approved': {
    title: 'ڈیپلائمنٹ منظور ہو گئی',
    message: 'آپ کی {modelName} ڈیپلائمنٹ "{deploymentName}" منظور ہو گئی ہے اور تیار کی جا رہی ہے۔',
  },
  'deployment.ready': {
    title: 'آپ کا ماڈل لائیو ہے',
    message: '"{deploymentName}" چل رہا ہے اور درخواستیں قبول کرنے کے لیے تیار ہے۔',
  },
  'deployment.keyRotated': {
    title: 'نئی API key جاری کر دی گئی',
    message: '"{deploymentName}" دوبارہ چل رہا ہے۔ چونکہ یہ معطل ہوا تھا، اس لیے نئی API key جاری کی '
      + 'گئی ہے اور پرانی اب کام نہیں کرتی — اگلی درخواست سے پہلے ڈیپلائمنٹ صفحے سے نئی key کاپی کر لیں۔',
  },
  'deployment.rejected': {
    title: 'ڈیپلائمنٹ کی درخواست مسترد',
    message: '{reason}',
  },
  'deployment.rejectedNoReason': {
    title: 'ڈیپلائمنٹ کی درخواست مسترد',
    message: 'آپ کی ڈیپلائمنٹ کی درخواست پوری نہیں کی جا سکی۔',
  },
  'deployment.pausedNoCredit': {
    title: 'ڈیپلائمنٹ روک دی گئی — کریڈٹ ختم',
  },
  'deployment.pausedCardRequired': {
    title: 'ڈیپلائمنٹ روک دی گئی — تصدیق شدہ کارڈ درکار',
  },

  'credit.lowBalanceHours': {
    title: 'کریڈٹ بیلنس کم ہے',
    message: 'آپ کا بیلنس {currency} {balance} ہے — آپ کے موجودہ استعمال {currency} {burnRatePerHour} '
      + 'فی گھنٹہ کے حساب سے یہ تقریباً {runway} گھنٹے چلے گا۔ رکاوٹ سے بچنے کے لیے ٹاپ اپ کریں۔',
  },
  'credit.lowBalanceDays': {
    title: 'کریڈٹ بیلنس کم ہے',
    message: 'آپ کا بیلنس {currency} {balance} ہے — آپ کے موجودہ استعمال {currency} {burnRatePerHour} '
      + 'فی گھنٹہ کے حساب سے یہ تقریباً {runway} دن چلے گا۔ رکاوٹ سے بچنے کے لیے ٹاپ اپ کریں۔',
  },
  'credit.pausingSoon': {
    title: 'آپ کی ڈیپلائمنٹس جلد رک جائیں گی',
    message: 'آپ کا بیلنس {currency} {balance} ہے — آپ کے موجودہ استعمال {currency} {burnRatePerHour} '
      + 'فی گھنٹہ کے حساب سے یہ تقریباً {runway} گھنٹے چلے گا۔ رکاوٹ سے بچنے کے لیے ٹاپ اپ کریں۔',
  },
  'credit.adjustedUp': {
    title: 'آپ کے اکاؤنٹ میں کریڈٹ شامل ہوا',
    message: '+{amount} {currency}۔ نیا بیلنس: {balance} {currency}۔{note}',
  },
  'credit.adjustedDown': {
    title: 'اکاؤنٹ کا بیلنس تبدیل کیا گیا',
    message: '{amount} {currency}۔ نیا بیلنس: {balance} {currency}۔{note}',
  },
  'debt.collected': {
    title: 'واجب الادا رقم ادا ہو گئی',
    message: 'آپ کی واجب الادا رقم ادا کرنے کے لیے آپ کے کارڈ سے {currency} {amount} وصول کیے گئے۔',
  },
  'debt.collectionFailed': {
    title: 'آپ کی واجب الادا رقم وصول نہیں ہو سکی',
    message: 'ہم نے آپ کی واجب الادا رقم ادا کرنے کے لیے آپ کے کارڈ سے {currency} {amount} وصول کرنے '
      + 'کی کوشش کی، مگر ناکام رہے ({error})۔ براہِ کرم اپنا ادائیگی کا طریقہ اپ ڈیٹ کریں یا رقم شامل کریں۔',
  },
  'debt.pausedOverLimit': {
    title: 'ڈیپلائمنٹ روک دی گئی — واجب الادا رقم',
    message: '"{deploymentName}" اس لیے روک دی گئی کیونکہ آپ کی واجب الادا رقم پلیٹ فارم کی حد سے '
      + 'بڑھ گئی ہے۔ دوبارہ چلانے کے لیے یہ رقم ادا کریں۔',
  },
  'debt.pausedTooOld': {
    title: 'ڈیپلائمنٹ روک دی گئی — واجب الادا رقم',
    message: '"{deploymentName}" اس لیے روک دی گئی کیونکہ آپ کی واجب الادا رقم بہت عرصے سے ادا نہیں '
      + 'ہوئی۔ دوبارہ چلانے کے لیے یہ رقم ادا کریں۔',
  },

  'storage.terminated': {
    title: 'ڈیپلائمنٹ ختم کر دی گئی — اسٹوریج کی رقم ادا نہیں ہوئی',
    message: '"{deploymentName}" اس لیے ختم کر دی گئی کیونکہ اس کی اسٹوریج کی رقم {graceDays} دن سے '
      + 'زیادہ عرصے تک ادا نہیں ہوئی۔ واجب الادا رقم اب بھی واجب ہے۔',
  },
  'storage.warning': {
    title: 'اسٹوریج کی رقم ادا نہیں ہوئی — کارروائی درکار',
  },

  'card.expired': {
    title: 'آپ کا محفوظ کارڈ ختم ہو گیا',
    message: 'آپ کا {brand} کارڈ جس کے آخری ہندسے {last4} ہیں، ختم ہو گیا ہے۔ pay-as-you-go اور خودکار '
      + 'ٹاپ اپ چالو رکھنے کے لیے نیا کارڈ شامل کریں۔',
  },
  'card.expiring': {
    title: 'آپ کا محفوظ کارڈ جلد ختم ہو رہا ہے',
    message: 'آپ کا {brand} کارڈ جس کے آخری ہندسے {last4} ہیں، {days} دن میں ختم ہو جائے گا۔ رکاوٹ سے '
      + 'بچنے کے لیے اس سے پہلے نیا کارڈ شامل کریں۔',
  },

  'account.emailVerified': {
    title: 'ای میل تصدیق شدہ',
    message: 'آپ کے ای میل کی تصدیق ایڈمن نے کر دی ہے۔ اب آپ تمام سہولیات استعمال کر سکتے ہیں۔',
  },
  'account.suspended': {
    title: 'اکاؤنٹ معطل',
    message: 'آپ کا اکاؤنٹ معطل کر دیا گیا ہے۔ مزید معلومات کے لیے سپورٹ سے رابطہ کریں۔',
  },
  'account.suspendedWithReason': {
    title: 'اکاؤنٹ معطل',
    message: '{reason}',
  },
  'account.activated': {
    title: 'اکاؤنٹ فعال',
    message: 'آپ کا اکاؤنٹ فعال کر دیا گیا ہے۔ اب آپ تمام سہولیات استعمال کر سکتے ہیں۔',
  },
  'account.statusSuspended': {
    title: 'اکاؤنٹ کی حالت تبدیل ہوئی',
    message: 'آپ کا اکاؤنٹ معطل کر دیا گیا ہے۔ مدد کے لیے سپورٹ سے رابطہ کریں۔',
  },
  'account.statusActivated': {
    title: 'اکاؤنٹ کی حالت تبدیل ہوئی',
    message: 'آپ کا اکاؤنٹ فعال کر دیا گیا ہے۔ اب آپ تمام سہولیات استعمال کر سکتے ہیں۔',
  },
  'account.updatedByAdmin': {
    title: 'اکاؤنٹ اپ ڈیٹ ہوا',
    message: 'آپ کا اکاؤنٹ {adminName} نے اپ ڈیٹ کیا ہے۔',
  },
  'admin.welcome': {
    title: 'ایڈمن پینل میں خوش آمدید',
    message: 'آپ کا ایڈمن اکاؤنٹ {adminName} نے بنایا ہے۔ آپ کا کردار ہے: {role}۔',
  },
};
