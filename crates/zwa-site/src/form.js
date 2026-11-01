// Contact forms (theme: form.html). Sends with fetch so the page stays,
// blocks double submits, and resets Turnstile after a failure (its tokens
// are single-use).
for (const form of document.querySelectorAll("form[data-zwa-form]")) {
  const status = form.querySelector(".form-status");
  const button = form.querySelector('button[type="submit"]');
  // One per form view: if a response is lost and the visitor resends, the
  // Worker stores the submission only once.
  const nonce = crypto.randomUUID();

  // A radio group can't be emptied by clicking, so optional ones get a
  // button that clears the choice. It shows only while something is chosen.
  for (const clear of form.querySelectorAll("[data-zwa-clear]")) {
    const group = clear.closest("fieldset");
    const radios = group.querySelectorAll('input[type="radio"]');
    const update = () => (clear.hidden = ![...radios].some((r) => r.checked));
    group.addEventListener("change", update);
    clear.addEventListener("click", () => {
      for (const r of radios) r.checked = false;
      update();
      radios[0]?.focus();
    });
    update();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (button.disabled) return;
    if (form.hasAttribute("data-preview")) {
      status.textContent = form.dataset.msgPreview;
      return;
    }
    button.disabled = true;
    status.textContent = form.dataset.msgSending;
    const body = new FormData(form);
    body.set("_zwa_nonce", nonce);
    let error = form.dataset.msgFailed;
    try {
      const res = await fetch(form.action, { method: "POST", body });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.ok) {
        const done = document.createElement("p");
        done.className = "form-done";
        done.textContent = form.dataset.msgSuccess;
        form.replaceWith(done);
        return;
      }
      if (result.error) error = result.error;
    } catch {
      // Network error: keep the generic message.
    }
    status.textContent = error;
    const widget = form.querySelector(".cf-turnstile");
    if (window.turnstile && widget) window.turnstile.reset(widget);
    button.disabled = false;
  });
}
