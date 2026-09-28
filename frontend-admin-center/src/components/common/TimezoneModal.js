import React, { useState, useEffect } from 'react';
import { Modal, Select, message, Typography } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import authApi from '../../api/authApi';
import { useTheme } from '../../contexts/ThemeContext';
import { TILE, STATUS_COLORS, ink, muted, hairline } from '../../theme/colors';

const { Text } = Typography;

const TIMEZONES = [
  // UTC
  { value: 'UTC', label: '🌍 UTC (Coordinated Universal Time)', flag: '🌍', city: 'UTC' },
  
  // Africa
  { value: 'Africa/Cairo', label: '🇪🇬 Cairo, Egypt (EET)', flag: '🇪🇬', city: 'Cairo' },
  { value: 'Africa/Lagos', label: '🇳🇬 Lagos, Nigeria (WAT)', flag: '🇳🇬', city: 'Lagos' },
  { value: 'Africa/Nairobi', label: '🇰🇪 Nairobi, Kenya (EAT)', flag: '🇰🇪', city: 'Nairobi' },
  { value: 'Africa/Johannesburg', label: '🇿🇦 Johannesburg, South Africa (SAST)', flag: '🇿🇦', city: 'Johannesburg' },
  { value: 'Africa/Casablanca', label: '🇲🇦 Casablanca, Morocco (WET)', flag: '🇲🇦', city: 'Casablanca' },
  { value: 'Africa/Algiers', label: '🇩🇿 Algiers, Algeria (CET)', flag: '🇩🇿', city: 'Algiers' },
  { value: 'Africa/Tunis', label: '🇹🇳 Tunis, Tunisia (CET)', flag: '🇹🇳', city: 'Tunis' },
  { value: 'Africa/Accra', label: '🇬🇭 Accra, Ghana (GMT)', flag: '🇬🇭', city: 'Accra' },
  { value: 'Africa/Addis_Ababa', label: '🇪🇹 Addis Ababa, Ethiopia (EAT)', flag: '🇪🇹', city: 'Addis Ababa' },
  { value: 'Africa/Dar_es_Salaam', label: '🇹🇿 Dar es Salaam, Tanzania (EAT)', flag: '🇹🇿', city: 'Dar es Salaam' },
  
  // Americas - North America
  { value: 'America/New_York', label: '🇺🇸 New York, USA (ET)', flag: '🇺🇸', city: 'New York' },
  { value: 'America/Chicago', label: '🇺🇸 Chicago, USA (CT)', flag: '🇺🇸', city: 'Chicago' },
  { value: 'America/Denver', label: '🇺🇸 Denver, USA (MT)', flag: '🇺🇸', city: 'Denver' },
  { value: 'America/Los_Angeles', label: '🇺🇸 Los Angeles, USA (PT)', flag: '🇺🇸', city: 'Los Angeles' },
  { value: 'America/Phoenix', label: '🇺🇸 Phoenix, USA (MST)', flag: '🇺🇸', city: 'Phoenix' },
  { value: 'America/Anchorage', label: '🇺🇸 Anchorage, Alaska (AKT)', flag: '🇺🇸', city: 'Anchorage' },
  { value: 'Pacific/Honolulu', label: '🇺🇸 Honolulu, Hawaii (HT)', flag: '🇺🇸', city: 'Honolulu' },
  { value: 'America/Toronto', label: '🇨🇦 Toronto, Canada (ET)', flag: '🇨🇦', city: 'Toronto' },
  { value: 'America/Vancouver', label: '🇨🇦 Vancouver, Canada (PT)', flag: '🇨🇦', city: 'Vancouver' },
  { value: 'America/Edmonton', label: '🇨🇦 Edmonton, Canada (MT)', flag: '🇨🇦', city: 'Edmonton' },
  { value: 'America/Winnipeg', label: '🇨🇦 Winnipeg, Canada (CT)', flag: '🇨🇦', city: 'Winnipeg' },
  { value: 'America/Halifax', label: '🇨🇦 Halifax, Canada (AT)', flag: '🇨🇦', city: 'Halifax' },
  { value: 'America/Mexico_City', label: '🇲🇽 Mexico City, Mexico (CST)', flag: '🇲🇽', city: 'Mexico City' },
  { value: 'America/Cancun', label: '🇲🇽 Cancún, Mexico (EST)', flag: '🇲🇽', city: 'Cancún' },
  
  // Americas - Central America
  { value: 'America/Guatemala', label: '🇬🇹 Guatemala City, Guatemala (CST)', flag: '🇬🇹', city: 'Guatemala' },
  { value: 'America/Belize', label: '🇧🇿 Belize City, Belize (CST)', flag: '🇧🇿', city: 'Belize' },
  { value: 'America/San_Jose', label: '🇨🇷 San José, Costa Rica (CST)', flag: '🇨🇷', city: 'San José' },
  { value: 'America/Panama', label: '🇵🇦 Panama City, Panama (EST)', flag: '🇵🇦', city: 'Panama' },
  
  // Americas - Caribbean
  { value: 'America/Havana', label: '🇨🇺 Havana, Cuba (CST)', flag: '🇨🇺', city: 'Havana' },
  { value: 'America/Jamaica', label: '🇯🇲 Kingston, Jamaica (EST)', flag: '🇯🇲', city: 'Kingston' },
  { value: 'America/Puerto_Rico', label: '🇵🇷 San Juan, Puerto Rico (AST)', flag: '🇵🇷', city: 'San Juan' },
  { value: 'America/Santo_Domingo', label: '🇩🇴 Santo Domingo, Dominican Republic (AST)', flag: '🇩🇴', city: 'Santo Domingo' },
  
  // Americas - South America
  { value: 'America/Sao_Paulo', label: '🇧🇷 São Paulo, Brazil (BRT)', flag: '🇧🇷', city: 'São Paulo' },
  { value: 'America/Rio_Branco', label: '🇧🇷 Rio Branco, Brazil (ACT)', flag: '🇧🇷', city: 'Rio Branco' },
  { value: 'America/Buenos_Aires', label: '🇦🇷 Buenos Aires, Argentina (ART)', flag: '🇦🇷', city: 'Buenos Aires' },
  { value: 'America/Santiago', label: '🇨🇱 Santiago, Chile (CLT)', flag: '🇨🇱', city: 'Santiago' },
  { value: 'America/Lima', label: '🇵🇪 Lima, Peru (PET)', flag: '🇵🇪', city: 'Lima' },
  { value: 'America/Bogota', label: '🇨🇴 Bogotá, Colombia (COT)', flag: '🇨🇴', city: 'Bogotá' },
  { value: 'America/Caracas', label: '🇻🇪 Caracas, Venezuela (VET)', flag: '🇻🇪', city: 'Caracas' },
  { value: 'America/La_Paz', label: '🇧🇴 La Paz, Bolivia (BOT)', flag: '🇧🇴', city: 'La Paz' },
  { value: 'America/Guayaquil', label: '🇪🇨 Guayaquil, Ecuador (ECT)', flag: '🇪🇨', city: 'Guayaquil' },
  { value: 'America/Montevideo', label: '🇺🇾 Montevideo, Uruguay (UYT)', flag: '🇺🇾', city: 'Montevideo' },
  { value: 'America/Asuncion', label: '🇵🇾 Asunción, Paraguay (PYT)', flag: '🇵🇾', city: 'Asunción' },
  
  // Europe - Western
  { value: 'Europe/London', label: '🇬🇧 London, United Kingdom (GMT/BST)', flag: '🇬🇧', city: 'London' },
  { value: 'Europe/Dublin', label: '🇮🇪 Dublin, Ireland (GMT/IST)', flag: '🇮🇪', city: 'Dublin' },
  { value: 'Europe/Lisbon', label: '🇵🇹 Lisbon, Portugal (WET/WEST)', flag: '🇵🇹', city: 'Lisbon' },
  { value: 'Atlantic/Reykjavik', label: '🇮🇸 Reykjavik, Iceland (GMT)', flag: '🇮🇸', city: 'Reykjavik' },
  
  // Europe - Central
  { value: 'Europe/Paris', label: '🇫🇷 Paris, France (CET/CEST)', flag: '🇫🇷', city: 'Paris' },
  { value: 'Europe/Berlin', label: '🇩🇪 Berlin, Germany (CET/CEST)', flag: '🇩🇪', city: 'Berlin' },
  { value: 'Europe/Rome', label: '🇮🇹 Rome, Italy (CET/CEST)', flag: '🇮🇹', city: 'Rome' },
  { value: 'Europe/Madrid', label: '🇪🇸 Madrid, Spain (CET/CEST)', flag: '🇪🇸', city: 'Madrid' },
  { value: 'Europe/Amsterdam', label: '🇳🇱 Amsterdam, Netherlands (CET/CEST)', flag: '🇳🇱', city: 'Amsterdam' },
  { value: 'Europe/Brussels', label: '🇧🇪 Brussels, Belgium (CET/CEST)', flag: '🇧🇪', city: 'Brussels' },
  { value: 'Europe/Vienna', label: '🇦🇹 Vienna, Austria (CET/CEST)', flag: '🇦🇹', city: 'Vienna' },
  { value: 'Europe/Zurich', label: '🇨🇭 Zurich, Switzerland (CET/CEST)', flag: '🇨🇭', city: 'Zurich' },
  { value: 'Europe/Prague', label: '🇨🇿 Prague, Czech Republic (CET/CEST)', flag: '🇨🇿', city: 'Prague' },
  { value: 'Europe/Warsaw', label: '🇵🇱 Warsaw, Poland (CET/CEST)', flag: '🇵🇱', city: 'Warsaw' },
  { value: 'Europe/Stockholm', label: '🇸🇪 Stockholm, Sweden (CET/CEST)', flag: '🇸🇪', city: 'Stockholm' },
  { value: 'Europe/Oslo', label: '🇳🇴 Oslo, Norway (CET/CEST)', flag: '🇳🇴', city: 'Oslo' },
  { value: 'Europe/Copenhagen', label: '🇩🇰 Copenhagen, Denmark (CET/CEST)', flag: '🇩🇰', city: 'Copenhagen' },
  { value: 'Europe/Budapest', label: '🇭🇺 Budapest, Hungary (CET/CEST)', flag: '🇭🇺', city: 'Budapest' },
  
  // Europe - Eastern
  { value: 'Europe/Athens', label: '🇬🇷 Athens, Greece (EET/EEST)', flag: '🇬🇷', city: 'Athens' },
  { value: 'Europe/Helsinki', label: '🇫🇮 Helsinki, Finland (EET/EEST)', flag: '🇫🇮', city: 'Helsinki' },
  { value: 'Europe/Bucharest', label: '🇷🇴 Bucharest, Romania (EET/EEST)', flag: '🇷🇴', city: 'Bucharest' },
  { value: 'Europe/Sofia', label: '🇧🇬 Sofia, Bulgaria (EET/EEST)', flag: '🇧🇬', city: 'Sofia' },
  { value: 'Europe/Istanbul', label: '🇹🇷 Istanbul, Turkey (TRT)', flag: '🇹🇷', city: 'Istanbul' },
  { value: 'Europe/Kiev', label: '🇺🇦 Kyiv, Ukraine (EET/EEST)', flag: '🇺🇦', city: 'Kyiv' },
  { value: 'Europe/Moscow', label: '🇷🇺 Moscow, Russia (MSK)', flag: '🇷🇺', city: 'Moscow' },
  { value: 'Europe/Minsk', label: '🇧🇾 Minsk, Belarus (MSK)', flag: '🇧🇾', city: 'Minsk' },
  
  // Middle East
  { value: 'Asia/Dubai', label: '🇦🇪 Dubai, UAE (GST)', flag: '🇦🇪', city: 'Dubai' },
  { value: 'Asia/Riyadh', label: '🇸🇦 Riyadh, Saudi Arabia (AST)', flag: '🇸🇦', city: 'Riyadh' },
  { value: 'Asia/Kuwait', label: '🇰🇼 Kuwait City, Kuwait (AST)', flag: '🇰🇼', city: 'Kuwait' },
  { value: 'Asia/Qatar', label: '🇶🇦 Doha, Qatar (AST)', flag: '🇶🇦', city: 'Doha' },
  { value: 'Asia/Bahrain', label: '🇧🇭 Manama, Bahrain (AST)', flag: '🇧🇭', city: 'Manama' },
  { value: 'Asia/Muscat', label: '🇴🇲 Muscat, Oman (GST)', flag: '🇴🇲', city: 'Muscat' },
  { value: 'Asia/Baghdad', label: '🇮🇶 Baghdad, Iraq (AST)', flag: '🇮🇶', city: 'Baghdad' },
  { value: 'Asia/Tehran', label: '🇮🇷 Tehran, Iran (IRST)', flag: '🇮🇷', city: 'Tehran' },
  { value: 'Asia/Amman', label: '🇯🇴 Amman, Jordan (EET)', flag: '🇯🇴', city: 'Amman' },
  { value: 'Asia/Beirut', label: '🇱🇧 Beirut, Lebanon (EET)', flag: '🇱🇧', city: 'Beirut' },
  { value: 'Asia/Damascus', label: '🇸🇾 Damascus, Syria (EET)', flag: '🇸🇾', city: 'Damascus' },
  { value: 'Asia/Jerusalem', label: '🇮🇱 Jerusalem, Israel (IST)', flag: '🇮🇱', city: 'Jerusalem' },
  
  // Asia - South
  { value: 'Asia/Karachi', label: '🇵🇰 Karachi, Pakistan (PKT)', flag: '🇵🇰', city: 'Karachi' },
  { value: 'Asia/Kolkata', label: '🇮🇳 Mumbai/Delhi, India (IST)', flag: '🇮🇳', city: 'India' },
  { value: 'Asia/Dhaka', label: '🇧🇩 Dhaka, Bangladesh (BST)', flag: '🇧🇩', city: 'Dhaka' },
  { value: 'Asia/Colombo', label: '🇱🇰 Colombo, Sri Lanka (IST)', flag: '🇱🇰', city: 'Colombo' },
  { value: 'Asia/Kathmandu', label: '🇳🇵 Kathmandu, Nepal (NPT)', flag: '🇳🇵', city: 'Kathmandu' },
  { value: 'Asia/Kabul', label: '🇦🇫 Kabul, Afghanistan (AFT)', flag: '🇦🇫', city: 'Kabul' },
  
  // Asia - Southeast
  { value: 'Asia/Bangkok', label: '🇹🇭 Bangkok, Thailand (ICT)', flag: '🇹🇭', city: 'Bangkok' },
  { value: 'Asia/Singapore', label: '🇸🇬 Singapore (SGT)', flag: '🇸🇬', city: 'Singapore' },
  { value: 'Asia/Kuala_Lumpur', label: '🇲🇾 Kuala Lumpur, Malaysia (MYT)', flag: '🇲🇾', city: 'Kuala Lumpur' },
  { value: 'Asia/Jakarta', label: '🇮🇩 Jakarta, Indonesia (WIB)', flag: '🇮🇩', city: 'Jakarta' },
  { value: 'Asia/Manila', label: '🇵🇭 Manila, Philippines (PHT)', flag: '🇵🇭', city: 'Manila' },
  { value: 'Asia/Ho_Chi_Minh', label: '🇻🇳 Ho Chi Minh, Vietnam (ICT)', flag: '🇻🇳', city: 'Ho Chi Minh' },
  { value: 'Asia/Phnom_Penh', label: '🇰🇭 Phnom Penh, Cambodia (ICT)', flag: '🇰🇭', city: 'Phnom Penh' },
  { value: 'Asia/Vientiane', label: '🇱🇦 Vientiane, Laos (ICT)', flag: '🇱🇦', city: 'Vientiane' },
  { value: 'Asia/Yangon', label: '🇲🇲 Yangon, Myanmar (MMT)', flag: '🇲🇲', city: 'Yangon' },
  
  // Asia - East
  { value: 'Asia/Hong_Kong', label: '🇭🇰 Hong Kong (HKT)', flag: '🇭🇰', city: 'Hong Kong' },
  { value: 'Asia/Shanghai', label: '🇨🇳 Shanghai/Beijing, China (CST)', flag: '🇨🇳', city: 'Shanghai' },
  { value: 'Asia/Taipei', label: '🇹🇼 Taipei, Taiwan (CST)', flag: '🇹🇼', city: 'Taipei' },
  { value: 'Asia/Tokyo', label: '🇯🇵 Tokyo, Japan (JST)', flag: '🇯🇵', city: 'Tokyo' },
  { value: 'Asia/Seoul', label: '🇰🇷 Seoul, South Korea (KST)', flag: '🇰🇷', city: 'Seoul' },
  { value: 'Asia/Pyongyang', label: '🇰🇵 Pyongyang, North Korea (KST)', flag: '🇰🇵', city: 'Pyongyang' },
  { value: 'Asia/Ulaanbaatar', label: '🇲🇳 Ulaanbaatar, Mongolia (ULAT)', flag: '🇲🇳', city: 'Ulaanbaatar' },
  
  // Central Asia
  { value: 'Asia/Almaty', label: '🇰🇿 Almaty, Kazakhstan (ALMT)', flag: '🇰🇿', city: 'Almaty' },
  { value: 'Asia/Tashkent', label: '🇺🇿 Tashkent, Uzbekistan (UZT)', flag: '🇺🇿', city: 'Tashkent' },
  { value: 'Asia/Bishkek', label: '🇰🇬 Bishkek, Kyrgyzstan (KGT)', flag: '🇰🇬', city: 'Bishkek' },
  { value: 'Asia/Dushanbe', label: '🇹🇯 Dushanbe, Tajikistan (TJT)', flag: '🇹🇯', city: 'Dushanbe' },
  { value: 'Asia/Ashgabat', label: '🇹🇲 Ashgabat, Turkmenistan (TMT)', flag: '🇹🇲', city: 'Ashgabat' },
  
  // Australia & Pacific
  { value: 'Australia/Sydney', label: '🇦🇺 Sydney, Australia (AEDT/AEST)', flag: '🇦🇺', city: 'Sydney' },
  { value: 'Australia/Melbourne', label: '🇦🇺 Melbourne, Australia (AEDT/AEST)', flag: '🇦🇺', city: 'Melbourne' },
  { value: 'Australia/Brisbane', label: '🇦🇺 Brisbane, Australia (AEST)', flag: '🇦🇺', city: 'Brisbane' },
  { value: 'Australia/Perth', label: '🇦🇺 Perth, Australia (AWST)', flag: '🇦🇺', city: 'Perth' },
  { value: 'Australia/Adelaide', label: '🇦🇺 Adelaide, Australia (ACDT/ACST)', flag: '🇦🇺', city: 'Adelaide' },
  { value: 'Pacific/Auckland', label: '🇳🇿 Auckland, New Zealand (NZDT/NZST)', flag: '🇳🇿', city: 'Auckland' },
  { value: 'Pacific/Fiji', label: '🇫🇯 Suva, Fiji (FJT)', flag: '🇫🇯', city: 'Fiji' },
  { value: 'Pacific/Guam', label: '🇬🇺 Guam (ChST)', flag: '🇬🇺', city: 'Guam' },
  { value: 'Pacific/Port_Moresby', label: '🇵🇬 Port Moresby, Papua New Guinea (PGT)', flag: '🇵🇬', city: 'Port Moresby' },
  { value: 'Pacific/Noumea', label: '🇳🇨 Nouméa, New Caledonia (NCT)', flag: '🇳🇨', city: 'Nouméa' },
  { value: 'Pacific/Tongatapu', label: '🇹🇴 Nuku\'alofa, Tonga (TOT)', flag: '🇹🇴', city: 'Tonga' },
  { value: 'Pacific/Apia', label: '🇼🇸 Apia, Samoa (WST)', flag: '🇼🇸', city: 'Samoa' },
];

const TimezoneModal = ({ open, onClose, currentTimezone, onTimezoneChange }) => {
  const [loading, setLoading] = useState(false);
  const [selectedTimezone, setSelectedTimezone] = useState(currentTimezone || 'UTC');
  const { isDark } = useTheme();
  const blue = TILE.blue.fg(isDark);

  // Update selectedTimezone when currentTimezone prop changes
  useEffect(() => {
    setSelectedTimezone(currentTimezone || 'UTC');
  }, [currentTimezone]);

  const handleSave = async () => {
    setLoading(true);
    try {
      await authApi.updateProfile({ timezone: selectedTimezone });
      localStorage.setItem('userTimezone', selectedTimezone);
      onTimezoneChange(selectedTimezone);
      message.success('Timezone updated successfully');
      onClose();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to update timezone');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={
        <span style={{ fontSize: 18, fontWeight: 600 }}>
          <GlobalOutlined style={{ marginRight: 8, fontSize: 20 }} />
          Select Timezone
        </span>
      }
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={loading}
      okText="Save"
      cancelText="Cancel"
      width={600}
      styles={{
        body: { padding: '24px' }
      }}
    >
      <div style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 14, color: muted(isDark), lineHeight: '1.6' }}>
          All dates and times in the admin panel will be displayed in your selected timezone.
        </Text>
      </div>
      
      <Select
        size="large"
        style={{ width: '100%', fontSize: 15 }}
        placeholder="Search for your country or city..."
        value={selectedTimezone}
        onChange={setSelectedTimezone}
        showSearch
        filterOption={(input, option) =>
          (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
        }
        options={TIMEZONES}
        optionLabelProp="label"
        listHeight={400}
      />
      
      <div style={{
        marginTop: 20,
        padding: '12px 16px',
        background: STATUS_COLORS.neutral.bg(isDark),
        borderRadius: 6,
        border: `1px solid ${hairline(isDark)}`
      }}>
        <Text style={{ fontSize: 14, color: ink(isDark), fontWeight: 500 }}>
          Current time in {selectedTimezone}:
        </Text>
        <br />
        <Text style={{ fontSize: 16, color: blue, fontWeight: 600 }}>
          {new Date().toLocaleString('en-US', { 
            timeZone: selectedTimezone,
            dateStyle: 'full',
            timeStyle: 'long'
          })}
        </Text>
      </div>
    </Modal>
  );
};

export default TimezoneModal;
