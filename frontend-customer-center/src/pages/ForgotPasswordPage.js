import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Form, Input, Button, Alert, Typography, Result, theme } from "antd";
import { MailOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import AuthShell from "../components/AuthShell";
import config from "../config";

const { Text } = Typography;

const ForgotPasswordPage = () => {
  const { t } = useTranslation("auth");
  const { token: tok } = theme.useToken();
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (values) => {
    setErrorMsg(""); setLoading(true);
    try {
      const res  = await fetch(`${config.apiUrl}/api/v1/auth/customer/forgot-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email }),
      });
      const data = await res.json();
      if (data.success) { setSent(true); }
      else { setErrorMsg(data.message || t("errors.generic")); }
    } catch { setErrorMsg(t("errors.networkRetry")); }
    finally  { setLoading(false); }
  };

  if (sent) {
    return (
      <AuthShell>
        <Result
          status="success"
          title={t("forgot.sentTitle")}
          subTitle={t("forgot.sentBody")}
          extra={<Link to="/login"><Button type="primary">{t("forgot.backToLogin")}</Button></Link>}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("forgot.title")}
      subtitle={t("forgot.subtitle")}
    >
      {errorMsg && <Alert type="error" message={errorMsg} showIcon style={{ marginBottom: 20, borderRadius: tok.borderRadius }} />}

      <Form layout="vertical" onFinish={handleSubmit} size="large" requiredMark={false}>
        <Form.Item name="email" label={<Text strong>{t("fields.emailLabel")}</Text>}
          rules={[{ required: true, message: t("fields.emailRequired") }, { type: "email", message: t("fields.emailInvalid") }]}>
          <Input prefix={<MailOutlined style={{ color: tok.colorTextTertiary }} />} placeholder={t("fields.emailPlaceholder")} />
        </Form.Item>
        <Form.Item style={{ marginBottom: 16 }}>
          <Button type="primary" htmlType="submit" loading={loading} block style={{ height: 44, fontWeight: 600, fontSize: 15 }}>
            {t("forgot.submitButton")}
          </Button>
        </Form.Item>
      </Form>

      <div style={{ textAlign: "center" }}>
        <Link to="/login" style={{ color: tok.colorPrimary, fontWeight: 500, fontSize: 13 }}>
          <ArrowLeftOutlined style={{ marginInlineEnd: 6 }} />{t("forgot.backToLogin")}
        </Link>
      </div>
    </AuthShell>
  );
};

export default ForgotPasswordPage;
