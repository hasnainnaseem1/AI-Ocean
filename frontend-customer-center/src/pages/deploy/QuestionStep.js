import React from 'react';
import { Typography, Space, Row, Col } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  OptionCard, BigInput, BigTextArea, BigNumber, StepHeading,
} from './journeyParts';

const { Text } = Typography;

/**
 * One question, rendered as a screen rather than a form row.
 *
 * Every choice type that can be a set of cards is one — select, radio,
 * multiselect and boolean all become the same large tappable option, so the
 * customer learns one interaction and reuses it for the whole journey. Only
 * genuinely open answers (text, number) fall back to an input, and even those
 * are set at display size.
 */
const AnswerControl = ({ question, value, onChange, onEnter, autoFocus }) => {
  const { t } = useTranslation(['deploy', 'common']);
  const options = question.options || [];

  switch (question.type) {
    case 'select':
    case 'radio':
      return (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          {options.map((option, index) => (
            <OptionCard
              key={option.value}
              index={index}
              label={option.label}
              selected={value === option.value}
              onClick={() => onChange(option.value)}
            />
          ))}
        </Space>
      );

    case 'multiselect': {
      const selected = Array.isArray(value) ? value : [];
      return (
        <>
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {options.map((option, index) => (
              <OptionCard
                key={option.value}
                index={index}
                multi
                label={option.label}
                selected={selected.includes(option.value)}
                onClick={() => onChange(
                  selected.includes(option.value)
                    ? selected.filter((v) => v !== option.value)
                    : [...selected, option.value]
                )}
              />
            ))}
          </Space>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
            {t('deploy:question.chooseMany')}
          </Text>
        </>
      );
    }

    // A yes/no reads better as two cards than as a lone toggle with no context
    case 'boolean':
      return (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <OptionCard index={0} label={t('deploy:question.yes')} selected={value === true} onClick={() => onChange(true)} />
          <OptionCard index={1} label={t('deploy:question.no')} selected={value === false} onClick={() => onChange(false)} />
        </Space>
      );

    case 'number':
      return (
        <BigNumber
          autoFocus={autoFocus}
          value={value}
          onChange={onChange}
          onEnter={onEnter}
          placeholder={question.placeholder}
        />
      );

    case 'textarea':
      return (
        <BigTextArea
          autoFocus={autoFocus}
          value={value}
          onChange={onChange}
          placeholder={question.placeholder}
        />
      );

    default:
      return (
        <BigInput
          autoFocus={autoFocus}
          value={value}
          onChange={onChange}
          onEnter={onEnter}
          placeholder={question.placeholder}
        />
      );
  }
};

/**
 * A journey step holding one question (full screen) or a small group of
 * related ones side by side.
 */
const QuestionStep = ({ step, answers, setAnswer, onEnter, eyebrow, missing = [] }) => {
  const { t } = useTranslation(['deploy', 'common']);
  const questions = step.questions || [];
  const isGroup = step.type === 'question_group' && questions.length > 1;
  const columns = isGroup ? (step.settings?.columns || 2) : 1;

  // A single-question step leads with the question itself as the headline —
  // repeating it under a near-identical step title would read as a stutter.
  const primary = questions[0];
  const heading = step.title || primary?.question;
  const subtitle = step.subtitle || (isGroup ? '' : primary?.helpText);

  return (
    <div>
      <StepHeading eyebrow={eyebrow} title={heading} subtitle={subtitle} />

      {isGroup ? (
        <Row gutter={[24, 28]}>
          {questions.map((question, index) => (
            <Col xs={24} md={24 / columns} key={question.key}>
              <div style={{ marginBottom: 12 }}>
                <Text strong style={{ fontSize: 15, display: 'block' }}>
                  {question.question}
                  {question.required && <Text type="danger"> *</Text>}
                </Text>
                {question.helpText && (
                  <Text type="secondary" style={{ fontSize: 12.5 }}>{question.helpText}</Text>
                )}
                {missing.includes(question.key) && (
                  <Text type="danger" style={{ fontSize: 12.5, display: 'block', marginTop: 4 }}>
                    {t('deploy:question.answerFirst')}
                  </Text>
                )}
              </div>
              <AnswerControl
                question={question}
                value={answers[question.key]}
                onChange={(v) => setAnswer(question.key, v)}
                onEnter={onEnter}
                autoFocus={index === 0}
              />
            </Col>
          ))}
        </Row>
      ) : primary ? (
        <>
          <AnswerControl
            question={primary}
            value={answers[primary.key]}
            onChange={(v) => setAnswer(primary.key, v)}
            onEnter={onEnter}
            autoFocus
          />
          {missing.includes(primary.key) && (
            <Text type="danger" style={{ fontSize: 13, display: 'block', marginTop: 12 }}>
              {t('deploy:question.answerFirst')}
            </Text>
          )}
        </>
      ) : null}
    </div>
  );
};

export { AnswerControl };
export default QuestionStep;
