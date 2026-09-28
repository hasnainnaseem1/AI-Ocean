import React, { useState } from 'react';
import { Modal, Button, Typography, Space } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { getBrand, cardStyle as surfaceStyle } from '../theme/colors';

const { Title, Text } = Typography;

/**
 * Asked once, on a customer's first sign-in, when their country suggests they
 * might prefer a language other than English.
 *
 * Deliberately two options and no more. A list of every language the platform
 * speaks would be a settings screen, and a settings screen is not what someone
 * wants in the first ten seconds of their first session — the switcher in the
 * header is there for anyone who wants the full list.
 *
 * Whatever they do here, it counts as an answer. Choosing a language saves it;
 * choosing English saves English; closing the dialog saves English too. All
 * three set `languagePreferenceSet` on the account, so this is never asked
 * again on any device — a prompt that comes back is a prompt that was not
 * really a question.
 *
 * Not currently reachable: it needs a detected country, and nothing in this
 * stack provides one yet. See `src/i18n/detectCountry.js`.
 */
const LanguageSelectionModal = ({ open, suggested, onDone }) => {
  const { t } = useTranslation('common');
  const { isDark } = useTheme();
  const { changeLanguage, enabled } = useLanguage();
  const [busy, setBusy] = useState(null);
  const BRAND = getBrand(isDark);

  const english = enabled.find((l) => l.code === 'en');
  if (!suggested || !english) return null;

  const choose = async (code) => {
    setBusy(code);
    /*
     * Awaited, unlike the header switcher — this is the write that records the
     * customer has been asked, and letting the dialog close before it lands
     * risks asking again on the next device. A failure still closes: the
     * language is applied locally, and LanguageContext retries on the next
     * change. Nagging someone because our network hiccuped is worse than
     * losing the flag.
     */
    await changeLanguage(code);
    setBusy(null);
    onDone(code);
  };

  const option = (lang, isPrimary) => (
    <button
      key={lang.code}
      onClick={() => choose(lang.code)}
      disabled={!!busy}
      style={{
        ...surfaceStyle(isDark),
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '16px 18px',
        cursor: busy ? 'wait' : 'pointer',
        textAlign: 'start',
        border: isPrimary ? `1.5px solid ${BRAND}` : undefined,
        opacity: busy && busy !== lang.code ? 0.5 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Its own script and its own direction — the whole point of this
            dialog is that the reader may not read the one on screen. */}
        <div dir={lang.dir} style={{ fontSize: 20, fontWeight: 600, marginBottom: 2 }}>
          {lang.nativeName}
        </div>
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          {lang.englishName}
          {lang.code === 'en' ? ` · ${t('language.defaultTag')}` : ''}
        </Text>
      </div>
    </button>
  );

  return (
    <Modal
      open={open}
      // No close button and no mask-dismiss: every exit has to go through a
      // choice, so the "they have been asked" flag is always written. The
      // English option is the escape hatch.
      closable={false}
      maskClosable={false}
      keyboard={false}
      footer={null}
      width={460}
      centered
    >
      <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 20 }}>
        <GlobalOutlined style={{ fontSize: 22, color: BRAND }} />
        <Title level={4} style={{ margin: '8px 0 0' }}>
          {t('language.chooseTitle', { language: suggested.nativeName })}
        </Title>
        <Text type="secondary" style={{ fontSize: 13.5 }}>
          {t('language.chooseBody', { language: suggested.englishName })}
        </Text>
      </Space>

      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {option(suggested, true)}
        {option(english, false)}
      </Space>

      <div style={{ textAlign: 'center', marginTop: 14 }}>
        <Button type="link" size="small" disabled={!!busy} onClick={() => choose('en')}>
          {t('language.keepEnglish')}
        </Button>
      </div>
    </Modal>
  );
};

export default LanguageSelectionModal;
