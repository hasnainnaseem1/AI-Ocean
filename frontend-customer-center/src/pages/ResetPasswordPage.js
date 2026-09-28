import React, { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Form, Input, Button, Alert, Typography, Result, Progress, theme } from "antd";
import { LockOutlined, EyeInvisibleOutlined, EyeTwoTone, SafetyCertificateOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import AuthShell from "../components/AuthShell";
import config from "../config";

const { Text } = Typography;

const getStrength = (pw) => {
  let s = 0;
  if (pw.length >= 8)  s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw))   s++;
  if (/[^a-zA-Z\d]/.test(pw)) s++;
  const labels = ["", "Weak", "Fair", "Good", "Strong", "Very Strong"];
  const colors  = ["", "#DC2626", "#D97706", "#CA8A04", "#16A34A", "#15803D"];
  return { score: s, label: labels[s] || "", color: colors[s] || "#ddd", pct: (s / 5) * 100 };
};

const ResetPasswordPage = () => {
  const { t } = useTranslation("auth");
  const { token: urlToken } = useParams();
  const navigate = useNavigate();
  const { token: tok } = theme.useToken();

  const [loading, setLoading]   = useState(false);
  const [success, setSuccess]   = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [expired, setExpired]   = useState(false);
  const [strength, setStrength] = useState({ score: 0, label: "", color: "#ddd", pct: 0 });

  const handleSubmit = async (values) => {
    setErrorMsg(""); setLoading(true);
    try {
      const res  = await fetch(`${config.apiUrl}/api/v1/auth/customer/reset-password/${urlToken}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: values.password }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(true);
        setTimeout(() => navigate("/login"), 3000);
      } else if (res.status === 400) {
        setExpired(true);
        setErrorMsg(data.message || t("reset.expired"));
      } else {
        setErrorMsg(data.message || t("reset.failed"));
      }
    } catch { setErrorMsg(t("errors.networkRetry")); }
    finally  { setLoading(false); }
  };

  if (success) {
    return (
      <AuthShell>
        <Result
          status="success"
          title={t("reset.doneTitle")}
          subTitle={t("reset.doneBody")}
          extra={<Link to="/login"><Button type="primary">{t("reset.goToLogin")}</Button></Link>}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("reset.title")} subtitle={t("reset.subtitle")}>
      {errorMsg && (
        <Alert type="error" message={errorMsg} showIcon style={{ marginBottom: 20, borderRadius: tok.borderRadius }}
          action={expired ? <Link to="/forgot-password"><Button size="small" type="link">{t("reset.requestNewLink")}</Button></Link> : null} />
      )}

      <Form layout="vertical" onFinish={handleSubmit} size="large" requiredMark={false}>
        <Form.Item name="password" label={<Text strong>{t("fields.newPasswordLabel")}</Text>}
          rules={[{ required: true, message: t("fields.passwordRequired") }, { min: 8, message: t("fields.passwordMinLength") }]}
          style={{ marginBottom: 6 }}>
          <Input.Password
            prefix={<LockOutlined style={{ color: tok.colorTextTertiary }} />}
            placeholder={t("fields.newPasswordPlaceholder")}
            iconRender={v => (v ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
            onChange={e => setStrength(getStrength(e.target.value))}
          />
        </Form.Item>

        {strength.score > 0 && (
          <div style={{ marginBottom: 16 }}>
            <Progress percent={strength.pct} showInfo={false} strokeColor={strength.color} size="small" />
            <Text style={{ fontSize: 12, color: strength.color }}>{strength.label} password</Text>
          </div>
        )}

        <Form.Item name="confirmPassword" label={<Text strong>{t("fields.confirmNewPasswordLabel")}</Text>}
          dependencies={["password"]}
          rules={[
            { required: true, message: t("fields.confirmRequired") },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("password") === value) return Promise.resolve();
                return Promise.reject(new Error(t("fields.passwordMismatch")));
              },
            }),
          ]}>
          <Input.Password
            prefix={<SafetyCertificateOutlined style={{ color: tok.colorTextTertiary }} />}
            placeholder={t("fields.confirmNewPasswordPlaceholder")}
            iconRender={v => (v ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 16 }}>
          <Button type="primary" htmlType="submit" loading={loading} block style={{ height: 44, fontWeight: 600, fontSize: 15 }}>
            {t("reset.submitButton")}
          </Button>
        </Form.Item>
      </Form>

      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <Link to="/login" style={{ color: tok.colorPrimary, fontSize: 13 }}>{t("reset.backToLogin")}</Link>
      </div>
    </AuthShell>
  );
};

export default ResetPasswordPage;
