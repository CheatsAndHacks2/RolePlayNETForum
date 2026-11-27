import crypto from "node:crypto";
import { db } from "@/db";
import { categories, forums, roles, settings, threadPrefixes, users } from "@/db/schema";
import { DEFAULT_ROLES } from "@/lib/constants";
import { eq } from "drizzle-orm";

let seeding: Promise<void> | null = null;

export function ensureSeed(): Promise<void> {
  if (!seeding) {
    seeding = runSeed().catch((e) => {
      seeding = null;
      throw e;
    });
  }
  return seeding;
}

function hashPw(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `s1$${salt}$${crypto.scryptSync(pw, salt, 64).toString("hex")}`;
}

/**
 * Creates only system roles, an optional owner account configured by the
 * deployment owner, and an empty forum structure. No fictional members,
 * passwords, sample threads, likes, or fake activity are inserted.
 */
async function runSeed() {
  const existingRoles = await db.select().from(roles);
  const have = new Set(existingRoles.map((r) => r.slug));
  for (const role of DEFAULT_ROLES) {
    if (!have.has(role.slug)) {
      await db.insert(roles).values({ ...role, isSystem: true });
    }
  }

  const founder = (await db.select().from(roles).where(eq(roles.slug, "founder")).limit(1))[0];
  const founderName = process.env.FOUNDER_USERNAME?.trim();
  const founderPassword = process.env.FOUNDER_PASSWORD;
  if (founderName && founderPassword && founder) {
    const usernameLower = founderName.toLowerCase();
    const existing = await db.select().from(users).where(eq(users.usernameLower, usernameLower)).limit(1);
    if (!existing[0]) {
      await db.insert(users).values({
        username: founderName,
        usernameLower,
        passwordHash: hashPw(founderPassword),
        roleId: founder.id,
        avatarColor: "#ff3b5c",
        isProtected: true,
        hwLocked: false,
        customTitle: "Основатель проекта",
        about: "Владелец сообщества.",
      });
    }
  }

  const seeded = await db.select().from(settings).where(eq(settings.key, "seeded_structure_v2")).limit(1);
  if (seeded[0]) return;

  const prefixRows = [
    ["Набор", "#22c55e"],
    ["Анкета", "#3b82f6"],
    ["Важно", "#ef4444"],
    ["Сюжет", "#a855f7"],
    ["Вопрос", "#f59e0b"],
    ["Закрыто", "#6b7280"],
  ];
  for (let i = 0; i < prefixRows.length; i++) {
    await db.insert(threadPrefixes).values({ label: prefixRows[i][0], color: prefixRows[i][1], sortOrder: i });
  }

  type ForumSeed = { title: string; description: string; icon: string; view?: number; post?: number; thread?: number };
  const structure: { title: string; description: string; icon: string; color: string; view?: number; forums: ForumSeed[] }[] = [
    { title: "Информация", description: "Новости, правила и знакомство с сообществом", icon: "📢", color: "#ef4444", forums: [
      { title: "Новости и объявления", description: "Официальные новости проекта", icon: "📰", post: 70, thread: 70 },
      { title: "Правила и FAQ", description: "Правила сообщества и ответы на вопросы", icon: "📜", post: 70, thread: 70 },
      { title: "Знакомство", description: "Расскажите о себе и своих интересах", icon: "👋" },
    ]},
    { title: "Ролевые проекты", description: "Всё о RP-играх: наборы, анкеты и сюжеты", icon: "🎭", color: "#7c3aed", forums: [
      { title: "Наборы в проекты", description: "Поиск игроков и команды", icon: "🧭" },
      { title: "Анкеты персонажей", description: "Биографии и истории героев", icon: "🪪" },
      { title: "Игровые эпизоды", description: "Текстовые отыгрыши и совместные истории", icon: "📖" },
      { title: "Идеи и сюжеты", description: "Идеи для новых ролевых вселенных", icon: "💡" },
    ]},
    { title: "Общение", description: "Свободное общение на любые темы", icon: "💬", color: "#06b6d4", forums: [
      { title: "Флудилка", description: "Разговоры обо всём на свете", icon: "☕" },
      { title: "Творчество и арт", description: "Рисунки, истории, музыка и видео", icon: "🎨" },
      { title: "Игры и кино", description: "Обсуждаем игры, фильмы и сериалы", icon: "🎬" },
    ]},
    { title: "Поддержка", description: "Помощь, жалобы и предложения", icon: "🛠️", color: "#22c55e", forums: [
      { title: "Вопросы по форуму", description: "Задайте вопрос администрации", icon: "❓" },
      { title: "Жалобы на игроков", description: "Сообщите о нарушении правил", icon: "🚨" },
      { title: "Предложения", description: "Идеи по улучшению сообщества", icon: "📮" },
    ]},
    { title: "Для персонала", description: "Закрытый раздел для команды форума", icon: "🔒", color: "#f59e0b", view: 30, forums: [
      { title: "Обсуждение модерации", description: "Рабочие вопросы команды", icon: "🛡️", view: 30, post: 30, thread: 30 },
      { title: "Администрация", description: "Закрытый раздел администрации", icon: "👑", view: 70, post: 70, thread: 70 },
    ]},
  ];

  for (let ci = 0; ci < structure.length; ci++) {
    const category = structure[ci];
    const [createdCategory] = await db.insert(categories).values({
      title: category.title,
      description: category.description,
      icon: category.icon,
      color: category.color,
      sortOrder: ci,
      minViewLevel: category.view ?? 0,
    }).returning({ id: categories.id });

    for (let fi = 0; fi < category.forums.length; fi++) {
      const forum = category.forums[fi];
      await db.insert(forums).values({
        categoryId: createdCategory.id,
        title: forum.title,
        description: forum.description,
        icon: forum.icon,
        sortOrder: fi,
        minViewLevel: forum.view ?? 0,
        minPostLevel: forum.post ?? 1,
        minThreadLevel: forum.thread ?? 1,
      });
    }
  }

  await db.insert(settings).values({ key: "seeded_structure_v2", value: "1" });
}
