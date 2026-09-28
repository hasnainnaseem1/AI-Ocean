import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Typography, Button, Spin, Result, Alert, Input, theme } from "antd";
import { MailOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import AuthShell from "../components/AuthShell";
import config from "../config";

const { Text } = Typography;

const ResendForm = ({ tok }) => {
  const { t } = useTranslation("auth");
  const [email, setEmail]     = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);
  const [err, setErr]         = useState("");
  const [alreadyVerified, setAlreadyVerified] = useState(false);

  const handleResend = async () => {
    if (!email) return;
    setSending(true); setErr(""); setAlreadyVerified(false);
    try {
      const res  = await fetch(`${config.apiUrl}/api/v1/auth/customer/resend-verification`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.success) {
        setSent(true);
      } else if (data.action === "login" || (data.message && data.message.toLowerCase().includes("already verified"))) {
        setAlreadyVerified(true);
      } else {
        setErr(data.message || t("verifySent.resendFailed"));
      }
    } catch { setErr(t("errors.network")); }
    finally  { setSending(false); }
  };

  if (sent) return <Text style={{ color: "#16A34A" }}>{t("verify.resendSent")}</Text>;

  if (alreadyVerified) return (
    <div style={{ textAlign: "center" }}>
      <Text style={{ color: "#16A34A", fontSize: 15, display: "block", marginBottom: 12 }}>
        {t("verify.alreadyVerified")}
      </Text>
      <Button type="primary" href="/login" style={{ fontWeight: 600 }}>
        {t("verify.goToLogin")}
      </Button>
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
      <Input
        type="email" placeholder={t("verify.emailPlaceholder")}
        value={email} onChange={e => setEmail(e.target.value)}
        prefix={<MailOutlined style={{ color: tok.colorTextTertiary }} />}
        style={{ flex: 1, minWidth: 200 }}
      />
      <Button type="primary" onClick={handleResend} loading={sending} style={{ fontWeight: 600 }}>
        {t("verify.resendButton")}
      </Button>
      {err && <Text type="danger" style={{ fontSize: 12, width: "100%" }}>{err}</Text>}
    </div>
  );
};

const VerifyEmailPage = () => {
  const { t } = useTranslation("auth");
  const { token }  = useParams();
  const navigate   = useNavigate();
  const { token: tok } = theme.useToken();

  const [status, setStatus]   = useState("verifying");
  // Split so a language switch re-translates ours and leaves the server's alone.
  const [messageKey, setMessageKey] = useState("");
  const [serverMessage, setServerMessage] = useState("");
  const hasCalled = useRef(false);

  /*
   * The effect stores a translation *key*, never a translated string.
   *
   * Resolving `t(...)` here would freeze the message in whatever language was
   * active when the request came back — switch language afterwards and the
   * rest of the screen changes while this one line does not. Keys are
   * translated at render instead, so the whole screen moves together. A server
   * message is kept as-is, because the backend is not translated yet and there
   * is nothing to look up.
   */
  useEffect(() => {
    if (!token) { setStatus("error"); setMessageKey("verify.invalidLink"); return; }
    if (hasCalled.current) return;
    hasCalled.current = true;

    (async () => {
      try {
        const res  = await fetch(`${config.apiUrl}/api/v1/auth/customer/verify-email/${token}`);
        const data = await res.json();
        if (data.success) {
          setStatus("success");
          if (data.message) setServerMessage(data.message); else setMessageKey("verify.successDefault");
          setTimeout(() => navigate("/login"), 3000);
        } else {
          setStatus("error");
          if (data.message) setServerMessage(data.message); else setMessageKey("verify.failedDefault");
        }
      } catch { setStatus("error"); setMessageKey("errors.networkRetry"); }
    })();
  }, [token, navigate]);

  const message = serverMessage || (messageKey ? t(messageKey) : "");

  return (
    <AuthShell maxWidth={480}>
      <div style={{ textAlign: "center" }}>
        {status === "verifying" && (
          <>
            <Spin size="large" style={{ marginBottom: 24 }} />
            <Typography.Title level={3} style={{ marginTop: 0 }}>{t("verify.checkingTitle")}</Typography.Title>
            <Text type="secondary">{t("verify.checkingBody")}</Text>
          </>
        )}
        {status === "success" && (
          <Result status="success" title={t("verify.successTitle")} subTitle={t("verify.successRedirect", { message })}
            extra={<Button type="primary" onClick={() => navigate("/login")}>{t("verify.goToLogin")}</Button>} />
        )}
        {status === "error" && (
          <>
            <Result status="error" title={t("verify.failedTitle")} subTitle={message} />
            <Alert
              type="warning" showIcon
              message={t("verify.expiredPrompt")}
              description={<ResendForm tok={tok} />}
              style={{ textAlign: "left", marginBottom: 16, borderRadius: tok.borderRadius }}
            />
            <Link to="/login"><Button type="default">{t("verify.backToLogin")}</Button></Link>
          </>
        )}
      </div>
    </AuthShell>
  );
};

export default VerifyEmailPage;
