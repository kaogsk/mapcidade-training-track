/** Login form. Standalone (no imports): it loads before there is a session. */
const form = document.getElementById("loginForm") as HTMLFormElement;
const msg = document.getElementById("loginMsg") as HTMLElement;
const btn = form.querySelector("button") as HTMLButtonElement;

/** Only same-origin paths: `?next=https://evil.example` must not become an open redirect. */
function nextPath(): string {
  const n = new URLSearchParams(location.search).get("next") ?? "/";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = new FormData(form);
  btn.disabled = true;
  msg.textContent = "Signing in…";
  msg.className = "msg";
  try {
    const r = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
    });
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    if (r.ok) {
      location.href = nextPath();
      return;
    }
    msg.textContent = body.error ?? `Error ${r.status}`;
    msg.className = "msg err";
  } catch {
    msg.textContent = "Network error. Try again.";
    msg.className = "msg err";
  } finally {
    btn.disabled = false;
  }
});

export {};
