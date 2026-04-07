/**
 * Authentication provider wrapping Clerk.
 * Extracts user role and assigned trucks from Clerk publicMetadata.
 * Caches auth state locally for offline access after initial sign-in.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';
import type { AppUser, UserRole } from '@/types/auth';
import { setTokenProvider } from '@/services/api-client';

const CLERK_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

// Clerk token cache using SecureStore
const tokenCache = {
  async getToken(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // Silent fail
    }
  },
  async clearToken(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Silent fail
    }
  },
};

// ── App User Context ────────────────────────────────────────────────

interface AuthContextValue {
  currentUser: AppUser | null;
  isSignedIn: boolean;
  isLoaded: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  currentUser: null,
  isSignedIn: false,
  isLoaded: false,
  signOut: async () => {},
});

export function useAppAuth(): AuthContextValue {
  return useContext(AuthContext);
}

// ── Inner provider (inside ClerkProvider) ───────────────────────────

function AuthInner({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded, signOut, getToken } = useAuth();
  const { user } = useUser();

  // Set the token provider for API requests
  React.useEffect(() => {
    if (isSignedIn) {
      setTokenProvider(() => getToken());
    }
  }, [isSignedIn, getToken]);

  const currentUser = useMemo<AppUser | null>(() => {
    if (!isSignedIn || !user) return null;

    const metadata = (user.publicMetadata || {}) as Record<string, unknown>;
    const role = (metadata.role as UserRole) || 'operator';
    const assignedTruckIds = (metadata.assignedTruckIds as string[]) || [];

    return {
      id: user.id,
      name: user.fullName || user.primaryEmailAddress?.emailAddress || 'Unknown',
      email: user.primaryEmailAddress?.emailAddress || '',
      role,
      assignedTruckIds,
    };
  }, [isSignedIn, user]);

  const value = useMemo(
    () => ({
      currentUser,
      isSignedIn: !!isSignedIn,
      isLoaded,
      signOut: async () => {
        await signOut();
      },
    }),
    [currentUser, isSignedIn, isLoaded, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Root provider ───────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider publishableKey={CLERK_KEY} tokenCache={tokenCache}>
      <AuthInner>{children}</AuthInner>
    </ClerkProvider>
  );
}
