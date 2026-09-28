import React, { useState } from 'react';
import { Dropdown, Button, Tooltip, Typography, message } from 'antd';
import { GlobalOutlined, CheckOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { getBrand } from '../theme/colors';

const { Text } = Typography;

/**
 * The one way a customer changes language.
 *
 * One component with two shapes rather than two components, because the two
 * placements differ only in how they look:
 *
 *   icon — the app header, where it sits beside the theme toggle and has to be
 *          the same 38px circle or the row stops looking deliberate.
 *   chip — the auth screens, where there is no icon row to join and a bare
 *          globe would be a mystery to someone who has not signed in yet, so
 *          the language's own name is shown instead.
 *
 * Renders nothing when the platform offers one language. A deployment that
 * never turns on a second language should not grow a control for it — and this
 * is why `enabled` comes from the admin's settings rather than from the code
 * catalogue.
 *
 * Every entry is written in its own script (اردو, 简体中文), never transliterated
 * and never in English only: someone who cannot read the current language has
 * to be able to find their own in the list.
 */
const LanguageSwitcher = ({ variant = 'icon' }) => {
  const { t } = useTranslation('common');
  const { isDark } = useTheme();
  const { language, enabled, changeLanguage, platformDefault } = useLanguage();
  const [open, setOpen] = useState(false);
  const BRAND = getBrand(isDark);

  if (!enabled || enabled.length < 2) return null;

  const active = enabled.find((l) => l.code === language) || enabled[0];

  const pick = async (code) => {
    setOpen(false);
    if (code === language) return;

    const result = await changeLanguage(code);
    /*
     * The language is already applied by the time this returns — the switch is
     * local-first on purpose, so it never feels like a network operation. This
     * only tells them the *saving* failed, and says what that means: it works
     * here, it may not follow them to another device yet.
     */
    if (!result?.ok && result?.reason !== 'anonymous') {
      message.warning(t('language.saveFailed'), 5);
    }
  };

  const items = enabled.map((l) => ({
    key: l.code,
    label: (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        minWidth: 190, padding: '2px 0',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/*
            * The native name leads and carries the language's own direction —
            * inside an LTR menu an Arabic name would otherwise have its
            * punctuation rearranged by the bidi algorithm.
            */}
          <div dir={l.dir} style={{ fontSize: 14, fontWeight: l.code === language ? 600 : 500 }}>
            {l.nativeName}
          </div>
          <Text type="secondary" style={{ fontSize: 11.5 }}>
            {l.englishName}
            {l.code === platformDefault ? ` · ${t('language.defaultTag')}` : ''}
          </Text>
        </div>
        {l.code === language && <CheckOutlined style={{ color: BRAND, fontSize: 12 }} />}
      </div>
    ),
    onClick: () => pick(l.code),
  }));

  const trigger = variant === 'chip' ? (
    <Button
      aria-label={t('language.switcherLabel')}
      icon={<GlobalOutlined />}
      style={{
        height: 38,
        borderRadius: 19,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 13.5,
      }}
    >
      <span dir={active.dir}>{active.nativeName}</span>
    </Button>
  ) : (
    <Tooltip title={t('language.switcherLabel')}>
      <Button
        type="text"
        shape="circle"
        aria-label={t('language.switcherLabel')}
        icon={<GlobalOutlined />}
        style={{ fontSize: 16, width: 38, height: 38 }}
      />
    </Tooltip>
  );

  return (
    <Dropdown
      trigger={['click']}
      open={open}
      onOpenChange={setOpen}
      // antd mirrors `placement` itself under direction="rtl", so this stays
      // "bottomRight" in both directions and lands on the correct edge.
      placement="bottomRight"
      menu={{ items, selectedKeys: [language] }}
    >
      {trigger}
    </Dropdown>
  );
};

export default LanguageSwitcher;
