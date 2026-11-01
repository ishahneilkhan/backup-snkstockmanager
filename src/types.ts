export type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  PBKDF2_ITERATIONS?: string;
  PAYMENT_BKASH?: string;
  PAYMENT_NAGAD?: string;
  SALES_OPEN?: string;
};

export type Role = 'super_admin' | 'owner' | 'salesman';

export type AuthUser = {
  id: string;
  shopId: string | null;
  role: Role;
  name: string;
  mustChangePassword: boolean;
};

export type AppEnv = { Bindings: Env; Variables: { user: AuthUser } };
