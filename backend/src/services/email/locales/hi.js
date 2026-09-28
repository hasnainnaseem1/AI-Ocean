/**
 * Hindi (hi) email templates.
 *
 * LTR, so the HTML is structurally identical to the English pack — only the
 * prose changes. Every `{{variable}}` keeps its English name because that is
 * what `_interpolate` matches on.
 */
module.exports = {
  verification: {
    subject: 'अपना ईमेल सत्यापित करें – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">अपना ईमेल पता सत्यापित करें</h2>
      <p>नमस्ते {{userName}},</p>
      <p><strong>{{siteName}}</strong> पर साइन अप करने के लिए धन्यवाद! अपना ईमेल पता सत्यापित करने और खाता सक्रिय करने के लिए नीचे दिए गए बटन पर क्लिक करें।</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{verificationLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          ईमेल पता सत्यापित करें
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">या यह लिंक कॉपी करके अपने ब्राउज़र में खोलें:</p>
      <p style="color: {{primaryColor}}; font-size: 13px; word-break: break-all;">{{verificationLink}}</p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        यह लिंक 24 घंटे में समाप्त हो जाएगा। यदि आपने खाता नहीं बनाया है, तो इस ईमेल को अनदेखा कर सकते हैं।
      </p>
    `,
  },
  welcome: {
    subject: '{{siteName}} में आपका स्वागत है!',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">स्वागत है, {{userName}}! 🎉</h2>
      <p><strong>{{siteName}}</strong> पर आपका खाता बन गया है और सफलतापूर्वक सत्यापित हो गया है।</p>
      <p>अब आप यह कर सकते हैं:</p>
      <ul style="line-height: 2; color: #374151;">
        <li>अपना डैशबोर्ड और टूल्स देखें</li>
        <li>मॉडल चलाने के लिए अपना क्रेडिट बैलेंस टॉप अप करें</li>
        <li>उपलब्ध मॉडलों के लिए कैटलॉग देखें</li>
      </ul>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{loginLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          डैशबोर्ड पर जाएँ
        </a>
      </div>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        आपको यह ईमेल इसलिए मिला क्योंकि आपने {{siteName}} पर साइन अप किया था।
      </p>
    `,
  },
  passwordReset: {
    subject: 'अपना पासवर्ड रीसेट करें – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">अपना पासवर्ड रीसेट करें</h2>
      <p>नमस्ते {{userName}},</p>
      <p>हमें आपके <strong>{{siteName}}</strong> खाते का पासवर्ड रीसेट करने का अनुरोध मिला है।</p>
      <p>नया पासवर्ड चुनने के लिए नीचे दिए गए बटन पर क्लिक करें। यह लिंक <strong>1 घंटे</strong> में समाप्त हो जाएगा।</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{resetLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          पासवर्ड रीसेट करें
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">या यह लिंक कॉपी करके अपने ब्राउज़र में खोलें:</p>
      <p style="color: {{primaryColor}}; font-size: 13px; word-break: break-all;">{{resetLink}}</p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        यदि आपने पासवर्ड रीसेट का अनुरोध नहीं किया है, तो इस ईमेल को अनदेखा कर सकते हैं। आपका पासवर्ड नहीं बदलेगा।
      </p>
    `,
  },

  deploymentApproved: {
    subject: 'आपकी {{modelName}} डिप्लॉयमेंट तैयार की जा रही है – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">आपकी डिप्लॉयमेंट स्वीकृत हो गई है</h2>
      <p>नमस्ते {{userName}},</p>
      <p>अच्छी खबर — <strong>{{modelName}}</strong> के लिए आपका अनुरोध स्वीकृत हो गया है और हमारी टीम ने इसे तैयार करना शुरू कर दिया है।</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">डिप्लॉयमेंट</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{deploymentName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">मॉडल</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{modelName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">हार्डवेयर</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{tierName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">दर</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{pricePerHour}}/घंटा</td></tr>
      </table>

      <p>आपका एंडपॉइंट लाइव होते ही हम आपको फिर से ईमेल करेंगे। बिलिंग तभी शुरू होती है जब डिप्लॉयमेंट चल रही हो।</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{deploymentUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          डिप्लॉयमेंट देखें
        </a>
      </div>
    `,
  },

  deploymentReady: {
    subject: '{{modelName}} लाइव हो गया – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">आपका मॉडल तैयार है 🚀</h2>
      <p>नमस्ते {{userName}},</p>
      <p><strong>{{deploymentName}}</strong> अब चल रहा है और अनुरोध स्वीकार करने के लिए तैयार है।</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">मॉडल</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{modelName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">हार्डवेयर</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{tierName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">एंडपॉइंट</td><td style="padding: 6px 12px; text-align: right; font-weight: 600; word-break: break-all;">{{endpointUrl}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">दर</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{pricePerHour}}/घंटा</td></tr>
      </table>

      <p style="color: #b45309; background: #fffbeb; border-left: 3px solid #f59e0b; padding: 12px 16px; border-radius: 6px; font-size: 14px;">
        सुरक्षा कारणों से आपकी API key इस ईमेल में शामिल नहीं है। इसे कॉपी करने के लिए डैशबोर्ड में अपनी डिप्लॉयमेंट खोलें।
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{deploymentUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          API key प्राप्त करें
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        डिप्लॉयमेंट लाइव होते ही प्रति घंटा बिलिंग शुरू हो गई है। शुल्क रोकने के लिए आप इसे कभी भी डैशबोर्ड से रोक या बंद कर सकते हैं।
      </p>
    `,
  },

  deploymentRejected: {
    subject: 'आपके {{modelName}} अनुरोध के बारे में – {{siteName}}',
    body: `
      <h2 style="color: #ff4d4f; margin: 0 0 16px;">हम इस अनुरोध को आगे नहीं बढ़ा सके</h2>
      <p>नमस्ते {{userName}},</p>
      <p>खेद है कि हम इस समय <strong>{{deploymentName}}</strong> ({{modelName}}) तैयार नहीं कर सके।</p>

      <p style="background: #fff1f0; border-left: 3px solid #ff4d4f; padding: 12px 16px; border-radius: 6px; color: #a8071a;">
        <strong>कारण:</strong> {{rejectionReason}}
      </p>

      <p>इस अनुरोध के लिए आपसे कोई शुल्क नहीं लिया गया है। यदि आप चाहते हैं कि हम कोई ऐसा कॉन्फ़िगरेशन ढूँढने में मदद करें जो काम करे, तो इस ईमेल का उत्तर दें या {{supportEmail}} पर हमसे संपर्क करें।</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{catalogUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          मॉडल देखें
        </a>
      </div>
    `,
  },

  deploymentSuspended: {
    subject: 'डिप्लॉयमेंट रोकी गई – क्रेडिट समाप्त – {{siteName}}',
    body: `
      <h2 style="color: #faad14; margin: 0 0 16px;">आपकी डिप्लॉयमेंट रोक दी गई है</h2>
      <p>नमस्ते {{userName}},</p>
      <p>हमने <strong>{{deploymentName}}</strong> ({{modelName}}) इसलिए रोक दी है क्योंकि आपका क्रेडिट बैलेंस समाप्त हो गया। आपका कॉन्फ़िगरेशन और डेटा सुरक्षित है — टॉप अप करने पर आप इसे फिर से शुरू कर सकेंगे।</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">वर्तमान बैलेंस</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{balance}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">दर</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{pricePerHour}}/घंटा</td></tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          क्रेडिट जोड़ें
        </a>
      </div>
    `,
  },

  creditTopUp: {
    subject: 'क्रेडिट जोड़ा गया – {{currency}} {{amount}} – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">आपका क्रेडिट जोड़ दिया गया है</h2>
      <p>नमस्ते {{userName}},</p>
      <p>हमने आपके खाते में <strong>{{currency}} {{amount}}</strong> जोड़ दिए हैं।</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">जोड़ी गई राशि</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{amount}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">नया बैलेंस</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{balance}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">तारीख</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{paymentDate}}</td></tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          वॉलेट देखें
        </a>
      </div>
    `,
  },

  lowBalance: {
    subject: 'क्रेडिट बैलेंस कम है – {{siteName}}',
    body: `
      <h2 style="color: #faad14; margin: 0 0 16px;">आपका बैलेंस कम होता जा रहा है</h2>
      <p>नमस्ते {{userName}},</p>
      <p>आपका क्रेडिट बैलेंस <strong>{{currency}} {{balance}}</strong> है। आपके वर्तमान उपयोग {{currency}} {{burnRatePerDay}} प्रति दिन के हिसाब से यह लगभग <strong>{{runwayDays}} दिन</strong> चलेगा।</p>
      <p>अपनी डिप्लॉयमेंट्स बिना रुकावट चलाने के लिए अभी टॉप अप करें — बैलेंस समाप्त होने पर वे अपने आप रोक दी जाती हैं।</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          क्रेडिट जोड़ें
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        आप अपनी वॉलेट सेटिंग्स में ऑटो टॉप अप चालू कर सकते हैं ताकि ऐसा दोबारा न हो।
      </p>
    `,
  },

  teamNotification: {
    subject: '{{title}} · {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">{{title}}</h2>
      <p>नमस्ते {{name}},</p>
      <p>{{message}}</p>
      {{actionBlock}}
      <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
        यह संदेश आपको {{siteName}} पर किसी संगठन की सदस्यता के कारण मिला है।
      </p>
    `,
  },
  teamInvite: {
    subject: '{{inviterName}} ने आपको {{siteName}} पर {{teamName}} में आमंत्रित किया है',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">{{teamName}} से जुड़ें</h2>
      <p>नमस्ते,</p>
      <p><strong>{{inviterName}}</strong> ने आपको {{siteName}} पर <strong>{{teamName}}</strong> में <strong>{{roleName}}</strong> के रूप में शामिल होने के लिए आमंत्रित किया है।</p>
      <p>इसी ईमेल पते वाले खाते से स्वीकार करें। अगर अभी खाता नहीं है, तो आमंत्रण पेज से बना सकते हैं।</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{acceptUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          आमंत्रण स्वीकार करें
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">यह आमंत्रण {{expiresDays}} दिन में समाप्त हो जाएगा। अगर आपको इसकी उम्मीद नहीं थी, तो इस ईमेल को अनदेखा करें।</p>
    `,
  },
  teamRoles: {
    owner: 'मालिक',
    admin: 'एडमिन',
    billing: 'बिलिंग',
    developer: 'डेवलपर',
    viewer: 'दर्शक',
  },
  layout: {
    rights: '&copy; {{year}} {{siteName}}. सर्वाधिकार सुरक्षित।',
    needHelp: 'मदद चाहिए?',
    logoAlt: '{{siteName}}',
  },
};
