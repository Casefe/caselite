import { Icon } from '../shared/ui/Icon';
import { ThemeSetting } from './Appearance';
import ModelSettings from './ModelSettings';
import PersonalSettings from './PersonalSettings';
import { settingsGroups, information, type SettingsSection } from './settings-sections';
export { settingsGroups, type SettingsSection } from './settings-sections';

export default function SettingsView({
  section,
  onSection,
  onBack,
}: {
  section: SettingsSection;
  onSection(section: SettingsSection): void;
  onBack(): void;
}) {
  const group = settingsGroups.find(({ items }) => items.some(([id]) => id === section))!;
  const label = group.items.find(([id]) => id === section)![1];
  return (
    <section className="settings-center" aria-label="设置中心">
      <aside className="settings-navigation">
        <div className="settings-nav-title">
          <Icon name="settings" size={17} />
          <h1>设置</h1>
        </div>
        <nav aria-label="设置分类">
          {settingsGroups.map(({ title, items }) => (
            <div className="settings-nav-group" key={title} role="group" aria-label={title}>
              <span>{title}</span>
              {items.map(([id, name]) => (
                <button
                  key={id}
                  aria-current={section === id ? 'page' : undefined}
                  onClick={() => onSection(id)}
                >
                  {name}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button className="settings-back" onClick={onBack}>
          <Icon name="back" size={14} />
          返回工作区
        </button>
        <p>
          个人本地工作区
          <br />
          无需登录即可使用
        </p>
      </aside>
      <div className="settings-content">
        <header className="settings-heading">
          <span>
            设置 / {group.title} / {label}
          </span>
          <span>仅此设备</span>
        </header>
        <div className="settings-page">
          <h2>{label}</h2>
          {section === 'models' && <ModelSettings />}
          {section === 'general' && <ThemeSetting />}
          {section === 'account' && <PersonalSettings />}
          {section === 'general' && <PersonalSettings preferencesOnly />}
          {information[section]?.map(([title, description, value]) => (
            <SettingRow key={title} title={title} description={description} value={value} />
          ))}
        </div>
      </div>
    </section>
  );
}
function SettingRow({
  title,
  description,
  value,
}: {
  title: string;
  description: string;
  value: string;
}) {
  return (
    <div className="setting-row">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <span className="settings-pill">{value}</span>
    </div>
  );
}
