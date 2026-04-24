export type UserRole = 'admin' | 'staff';

export interface AppUser {
  id: number;
  username: string;
  role: UserRole;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}
