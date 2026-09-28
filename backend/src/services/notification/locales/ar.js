/**
 * Arabic (ar) notification copy.
 *
 * Every `{placeholder}` keeps its English name — `render()` matches on the name.
 *
 * The three operator-authored bodies are omitted: the merge falls back per
 * field, so their titles come from here and their bodies stay as the operator
 * wrote them in the Admin Center.
 *
 * Digits stay Latin (0-9), matching the app and the emails.
 */
module.exports = {
  'deployment.movedToPrepaid': {
    title: 'تم نقل النشر إلى الدفع المسبق',
    message: 'لم يعد الدفع حسب الاستخدام متاحًا في حسابك، لذا يعمل "{deploymentName}" الآن من رصيدك المدفوع مسبقًا. تمت فوترة الاستخدام حتى الآن بنظام الدفع حسب الاستخدام. احتفظ برصيد في محفظتك ليستمر في العمل.',
  },
  'team.spendLimitNear': {
    title: 'اقترب بلوغ حد الإنفاق',
    message: 'استخدم {memberName} نسبة {percent}% من حده الشهري البالغ {currency} {limit} في {teamName}.',
  },
  'team.spendLimitReached': {
    title: 'تم بلوغ حد الإنفاق',
    message: 'بلغ {memberName} حده الشهري البالغ {currency} {limit} في {teamName}. لا يمكنه بدء عمليات نشر جديدة حتى الشهر القادم أو حتى ترفع الحد.',
  },
  'team.ownershipOffered': {
    title: 'عُرضت عليك ملكية الفريق',
    message: 'عرض عليك {fromName} ملكية {teamName}. اقبل لتتولى الحساب، أو ارفض ليبقى معه.',
  },
  'team.ownershipAccepted': {
    title: 'تم نقل الملكية',
    message: '{toName} هو الآن مالك {teamName}. وأنت مسؤول فيه.',
  },
  'team.ownershipDeclined': {
    title: 'رُفض نقل الملكية',
    message: 'رفض {toName} ملكية {teamName}. ما زلت أنت المالك.',
  },
  'team.closed': {
    title: 'أُغلق فريق كنت فيه',
    message: 'أغلق مالك {teamName} الفريق. لم يعد لديك وصول إليه.',
  },
  'team.domainJoined': {
    title: 'انضم شخص عبر نطاقك',
    message: 'انضم {memberName} ({memberEmail}) إلى {teamName} تلقائيًا، لأن قاعدة نطاقك تسمح لكل من لديه بريد على {domain}.',
  },
  'team.joinRequested': {
    title: 'طلب أحدهم الانضمام',
    message: 'طلب {memberName} ({memberEmail}) الانضمام إلى {teamName}.',
  },
  'team.joinApproved': {
    title: 'تمت إضافتك',
    message: 'تمت الموافقة على طلب انضمامك إلى {teamName}.',
  },
  'team.joinDeclined': {
    title: 'رُفض طلبك',
    message: 'لم تتم الموافقة على طلب انضمامك إلى {teamName}.',
  },
  'team.addedByAdmin': {
    title: 'أُضفت إلى فريق',
    message: 'أضافك الدعم إلى {teamName}.',
  },
  'team.removedByAdmin': {
    title: 'أُزلت من فريق',
    message: 'لم يعد لديك وصول إلى {teamName}.',
  },
  'deployment.approved': {
    title: 'تمت الموافقة على النشر',
    message: 'تمت الموافقة على نشر {modelName} الخاص بك "{deploymentName}" وجارٍ تجهيزه.',
  },
  'deployment.ready': {
    title: 'نموذجك يعمل الآن',
    message: '"{deploymentName}" يعمل الآن وجاهز لاستقبال الطلبات.',
  },
  'deployment.keyRotated': {
    title: 'تم إصدار مفتاح API جديد',
    message: '"{deploymentName}" يعمل من جديد. وبما أنه كان موقوفاً، تم إصدار مفتاح API جديد ولم يعد '
      + 'المفتاح السابق صالحاً — انسخ المفتاح الجديد من صفحة النشر قبل طلبك التالي.',
  },
  'deployment.rejected': {
    title: 'تم رفض طلب النشر',
    message: '{reason}',
  },
  'deployment.rejectedNoReason': {
    title: 'تم رفض طلب النشر',
    message: 'تعذّر تنفيذ طلب النشر الخاص بك.',
  },
  'deployment.pausedNoCredit': {
    title: 'تم إيقاف النشر مؤقتاً — نفد الرصيد',
  },
  'deployment.pausedCardRequired': {
    title: 'تم إيقاف النشر مؤقتاً — مطلوب بطاقة مُوثّقة',
  },

  'credit.lowBalanceHours': {
    title: 'رصيدك منخفض',
    message: 'رصيدك هو {currency} {balance} — أي نحو {runway} ساعة بمعدل استهلاكك الحالي {currency} '
      + '{burnRatePerHour} في الساعة. اشحن رصيدك لتجنّب الانقطاع.',
  },
  'credit.lowBalanceDays': {
    title: 'رصيدك منخفض',
    message: 'رصيدك هو {currency} {balance} — أي نحو {runway} يوم بمعدل استهلاكك الحالي {currency} '
      + '{burnRatePerHour} في الساعة. اشحن رصيدك لتجنّب الانقطاع.',
  },
  'credit.pausingSoon': {
    title: 'ستتوقف عمليات النشر قريباً',
    message: 'رصيدك هو {currency} {balance} — أي نحو {runway} ساعة بمعدل استهلاكك الحالي {currency} '
      + '{burnRatePerHour} في الساعة. اشحن رصيدك لتجنّب الانقطاع.',
  },
  'credit.adjustedUp': {
    title: 'تمت إضافة رصيد إلى حسابك',
    message: '+{amount} {currency}. الرصيد الجديد: {balance} {currency}.{note}',
  },
  'credit.adjustedDown': {
    title: 'تم تعديل رصيد الحساب',
    message: '{amount} {currency}. الرصيد الجديد: {balance} {currency}.{note}',
  },
  'debt.collected': {
    title: 'تمت تسوية المبلغ المستحق',
    message: 'تم خصم {currency} {amount} من بطاقتك لتسوية المبلغ المستحق عليك.',
  },
  'debt.collectionFailed': {
    title: 'تعذّر تحصيل المبلغ المستحق',
    message: 'حاولنا خصم {currency} {amount} من بطاقتك لتسوية المبلغ المستحق، لكن العملية فشلت '
      + '({error}). يرجى تحديث وسيلة الدفع أو إضافة رصيد.',
  },
  'debt.pausedOverLimit': {
    title: 'تم إيقاف النشر مؤقتاً — مبلغ مستحق',
    message: 'تم إيقاف "{deploymentName}" لأن المبلغ المستحق عليك تجاوز حد المنصة. سدّده لاستئناف '
      + 'التشغيل.',
  },
  'debt.pausedTooOld': {
    title: 'تم إيقاف النشر مؤقتاً — مبلغ مستحق',
    message: 'تم إيقاف "{deploymentName}" لأن المبلغ المستحق عليك ظل دون سداد لفترة طويلة. سدّده '
      + 'لاستئناف التشغيل.',
  },

  'storage.terminated': {
    title: 'تم إنهاء النشر — تخزين غير مدفوع',
    message: 'تم إنهاء "{deploymentName}" لأن تخزينه ظل دون سداد لأكثر من {graceDays} يوماً. وأي مبلغ '
      + 'مستحق ما زال واجب السداد.',
  },
  'storage.warning': {
    title: 'تخزين غير مدفوع — مطلوب إجراء',
  },

  'card.expired': {
    title: 'انتهت صلاحية بطاقتك المحفوظة',
    message: 'انتهت صلاحية بطاقة {brand} المنتهية بالأرقام {last4}. أضف بطاقة جديدة للإبقاء على نظام '
      + 'الدفع حسب الاستخدام والشحن التلقائي.',
  },
  'card.expiring': {
    title: 'بطاقتك المحفوظة على وشك الانتهاء',
    message: 'تنتهي صلاحية بطاقة {brand} المنتهية بالأرقام {last4} خلال {days} يوم. أضف بطاقة جديدة '
      + 'قبل ذلك لتجنّب الانقطاع.',
  },

  'account.emailVerified': {
    title: 'تم تأكيد البريد الإلكتروني',
    message: 'قام المشرف بتأكيد بريدك الإلكتروني. يمكنك الآن الوصول إلى جميع الميزات.',
  },
  'account.suspended': {
    title: 'تم تعليق الحساب',
    message: 'تم تعليق حسابك. يرجى التواصل مع الدعم لمزيد من المعلومات.',
  },
  'account.suspendedWithReason': {
    title: 'تم تعليق الحساب',
    message: '{reason}',
  },
  'account.activated': {
    title: 'تم تفعيل الحساب',
    message: 'تم تفعيل حسابك. يمكنك الآن الوصول إلى جميع الميزات.',
  },
  'account.statusSuspended': {
    title: 'تم تحديث حالة الحساب',
    message: 'تم تعليق حسابك. يرجى التواصل مع الدعم للمساعدة.',
  },
  'account.statusActivated': {
    title: 'تم تحديث حالة الحساب',
    message: 'تم تفعيل حسابك. يمكنك الآن الوصول إلى جميع الميزات.',
  },
  'account.updatedByAdmin': {
    title: 'تم تحديث الحساب',
    message: 'قام {adminName} بتحديث حسابك.',
  },
  'admin.welcome': {
    title: 'مرحباً بك في لوحة الإدارة',
    message: 'أنشأ {adminName} حساب المشرف الخاص بك. دورك هو: {role}.',
  },
};
