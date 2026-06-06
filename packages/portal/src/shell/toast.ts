export function showToast(msg: string) {
  const el = document.getElementById("toast")
  if (!el) return
  el.textContent = msg
  el.classList.add("show")
  window.setTimeout(() => el.classList.remove("show"), 2800)
}
