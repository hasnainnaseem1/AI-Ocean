import React, { useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { Typography, Button, Alert, theme } from "antd";
import { MailOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../context/ThemeContext";
import { getBrand } from "../theme/colors";
import AuthShell from "../components/AuthShell";
import config from "../config";

const { Title, Text } = Typography;

const VerifyEmailSentPage = () => {
  const { t } = useTranslation("auth");
  const location  = useLocation();
  const email     = location.state?.email || "";
  const { isDark } = useTheme();
  const { token: tok } = theme.useToken();
  const brand = getBrand(isDark);

  const [resending, setResending]     = useState(false);
  const [resendStatus, setResendStatus] = useState(null);

  const handleResend = async () => {
    if (!email) return;
    setResending(true); setResendStatus(null);
    try {
      const res  = await fetch(`${config.apiUrl}/api/v1/auth/customer/resend-verification`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      setResendStatus(data.success ? "success" : "error");
    } catch { setResendStatus("error"); }
    finally  { setResending(false); }
  };

  return (
    <AuthShell maxWidth={460}>
      <div style={{ textAlign: "center" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 64, height: 64, borderRadius: "50%", marginBottom: 20,
          background: isDark ? "rgba(59,130,246,0.15)" : "rgba(37,99,235,0.1)",
        }}>
          <MailOutlined style={{ color: brand, fontSize: 26 }} />
        </div>

        <Title level={3} style={{ marginTop: 0, marginBottom: 8 }}>{t("verifySent.title")}</Title>
        <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
          {t("verifySent.sentTo")}
        </Text>
        {email ? (
          <Text strong style={{ color: tok.colorPrimary, fontSize: 16, display: "block", marginBottom: 20, wordBreak: "break-all" }}>
            {email}
          </Text>
        ) : (
          <Alert
            type="warning" showIcon
            message={t("verifySent.noEmailTitle")}
            description={t("verifySent.noEmailBody")}
            style={{ marginBottom: 20, borderRadius: tok.borderRadius, textAlign: 'start' }}
          />
        )}
        <Text type="secondary" style={{ display: "block", marginBottom: 28, fontSize: 13 }}>
          {t("verifySent.instructions")}
        </Text>

        {resendStatus === "success" && <Alert type="success" message={t("verifySent.resent")} showIcon style={{ marginBottom: 16, borderRadius: tok.borderRadius }} />}
        {resendStatus === "error"   && <Alert type="error"   message={t("verifySent.resendFailed")} showIcon style={{ marginBottom: 16, borderRadius: tok.borderRadius }} />}

        <Button
          type="primary" onClick={handleResend} loading={resending} disabled={!email || resendStatus === "success"} block
          style={{ height: 44, fontWeight: 600, marginBottom: 16 }}
        >
          {t("verifySent.resendButton")}
        </Button>

        <Link to="/login" style={{ color: tok.colorPrimary, fontSize: 13 }}>{t("verifySent.backToLogin")}</Link>
      </div>
    </AuthShell>
  );
};

export default VerifyEmailSentPage;
