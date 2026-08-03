export const WORKSPACE_URL_CHANGE_EVENT = "zzone:workspace-url-change";

export type WorkspaceUrlMode = "push" | "replace";

export type WorkspaceUrlPatch = Record<
  string,
  string | number | null | undefined
>;

export function readWorkspaceUrl() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function updateWorkspaceUrl(
  patch: WorkspaceUrlPatch,
  mode: WorkspaceUrlMode = "push"
) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  if (url.href === window.location.href) return;

  const method = mode === "replace" ? "replaceState" : "pushState";
  window.history[method](window.history.state, "", url);
  window.dispatchEvent(new Event(WORKSPACE_URL_CHANGE_EVENT));
}

export function subscribeWorkspaceUrl(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(WORKSPACE_URL_CHANGE_EVENT, listener);

  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(WORKSPACE_URL_CHANGE_EVENT, listener);
  };
}
