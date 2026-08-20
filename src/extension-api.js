let injectedExtensionApi = null;

export function setExtensionApi(api) {
  injectedExtensionApi = api || null;
}

export function getExtensionApi() {
  return injectedExtensionApi || globalThis.browser || globalThis.chrome || null;
}

export function getExtensionStorageArea(area) {
  const api = getExtensionApi();

  if (!api?.storage?.[area]) {
    throw new Error(`extension storage ${area} is not available`);
  }

  return api.storage[area];
}

export function getExtensionUrl(path) {
  return getExtensionApi()?.runtime?.getURL?.(path) || path;
}
