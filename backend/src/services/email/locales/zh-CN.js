/**
 * Simplified Chinese (zh-CN) email templates.
 *
 * LTR, so the HTML is structurally identical to the English pack — only the
 * prose changes. Every `{{variable}}` keeps its English name because that is
 * what `_interpolate` matches on.
 *
 * The filename carries the region subtag, matching the language code the rest
 * of the stack uses (`zh-CN`), so `getDefaults('zh-CN')` resolves it directly.
 */
module.exports = {
  verification: {
    subject: '验证您的邮箱 – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">验证您的邮箱地址</h2>
      <p>您好，{{userName}}：</p>
      <p>感谢您注册 <strong>{{siteName}}</strong>！请点击下方按钮验证邮箱地址并激活账户。</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{verificationLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          验证邮箱地址
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">或复制以下链接并粘贴到浏览器中打开：</p>
      <p style="color: {{primaryColor}}; font-size: 13px; word-break: break-all;">{{verificationLink}}</p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        此链接将在 24 小时后失效。如果您并未注册账户，可以忽略这封邮件。
      </p>
    `,
  },
  welcome: {
    subject: '欢迎加入 {{siteName}}！',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">欢迎您，{{userName}}！🎉</h2>
      <p>您在 <strong>{{siteName}}</strong> 的账户已创建并验证成功。</p>
      <p>接下来您可以：</p>
      <ul style="line-height: 2; color: #374151;">
        <li>浏览您的控制台和各项工具</li>
        <li>充值余额以部署模型</li>
        <li>查看模型目录，了解可用模型</li>
      </ul>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{loginLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          前往控制台
        </a>
      </div>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        您收到这封邮件是因为您注册了 {{siteName}}。
      </p>
    `,
  },
  passwordReset: {
    subject: '重置您的密码 – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">重置您的密码</h2>
      <p>您好，{{userName}}：</p>
      <p>我们收到了重置您 <strong>{{siteName}}</strong> 账户密码的请求。</p>
      <p>请点击下方按钮设置新密码。此链接将在 <strong>1 小时</strong>后失效。</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{resetLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          重置密码
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">或复制以下链接并粘贴到浏览器中打开：</p>
      <p style="color: {{primaryColor}}; font-size: 13px; word-break: break-all;">{{resetLink}}</p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        如果您并未请求重置密码，可以忽略这封邮件，您的密码不会发生变化。
      </p>
    `,
  },

  deploymentApproved: {
    subject: '正在为您部署 {{modelName}} – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">您的部署已通过审核</h2>
      <p>您好，{{userName}}：</p>
      <p>好消息 — 您对 <strong>{{modelName}}</strong> 的申请已通过审核，我们的团队已开始为其配置资源。</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">部署</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{deploymentName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">模型</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{modelName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">硬件</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{tierName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">费率</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{pricePerHour}}/小时</td></tr>
      </table>

      <p>端点上线后我们会再次邮件通知您。只有在部署实际运行时才会开始计费。</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{deploymentUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          查看部署
        </a>
      </div>
    `,
  },

  deploymentReady: {
    subject: '{{modelName}} 已上线 – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">您的模型已就绪 🚀</h2>
      <p>您好，{{userName}}：</p>
      <p><strong>{{deploymentName}}</strong> 现已运行，可以开始接收请求。</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">模型</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{modelName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">硬件</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{tierName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">端点</td><td style="padding: 6px 12px; text-align: right; font-weight: 600; word-break: break-all;">{{endpointUrl}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">费率</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{pricePerHour}}/小时</td></tr>
      </table>

      <p style="color: #b45309; background: #fffbeb; border-left: 3px solid #f59e0b; padding: 12px 16px; border-radius: 6px; font-size: 14px;">
        出于安全考虑，邮件中不包含您的 API 密钥。请在控制台中打开该部署以复制密钥。
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{deploymentUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          获取 API 密钥
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        部署上线时已开始按小时计费。您可以随时在控制台中暂停或停止它以终止计费。
      </p>
    `,
  },

  deploymentRejected: {
    subject: '关于您的 {{modelName}} 申请 – {{siteName}}',
    body: `
      <h2 style="color: #ff4d4f; margin: 0 0 16px;">这项申请无法继续</h2>
      <p>您好，{{userName}}：</p>
      <p>很抱歉，我们目前无法为 <strong>{{deploymentName}}</strong>（{{modelName}}）配置资源。</p>

      <p style="background: #fff1f0; border-left: 3px solid #ff4d4f; padding: 12px 16px; border-radius: 6px; color: #a8071a;">
        <strong>原因：</strong>{{rejectionReason}}
      </p>

      <p>本次申请不会向您收取任何费用。如果需要我们协助您找到可行的配置，请直接回复这封邮件，或发送邮件至 {{supportEmail}}。</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{catalogUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          浏览模型
        </a>
      </div>
    `,
  },

  deploymentSuspended: {
    subject: '部署已暂停 — 余额不足 – {{siteName}}',
    body: `
      <h2 style="color: #faad14; margin: 0 0 16px;">您的部署已暂停</h2>
      <p>您好，{{userName}}：</p>
      <p>由于余额已用完，我们暂停了 <strong>{{deploymentName}}</strong>（{{modelName}}）。您的配置和数据均安全保留 — 充值后即可恢复运行。</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">当前余额</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{balance}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">费率</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{pricePerHour}}/小时</td></tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          充值
        </a>
      </div>
    `,
  },

  creditTopUp: {
    subject: '充值成功 – {{currency}} {{amount}} – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">充值已到账</h2>
      <p>您好，{{userName}}：</p>
      <p>我们已向您的账户充值 <strong>{{currency}} {{amount}}</strong>。</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">充值金额</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{amount}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">当前余额</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{balance}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">日期</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{paymentDate}}</td></tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          查看钱包
        </a>
      </div>
    `,
  },

  lowBalance: {
    subject: '余额不足提醒 – {{siteName}}',
    body: `
      <h2 style="color: #faad14; margin: 0 0 16px;">您的余额即将用尽</h2>
      <p>您好，{{userName}}：</p>
      <p>您的当前余额为 <strong>{{currency}} {{balance}}</strong>。按目前每天 {{currency}} {{burnRatePerDay}} 的消耗速度，大约还可以使用 <strong>{{runwayDays}} 天</strong>。</p>
      <p>请及时充值，以免部署中断 — 余额用尽时系统会自动暂停部署。</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          充值
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        您可以在钱包设置中开启自动充值，避免再次出现这种情况。
      </p>
    `,
  },

  teamNotification: {
    subject: '{{title}} · {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">{{title}}</h2>
      <p>{{name}} 您好：</p>
      <p>{{message}}</p>
      {{actionBlock}}
      <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
        您收到此邮件，是因为您是 {{siteName}} 上某个团队的成员。
      </p>
    `,
  },
  teamInvite: {
    subject: '{{inviterName}} 邀请您加入 {{siteName}} 上的 {{teamName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">加入 {{teamName}}</h2>
      <p>您好：</p>
      <p><strong>{{inviterName}}</strong> 邀请您以 <strong>{{roleName}}</strong> 身份加入 {{siteName}} 上的 <strong>{{teamName}}</strong>。</p>
      <p>请使用该邮箱地址对应的账户接受邀请。如果还没有账户，可以在邀请页面创建。</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{acceptUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          接受邀请
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">此邀请将在 {{expiresDays}} 天后失效。如果您没有预料到这封邮件，可以忽略它。</p>
    `,
  },
  teamRoles: {
    owner: '所有者',
    admin: '管理员',
    billing: '账单',
    developer: '开发者',
    viewer: '查看者',
  },
  layout: {
    rights: '&copy; {{year}} {{siteName}}。保留所有权利。',
    needHelp: '需要帮助？',
    logoAlt: '{{siteName}}',
  },
};
