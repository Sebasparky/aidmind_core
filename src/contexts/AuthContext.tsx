/**
 * Mock Auth Context for RBAC
 * 
 * This provides a simple mock authentication context for development.
 * In production, this would integrate with Supabase Auth.
 */

import React, { createContext, useContext, useState, useCallback } from "react";
import { MockUser, MOCK_USERS, UserRole, canAccessSupervisorUI } from "@/lib/rbac/types";

interface AuthContextType {
  currentUser: MockUser | null;
  isAuthenticated: boolean;
  switchUser: (userId: string) => void;
  logout: () => void;
  canAccessSupervisor: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Default to caseworker — no localStorage persistence
  const [currentUser, setCurrentUser] = useState<MockUser | null>(
    () => MOCK_USERS.caseworker_1
  );

  const switchUser = useCallback((userId: string) => {
    const user = Object.values(MOCK_USERS).find((u) => u.id === userId);
    if (user) {
      setCurrentUser(user);
    }
  }, []);

  const logout = useCallback(() => {
    setCurrentUser(null);
  }, []);

  const canAccessSupervisor = currentUser 
    ? canAccessSupervisorUI(currentUser.role)
    : false;

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAuthenticated: currentUser !== null,
        switchUser,
        logout,
        canAccessSupervisor,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// Hook to check current user's role
export function useRole(): UserRole | null {
  const { currentUser } = useAuth();
  return currentUser?.role ?? null;
}

// Hook to check if current user can access a resource
export function useCanAccess(action: string, resource: string): boolean {
  const { currentUser } = useAuth();
  if (!currentUser) return false;
  
  // Import hasPermission dynamically to avoid circular deps
  const { hasPermission } = require("@/lib/rbac/types");
  return hasPermission(currentUser.role, action, resource);
}
