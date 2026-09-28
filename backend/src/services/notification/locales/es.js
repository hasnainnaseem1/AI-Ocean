/**
 * Spanish (es) notification copy.
 *
 * Every `{placeholder}` keeps its English name — `render()` matches on the name.
 * The three operator-authored bodies are omitted so their text stays as written.
 *
 * Tone is "tú", matching the app and the emails.
 */
module.exports = {
  'deployment.movedToPrepaid': {
    title: 'Despliegue pasado a prepago',
    message: 'El pago por uso ya no está disponible en tu cuenta, así que "{deploymentName}" ahora usa tu saldo prepago. El uso hasta ahora se facturó como pago por uso. Mantén crédito en tu billetera para que siga funcionando.',
  },
  'team.spendLimitNear': {
    title: 'Límite de gasto casi alcanzado',
    message: '{memberName} ha usado el {percent}% de su límite mensual de {currency} {limit} en {teamName}.',
  },
  'team.spendLimitReached': {
    title: 'Límite de gasto alcanzado',
    message: '{memberName} ha alcanzado su límite mensual de {currency} {limit} en {teamName}. No puede iniciar nuevos despliegues hasta el próximo mes o hasta que lo subas.',
  },
  'team.ownershipOffered': {
    title: 'Te han ofrecido la propiedad',
    message: '{fromName} te ha ofrecido la propiedad de {teamName}. Acéptala para hacerte cargo de la cuenta, o recházala para dejársela.',
  },
  'team.ownershipAccepted': {
    title: 'Propiedad transferida',
    message: '{toName} es ahora el propietario de {teamName}. Tú eres administrador.',
  },
  'team.ownershipDeclined': {
    title: 'Traspaso rechazado',
    message: '{toName} rechazó la propiedad de {teamName}. Sigues siendo su propietario.',
  },
  'team.closed': {
    title: 'Se cerró un equipo del que formabas parte',
    message: 'El propietario cerró {teamName}. Ya no tienes acceso.',
  },
  'team.domainJoined': {
    title: 'Alguien se unió por tu dominio',
    message: '{memberName} ({memberEmail}) se unió a {teamName} automáticamente, porque tu regla de dominio admite a cualquiera de {domain}.',
  },
  'team.joinRequested': {
    title: 'Alguien pidió unirse',
    message: '{memberName} ({memberEmail}) pidió unirse a {teamName}.',
  },
  'team.joinApproved': {
    title: 'Ya estás dentro',
    message: 'Se aprobó tu solicitud para unirte a {teamName}.',
  },
  'team.joinDeclined': {
    title: 'Tu solicitud fue rechazada',
    message: 'No se aprobó tu solicitud para unirte a {teamName}.',
  },
  'team.addedByAdmin': {
    title: 'Te añadieron a una organización',
    message: 'Soporte te añadió a {teamName}.',
  },
  'team.removedByAdmin': {
    title: 'Te quitaron de una organización',
    message: 'Ya no tienes acceso a {teamName}.',
  },
  'deployment.approved': {
    title: 'Despliegue aprobado',
    message: 'Tu despliegue de {modelName} "{deploymentName}" ha sido aprobado y se está preparando.',
  },
  'deployment.ready': {
    title: 'Tu modelo está activo',
    message: '"{deploymentName}" está en marcha y listo para recibir solicitudes.',
  },
  'deployment.keyRotated': {
    title: 'Nueva clave de API emitida',
    message: '"{deploymentName}" vuelve a estar en marcha. Como estuvo suspendido, se emitió una '
      + 'nueva clave de API y la anterior ya no funciona: copia la nueva desde la página del '
      + 'despliegue antes de tu siguiente solicitud.',
  },
  'deployment.rejected': {
    title: 'Solicitud de despliegue rechazada',
    message: '{reason}',
  },
  'deployment.rejectedNoReason': {
    title: 'Solicitud de despliegue rechazada',
    message: 'No hemos podido atender tu solicitud de despliegue.',
  },
  'deployment.pausedNoCredit': {
    title: 'Despliegue pausado: saldo agotado',
  },
  'deployment.pausedCardRequired': {
    title: 'Despliegue pausado: se requiere una tarjeta verificada',
  },

  'credit.lowBalanceHours': {
    title: 'Saldo bajo',
    message: 'Tu saldo es de {currency} {balance}: unas {runway} hora(s) con tu consumo actual de '
      + '{currency} {burnRatePerHour}/h. Recarga para evitar interrupciones.',
  },
  'credit.lowBalanceDays': {
    title: 'Saldo bajo',
    message: 'Tu saldo es de {currency} {balance}: unos {runway} día(s) con tu consumo actual de '
      + '{currency} {burnRatePerHour}/h. Recarga para evitar interrupciones.',
  },
  'credit.pausingSoon': {
    title: 'Tus despliegues se pausarán pronto',
    message: 'Tu saldo es de {currency} {balance}: unas {runway} hora(s) con tu consumo actual de '
      + '{currency} {burnRatePerHour}/h. Recarga para evitar interrupciones.',
  },
  'credit.adjustedUp': {
    title: 'Se ha añadido saldo a tu cuenta',
    message: '+{amount} {currency}. Nuevo saldo: {balance} {currency}.{note}',
  },
  'credit.adjustedDown': {
    title: 'Saldo de la cuenta ajustado',
    message: '{amount} {currency}. Nuevo saldo: {balance} {currency}.{note}',
  },
  'debt.collected': {
    title: 'Importe pendiente liquidado',
    message: 'Hemos cargado {currency} {amount} en tu tarjeta para liquidar tu importe pendiente.',
  },
  'debt.collectionFailed': {
    title: 'No hemos podido cobrar tu importe pendiente',
    message: 'Intentamos cargar {currency} {amount} en tu tarjeta para liquidar tu importe pendiente, '
      + 'pero falló ({error}). Actualiza tu método de pago o añade fondos.',
  },
  'debt.pausedOverLimit': {
    title: 'Despliegue pausado: importe pendiente',
    message: 'Hemos pausado "{deploymentName}" porque tu importe pendiente ha superado el límite de '
      + 'la plataforma. Liquídalo para reanudarlo.',
  },
  'debt.pausedTooOld': {
    title: 'Despliegue pausado: importe pendiente',
    message: 'Hemos pausado "{deploymentName}" porque tu importe pendiente lleva demasiado tiempo sin '
      + 'pagarse. Liquídalo para reanudarlo.',
  },

  'storage.terminated': {
    title: 'Despliegue eliminado: almacenamiento sin pagar',
    message: 'Hemos eliminado "{deploymentName}" porque su almacenamiento estuvo sin pagar más de '
      + '{graceDays} días. Cualquier importe pendiente sigue debiéndose.',
  },
  'storage.warning': {
    title: 'Almacenamiento sin pagar: acción necesaria',
  },

  'card.expired': {
    title: 'Tu tarjeta guardada ha caducado',
    message: 'Tu tarjeta {brand} terminada en {last4} ha caducado. Añade una nueva para que el pago '
      + 'por uso y las recargas automáticas sigan funcionando.',
  },
  'card.expiring': {
    title: 'Tu tarjeta guardada caduca pronto',
    message: 'Tu tarjeta {brand} terminada en {last4} caduca en {days} día(s). Añade una nueva antes '
      + 'de esa fecha para evitar interrupciones.',
  },

  'account.emailVerified': {
    title: 'Correo verificado',
    message: 'Un administrador ha verificado tu correo. Ya puedes acceder a todas las funciones.',
  },
  'account.suspended': {
    title: 'Cuenta suspendida',
    message: 'Tu cuenta ha sido suspendida. Ponte en contacto con soporte para más información.',
  },
  'account.suspendedWithReason': {
    title: 'Cuenta suspendida',
    message: '{reason}',
  },
  'account.activated': {
    title: 'Cuenta activada',
    message: 'Tu cuenta ha sido activada. Ya puedes acceder a todas las funciones.',
  },
  'account.statusSuspended': {
    title: 'Estado de la cuenta actualizado',
    message: 'Tu cuenta ha sido suspendida. Ponte en contacto con soporte para que te ayuden.',
  },
  'account.statusActivated': {
    title: 'Estado de la cuenta actualizado',
    message: 'Tu cuenta ha sido activada. Ya puedes acceder a todas las funciones.',
  },
  'account.updatedByAdmin': {
    title: 'Cuenta actualizada',
    message: '{adminName} ha actualizado tu cuenta.',
  },
  'admin.welcome': {
    title: 'Bienvenido al panel de administración',
    message: '{adminName} ha creado tu cuenta de administrador. Tu rol es: {role}.',
  },
};
