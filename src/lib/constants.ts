// Client-safe constants shared between server and browser code.

export const PERMS: Record<string, { label: string; group: string }> = {
  "admin.access": { label: "Доступ в админ-панель", group: "Панель" },
  "dashboard.view": { label: "Статистика и дашборд", group: "Панель" },
  "logs.view": { label: "Просмотр логов", group: "Панель" },
  "logs.clear": { label: "Очистка логов", group: "Панель" },
  "system.manage": { label: "Системные операции", group: "Панель" },
  "settings.manage": { label: "Настройки форума", group: "Панель" },
  "users.view": { label: "Видеть IP/железо/заметки пользователей", group: "Пользователи" },
  "users.edit": { label: "Редактировать профили", group: "Пользователи" },
  "users.role": { label: "Выдавать и снимать роли", group: "Пользователи" },
  "users.password": { label: "Сбрасывать пароли", group: "Пользователи" },
  "users.delete": { label: "Удалять аккаунты", group: "Пользователи" },
  "users.create": { label: "Создавать аккаунты", group: "Пользователи" },
  "users.approve": { label: "Одобрять регистрации", group: "Пользователи" },
  "users.mute": { label: "Выдавать мут", group: "Пользователи" },
  "users.warn": { label: "Выдавать предупреждения", group: "Пользователи" },
  "users.hw": { label: "Управлять привязкой к железу", group: "Пользователи" },
  "users.sessions": { label: "Управлять сессиями", group: "Пользователи" },
  "bans.view": { label: "Просмотр банов", group: "Баны" },
  "bans.manage": { label: "Выдавать/снимать баны", group: "Баны" },
  "bans.ip": { label: "Баны по IP", group: "Баны" },
  "bans.hw": { label: "Баны по железу", group: "Баны" },
  "roles.manage": { label: "Управление ролями", group: "Структура" },
  "structure.manage": { label: "Управление разделами и форумами", group: "Структура" },
  "content.pin": { label: "Закреплять темы", group: "Модерация" },
  "content.lock": { label: "Закрывать темы", group: "Модерация" },
  "content.move": { label: "Переносить темы", group: "Модерация" },
  "content.delete": { label: "Удалять темы и сообщения", group: "Модерация" },
  "content.edit": { label: "Редактировать чужие сообщения", group: "Модерация" },
  "content.merge": { label: "Объединять темы", group: "Модерация" },
  "content.approve": { label: "Одобрять темы (премодерация)", group: "Модерация" },
  "content.purge": { label: "Физически удалять контент", group: "Модерация" },
  "content.prefix": { label: "Управлять префиксами", group: "Модерация" },
  "reports.handle": { label: "Обрабатывать жалобы", group: "Модерация" },
  "notify.send": { label: "Отправлять уведомления", group: "Модерация" },
  "forum.viewHidden": { label: "Видеть скрытый контент", group: "Особые" },
  "forum.viewAll": { label: "Видеть все разделы (игнор. уровень)", group: "Особые" },
  "forum.ignoreLock": { label: "Писать в закрытые темы/форумы", group: "Особые" },
  "forum.ignoreFlood": { label: "Без антифлуда", group: "Особые" },
};

export const ALL_PERMS = Object.keys(PERMS);

export type RoleSeed = {
  slug: string;
  name: string;
  color: string;
  icon: string;
  level: number;
  style: string;
  description: string;
  permissions: string[];
  showOnTeam: boolean;
};

const MOD_BASE = ["forum.viewHidden", "forum.ignoreFlood"];

export const DEFAULT_ROLES: RoleSeed[] = [
  {
    slug: "founder", name: "Основатель", color: "#ff3b5c", icon: "👑", level: 100, style: "animated",
    description: "Владелец проекта. Полный доступ ко всем функциям.", permissions: ["*"], showOnTeam: true,
  },
  {
    slug: "coowner", name: "Совладелец", color: "#ff7a1a", icon: "💎", level: 90, style: "gradient",
    description: "Правая рука основателя.", showOnTeam: true,
    permissions: ALL_PERMS.filter((p) => !["system.manage", "logs.clear", "roles.manage"].includes(p)),
  },
  {
    slug: "head-admin", name: "Главный администратор", color: "#f43f5e", icon: "🛡️", level: 80, style: "glow",
    description: "Руководит администрацией.", showOnTeam: true,
    permissions: ALL_PERMS.filter((p) => !["system.manage", "logs.clear", "roles.manage", "settings.manage", "users.create"].includes(p)),
  },
  {
    slug: "admin", name: "Администратор", color: "#ef4444", icon: "⚔️", level: 70, style: "glow",
    description: "Администратор форума.", showOnTeam: true,
    permissions: ["admin.access", "dashboard.view", "logs.view", "users.view", "users.edit", "users.role", "users.mute", "users.warn", "users.delete", "users.approve", "users.sessions", "bans.view", "bans.manage", "bans.ip", "bans.hw", "structure.manage", "content.pin", "content.lock", "content.move", "content.delete", "content.edit", "content.merge", "content.approve", "content.prefix", "reports.handle", "notify.send", "forum.viewHidden", "forum.viewAll", "forum.ignoreLock", "forum.ignoreFlood"],
  },
  {
    slug: "senior-mod", name: "Старший модератор", color: "#f59e0b", icon: "🔰", level: 60, style: "gradient",
    description: "Следит за работой модераторов.", showOnTeam: true,
    permissions: ["admin.access", "dashboard.view", "users.view", "users.mute", "users.warn", "bans.view", "bans.manage", "bans.ip", "content.pin", "content.lock", "content.move", "content.delete", "content.edit", "content.merge", "content.approve", "content.prefix", "reports.handle", "notify.send", "forum.viewAll", "forum.ignoreLock", ...MOD_BASE],
  },
  {
    slug: "moderator", name: "Модератор", color: "#22c55e", icon: "🟢", level: 50, style: "glow",
    description: "Следит за порядком на форуме.", showOnTeam: true,
    permissions: ["admin.access", "dashboard.view", "users.view", "users.mute", "users.warn", "bans.view", "bans.manage", "content.pin", "content.lock", "content.move", "content.delete", "content.edit", "content.approve", "reports.handle", "forum.ignoreLock", ...MOD_BASE],
  },
  {
    slug: "junior-mod", name: "Младший модератор", color: "#4ade80", icon: "🌱", level: 40, style: "plain",
    description: "Начинающий модератор.", showOnTeam: true,
    permissions: ["admin.access", "users.mute", "bans.view", "content.lock", "content.delete", "content.approve", "reports.handle", ...MOD_BASE],
  },
  {
    slug: "curator", name: "Куратор RP", color: "#06b6d4", icon: "🎭", level: 35, style: "outline",
    description: "Куратор ролевых проектов и сюжетов.", showOnTeam: true,
    permissions: ["content.pin", "content.lock", "content.edit", "content.approve", "content.prefix", "reports.handle", "forum.viewHidden"],
  },
  {
    slug: "helper", name: "Хелпер", color: "#38bdf8", icon: "🤝", level: 30, style: "plain",
    description: "Помогает новичкам.", showOnTeam: true,
    permissions: ["reports.handle", "content.lock", "forum.ignoreFlood"],
  },
  {
    slug: "vip", name: "VIP", color: "#e879f9", icon: "✨", level: 20, style: "gradient",
    description: "Поддержавший проект.", permissions: ["forum.ignoreFlood"], showOnTeam: false,
  },
  {
    slug: "verified", name: "Проверенный", color: "#60a5fa", icon: "✅", level: 10, style: "outline",
    description: "Проверенный участник сообщества.", permissions: [], showOnTeam: false,
  },
  {
    slug: "member", name: "Участник", color: "#9ca3af", icon: "👤", level: 5, style: "plain",
    description: "Обычный участник форума.", permissions: [], showOnTeam: false,
  },
];

export type SettingDef = {
  def: string;
  label: string;
  type: "text" | "number" | "bool" | "textarea" | "color";
  group: string;
};

export const SETTING_DEFS: Record<string, SettingDef> = {
  siteName: { def: "RolePlay.NET", label: "Название сайта", type: "text", group: "general" },
  siteTagline: { def: "Универсальный форум для RolyPlay (RP) игр", label: "Слоган", type: "text", group: "general" },
  welcomeMessage: { def: "Добро пожаловать на RolePlay.NET — место для ролевых проектов, сюжетов и общения!", label: "Приветствие на главной", type: "textarea", group: "general" },
  footerText: { def: "© RolePlay.NET — все права защищены", label: "Текст в подвале", type: "text", group: "general" },

  registrationOpen: { def: "1", label: "Регистрация открыта", type: "bool", group: "registration" },
  requireApproval: { def: "0", label: "Ручное одобрение новых аккаунтов", type: "bool", group: "registration" },
  captchaEnabled: { def: "1", label: "Капча при регистрации", type: "bool", group: "registration" },
  minUsernameLen: { def: "3", label: "Мин. длина ника", type: "number", group: "registration" },
  maxUsernameLen: { def: "20", label: "Макс. длина ника", type: "number", group: "registration" },
  minPasswordLen: { def: "8", label: "Мин. длина пароля", type: "number", group: "registration" },
  maxRegsPerIpPerDay: { def: "5", label: "Макс. регистраций с одного IP в сутки", type: "number", group: "registration" },
  reservedNames: { def: "admin\nadministrator\nmoderator\nsupport\nroot\nsystem\nstaff", label: "Запрещённые ники (по одному в строке, * = маска)", type: "textarea", group: "registration" },
  defaultRoleSlug: { def: "member", label: "Роль по умолчанию (slug)", type: "text", group: "registration" },

  maxLoginAttempts: { def: "8", label: "Попыток входа до блокировки", type: "number", group: "security" },
  lockoutMinutes: { def: "15", label: "Время блокировки входа (мин)", type: "number", group: "security" },
  captchaAfterFails: { def: "3", label: "Капча при входе после N неудач", type: "number", group: "security" },
  sessionDays: { def: "30", label: "Срок жизни сессии (дней)", type: "number", group: "security" },
  enforceHwBans: { def: "1", label: "Проверять баны по железу", type: "bool", group: "security" },
  enforceIpBans: { def: "1", label: "Проверять баны по IP", type: "bool", group: "security" },
  autoWarnLimit: { def: "10", label: "Очков варнов для автобана (0 = выкл.)", type: "number", group: "security" },
  autoBanDays: { def: "7", label: "Срок автобана (дней)", type: "number", group: "security" },

  floodSeconds: { def: "15", label: "Антифлуд: пауза между сообщениями (сек)", type: "number", group: "posting" },
  threadsPerPage: { def: "20", label: "Тем на странице", type: "number", group: "posting" },
  postsPerPage: { def: "15", label: "Сообщений на странице", type: "number", group: "posting" },
  minTitleLength: { def: "5", label: "Мин. длина заголовка темы", type: "number", group: "posting" },
  minPostLength: { def: "3", label: "Мин. длина сообщения", type: "number", group: "posting" },
  maxPostLength: { def: "20000", label: "Макс. длина сообщения", type: "number", group: "posting" },
  editWindowMinutes: { def: "60", label: "Окно редактирования своих сообщений (мин, 0 = без лимита)", type: "number", group: "posting" },
  allowSignatures: { def: "1", label: "Разрешить подписи", type: "bool", group: "posting" },
  allowAvatarUrls: { def: "1", label: "Разрешить аватары по ссылке", type: "bool", group: "posting" },
  allowImages: { def: "1", label: "Разрешить [img] в сообщениях", type: "bool", group: "posting" },
  allowLikes: { def: "1", label: "Разрешить лайки", type: "bool", group: "posting" },
  wordFilter: { def: "", label: "Фильтр слов (по одному в строке)", type: "textarea", group: "posting" },

  maintenanceMode: { def: "0", label: "Режим техработ (только персонал)", type: "bool", group: "maintenance" },
  maintenanceMessage: { def: "На форуме ведутся технические работы. Загляните позже!", label: "Сообщение о техработах", type: "textarea", group: "maintenance" },
  readOnlyMode: { def: "0", label: "Режим «только чтение»", type: "bool", group: "maintenance" },
  guestsCanView: { def: "1", label: "Гости могут читать форум", type: "bool", group: "maintenance" },

  bannerEnabled: { def: "0", label: "Показывать баннер-объявление", type: "bool", group: "banner" },
  bannerText: { def: "", label: "Текст баннера", type: "textarea", group: "banner" },
  bannerColor: { def: "#7c3aed", label: "Цвет баннера", type: "color", group: "banner" },

  rulesText: {
    def: "1. Уважайте других участников.\n2. Запрещены оскорбления, дискриминация и травля.\n3. Запрещён спам, флуд и реклама без разрешения администрации.\n4. Запрещена мультиаккаунтность и обход банов.\n5. Публикуйте темы в подходящих разделах.\n6. Решения модерации обсуждаются только через жалобы или личное обращение к администрации.\n7. Администрация вправе изменять правила в любой момент.",
    label: "Правила форума", type: "textarea", group: "rules",
  },
};

export function hasPerm(perms: string[] | undefined | null, p: string): boolean {
  if (!perms) return false;
  return perms.includes("*") || perms.includes(p);
}

export const ROLE_STYLES = ["plain", "glow", "gradient", "outline", "animated"];

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return "никогда";
  const dt = typeof d === "string" ? new Date(d) : d;
  const s = Math.floor((Date.now() - dt.getTime()) / 1000);
  if (s < 45) return "только что";
  if (s < 3600) return `${Math.floor(s / 60)} мин. назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч. назад`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} дн. назад`;
  return dt.toLocaleDateString("ru-RU");
}
