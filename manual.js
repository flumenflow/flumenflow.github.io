// Highlights the manual section in view in the table of contents.
(() => {
  const links = [...document.querySelectorAll(".toc a")];
  const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) {
      links.forEach((a) => a.classList.remove("on"));
      byId.get(e.target.id)?.classList.add("on");
    }
  }, { rootMargin: "-20% 0px -70% 0px" });
  document.querySelectorAll(".doc section").forEach((s) => io.observe(s));
})();
