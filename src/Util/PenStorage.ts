const storageKey = "connected-pens";

export type DeviceDescription = {
  id: string;
  name?: string;
}

export const buildDeviceHash = ({ id, name }: DeviceDescription) => id + ":" + name;

export function storePen({ id, name }: DeviceDescription) {
  const stored = getStoredPens();
  const map = new Map(stored.map(device => [device.id, device]));

  map.set(id, { id, name })

  localStorage.setItem(storageKey, JSON.stringify([...map.values()]));
}

export function getStoredPens(): DeviceDescription[] {
  const storedJson = localStorage.getItem(storageKey);
  const stored = storedJson && JSON.parse(storedJson);

  return Array.isArray(stored) ? stored : [];
}

