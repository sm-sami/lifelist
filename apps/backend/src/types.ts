import type { Category, Item, User } from "../db/schema";

export type AppVariables = {
  userId: string;
  userEmail: string;
};

export type AppBindings = Record<string, never>;

export type AppEnv = {
  Variables: AppVariables;
  Bindings: AppBindings;
};

export type { Item, Category, User };
