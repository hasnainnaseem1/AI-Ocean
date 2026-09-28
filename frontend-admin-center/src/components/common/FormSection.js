import React from 'react';
import { Typography } from 'antd';
import { useTheme } from '../../contexts/ThemeContext';
import { adminCardStyle, microLabelStyle, muted, ADMIN_DENSITY } from '../../theme/colors';

const { Text } = Typography;

/**
 * A titled group of form fields, capped to a readable column width.
 *
 * Written to fix `SettingsPage`'s full-width-input problem at the structure
 * rather than the field: a "Free Trial Days" `<InputNumber>` currently
 * stretches to the page's full ~1200px because nothing in the layout caps it.
 * Wrapping a form's fields in one or more `FormSection`s fixes every field in
 * it at once, and reads as a settings page instead of one long, unbroken form.
 *
 * `Form.Item`s go directly inside as children — this only supplies the frame.
 *
 *   <FormSection title="Trial & signup" description="What new customers get on sign-up.">
 *     <Form.Item name="freeTrialDays" label="Free trial days">
 *       <InputNumber min={0} />
 *     </Form.Item>
 *   </FormSection>
 */
const FormSection = ({ title, description, children, style }) => {
  const { isDark } = useTheme();

  return (
    <div
      className="form-section"
      style={{
        ...adminCardStyle(isDark),
        padding: '16px 18px',
        marginBottom: 14,
        maxWidth: ADMIN_DENSITY.formMaxWidth,
        ...style,
      }}
    >
      {title && (
        <div style={{ marginBottom: 14 }}>
          <div style={microLabelStyle(isDark)}>{title}</div>
          {description && (
            <Text style={{ display: 'block', marginTop: 4, fontSize: 13, color: muted(isDark) }}>
              {description}
            </Text>
          )}
        </div>
      )}
      {children}
    </div>
  );
};

export default FormSection;
