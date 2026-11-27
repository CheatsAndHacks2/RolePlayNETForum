import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#9ca3af"),
  icon: text("icon").notNull().default("👤"),
  level: integer("level").notNull().default(1),
  style: text("style").notNull().default("plain"), // plain | glow | gradient | outline | animated
  description: text("description").notNull().default(""),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  showOnTeam: boolean("show_on_team").notNull().default(false),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: text("username").notNull(),
    usernameLower: text("username_lower").notNull(),
    passwordHash: text("password_hash").notNull(),
    roleId: integer("role_id").notNull(),
    customTitle: text("custom_title").notNull().default(""),
    avatarUrl: text("avatar_url").notNull().default(""),
    avatarColor: text("avatar_color").notNull().default("#7c3aed"),
    signature: text("signature").notNull().default(""),
    about: text("about").notNull().default(""),
    location: text("location").notNull().default(""),
    website: text("website").notNull().default(""),
    status: text("status").notNull().default("active"), // active | pending | deleted
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at"),
    lastLoginAt: ts("last_login_at"),
    regIp: text("reg_ip").notNull().default(""),
    lastIp: text("last_ip").notNull().default(""),
    hwHash: text("hw_hash"),
    regHwHash: text("reg_hw_hash"),
    hwLocked: boolean("hw_locked").notNull().default(false),
    isProtected: boolean("is_protected").notNull().default(false),
    postsCount: integer("posts_count").notNull().default(0),
    threadsCount: integer("threads_count").notNull().default(0),
    reputation: integer("reputation").notNull().default(0),
    warnPoints: integer("warn_points").notNull().default(0),
    mutedUntil: ts("muted_until"),
    muteReason: text("mute_reason").notNull().default(""),
    hideOnline: boolean("hide_online").notNull().default(false),
    forcePwChange: boolean("force_pw_change").notNull().default(false),
    adminNote: text("admin_note").notNull().default(""),
    failedLogins: integer("failed_logins").notNull().default(0),
  },
  (t) => [uniqueIndex("users_username_lower_idx").on(t.usernameLower)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    ip: text("ip").notNull().default(""),
    userAgent: text("user_agent").notNull().default(""),
    hwHash: text("hw_hash"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  icon: text("icon").notNull().default("📁"),
  color: text("color").notNull().default("#7c3aed"),
  sortOrder: integer("sort_order").notNull().default(0),
  minViewLevel: integer("min_view_level").notNull().default(0),
  isHidden: boolean("is_hidden").notNull().default(false),
  isCollapsed: boolean("is_collapsed").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const forums = pgTable(
  "forums",
  {
    id: serial("id").primaryKey(),
    categoryId: integer("category_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    icon: text("icon").notNull().default("💬"),
    sortOrder: integer("sort_order").notNull().default(0),
    isLocked: boolean("is_locked").notNull().default(false),
    isHidden: boolean("is_hidden").notNull().default(false),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    minViewLevel: integer("min_view_level").notNull().default(0),
    minPostLevel: integer("min_post_level").notNull().default(1),
    minThreadLevel: integer("min_thread_level").notNull().default(1),
    threadsCount: integer("threads_count").notNull().default(0),
    postsCount: integer("posts_count").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("forums_cat_idx").on(t.categoryId)],
);

export const threadPrefixes = pgTable("thread_prefixes", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  color: text("color").notNull().default("#7c3aed"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const threads = pgTable(
  "threads",
  {
    id: serial("id").primaryKey(),
    forumId: integer("forum_id").notNull(),
    authorId: integer("author_id").notNull(),
    title: text("title").notNull(),
    prefixId: integer("prefix_id"),
    isPinned: boolean("is_pinned").notNull().default(false),
    isAnnouncement: boolean("is_announcement").notNull().default(false),
    isLocked: boolean("is_locked").notNull().default(false),
    isHidden: boolean("is_hidden").notNull().default(false),
    isApproved: boolean("is_approved").notNull().default(true),
    views: integer("views").notNull().default(0),
    repliesCount: integer("replies_count").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastPostAt: ts("last_post_at").notNull().defaultNow(),
    lastPostUserId: integer("last_post_user_id"),
  },
  (t) => [index("threads_forum_idx").on(t.forumId), index("threads_author_idx").on(t.authorId)],
);

export const posts = pgTable(
  "posts",
  {
    id: serial("id").primaryKey(),
    threadId: integer("thread_id").notNull(),
    authorId: integer("author_id").notNull(),
    content: text("content").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    editedAt: ts("edited_at"),
    editedBy: integer("edited_by"),
    isHidden: boolean("is_hidden").notNull().default(false),
    isFirst: boolean("is_first").notNull().default(false),
    likesCount: integer("likes_count").notNull().default(0),
    ip: text("ip").notNull().default(""),
  },
  (t) => [index("posts_thread_idx").on(t.threadId), index("posts_author_idx").on(t.authorId)],
);

export const postLikes = pgTable(
  "post_likes",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("post_likes_uniq").on(t.postId, t.userId)],
);

export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull(),
  threadId: integer("thread_id").notNull(),
  reporterId: integer("reporter_id").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"), // open | resolved | rejected
  handledBy: integer("handled_by"),
  note: text("note").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
  handledAt: ts("handled_at"),
});

export const bans = pgTable(
  "bans",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    username: text("username").notNull().default(""),
    ip: text("ip"), // supports trailing * as prefix mask
    hwHash: text("hw_hash"),
    reason: text("reason").notNull().default(""),
    bannedBy: integer("banned_by"),
    bannedByName: text("banned_by_name").notNull().default(""),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at"),
    isActive: boolean("is_active").notNull().default(true),
    liftedBy: text("lifted_by"),
    liftedAt: ts("lifted_at"),
    shadow: boolean("shadow").notNull().default(false),
  },
  (t) => [index("bans_user_idx").on(t.userId)],
);

export const warnings = pgTable("warnings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  issuedBy: text("issued_by").notNull().default(""),
  points: integer("points").notNull().default(1),
  reason: text("reason").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at"),
});

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    text: text("text").notNull(),
    link: text("link").notNull().default(""),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("notif_user_idx").on(t.userId)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id"),
  actorName: text("actor_name").notNull().default("system"),
  action: text("action").notNull(),
  target: text("target").notNull().default(""),
  details: text("details").notNull().default(""),
  ip: text("ip").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const loginLog = pgTable("login_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  username: text("username").notNull().default(""),
  ip: text("ip").notNull().default(""),
  hwHash: text("hw_hash"),
  success: boolean("success").notNull().default(false),
  reason: text("reason").notNull().default(""),
  userAgent: text("user_agent").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const usedCaptchas = pgTable("used_captchas", {
  id: text("id").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
});

export const metaJson = pgTable("meta_json", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>(),
});
