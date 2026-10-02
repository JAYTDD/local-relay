/** 面板 API 客户端。所有路径相对当前 origin，由 local-relay 同源托管。 */

async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`bad JSON from ${url}: ${text.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status} from ${url}`);
  return json;
}

export const api = {
  getHealth: () => req('GET', '/panel/api/health'),
  getTrae: () => req('GET', '/panel/api/trae'),
  getWorkBuddy: () => req('GET', '/panel/api/workbuddy'),
  getQoder: () => req('GET', '/panel/api/qoder'),
  postTraeRefresh: (region) => req('POST', `/panel/api/trae/refresh?region=${encodeURIComponent(region)}`),
  postTraeCheckin: (region) => req('POST', `/panel/api/trae/checkin?region=${encodeURIComponent(region)}`),
  postWorkBuddyControl: (variant, action) =>
    req('POST', `/panel/api/workbuddy/control?variant=${encodeURIComponent(variant)}`, action),
  postWorkBuddyProbe: (variant, model) =>
    req('POST', `/panel/api/workbuddy/probe?variant=${encodeURIComponent(variant)}`, { model }),
  postQoderRefresh: (variant) => req('POST', `/panel/api/qoder/refresh?variant=${encodeURIComponent(variant)}`),
  postQoderProbe: (variant, model) =>
    req('POST', `/panel/api/qoder/probe?variant=${encodeURIComponent(variant)}`, { model }),
};
