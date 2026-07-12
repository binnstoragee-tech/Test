/* =========================================================
   PAGE TRANSITIONS — iOS push / pop logic
   Include on every page, before </body>, with `defer`.

   Usage on links:
   - normal link  → plays as a forward "push" (slide in from right)
   - back link    → add  data-pt-back  attribute to play "pop"
                    (slide in from left), e.g.
                    <a href="index.html" data-pt-back>← Back</a>
   ========================================================= */

(function () {
  const DURATION = 420; // must match --pt-duration
  const KEY = "pt-direction";

  // 1. make sure the sliding wrapper + dim veil exist
  function ensureScaffold() {
    if (!document.querySelector("[data-pt-content]")) {
      // no wrapper found — auto-wrap <main>, or warn in console
      const main = document.querySelector("main");
      if (main) {
        main.setAttribute("data-pt-content", "");
      } else {
        console.warn("[page-transitions] No [data-pt-content] element found. Wrap your page content in <main data-pt-content> for the slide to work.");
      }
    }
    if (!document.getElementById("pt-veil")) {
      const veil = document.createElement("div");
      veil.id = "pt-veil";
      document.body.appendChild(veil);
    }
  }

  ensureScaffold();

  // 2. figure out which way we arrived (push = forward, pop = back)
  const arrivedAs = sessionStorage.getItem(KEY) || "push";
  sessionStorage.removeItem(KEY);
  document.body.classList.add(arrivedAs === "pop" ? "pt-enter-pop" : "pt-enter-push");

  // 3. intercept internal link clicks
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link) return;

    const url = link.getAttribute("href");
    if (!url) return;

    const isExternal   = link.target === "_blank" || link.hasAttribute("download");
    const isAnchor     = url.startsWith("#");
    const isOtherProto = /^[a-z]+:/i.test(url) && !url.startsWith(window.location.origin);
    const isSameOrigin = !/^https?:\/\//i.test(url) || url.startsWith(window.location.origin);

    if (isExternal || isAnchor || isOtherProto || !isSameOrigin) return; // let browser handle normally

    e.preventDefault();

    const goingBack = link.hasAttribute("data-pt-back");
    sessionStorage.setItem(KEY, goingBack ? "pop" : "push");

    document.body.classList.remove("pt-enter-push", "pt-enter-pop");
    document.body.classList.add(goingBack ? "pt-leave-pop" : "pt-leave-push");

    setTimeout(() => {
      window.location.href = url;
    }, DURATION);
  });

  // 4. restore cleanly if the page is served from bfcache (browser back/forward buttons)
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      document.body.classList.remove("pt-leave-push", "pt-leave-pop");
      document.body.classList.add("pt-enter-pop");
    }
  });
})();
