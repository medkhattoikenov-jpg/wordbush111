"use strict";
window.WR = {
  session: null,
  html: (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    ),
  number: (value) => Number(value || 0).toLocaleString("en-US"),
  async request(url, options = {}) {
    const method = options.method || "GET";
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(method !== "GET"
          ? { "X-CSRF-Token": this.session?.csrfToken || "" }
          : {}),
        ...options.headers,
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const data = await response.json().catch(() => ({
      message: "The server returned an unexpected response.",
    }));
    if (!response.ok) {
      const error = new Error(data.message || "Request failed.");
      error.status = response.status;
      error.details = data.details;
      throw error;
    }
    return data;
  },
  async initialize() {
    this.session = await this.request("/api/session");
    return this.session;
  },
  async logout() {
    await this.request("/api/auth/logout", { method: "POST", body: {} });
    const prefix = `wordrush:draft:${this.session.user.id}:`;
    for (const key of Object.keys(localStorage))
      if (key.startsWith(prefix)) localStorage.removeItem(key);
    location.href = "/login";
  },
  errorText: (error) => [error.message, ...(error.details || [])].join("\n"),
};
