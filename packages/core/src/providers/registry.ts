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

const factories = new Map<ProviderId, ProviderFactory>();
const instances = new Map<ProviderId, IProvider>();

export function registerProviderFactory(
  id: ProviderId,
  factory: ProviderFactory,
): void {
  factories.set(id, factory);
}

export function getProvider(
  id: ProviderId,
  credentials: ProviderCredentials,
): IProvider {
  let instance = instances.get(id);
  if (!instance) {
    const factory = factories.get(id);
    if (!factory) {
      throw new Error(
        `Provider "${id}" is not registered. Did you import its implementation?`,
      );
    }
    instance = factory(credentials);
    instances.set(id, instance);
  }
  return instance;
}

/** Drop a cached instance (e.g. after credentials change). */
export function resetProvider(id: ProviderId): void {
  instances.delete(id);
}

export function getRegisteredProviderIds(): ProviderId[] {
  return [...factories.keys()];
}
