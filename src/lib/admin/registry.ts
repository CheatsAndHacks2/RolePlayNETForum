import { userActions } from "./users";
import { banActions, roleActions } from "./bans-roles";
import { structureActions, contentActions, reportActions } from "./structure-content";
import { systemActions } from "./system";
import type { ActionDef } from "./core";

export const ALL_ACTIONS: ActionDef[] = [
  ...userActions,
  ...banActions,
  ...roleActions,
  ...structureActions,
  ...contentActions,
  ...reportActions,
  ...systemActions,
];

export const ACTION_MAP = new Map(ALL_ACTIONS.map((a) => [a.id, a]));
