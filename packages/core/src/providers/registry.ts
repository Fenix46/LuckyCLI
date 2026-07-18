/**
 * Provider registry — maps a ProviderId to an IProvider instance.
 *
 * Providers are registered as lazy factories and only instantiated the first
 * time they're selected. Adding a provider = register one factory; the rest of
 * the engine only ever sees IProvider.
 */

import type { IProvider } from "./IProvider.js";
import type { ProviderCredentials, ProviderId } from "./types.js";

type ProviderFactory = (credentials: ProviderCredentials) => IProvider;

interface CachedProvider {
  instance: IProvider;
  credentialsKey: string;
}

const factories = new Map<ProviderId, ProviderFactory>();
const instances = new Map<ProviderId, CachedProvider>();

export function registerProviderFactory(
  id: ProviderId,
  factory: ProviderFactory,
): void {
  factories.set(id, factory);
}

/**
 * Structural key for credentials so a cache hit can be invalidated when the
 * caller's credentials have actually changed (e.g. re-auth with a different
 * account), instead of always returning whatever instance happened to be
 * built first regardless of what's passed in now.
 */
function credentialsKey(credentials: ProviderCredentials): string {
  return JSON.stringify(credentials);
}

export function getProvider(
  id: ProviderId,
  credentials: ProviderCredentials,
): IProvider {
  const key = credentialsKey(credentials);
  const cached = instances.get(id);
  if (cached && cached.credentialsKey === key) {
    return cached.instance;
  }

  const factory = factories.get(id);
  if (!factory) {
    throw new Error(
      `Provider "${id}" is not registered. Did you import its implementation?`,
    );
  }
  const instance = factory(credentials);
  instances.set(id, { instance, credentialsKey: key });
  return instance;
}

/** Drop a cached instance (e.g. after credentials change). */
export function resetProvider(id: ProviderId): void {
  instances.delete(id);
}

export function getRegisteredProviderIds(): ProviderId[] {
  return [...factories.keys()];
}
