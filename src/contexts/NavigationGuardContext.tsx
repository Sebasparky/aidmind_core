import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface NavigationGuard {
  active: boolean;
  guardedNavigate: (path: string) => void;
}

interface NavigationGuardContextType {
  guardActive: boolean;
  guardedNavigate: (path: string) => void;
  setGuard: (guard: NavigationGuard) => void;
  clearGuard: () => void;
}

const NavigationGuardContext = createContext<NavigationGuardContextType | null>(null);

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [guard, setGuardState] = useState<NavigationGuard>({
    active: false,
    guardedNavigate: (path: string) => navigate(path),
  });

  const setGuard = useCallback((newGuard: NavigationGuard) => {
    setGuardState(newGuard);
  }, []);

  const clearGuard = useCallback(() => {
    setGuardState({
      active: false,
      guardedNavigate: (path: string) => navigate(path),
    });
  }, [navigate]);

  const guardedNavigate = useCallback((path: string) => {
    guard.guardedNavigate(path);
  }, [guard]);

  return (
    <NavigationGuardContext.Provider
      value={{
        guardActive: guard.active,
        guardedNavigate,
        setGuard,
        clearGuard,
      }}
    >
      {children}
    </NavigationGuardContext.Provider>
  );
}

export function useNavigationGuard() {
  const context = useContext(NavigationGuardContext);
  if (!context) {
    throw new Error('useNavigationGuard must be used within NavigationGuardProvider');
  }
  return context;
}
