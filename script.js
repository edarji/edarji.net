const header = document.querySelector("[data-header]");
const menuButton = document.querySelector(".menu-toggle");
const menuLabel = menuButton.querySelector(".sr-only");
const nav = document.querySelector(".site-nav");
const navLinks = [...document.querySelectorAll(".site-nav a")];
const sections = [...document.querySelectorAll("main section[id]")];

// Menú móvil: aria-expanded y el texto del botón dicen si está abierto; cerrado, sus enlaces no
// reciben foco (visibility en styles.css); Escape lo cierra y devuelve el foco al botón.
const setMenu = (open) => {
  menuButton.setAttribute("aria-expanded", String(open));
  menuLabel.textContent = open ? "Cerrar menú" : "Abrir menú";
  nav.classList.toggle("open", open);
  header.classList.toggle("menu-open", open);
  document.body.style.overflow = open ? "hidden" : "";
};
const isOpen = () => menuButton.getAttribute("aria-expanded") === "true";
const closeMenu = () => setMenu(false);

menuButton.addEventListener("click", () => setMenu(!isOpen()));

navLinks.forEach((link) => link.addEventListener("click", closeMenu));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isOpen()) {
    closeMenu();
    menuButton.focus();
  }
});

// Si el foco sale del encabezado con el menú abierto, se cierra para que el foco no quede tras el panel.
header.addEventListener("focusout", (event) => {
  if (isOpen() && event.relatedTarget && !header.contains(event.relatedTarget)) closeMenu();
});

window.addEventListener("scroll", () => {
  header.classList.toggle("scrolled", window.scrollY > 20);
}, { passive: true });

const revealObserver = new IntersectionObserver((entries, observer) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));

const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    navLinks.forEach((link) => {
      link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`);
    });
  });
}, { rootMargin: "-40% 0px -50%", threshold: 0 });

sections.forEach((section) => sectionObserver.observe(section));
document.querySelector("[data-year]").textContent = new Date().getFullYear();
