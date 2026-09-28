/**
 * Hindi (hi) notification copy.
 *
 * Every `{placeholder}` keeps its English name — `render()` matches on the name.
 * The three operator-authored bodies are omitted so their text stays as written.
 */
module.exports = {
  'deployment.movedToPrepaid': {
    title: 'डिप्लॉयमेंट प्रीपेड पर स्थानांतरित',
    message: 'आपके खाते पर अब पे-एज़-यू-गो उपलब्ध नहीं है, इसलिए "{deploymentName}" अब आपके प्रीपेड बैलेंस से चलेगा। अब तक का उपयोग पे-एज़-यू-गो के रूप में बिल हो चुका है। इसे चलाते रहने के लिए वॉलेट में क्रेडिट रखें।',
  },
  'team.spendLimitNear': {
    title: 'खर्च सीमा लगभग पूरी',
    message: '{memberName} ने {teamName} में अपनी {currency} {limit} मासिक सीमा का {percent}% इस्तेमाल कर लिया है।',
  },
  'team.spendLimitReached': {
    title: 'खर्च सीमा पूरी हुई',
    message: '{memberName} ने {teamName} में अपनी {currency} {limit} मासिक सीमा पूरी कर ली है। अगले महीने या सीमा बढ़ाने तक वे नए डिप्लॉयमेंट शुरू नहीं कर सकते।',
  },
  'team.ownershipOffered': {
    title: 'आपको स्वामित्व की पेशकश हुई है',
    message: '{fromName} ने आपको {teamName} का स्वामित्व देने की पेशकश की है। स्वीकार करें तो खाता आपके जिम्मे आ जाएगा, अस्वीकार करें तो उन्हीं के पास रहेगा।',
  },
  'team.ownershipAccepted': {
    title: 'स्वामित्व स्थानांतरित हुआ',
    message: 'अब {teamName} के मालिक {toName} हैं। आप इसके एडमिन हैं।',
  },
  'team.ownershipDeclined': {
    title: 'स्वामित्व अस्वीकार',
    message: '{toName} ने {teamName} का स्वामित्व लेने से मना कर दिया। आप ही इसके मालिक हैं।',
  },
  'team.closed': {
    title: 'जिस टीम में आप थे वह बंद कर दी गई',
    message: '{teamName} को उसके मालिक ने बंद कर दिया। अब आपकी इस तक पहुँच नहीं है।',
  },
  'team.domainJoined': {
    title: 'कोई आपके डोमेन से शामिल हुआ',
    message: '{memberName} ({memberEmail}) अपने आप {teamName} में शामिल हो गए, क्योंकि आपका डोमेन नियम {domain} वाले हर व्यक्ति को अनुमति देता है।',
  },
  'team.joinRequested': {
    title: 'किसी ने शामिल होने का अनुरोध किया',
    message: '{memberName} ({memberEmail}) ने {teamName} में शामिल होने का अनुरोध किया है।',
  },
  'team.joinApproved': {
    title: 'आप शामिल हो गए',
    message: '{teamName} में शामिल होने का आपका अनुरोध स्वीकार कर लिया गया।',
  },
  'team.joinDeclined': {
    title: 'आपका अनुरोध अस्वीकार हुआ',
    message: '{teamName} में शामिल होने का आपका अनुरोध स्वीकार नहीं किया गया।',
  },
  'team.addedByAdmin': {
    title: 'आपको एक संगठन में जोड़ा गया',
    message: 'सपोर्ट ने आपको {teamName} में जोड़ दिया है।',
  },
  'team.removedByAdmin': {
    title: 'आपको संगठन से हटाया गया',
    message: 'अब {teamName} तक आपकी पहुँच नहीं है।',
  },
  'deployment.approved': {
    title: 'डिप्लॉयमेंट स्वीकृत',
    message: 'आपकी {modelName} डिप्लॉयमेंट "{deploymentName}" स्वीकृत हो गई है और तैयार की जा रही है।',
  },
  'deployment.ready': {
    title: 'आपका मॉडल लाइव है',
    message: '"{deploymentName}" चल रहा है और अनुरोध स्वीकार करने के लिए तैयार है।',
  },
  'deployment.keyRotated': {
    title: 'नई API key जारी की गई',
    message: '"{deploymentName}" फिर से चल रहा है। चूँकि यह निलंबित हुआ था, इसलिए नई API key जारी की '
      + 'गई है और पुरानी अब काम नहीं करती — अगले अनुरोध से पहले डिप्लॉयमेंट पेज से नई key कॉपी कर लें।',
  },
  'deployment.rejected': {
    title: 'डिप्लॉयमेंट अनुरोध अस्वीकृत',
    message: '{reason}',
  },
  'deployment.rejectedNoReason': {
    title: 'डिप्लॉयमेंट अनुरोध अस्वीकृत',
    message: 'आपका डिप्लॉयमेंट अनुरोध पूरा नहीं किया जा सका।',
  },
  'deployment.pausedNoCredit': {
    title: 'डिप्लॉयमेंट रोकी गई — क्रेडिट समाप्त',
  },
  'deployment.pausedCardRequired': {
    title: 'डिप्लॉयमेंट रोकी गई — सत्यापित कार्ड आवश्यक',
  },

  'credit.lowBalanceHours': {
    title: 'क्रेडिट बैलेंस कम है',
    message: 'आपका बैलेंस {currency} {balance} है — आपके वर्तमान उपयोग {currency} {burnRatePerHour} '
      + 'प्रति घंटा के हिसाब से यह लगभग {runway} घंटे चलेगा। रुकावट से बचने के लिए टॉप अप करें।',
  },
  'credit.lowBalanceDays': {
    title: 'क्रेडिट बैलेंस कम है',
    message: 'आपका बैलेंस {currency} {balance} है — आपके वर्तमान उपयोग {currency} {burnRatePerHour} '
      + 'प्रति घंटा के हिसाब से यह लगभग {runway} दिन चलेगा। रुकावट से बचने के लिए टॉप अप करें।',
  },
  'credit.pausingSoon': {
    title: 'आपकी डिप्लॉयमेंट्स जल्द रुक जाएँगी',
    message: 'आपका बैलेंस {currency} {balance} है — आपके वर्तमान उपयोग {currency} {burnRatePerHour} '
      + 'प्रति घंटा के हिसाब से यह लगभग {runway} घंटे चलेगा। रुकावट से बचने के लिए टॉप अप करें।',
  },
  'credit.adjustedUp': {
    title: 'आपके खाते में क्रेडिट जोड़ा गया',
    message: '+{amount} {currency}. नया बैलेंस: {balance} {currency}.{note}',
  },
  'credit.adjustedDown': {
    title: 'खाते का बैलेंस समायोजित किया गया',
    message: '{amount} {currency}. नया बैलेंस: {balance} {currency}.{note}',
  },
  'debt.collected': {
    title: 'बकाया राशि चुका दी गई',
    message: 'आपकी बकाया राशि चुकाने के लिए आपके कार्ड से {currency} {amount} लिए गए।',
  },
  'debt.collectionFailed': {
    title: 'आपकी बकाया राशि वसूल नहीं हो सकी',
    message: 'हमने आपकी बकाया राशि चुकाने के लिए आपके कार्ड से {currency} {amount} लेने की कोशिश की, '
      + 'लेकिन यह विफल रही ({error})। कृपया अपना भुगतान तरीका अपडेट करें या राशि जोड़ें।',
  },
  'debt.pausedOverLimit': {
    title: 'डिप्लॉयमेंट रोकी गई — बकाया राशि',
    message: '"{deploymentName}" इसलिए रोकी गई क्योंकि आपकी बकाया राशि प्लेटफ़ॉर्म की सीमा से ऊपर चली '
      + 'गई है। दोबारा चलाने के लिए इसे चुकाएँ।',
  },
  'debt.pausedTooOld': {
    title: 'डिप्लॉयमेंट रोकी गई — बकाया राशि',
    message: '"{deploymentName}" इसलिए रोकी गई क्योंकि आपकी बकाया राशि बहुत समय से नहीं चुकाई गई। '
      + 'दोबारा चलाने के लिए इसे चुकाएँ।',
  },

  'storage.terminated': {
    title: 'डिप्लॉयमेंट समाप्त — स्टोरेज का भुगतान नहीं हुआ',
    message: '"{deploymentName}" इसलिए समाप्त कर दी गई क्योंकि इसके स्टोरेज का भुगतान {graceDays} दिन '
      + 'से अधिक समय तक नहीं हुआ। कोई भी बकाया राशि अब भी देय है।',
  },
  'storage.warning': {
    title: 'स्टोरेज का भुगतान नहीं हुआ — कार्रवाई आवश्यक',
  },

  'card.expired': {
    title: 'आपका सहेजा गया कार्ड समाप्त हो गया',
    message: 'आपका {brand} कार्ड जिसके अंतिम अंक {last4} हैं, समाप्त हो गया है। pay-as-you-go और '
      + 'स्वचालित टॉप अप चालू रखने के लिए नया कार्ड जोड़ें।',
  },
  'card.expiring': {
    title: 'आपका सहेजा गया कार्ड जल्द समाप्त हो रहा है',
    message: 'आपका {brand} कार्ड जिसके अंतिम अंक {last4} हैं, {days} दिन में समाप्त हो जाएगा। रुकावट '
      + 'से बचने के लिए उससे पहले नया कार्ड जोड़ें।',
  },

  'account.emailVerified': {
    title: 'ईमेल सत्यापित',
    message: 'आपका ईमेल एडमिन द्वारा सत्यापित कर दिया गया है। अब आप सभी सुविधाएँ उपयोग कर सकते हैं।',
  },
  'account.suspended': {
    title: 'खाता निलंबित',
    message: 'आपका खाता निलंबित कर दिया गया है। अधिक जानकारी के लिए सपोर्ट से संपर्क करें।',
  },
  'account.suspendedWithReason': {
    title: 'खाता निलंबित',
    message: '{reason}',
  },
  'account.activated': {
    title: 'खाता सक्रिय',
    message: 'आपका खाता सक्रिय कर दिया गया है। अब आप सभी सुविधाएँ उपयोग कर सकते हैं।',
  },
  'account.statusSuspended': {
    title: 'खाते की स्थिति अपडेट हुई',
    message: 'आपका खाता निलंबित कर दिया गया है। सहायता के लिए सपोर्ट से संपर्क करें।',
  },
  'account.statusActivated': {
    title: 'खाते की स्थिति अपडेट हुई',
    message: 'आपका खाता सक्रिय कर दिया गया है। अब आप सभी सुविधाएँ उपयोग कर सकते हैं।',
  },
  'account.updatedByAdmin': {
    title: 'खाता अपडेट हुआ',
    message: 'आपका खाता {adminName} द्वारा अपडेट किया गया है।',
  },
  'admin.welcome': {
    title: 'एडमिन पैनल में आपका स्वागत है',
    message: 'आपका एडमिन खाता {adminName} द्वारा बनाया गया है। आपकी भूमिका है: {role}.',
  },
};
