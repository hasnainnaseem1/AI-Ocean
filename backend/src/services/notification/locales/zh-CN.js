/**
 * Simplified Chinese (zh-CN) notification copy.
 *
 * Every `{placeholder}` keeps its English name — `render()` matches on the name.
 * The three operator-authored bodies are omitted so their text stays as written.
 *
 * The filename carries the region subtag so `getCopy('zh-CN')` resolves it
 * directly, matching the language code the rest of the stack uses.
 */
module.exports = {
  'deployment.movedToPrepaid': {
    title: '部署已转为预付费',
    message: '您的账户已不再提供按量付费，因此 "{deploymentName}" 现在使用您的预付费余额运行。此前的用量已按按量付费计费。请在钱包中保留余额以保持运行。',
  },
  'team.spendLimitNear': {
    title: '支出限额即将用完',
    message: '{memberName} 已用去其在 {teamName} 的 {currency} {limit} 月度限额的 {percent}%。',
  },
  'team.spendLimitReached': {
    title: '已达到支出限额',
    message: '{memberName} 已达到其在 {teamName} 的 {currency} {limit} 月度限额。在下个月或您提高限额之前，其无法启动新的部署。',
  },
  'team.ownershipOffered': {
    title: '有人将团队所有权转给您',
    message: '{fromName} 邀请您接管 {teamName} 的所有权。接受后该账户由您负责，拒绝则仍归对方。',
  },
  'team.ownershipAccepted': {
    title: '所有权已转移',
    message: '{teamName} 现由 {toName} 拥有，您是该团队的管理员。',
  },
  'team.ownershipDeclined': {
    title: '对方拒绝接管',
    message: '{toName} 拒绝接管 {teamName}，您仍是所有者。',
  },
  'team.closed': {
    title: '您所在的团队已关闭',
    message: '{teamName} 已被所有者关闭，您无法再访问它。',
  },
  'team.domainJoined': {
    title: '有人通过您的域名加入',
    message: '{memberName}（{memberEmail}）已自动加入 {teamName}，因为您的域名规则允许所有 {domain} 邮箱的人加入。',
  },
  'team.joinRequested': {
    title: '有人申请加入',
    message: '{memberName}（{memberEmail}）申请加入 {teamName}。',
  },
  'team.joinApproved': {
    title: '您已加入',
    message: '您加入 {teamName} 的申请已通过。',
  },
  'team.joinDeclined': {
    title: '您的申请被拒绝',
    message: '您加入 {teamName} 的申请未获通过。',
  },
  'team.addedByAdmin': {
    title: '您已被加入某个团队',
    message: '客服已将您加入 {teamName}。',
  },
  'team.removedByAdmin': {
    title: '您已被移出团队',
    message: '您无法再访问 {teamName}。',
  },
  'deployment.approved': {
    title: '部署已通过审核',
    message: '您的 {modelName} 部署“{deploymentName}”已通过审核，正在配置中。',
  },
  'deployment.ready': {
    title: '您的模型已上线',
    message: '“{deploymentName}”正在运行，可以开始接收请求。',
  },
  'deployment.keyRotated': {
    title: '已签发新的 API 密钥',
    message: '“{deploymentName}”已重新运行。由于此前被暂停，系统签发了新的 API 密钥，旧密钥不再有效 — '
      + '请在下次请求前从部署页面复制新密钥。',
  },
  'deployment.rejected': {
    title: '部署申请被拒绝',
    message: '{reason}',
  },
  'deployment.rejectedNoReason': {
    title: '部署申请被拒绝',
    message: '您的部署申请无法完成。',
  },
  'deployment.pausedNoCredit': {
    title: '部署已暂停 — 余额不足',
  },
  'deployment.pausedCardRequired': {
    title: '部署已暂停 — 需要已验证的银行卡',
  },

  'credit.lowBalanceHours': {
    title: '余额不足',
    message: '您的余额为 {currency} {balance} — 按当前每小时 {currency} {burnRatePerHour} 的消耗速度，'
      + '大约还能使用 {runway} 小时。请及时充值以免服务中断。',
  },
  'credit.lowBalanceDays': {
    title: '余额不足',
    message: '您的余额为 {currency} {balance} — 按当前每小时 {currency} {burnRatePerHour} 的消耗速度，'
      + '大约还能使用 {runway} 天。请及时充值以免服务中断。',
  },
  'credit.pausingSoon': {
    title: '您的部署即将暂停',
    message: '您的余额为 {currency} {balance} — 按当前每小时 {currency} {burnRatePerHour} 的消耗速度，'
      + '大约还能使用 {runway} 小时。请及时充值以免服务中断。',
  },
  'credit.adjustedUp': {
    title: '账户已充值',
    message: '+{amount} {currency}。当前余额：{balance} {currency}。{note}',
  },
  'credit.adjustedDown': {
    title: '账户余额已调整',
    message: '{amount} {currency}。当前余额：{balance} {currency}。{note}',
  },
  'debt.collected': {
    title: '欠款已结清',
    message: '已从您的银行卡扣款 {currency} {amount} 以结清欠款。',
  },
  'debt.collectionFailed': {
    title: '无法扣收您的欠款',
    message: '我们尝试从您的银行卡扣款 {currency} {amount} 以结清欠款，但扣款失败（{error}）。'
      + '请更新支付方式或充值。',
  },
  'debt.pausedOverLimit': {
    title: '部署已暂停 — 存在欠款',
    message: '“{deploymentName}”已暂停，因为您的欠款已超出平台限额。结清后即可恢复运行。',
  },
  'debt.pausedTooOld': {
    title: '部署已暂停 — 存在欠款',
    message: '“{deploymentName}”已暂停，因为您的欠款长期未结清。结清后即可恢复运行。',
  },

  'storage.terminated': {
    title: '部署已终止 — 存储费用未支付',
    message: '“{deploymentName}”已被终止，因为其存储费用超过 {graceDays} 天未支付。'
      + '任何欠款仍然需要结清。',
  },
  'storage.warning': {
    title: '存储费用未支付 — 需要处理',
  },

  'card.expired': {
    title: '您保存的银行卡已过期',
    message: '您尾号 {last4} 的 {brand} 银行卡已过期。请添加新卡，以便继续使用按量付费和自动充值。',
  },
  'card.expiring': {
    title: '您保存的银行卡即将过期',
    message: '您尾号 {last4} 的 {brand} 银行卡将在 {days} 天后过期。请在此之前添加新卡，以免服务中断。',
  },

  'account.emailVerified': {
    title: '邮箱已验证',
    message: '管理员已验证您的邮箱。您现在可以使用全部功能。',
  },
  'account.suspended': {
    title: '账户已停用',
    message: '您的账户已被停用。如需了解详情，请联系客服。',
  },
  'account.suspendedWithReason': {
    title: '账户已停用',
    message: '{reason}',
  },
  'account.activated': {
    title: '账户已启用',
    message: '您的账户已启用。您现在可以使用全部功能。',
  },
  'account.statusSuspended': {
    title: '账户状态已更新',
    message: '您的账户已被停用。如需协助，请联系客服。',
  },
  'account.statusActivated': {
    title: '账户状态已更新',
    message: '您的账户已启用。您现在可以使用全部功能。',
  },
  'account.updatedByAdmin': {
    title: '账户已更新',
    message: '{adminName} 更新了您的账户。',
  },
  'admin.welcome': {
    title: '欢迎使用管理后台',
    message: '您的管理员账户由 {adminName} 创建。您的角色是：{role}。',
  },
};
