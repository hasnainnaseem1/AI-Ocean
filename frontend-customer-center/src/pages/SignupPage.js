import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { afterSignIn } from "../auth/safeNext";
import {
  Form, Input, Button, Divider, Alert, Typography, Progress, theme
} from "antd";
import {
  UserOutlined, MailOutlined, LockOutlined, EyeInvisibleOutlined, EyeTwoTone,
  GoogleOutlined, SafetyCertificateOutlined, TeamOutlined
} from "@ant-design/icons";
import { useGoogleLogin } from "@react-oauth/google";
import { useAuth } from "../context/AuthContext";
import { useSite } from "../context/SiteContext";
import { useTranslation } from "react-i18next";
import AuthShell from "../components/AuthShell";
import config from "../config";

const { Text } = Typography;

// Must be rendered INSIDE <GoogleOAuthProvider> — never call useGoogleLogin at the top level
const GoogleSignUpButton = ({ onSuccess, onError, intent }) => {
  const { t } = useTranslation("auth");
  const [loading, setLoading] = useState(false);
  const googleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setLoading(true);
      try {
        const res  = await fetch(`${config.apiUrl}/api/v1/auth/customer/google`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ access_token: tokenResponse.access_token, intent }),
        });
        const data = await res.json();
        if (data.success) {
          onSuccess(data.token, data.user);
        } else {
          onError(data.message || t("errors.googleFailed"));
        }
      } catch {
        onError(t("errors.network"));
      } finally {
        setLoading(false);
      }
    },
    onError: () => onError(t("errors.googleCancelled")),
  });
  return (
    <Button
      icon={<GoogleOutlined />}
      block
      size="large"
      loading={loading}
      onClick={() => googleLogin()}
      style={{ height: 44, fontWeight: 600, marginBottom: 24 }}
    >
      {t("signup.withGoogle")}
    </Button>
  );
};

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

/**
 * "Who will use it?" — asked only while teams are switched on. It shapes what
 * happens after signup (a team founder is taken to name their organization and
 * invite people) and closes no door: an individual can create an organization
 * later, and a founder keeps their personal account.
 */
const IntentChoice = ({ value, onChange }) => {
  const { t } = useTranslation("teams");
  const { token: tok } = theme.useToken();
  const option = (key, icon, title, hint) => {
    const active = value === key;
    return (
      <button
        type="button"
        onClick={() => onChange(key)}
        aria-pressed={active}
        style={{
          flex: "1 1 180px", textAlign: "start", cursor: "pointer",
          padding: "12px 14px", borderRadius: tok.borderRadiusLG,
          border: `1.5px solid ${active ? tok.colorPrimary : tok.colorBorder}`,
          background: active ? tok.colorPrimaryBg : tok.colorBgContainer,
          color: tok.colorText, font: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>{icon}{title}</div>
        <div style={{ fontSize: 12.5, color: tok.colorTextSecondary, marginTop: 2 }}>{hint}</div>
      </button>
    );
  };
  return (
    <div style={{ marginBottom: 20 }}>
      <Text strong style={{ display: "block", marginBottom: 8 }}>{t("signupIntent.question")}</Text>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {option("individual", <UserOutlined />, t("signupIntent.individual"), t("signupIntent.individualHint"))}
        {option("team", <TeamOutlined />, t("signupIntent.team"), t("signupIntent.teamHint"))}
      </div>
    </div>
  );
};

const SignupPage = () => {
  const { t } = useTranslation("auth");
  const navigate    = useNavigate();
  const location    = useLocation();
  const { login }   = useAuth();
  // Arriving from an invitation: that address is filled in, and they are
  // joining someone else's organization, so the question is not asked.
  const presetEmail = new URLSearchParams(location.search).get("email") || undefined;
  const fromInvite  = !!presetEmail;
  const { siteConfig, loaded: siteLoaded } = useSite();
  const googleEnabled = !!(siteConfig?.googleSSO?.enabled && siteConfig?.googleSSO?.clientId);
  const signupDisabled = siteLoaded && siteConfig?.enableCustomerSignup === false;
  const { token: tok } = theme.useToken();

  const [form]      = Form.useForm();
  const [loading, setLoading]   = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [strength, setStrength] = useState({ score: 0, label: "", color: "#ddd", pct: 0 });
  const [intent, setIntent]     = useState("individual");
  const askIntent = !!siteConfig?.teams?.enabled && !fromInvite;

  const handleSubmit = async (values) => {
    setErrorMsg(""); setLoading(true);
    try {
      const res  = await fetch(`${config.apiUrl}/api/v1/auth/customer/signup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name, email: values.email, password: values.password,
          intent: askIntent ? intent : "individual",
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.token) {
          login(data.token, data.user);
          navigate(afterSignIn(location.search));
        } else {
          navigate("/verify-email-sent", { state: { email: values.email } });
        }
      } else {
        setErrorMsg(data.message || t("errors.signupFailed"));
      }
    } catch {
      setErrorMsg(t("errors.network"));
    } finally { setLoading(false); }
  };

  return (
    <AuthShell
      maxWidth={480}
      title={t("signup.title")}
      subtitle={t("signup.subtitle")}
    >
      {signupDisabled && (
        <Alert
          type="warning"
          message={t("signup.disabledTitle")}
          description={t("signup.disabledBody")}
          showIcon
          style={{ marginBottom: 20, borderRadius: tok.borderRadius }}
        />
      )}

      {errorMsg && <Alert type="error" message={errorMsg} showIcon style={{ marginBottom: 20, borderRadius: tok.borderRadius }} />}

      {askIntent && <IntentChoice value={intent} onChange={setIntent} />}

      <Form form={form} layout="vertical" onFinish={handleSubmit} size="large" requiredMark={false} initialValues={{ email: presetEmail }}>
        <Form.Item name="name" label={<Text strong>{t("fields.nameLabel")}</Text>}
          rules={[{ required: true, message: t("fields.nameRequired") }, { min: 2, message: t("fields.nameMinLength") }]}>
          <Input prefix={<UserOutlined style={{ color: tok.colorTextTertiary }} />} placeholder={t("fields.namePlaceholder")} />
        </Form.Item>

        <Form.Item name="email" label={<Text strong>{t("fields.emailLabel")}</Text>}
          rules={[{ required: true, message: t("fields.emailRequired") }, { type: "email", message: t("fields.emailInvalid") }]}>
          <Input prefix={<MailOutlined style={{ color: tok.colorTextTertiary }} />} placeholder={t("fields.emailPlaceholder")} />
        </Form.Item>

        <Form.Item name="password" label={<Text strong>{t("fields.passwordLabel")}</Text>}
          rules={[{ required: true, message: t("fields.passwordRequired") }, { min: 8, message: t("fields.passwordMinLength") }]}
          style={{ marginBottom: 6 }}>
          <Input.Password
            prefix={<LockOutlined style={{ color: tok.colorTextTertiary }} />}
            placeholder={t("fields.passwordCreatePlaceholder")}
            iconRender={v => (v ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
            onChange={e => setStrength(getStrength(e.target.value))}
          />
        </Form.Item>

        {strength.score > 0 && (
          <div style={{ marginBottom: 16 }}>
            <Progress percent={strength.pct} showInfo={false} strokeColor={strength.color} size="small" />
            <Text style={{ fontSize: 12, color: strength.color }}>{strength.label} {t("signup.passwordStrengthSuffix")}</Text>
          </div>
        )}

        <Form.Item name="confirmPassword" label={<Text strong>{t("fields.confirmPasswordLabel")}</Text>}
          dependencies={["password"]}
          rules={[
            { required: true, message: t("fields.confirmPasswordRequired") },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("password") === value) return Promise.resolve();
                return Promise.reject(new Error(t("fields.passwordMismatch")));
              },
            }),
          ]}>
          <Input.Password
            prefix={<SafetyCertificateOutlined style={{ color: tok.colorTextTertiary }} />}
            placeholder={t("fields.confirmPasswordPlaceholder")}
            iconRender={v => (v ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
          />
        </Form.Item>

        {/*
          antd stamps the Form.Item's `name` onto its child as an `id`, so the
          wrapping <div> was also getting id="terms" — two elements sharing it.
          <label htmlFor="terms"> then resolved to the div, and clicking the
          words "I agree to the Terms…" did nothing at all: the only working
          target was the ~13px box itself. Giving the input its own distinct id
          (and the Form.Item an explicit one) leaves exactly one element per id.
        */}
        <Form.Item name="terms" id="terms-field" valuePropName="checked"
          rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error(t("signup.acceptTermsRequired"))) }]}>
          <div style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              id="terms-accept"
              onChange={e => form.setFieldValue("terms", e.target.checked)}
              style={{ marginInlineEnd: 8 }}
            />
            <label htmlFor="terms-accept" style={{ color: tok.colorText, cursor: 'pointer' }}>
              {t("signup.agreeTo")}{" "}
              <a href={`${config.marketingUrl}/terms`} target="_blank" rel="noreferrer" style={{ color: tok.colorPrimary }}>{t("signup.terms")}</a>
              {" "}{t("signup.and")}{" "}
              <a href={`${config.marketingUrl}/privacy`} target="_blank" rel="noreferrer" style={{ color: tok.colorPrimary }}>{t("signup.privacyPolicy")}</a>
            </label>
          </div>
        </Form.Item>

        <Form.Item style={{ marginBottom: 12 }}>
          <Button type="primary" htmlType="submit" loading={loading} disabled={signupDisabled} block
            style={{ height: 44, fontWeight: 600, fontSize: 15 }}>
            {t("signup.submitButton")}
          </Button>
        </Form.Item>
      </Form>

      {googleEnabled && !signupDisabled && (
        <>
          <Divider plain><Text type="secondary" style={{ fontSize: 12 }}>{t("signin.orContinueWith")}</Text></Divider>
          <GoogleSignUpButton
            intent={askIntent ? intent : "individual"}
            onSuccess={(token, user) => { login(token, user); navigate(afterSignIn(location.search)); }}
            onError={(msg) => setErrorMsg(msg)}
          />
        </>
      )}

      <div style={{ textAlign: "center" }}>
        <Text type="secondary">{t("signup.haveAccount")}{" "}</Text>
        <Link to={`/login${location.search}`} style={{ color: tok.colorPrimary, fontWeight: 600 }}>{t("signup.signInLink")}</Link>
      </div>
    </AuthShell>
  );
};

export default SignupPage;
