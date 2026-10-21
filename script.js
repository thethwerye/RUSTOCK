(() => {
  "use strict";

  const config = window.RUSTOCK_CONFIG || {};
  const productsEl = document.getElementById("products");
  const searchEl = document.getElementById("search");
  const sortEl = document.getElementById("sort");
  const countEl = document.getElementById("results-count");
  const emptyEl = document.getElementById("empty-state");
  const statusEl = document.getElementById("status-message");
  const clearEl = document.getElementById("clear-filters");
  const dialog = document.getElementById("product-dialog");
  const detailsEl = document.getElementById("product-details");
  const paginationEl = document.getElementById("catalog-pagination");
  const pageSize = 24;

  let supabase = null;
  let pageProducts = [];
  let activeFilter = "all";
  let currentPage = 1;
  let totalProducts = 0;
  let requestSequence = 0;
  let searchTimer = null;

  const configured = () =>
    Boolean(
      config.SUPABASE_URL &&
      config.SUPABASE_ANON_KEY &&
      !String(config.SUPABASE_URL).includes("ВСТАВЬТЕ") &&
      !String(config.SUPABASE_ANON_KEY).includes("ВСТАВЬТЕ")
    );

  const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  const formatPrice = value => {
    const amount = Number(value);
    return Number.isFinite(amount)
      ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(amount) + " ₽"
      : "Цена по запросу";
  };

  const imageOrPlaceholder = (url, alt = "") => url
    ? `<img class="product-image" src="${escapeHTML(url)}" alt="${escapeHTML(alt)}" loading="lazy" decoding="async">`
    : `<div class="image-placeholder">RUSTOCK</div>`;

  function safeSearchTerm(value) {
    // Remove PostgREST filter syntax and wildcard characters from user input.
    return String(value || "")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function updateClearButton() {
    clearEl.hidden = !(searchEl.value.trim() || activeFilter !== "all" || sortEl.value !== "newest");
  }

  function renderPagination() {
    if (!paginationEl) return;
    const pages = Math.max(1, Math.ceil(totalProducts / pageSize));
    if (totalProducts <= pageSize) {
      paginationEl.innerHTML = "";
      paginationEl.hidden = true;
      return;
    }

    paginationEl.hidden = false;
    paginationEl.innerHTML = `
      <button class="pagination-button" type="button" data-page="${currentPage - 1}" ${currentPage <= 1 ? "disabled" : ""} aria-label="Предыдущая страница">← Назад</button>
      <span class="pagination-label">Страница ${currentPage} из ${pages}</span>
      <button class="pagination-button" type="button" data-page="${currentPage + 1}" ${currentPage >= pages ? "disabled" : ""} aria-label="Следующая страница">Далее →</button>
    `;

    paginationEl.querySelectorAll("[data-page]").forEach(button => {
      button.addEventListener("click", () => {
        const nextPage = Number(button.dataset.page);
        if (nextPage < 1 || nextPage > pages || nextPage === currentPage) return;
        currentPage = nextPage;
        loadCatalog();
        window.scrollTo({ top: productsEl.getBoundingClientRect().top + window.scrollY - 24, behavior: "smooth" });
      });
    });
  }

  function renderProducts() {
    productsEl.innerHTML = pageProducts.map(product => {
      const images = Array.isArray(product.images) ? product.images : [];
      const firstImage = images[0] || "";
      return `
        <article class="product-card" tabindex="0" role="button" data-id="${escapeHTML(product.id)}" aria-label="Открыть ${escapeHTML(product.name)}">
          <div class="product-image-wrap">
            ${imageOrPlaceholder(firstImage, product.name)}
            <span class="stock-badge">${product.available ? "В наличии" : "Под заказ"}</span>
          </div>
          <div class="product-info">
            <h2 class="product-name">${escapeHTML(product.name)}</h2>
            <div class="product-bottom">
              <span class="product-price">${formatPrice(product.price)}</span>
            </div>
          </div>
        </article>`;
    }).join("");

    countEl.textContent = totalProducts === 0
      ? "Товаров не найдено"
      : `Показано ${pageProducts.length} из ${totalProducts} товаров`;

    emptyEl.hidden = totalProducts !== 0;
    updateClearButton();
    renderPagination();

    productsEl.querySelectorAll(".product-card").forEach(card => {
      const open = () => {
        const product = pageProducts.find(item => String(item.id) === card.dataset.id);
        if (product) openProduct(product);
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
  }

  function openProduct(product) {
    const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
    const characteristics = product.characteristics && typeof product.characteristics === "object"
      ? product.characteristics : {};
    let currentIndex = 0;

    detailsEl.innerHTML = `
      <div class="product-details">
        <div class="detail-gallery">
          <div class="detail-image-stage">
            ${images.length
              ? `<img id="detail-main-image" class="detail-main-image" src="${escapeHTML(images[0])}" alt="${escapeHTML(product.name)}" decoding="async">`
              : `<div class="detail-main-image image-placeholder">RUSTOCK</div>`}
            ${images.length > 1 ? `
              <button class="detail-gallery-arrow detail-gallery-prev" type="button" aria-label="Предыдущее фото">‹</button>
              <button class="detail-gallery-arrow detail-gallery-next" type="button" aria-label="Следующее фото">›</button>
              <span class="detail-gallery-counter">1 / ${images.length}</span>
            ` : ""}
          </div>
          ${images.length > 1 ? `<div class="detail-thumbnails">
            ${images.map((url, index) => `
              <button class="detail-thumb ${index === 0 ? "active" : ""}" data-index="${index}" type="button" aria-label="Фото ${index + 1}" aria-pressed="${index === 0}">
                <img src="${escapeHTML(url)}" alt="" loading="lazy" decoding="async">
              </button>`).join("")}
          </div>` : ""}
        </div>
        <div class="detail-copy">
          <h2>${escapeHTML(product.name)}</h2>
          <p class="detail-price">${formatPrice(product.price)}</p>
          <span class="detail-status">${product.available ? "В наличии" : "Под заказ"}</span>
          ${product.description ? `<p class="detail-description">${escapeHTML(product.description)}</p>` : ""}
          ${Object.keys(characteristics).length ? `
            <h3 class="detail-section-title">Характеристики:</h3>
            <dl class="characteristics">
              ${Object.entries(characteristics)
                .filter(([key, value]) => String(key).trim() && String(value).trim())
                .map(([key, value]) => `<div class="characteristic-row"><dt>${escapeHTML(key)}</dt><dd>${escapeHTML(value)}</dd></div>`)
                .join("")}
            </dl>` : ""}
        </div>
      </div>`;

    const gallery = detailsEl.querySelector(".detail-gallery");
    const mainImage = detailsEl.querySelector("#detail-main-image");
    const counter = detailsEl.querySelector(".detail-gallery-counter");
    const thumbnails = detailsEl.querySelectorAll(".detail-thumb");

    function showImage(index) {
      if (!images.length || !mainImage) return;
      currentIndex = (index + images.length) % images.length;
      mainImage.src = images[currentIndex];
      mainImage.alt = `${product.name} — фото ${currentIndex + 1}`;
      if (counter) counter.textContent = `${currentIndex + 1} / ${images.length}`;
      thumbnails.forEach((button, i) => {
        const active = i === currentIndex;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }

    detailsEl.querySelector(".detail-gallery-prev")?.addEventListener("click", () => showImage(currentIndex - 1));
    detailsEl.querySelector(".detail-gallery-next")?.addEventListener("click", () => showImage(currentIndex + 1));
    thumbnails.forEach(button => button.addEventListener("click", () => showImage(Number(button.dataset.index))));

    if (gallery && images.length > 1) {
      let touchStartX = 0;
      let touchStartY = 0;
      gallery.addEventListener("touchstart", event => {
        touchStartX = event.changedTouches[0].clientX;
        touchStartY = event.changedTouches[0].clientY;
      }, { passive: true });
      gallery.addEventListener("touchend", event => {
        const deltaX = event.changedTouches[0].clientX - touchStartX;
        const deltaY = event.changedTouches[0].clientY - touchStartY;
        if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY)) {
          showImage(currentIndex + (deltaX < 0 ? 1 : -1));
        }
      }, { passive: true });
    }

    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  async function loadCatalog() {
    if (!configured()) {
      countEl.textContent = "Supabase ещё не настроен";
      statusEl.textContent = "Откройте config.js и укажите Project URL и публичный anon/publishable key из Supabase.";
      productsEl.removeAttribute("aria-busy");
      return;
    }

    const sequence = ++requestSequence;
    statusEl.textContent = "";
    countEl.textContent = "Загружаем каталог…";
    productsEl.setAttribute("aria-busy", "true");

    try {
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;
      const columns = "id,name,price,short_description,description,characteristics,images,available,created_at";
      let query = supabase.from("products").select(columns, { count: "exact" });

      if (activeFilter === "available") query = query.eq("available", true);
      if (activeFilter === "order") query = query.eq("available", false);

      const term = safeSearchTerm(searchEl.value);
      if (term) {
        const pattern = `%${term}%`;
        query = query.or(
          `name.ilike.${pattern},short_description.ilike.${pattern},description.ilike.${pattern}`
        );
      }

      switch (sortEl.value) {
        case "price-asc":
          query = query.order("price", { ascending: true }).order("created_at", { ascending: false });
          break;
        case "price-desc":
          query = query.order("price", { ascending: false }).order("created_at", { ascending: false });
          break;
        case "name":
          query = query.order("name", { ascending: true }).order("id", { ascending: true });
          break;
        default:
          query = query.order("created_at", { ascending: false }).order("id", { ascending: true });
      }

      const {data,error,count} = await Promise.race([
        query.range(from, to),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Превышено время ожидания Supabase")),
            10000
          )
        )
      ]);
      
      if (sequence !== requestSequence) return;
      if (error) throw error;

      totalProducts = count || 0;
      const maxPage = Math.max(1, Math.ceil(totalProducts / pageSize));
      if (currentPage > maxPage) {
        currentPage = maxPage;
        return loadCatalog();
      }

      pageProducts = data || [];
      renderProducts();
    } catch (error) {
      if (sequence !== requestSequence) return;
      pageProducts = [];
      totalProducts = 0;
      productsEl.innerHTML = "";
      paginationEl.hidden = true;
      countEl.textContent = "Не удалось загрузить каталог";
      statusEl.textContent = `Ошибка Supabase: ${error.message || String(error)}. Проверьте подключение и политики доступа.`;
    } finally {
      if (sequence === requestSequence) productsEl.removeAttribute("aria-busy");
    }
  }

  document.querySelectorAll(".tab").forEach(button => button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    currentPage = 1;
    document.querySelectorAll(".tab").forEach(item => item.classList.toggle("active", item === button));
    loadCatalog();
  }));

  searchEl.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      currentPage = 1;
      loadCatalog();
    }, 280);
  });

  sortEl.addEventListener("change", () => {
    currentPage = 1;
    loadCatalog();
  });

  clearEl.addEventListener("click", () => {
    searchEl.value = "";
    sortEl.value = "newest";
    activeFilter = "all";
    currentPage = 1;
    document.querySelectorAll(".tab").forEach(item => item.classList.toggle("active", item.dataset.filter === "all"));
    loadCatalog();
  });

  document.getElementById("close-dialog").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    detailsEl.innerHTML = "";
  });

  if (configured() && window.supabase?.createClient) {
    supabase = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    loadCatalog();
  } else {
    countEl.textContent = "Supabase ещё не настроен";
    statusEl.textContent = "Откройте config.js и укажите Project URL и публичный anon/publishable key из Supabase.";
    productsEl.removeAttribute("aria-busy");
  }
})();
