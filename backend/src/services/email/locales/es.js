/**
 * Spanish (es) email templates.
 *
 * LTR, so the HTML is structurally identical to the English pack — only the
 * prose changes. Every `{{variable}}` keeps its English name because that is
 * what `_interpolate` matches on.
 *
 * Tone: "tú" throughout, matching the app's own wording rather than the more
 * formal "usted" — the product speaks to developers, not to institutions.
 */
module.exports = {
  verification: {
    subject: 'Verifica tu correo electrónico – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">Verifica tu dirección de correo</h2>
      <p>Hola {{userName}}:</p>
      <p>¡Gracias por registrarte en <strong>{{siteName}}</strong>! Haz clic en el botón de abajo para verificar tu dirección de correo y activar tu cuenta.</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{verificationLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Verificar correo electrónico
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">O copia y pega este enlace en tu navegador:</p>
      <p style="color: {{primaryColor}}; font-size: 13px; word-break: break-all;">{{verificationLink}}</p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        Este enlace caduca en 24 horas. Si no creaste ninguna cuenta, puedes ignorar este correo sin problema.
      </p>
    `,
  },
  welcome: {
    subject: '¡Te damos la bienvenida a {{siteName}}!',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">¡Bienvenido, {{userName}}! 🎉</h2>
      <p>Tu cuenta en <strong>{{siteName}}</strong> se ha creado y verificado correctamente.</p>
      <p>Esto es lo que puedes hacer ahora:</p>
      <ul style="line-height: 2; color: #374151;">
        <li>Explorar tu panel y tus herramientas</li>
        <li>Recargar tu saldo para desplegar un modelo</li>
        <li>Consultar el catálogo de modelos disponibles</li>
      </ul>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{loginLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Ir al panel
        </a>
      </div>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        Recibes este mensaje porque te registraste en {{siteName}}.
      </p>
    `,
  },
  passwordReset: {
    subject: 'Restablece tu contraseña – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">Restablece tu contraseña</h2>
      <p>Hola {{userName}}:</p>
      <p>Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de <strong>{{siteName}}</strong>.</p>
      <p>Haz clic en el botón de abajo para elegir una contraseña nueva. Este enlace caduca en <strong>1 hora</strong>.</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{resetLink}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Restablecer contraseña
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">O copia y pega este enlace en tu navegador:</p>
      <p style="color: {{primaryColor}}; font-size: 13px; word-break: break-all;">{{resetLink}}</p>
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        Si no solicitaste restablecer la contraseña, puedes ignorar este correo sin problema. Tu contraseña no cambiará.
      </p>
    `,
  },

  deploymentApproved: {
    subject: 'Estamos preparando tu despliegue de {{modelName}} – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">Tu despliegue ha sido aprobado</h2>
      <p>Hola {{userName}}:</p>
      <p>Buenas noticias: tu solicitud de <strong>{{modelName}}</strong> ha sido aprobada y nuestro equipo ya ha empezado a aprovisionarla.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Despliegue</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{deploymentName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Modelo</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{modelName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Hardware</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{tierName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Tarifa</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{pricePerHour}}/hora</td></tr>
      </table>

      <p>Te escribiremos de nuevo en cuanto tu endpoint esté activo. La facturación solo empieza cuando el despliegue está en marcha.</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{deploymentUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Ver despliegue
        </a>
      </div>
    `,
  },

  deploymentReady: {
    subject: '{{modelName}} ya está activo – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">Tu modelo está listo 🚀</h2>
      <p>Hola {{userName}}:</p>
      <p><strong>{{deploymentName}}</strong> ya está en marcha y listo para recibir solicitudes.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Modelo</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{modelName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Hardware</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{tierName}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Endpoint</td><td style="padding: 6px 12px; text-align: right; font-weight: 600; word-break: break-all;">{{endpointUrl}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Tarifa</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{pricePerHour}}/hora</td></tr>
      </table>

      <p style="color: #b45309; background: #fffbeb; border-left: 3px solid #f59e0b; padding: 12px 16px; border-radius: 6px; font-size: 14px;">
        Por seguridad, tu clave de API no se incluye en este correo. Abre tu despliegue en el panel para copiarla.
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{deploymentUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Obtener clave de API
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        La facturación por horas empezó en cuanto el despliegue se activó. Puedes pausarlo o detenerlo en cualquier momento desde el panel para dejar de acumular cargos.
      </p>
    `,
  },

  deploymentRejected: {
    subject: 'Sobre tu solicitud de {{modelName}} – {{siteName}}',
    body: `
      <h2 style="color: #ff4d4f; margin: 0 0 16px;">No hemos podido continuar con esta solicitud</h2>
      <p>Hola {{userName}}:</p>
      <p>Lamentablemente no hemos podido aprovisionar <strong>{{deploymentName}}</strong> ({{modelName}}) en este momento.</p>

      <p style="background: #fff1f0; border-left: 3px solid #ff4d4f; padding: 12px 16px; border-radius: 6px; color: #a8071a;">
        <strong>Motivo:</strong> {{rejectionReason}}
      </p>

      <p>No se te ha cobrado nada por esta solicitud. Si quieres que te ayudemos a encontrar una configuración que funcione, responde a este correo o escríbenos a {{supportEmail}}.</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{catalogUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Explorar modelos
        </a>
      </div>
    `,
  },

  deploymentSuspended: {
    subject: 'Despliegue pausado: saldo agotado – {{siteName}}',
    body: `
      <h2 style="color: #faad14; margin: 0 0 16px;">Hemos pausado tu despliegue</h2>
      <p>Hola {{userName}}:</p>
      <p>Hemos pausado <strong>{{deploymentName}}</strong> ({{modelName}}) porque tu saldo se ha agotado. Tu configuración y tus datos están a salvo: al recargar podrás reanudarlo.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Saldo actual</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{balance}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Tarifa</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{pricePerHour}}/hora</td></tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Añadir saldo
        </a>
      </div>
    `,
  },

  creditTopUp: {
    subject: 'Saldo añadido – {{currency}} {{amount}} – {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">Hemos añadido tu saldo</h2>
      <p>Hola {{userName}}:</p>
      <p>Hemos añadido <strong>{{currency}} {{amount}}</strong> a tu cuenta.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Importe añadido</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{amount}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Nuevo saldo</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{currency}} {{balance}}</td></tr>
        <tr><td style="padding: 6px 12px; color: #6b7280; font-size: 14px;">Fecha</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">{{paymentDate}}</td></tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Ver monedero
        </a>
      </div>
    `,
  },

  lowBalance: {
    subject: 'Saldo bajo – {{siteName}}',
    body: `
      <h2 style="color: #faad14; margin: 0 0 16px;">Te queda poco saldo</h2>
      <p>Hola {{userName}}:</p>
      <p>Tu saldo es de <strong>{{currency}} {{balance}}</strong>. Con tu consumo actual de {{currency}} {{burnRatePerDay}}/día, te quedan aproximadamente <strong>{{runwayDays}} día(s)</strong>.</p>
      <p>Recarga ahora para que tus despliegues sigan funcionando sin interrupciones: se pausan automáticamente cuando el saldo se agota.</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{walletUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Añadir saldo
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        Puedes activar la recarga automática en los ajustes de tu monedero para que esto no vuelva a pasar.
      </p>
    `,
  },

  teamNotification: {
    subject: '{{title}} · {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">{{title}}</h2>
      <p>Hola {{name}}:</p>
      <p>{{message}}</p>
      {{actionBlock}}
      <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
        Recibes esto por tu pertenencia a una organización en {{siteName}}.
      </p>
    `,
  },
  teamInvite: {
    subject: '{{inviterName}} te ha invitado a {{teamName}} en {{siteName}}',
    body: `
      <h2 style="color: {{primaryColor}}; margin: 0 0 16px;">Únete a {{teamName}}</h2>
      <p>Hola:</p>
      <p><strong>{{inviterName}}</strong> te ha invitado a unirte a <strong>{{teamName}}</strong> en {{siteName}} como <strong>{{roleName}}</strong>.</p>
      <p>Acepta con la cuenta de esta dirección de correo. Si aún no tienes una, puedes crearla desde la página de la invitación.</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="{{acceptUrl}}" target="_blank" rel="noopener noreferrer"
           style="background: linear-gradient(to right, {{primaryColor}}, {{secondaryColor}}); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
          Aceptar invitación
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">Esta invitación caduca en {{expiresDays}} día(s). Si no la esperabas, puedes ignorar este correo.</p>
    `,
  },
  teamRoles: {
    owner: 'Propietario',
    admin: 'Administrador',
    billing: 'Facturación',
    developer: 'Desarrollador',
    viewer: 'Lector',
  },
  layout: {
    rights: '&copy; {{year}} {{siteName}}. Todos los derechos reservados.',
    needHelp: '¿Necesitas ayuda?',
    logoAlt: '{{siteName}}',
  },
};
